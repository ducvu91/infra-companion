import { BrowserWindow, Notification, ipcMain, type WebContents } from 'electron'
import { recordEvent } from './events'
import {
  COLUMNS_SQL,
  INDEXES_SQL,
  ReplAlertEngine,
  ReplicationService,
  TABLE_INVENTORY_SQL,
  VARS_SQL,
  buildChecksumRun,
  buildChecksumSql,
  buildCountSql,
  buildScanRun,
  clampPollInterval,
  diagnose,
  readMasterSnapshot,
  diffInventory,
  diffSchemaEntries,
  diffVariables,
  formatReplAlertText,
  normalizeColumns,
  normalizeIndexes,
  normalizeTableRows,
  normalizeVars,
  openEndpointProbe,
  readChecksumRow,
  readCountRow,
  readSample,
  variableRowsToMap,
  type ProbeSession,
  type ReplAlertEvent,
  type ReplCreds,
  type ReplAlertRules,
  type ReplEndpointTarget,
  type ReplPairTarget,
  type ReplReplicaTarget,
  type ReplRunBuild,
  type ReplSample
} from '@infra/core'
import {
  IPC,
  type ReplAlertDto,
  type ReplChecksumRowDto,
  type ReplCompareResultDto,
  type ReplPairDto,
  type ReplPairInput,
  type ReplRunDetailDto,
  type ReplRunDto,
  type ReplRunKind,
  type ReplSettingsDto,
  type ReplSnapshotDto,
  type ReplTestResultDto
} from '@infra/shared'
import { makeHostKeyVerifier, prepareConnection } from './connection'
import { postReplWebhook, readReplSettings, registerReplicationSettingsIpc } from './replicationSettings'
import { ensureTunnelRunning } from './tunnels'
import { getVault, touchActivity } from './vault'

/**
 * F55 — IPC cho theo dõi bất đồng bộ master ↔ slave. Cấu trúc sao y `monitor.ts`:
 * tập subscriber (nhiều cửa sổ), replay sample gần nhất cho cửa sổ mới, dispose khi thoát.
 *
 * MẬT KHẨU DB KHÔNG BAO GIỜ ĐI QUA IPC: renderer chỉ gửi `pairId`, main tự tra vault. DTO trả
 * về chỉ có `hasDbPassword`. Nghĩa là renderer bị lỗi cũng không làm rò credential.
 */
/** Trần số bảng cho một lần đếm/checksum — mỗi bảng là một lần quét toàn bộ ở CẢ HAI server. */
const MAX_CHECKSUM_TABLES = 50

/** ReplAlertRules cho engine = settings bỏ phần webhook/osNotify. */
function toRules(s: ReplSettingsDto): ReplAlertRules {
  return { defaults: s.defaults, perPair: s.perPair }
}

/** Khoá snapshot: một cụm phát nhiều sample, mỗi slave một cái. */
const snapshotKey = (pairId: string, replicaId: string): string => `${pairId}::${replicaId}`

export function registerReplicationIpc(): () => void {
  const service = new ReplicationService()
  const subscribers = new Set<WebContents>()
  /** Kết quả mới nhất mỗi SLAVE — replay ngay cho cửa sổ vừa mở, khỏi phải chờ chu kỳ kế. */
  const lastSnapshots = new Map<string, ReplSnapshotDto>()
  /**
   * Tên cụm ghi lúc bắt đầu theo dõi — dựng thông báo/webhook KHÔNG cần vault (có thể đang khoá).
   * Cùng lý do với `labels` của monitor.ts.
   */
  const labels = new Map<string, string>()

  let settings = readReplSettings()
  const engine = new ReplAlertEngine(toRules(settings))

  const addSubscriber = (sender: WebContents): void => {
    if (subscribers.has(sender)) return
    subscribers.add(sender)
    sender.once('destroyed', () => subscribers.delete(sender))
  }

  const broadcast = (channel: string, payload: unknown): void => {
    for (const subscriber of subscribers) {
      if (!subscriber.isDestroyed()) subscriber.send(channel, payload)
    }
  }

  /**
   * Chẩn đoán tính ở đây (main) để cửa sổ tách rời dùng chung và renderer khỏi kéo @infra/core.
   * Ngưỡng trễ của chẩn đoán bám theo đúng ngưỡng cảnh báo user đã đặt — nếu không, panel sẽ nói
   * "trễ bình thường" trong khi notification đang kêu (hoặc ngược lại).
   */
  const toSnapshot = (sample: ReplSample): ReplSnapshotDto => {
    const perPair = settings.perPair[sample.pairId]
    const lagWarnSec = perPair?.lagSec !== undefined ? perPair.lagSec : settings.defaults.lagSec
    const applyGap = perPair?.applyGapBytes !== undefined ? perPair.applyGapBytes : settings.defaults.applyGapBytes
    return {
      sample,
      diagnoses: diagnose(sample, {
        ...(lagWarnSec !== null ? { lagWarnSec } : {}),
        ...(applyGap !== null ? { applyGapWarnBytes: applyGap } : {})
      })
    }
  }

  /** Phát 1 cảnh báo ra 3 kênh: renderer toast, OS notification (chỉ breach), webhook. */
  const dispatch = (alert: ReplAlertEvent): void => {
    // Nhãn gộp "<cụm> · <slave>": cụm nhiều slave thì thông báo phải chỉ rõ con nào
    const pairName = labels.get(alert.pairId) ?? alert.pairId
    const label = alert.replicaLabel ? `${pairName} · ${alert.replicaLabel}` : pairName
    const dto: ReplAlertDto = { ...alert, label, text: formatReplAlertText({ ...alert, label }) }
    broadcast(IPC.REPL_ALERT, dto)
    // Trung tâm thông báo: replication không gắn một host cụ thể (cụm master + slave) → hostId null
    recordEvent({
      kind: dto.kind === 'breach' ? 'alert' : 'recover',
      source: 'replication',
      severity: dto.kind === 'breach' ? 'warning' : 'info',
      hostId: null,
      title: dto.text
    })
    if (dto.kind === 'breach' && settings.osNotify && Notification.isSupported()) {
      const notification = new Notification({
        title: 'Infra Companion — replication',
        body: dto.text
      })
      notification.on('click', () => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win) {
          if (win.isMinimized()) win.restore()
          win.focus()
        }
      })
      notification.show()
    }
    if (settings.webhookUrl) postReplWebhook(settings.webhookUrl, dto)
  }

  service.on('sample', (sample: ReplSample) => {
    const snapshot = toSnapshot(sample)
    lastSnapshots.set(snapshotKey(sample.pairId, sample.replicaId), snapshot)
    broadcast(IPC.REPL_SAMPLE, snapshot)
    for (const alert of engine.onSample(sample)) dispatch(alert)
  })

  /** Xoá mọi snapshot của một cụm (đổi cấu hình / bỏ theo dõi / xoá cụm). */
  const forgetPair = (pairId: string): void => {
    for (const key of [...lastSnapshots.keys()]) {
      if (key.startsWith(`${pairId}::`)) lastSnapshots.delete(key)
    }
  }

  /**
   * Dựng target cho service: tra cụm trong vault, resolve đường tới master + TỪNG slave.
   * `prepareConnection` sẽ hỏi renderer mật khẩu SSH còn thiếu (theo thứ tự hop).
   */
  async function buildTarget(sender: WebContents, pairId: string): Promise<ReplPairTarget> {
    touchActivity()
    const vault = getVault()
    const pair = vault.getReplPair(pairId)
    if (!pair) throw new Error('Cụm replication không tồn tại')
    // Credential ĐÃ áp fallback (đầu nào khai riêng thì thắng, không thì lấy mặc định của cụm)
    const creds = vault.getReplCredentials(pairId)
    // Ghi tên NGAY tại đây: sau này vault khoá lại vẫn dựng được nội dung thông báo/webhook
    labels.set(pairId, pair.name)

    const common = {
      probeMode: pair.probeMode,
      dbPort: pair.dbPort,
      cliBinary: pair.cliBinary || undefined
    }
    /** Rỗng = dùng credential sẵn trên server (~/.my.cnf / unix_socket auth). */
    const withCreds = (c: { user: string; password: string }) => ({
      dbUser: c.user || undefined,
      dbPassword: c.password || undefined
    })

    /**
     * Đọc MySQL qua TUNNEL đã lưu: bật tunnel (nếu chưa) rồi nối thẳng vào đầu local của nó.
     * KHÔNG cần dựng chain SSH riêng — TunnelService đã giữ kết nối và đã chọn đúng đường
     * (`nc` trên máy sâu khi via-host vào bằng login script).
     */
    const viaTunnel = async (tunnelId: string, dbPort: number, c: ReplCreds): Promise<ReplEndpointTarget> => {
      const rule = await ensureTunnelRunning(sender, tunnelId)
      return {
        ...common,
        ...withCreds(c),
        dbPort,
        hostId: rule.hostId,
        chain: [],
        localAddress: { host: rule.bindHost || '127.0.0.1', port: rule.bindPort }
      }
    }

    const viaHost = async (hostId: string, dbPort: number, c: ReplCreds): Promise<ReplEndpointTarget> => {
      const prepared = await prepareConnection(sender, hostId)
      return { ...common, ...withCreds(c), dbPort, hostId, chain: prepared.chain, loginSteps: prepared.loginSteps }
    }

    const endpoint = (
      hostId: string,
      tunnelId: string | null,
      dbPort: number,
      c: ReplCreds
    ): Promise<ReplEndpointTarget> =>
      tunnelId ? viaTunnel(tunnelId, dbPort, c) : viaHost(hostId, dbPort, c)

    const hostLabel = (hostId: string): string => getVault().getHost(hostId)?.label ?? hostId

    // Mở đường tới TỪNG slave. Một slave hỏng (host bị xoá, tunnel chết) không được chặn cả cụm:
    // ném ở đây sẽ làm start() hỏng hết, nên slave lỗi vẫn vào danh sách và để service báo
    // sample lỗi riêng cho nó.
    const replicas: ReplReplicaTarget[] = []
    for (const replica of pair.replicas) {
      const label = replica.label || hostLabel(replica.hostId)
      const c = creds.replicas[replica.id] ?? creds.cluster
      try {
        replicas.push({
          ...(await endpoint(replica.hostId, replica.tunnelId, replica.dbPort, c)),
          replicaId: replica.id,
          label
        })
      } catch (error) {
        // Endpoint hỏng → target "què" (chain rỗng, không localAddress) để probe ném đúng lỗi này
        replicas.push({
          ...common,
          ...withCreds(c),
          dbPort: replica.dbPort,
          hostId: replica.hostId,
          chain: [],
          probeMode: 'driver',
          replicaId: replica.id,
          label,
          brokenReason: error instanceof Error ? error.message : String(error)
        })
      }
    }

    return {
      pairId,
      replicas,
      master: pair.masterHostId
        ? await endpoint(pair.masterHostId, pair.masterTunnelId, pair.dbPort, creds.master)
        : null,
      pollIntervalMs: clampPollInterval(pair.pollIntervalSec * 1000)
    }
  }

  // --- CRUD cụm ------------------------------------------------------------

  ipcMain.handle(IPC.REPL_LIST_PAIRS, (): ReplPairDto[] => {
    touchActivity()
    return getVault().listReplPairs()
  })

  ipcMain.handle(IPC.REPL_SAVE_PAIR, (_event, input: ReplPairInput): ReplPairDto => {
    touchActivity()
    const saved = getVault().saveReplPair(input)
    labels.set(saved.id, saved.name)
    // Cấu hình đổi (thêm/bớt slave, port, credential…) → kết nối đang chạy đã cũ, dừng để lần
    // watch sau dựng lại từ đầu
    if (input.id && service.isRunning(saved.id)) {
      service.stop(saved.id)
      engine.removePair(saved.id) // state cũ đo bằng cấu hình cũ, giữ lại là sai
      forgetPair(saved.id)
    }
    return saved
  })

  ipcMain.handle(IPC.REPL_DELETE_PAIR, (_event, id: string): void => {
    touchActivity()
    service.stop(id)
    engine.removePair(id)
    forgetPair(id)
    labels.delete(id)
    getVault().deleteReplPair(id)
  })

  // --- Đo ------------------------------------------------------------------

  /** Kiểm tra kết nối MỘT slave (mặc định slave đầu) + master của cụm. */
  ipcMain.handle(
    IPC.REPL_TEST_PAIR,
    async (event, pairId: string, replicaId?: string): Promise<ReplTestResultDto> => {
      let replicaSession: Awaited<ReturnType<typeof openEndpointProbe>> | null = null
      let masterSession: Awaited<ReturnType<typeof openEndpointProbe>> | null = null
      try {
        const target = await buildTarget(event.sender, pairId)
        const replica = replicaId ? target.replicas.find((r) => r.replicaId === replicaId) : target.replicas[0]
        if (!replica) return { ok: false, mode: null, message: 'Cụm này chưa khai slave nào' }

        replicaSession = await openEndpointProbe(replica, makeHostKeyVerifier(event.sender))
        if (target.master) {
          try {
            masterSession = await openEndpointProbe(target.master, makeHostKeyVerifier(event.sender))
          } catch {
            // Không nối được master vẫn là kết quả dùng được — snapshot sẽ ghi masterError
          }
        }
        const snapshot = await readMasterSnapshot(masterSession, Date.now())
        const sample = await readSample(
          pairId,
          { replicaId: replica.replicaId, label: replica.label, session: replicaSession },
          snapshot,
          Date.now()
        )
        if (!sample.ok) return { ok: false, mode: sample.mode, message: sample.error ?? 'Không đọc được trạng thái' }
        if (!sample.replica) {
          return { ok: false, mode: sample.mode, message: `${replica.label}: kết nối được nhưng chưa cấu hình làm replica` }
        }
        // Nói rõ đã đi đường nào: user cần biết để phân biệt "chưa bật tunnel" với "sai credential"
        const via = replica.localAddress
          ? `tunnel ${replica.localAddress.host}:${replica.localAddress.port}`
          : sample.mode === 'driver'
            ? 'driver MySQL trực tiếp'
            : 'lệnh mysql qua SSH'
        const masterNote = sample.masterError ? ` · KHÔNG đọc được master: ${sample.masterError}` : ''
        return { ok: true, mode: sample.mode, message: `${replica.label}: đọc được qua ${via}${masterNote}` }
      } catch (error) {
        return { ok: false, mode: null, message: error instanceof Error ? error.message : String(error) }
      } finally {
        replicaSession?.probe.close()
        masterSession?.probe.close()
      }
    }
  )

  ipcMain.handle(IPC.REPL_WATCH, async (event, pairId: string): Promise<void> => {
    addSubscriber(event.sender)
    const target = await buildTarget(event.sender, pairId)
    await service.start(target, makeHostKeyVerifier(event.sender))
  })

  ipcMain.on(IPC.REPL_UNWATCH, (_event, pairId: string) => {
    service.stop(pairId)
    engine.removePair(pairId) // KHÔNG phát recover — dừng theo dõi ≠ đã hết sự cố
    forgetPair(pairId)
  })

  ipcMain.handle(IPC.REPL_POLL_NOW, async (event, pairId: string): Promise<void> => {
    addSubscriber(event.sender)
    touchActivity()
    if (!service.isRunning(pairId)) {
      // Chưa theo dõi thì start luôn — "xem khi mở panel" và "theo dõi nền" dùng chung một đường
      const target = await buildTarget(event.sender, pairId)
      await service.start(target, makeHostKeyVerifier(event.sender))
      return
    }
    await service.pollNow(pairId)
  })

  ipcMain.on(IPC.REPL_SUBSCRIBE, (event) => {
    addSubscriber(event.sender)
    for (const snapshot of lastSnapshots.values()) {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.REPL_SAMPLE, snapshot)
    }
  })

  // --- So lệch thực tế (chạy theo yêu cầu) ---------------------------------

  /**
   * Mở probe cho cả 2 đầu, chạy `run`, rồi ĐÓNG. Cố ý không dùng lại kết nối của watcher nền:
   * `CHECKSUM TABLE` chạy hàng phút và sẽ chặn chu kỳ đo trạng thái nếu dùng chung.
   */
  async function withBothProbes<T>(
    sender: WebContents,
    pairId: string,
    replicaId: string | undefined,
    run: (master: ProbeSession, replica: ProbeSession) => Promise<T>
  ): Promise<T> {
    const target = await buildTarget(sender, pairId)
    if (!target.master) throw new Error('Cụm này chưa khai báo master nên không so lệch được')
    const replicaTarget = replicaId ? target.replicas.find((r) => r.replicaId === replicaId) : target.replicas[0]
    if (!replicaTarget) throw new Error('Không tìm thấy slave để so lệch')
    const verify = makeHostKeyVerifier(sender)
    const replica = await openEndpointProbe(replicaTarget, verify)
    let master: ProbeSession | null = null
    try {
      master = await openEndpointProbe(target.master, verify)
      return await run(master, replica)
    } finally {
      master?.probe.close()
      replica.probe.close()
    }
  }

  /**
   * F59 — ghi lại một lần so lệch. Nhãn cụm/slave/master SAO CHÉP tại đây: cụm đổi tên hay bị
   * xoá sau này thì bản ghi cũ vẫn nói đúng lúc đó nó so cái gì với cái gì.
   *
   * KHÔNG BAO GIỜ để việc lưu làm hỏng kết quả đo — user cần con số vừa quét hơn là cuốn sổ.
   * Lỗi ghi log ra console (chỉ xảy ra khi vault khoá, mà lối này thì vault đã phải mở).
   */
  function saveRun(pairId: string, replicaId: string | undefined, kind: ReplRunKind, build: ReplRunBuild): void {
    try {
      const vault = getVault()
      const pair = vault.getReplPair(pairId)
      const replica = replicaId ? pair?.replicas.find((r) => r.id === replicaId) : pair?.replicas[0]
      const hostLabel = (hostId: string | null | undefined): string =>
        hostId ? (vault.getHost(hostId)?.label ?? hostId) : ''
      vault.saveReplRun({
        pairId,
        pairName: pair?.name ?? pairId,
        replicaId: replica?.id ?? replicaId ?? '',
        replicaLabel: replica?.label || hostLabel(replica?.hostId),
        masterLabel: hostLabel(pair?.masterHostId),
        kind,
        counts: build.counts,
        payload: build.payload
      })
    } catch (error) {
      console.error('[repl] cannot save comparison history:', error)
    }
  }

  ipcMain.handle(IPC.REPL_HISTORY_LIST, (_event, pairId?: string): ReplRunDto[] => {
    touchActivity()
    return getVault().listReplRuns(pairId)
  })

  ipcMain.handle(IPC.REPL_HISTORY_GET, (_event, id: string): ReplRunDetailDto | null => {
    touchActivity()
    return getVault().getReplRun(id)
  })

  ipcMain.handle(IPC.REPL_HISTORY_DELETE, (_event, id: string): void => {
    touchActivity()
    getVault().deleteReplRun(id)
  })

  ipcMain.handle(IPC.REPL_HISTORY_CLEAR, (_event, pairId?: string): number => {
    touchActivity()
    return getVault().clearReplRuns(pairId)
  })

  ipcMain.handle(IPC.REPL_COMPARE, async (event, pairId: string, replicaId?: string): Promise<ReplCompareResultDto> => {
    const empty = { tables: [], columns: [], indexes: [], variables: [], hasFilters: false }
    try {
      return await withBothProbes(event.sender, pairId, replicaId, async (master, replica) => {
        const [mTables, rTables] = await Promise.all([
          master.probe.queryRows(TABLE_INVENTORY_SQL),
          replica.probe.queryRows(TABLE_INVENTORY_SQL)
        ])
        const [mCols, rCols] = await Promise.all([
          master.probe.queryRows(COLUMNS_SQL),
          replica.probe.queryRows(COLUMNS_SQL)
        ])
        const [mIdx, rIdx] = await Promise.all([
          master.probe.queryRows(INDEXES_SQL),
          replica.probe.queryRows(INDEXES_SQL)
        ])
        // Lấy bộ lọc replication từ sample gần nhất CỦA CHÍNH SLAVE ĐÓ để đánh dấu chênh lệch CỐ Ý
        const key = replicaId ? snapshotKey(pairId, replicaId) : null
        const snapshot = key
          ? lastSnapshots.get(key)
          : [...lastSnapshots.entries()].find(([k]) => k.startsWith(`${pairId}::`))?.[1]
        const filters = snapshot?.sample.replica?.filters
        const [mVars, rVars] = await Promise.all([
          master.probe.queryRows(VARS_SQL),
          replica.probe.queryRows(VARS_SQL)
        ])
        const result: ReplCompareResultDto = {
          ok: true,
          tables: diffInventory(normalizeTableRows(mTables), normalizeTableRows(rTables), { filters }),
          columns: diffSchemaEntries(normalizeColumns(mCols), normalizeColumns(rCols)),
          indexes: diffSchemaEntries(normalizeIndexes(mIdx), normalizeIndexes(rIdx)),
          variables: diffVariables(
            normalizeVars(variableRowsToMap(mVars)),
            normalizeVars(variableRowsToMap(rVars))
          ),
          hasFilters: filters?.any ?? false
        }
        // Lưu NGAY, không đợi user bấm gì: lần quét sau sẽ ghi đè kết quả trên màn hình, và cái
        // mất đi đúng là thứ cần để đối chiếu khi vá dữ liệu ở những ngày sau.
        saveRun(pairId, replicaId, 'scan', buildScanRun(result))
        return result
      })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), ...empty }
    }
  })

  ipcMain.handle(
    IPC.REPL_CHECKSUM,
    async (
      event,
      pairId: string,
      tables: Array<{ schema: string; name: string }>,
      mode: 'count' | 'checksum',
      replicaId?: string
    ): Promise<ReplChecksumRowDto[]> => {
      // Trần cứng: mỗi bảng là một lần quét toàn bộ, chọn 500 bảng là tự bắn vào chân
      const picked = (tables ?? []).slice(0, MAX_CHECKSUM_TABLES)
      try {
        return await withBothProbes(event.sender, pairId, replicaId, async (master, replica) => {
          const out: ReplChecksumRowDto[] = []
          for (const t of picked) {
            const row: ReplChecksumRowDto = {
              schema: t.schema,
              name: t.name,
              masterCount: null,
              replicaCount: null,
              masterChecksum: null,
              replicaChecksum: null
            }
            try {
              // buildCountSql/buildChecksumSql TỪ CHỐI tên có ký tự lạ → ghi lỗi vào đúng dòng
              // của bảng đó thay vì bỏ qua im lặng.
              const sql = mode === 'count' ? buildCountSql(t.schema, t.name) : buildChecksumSql(t.schema, t.name)
              const [m, r] = await Promise.all([master.probe.queryRows(sql), replica.probe.queryRows(sql)])
              if (mode === 'count') {
                row.masterCount = readCountRow(m)
                row.replicaCount = readCountRow(r)
              } else {
                row.masterChecksum = readChecksumRow(m)
                row.replicaChecksum = readChecksumRow(r)
              }
            } catch (error) {
              row.error = error instanceof Error ? error.message : String(error)
            }
            out.push(row)
          }
          saveRun(pairId, replicaId, mode, buildChecksumRun(out))
          return out
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return picked.map((t) => ({
          schema: t.schema,
          name: t.name,
          masterCount: null,
          replicaCount: null,
          masterChecksum: null,
          replicaChecksum: null,
          error: message
        }))
      }
    }
  )

  registerReplicationSettingsIpc((s) => {
    settings = s
    engine.setRules(toRules(s))
  })

  return () => {
    service.stopAll()
  }
}
