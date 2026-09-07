import { connect } from 'node:net'
import { ipcMain, type WebContents } from 'electron'
import { IPC, type WatcherStatusDto, type WatcherTargetDto } from '@infra/shared'
import { recordEvent } from './events'

/** Chu kỳ sweep. */
const SWEEP_INTERVAL_MS = 60_000
/** Timeout mỗi lần TCP connect. */
const CONNECT_TIMEOUT_MS = 5_000

/** 1 lần TCP connect tới host:port — đo latency, không gửi byte nào (chỉ SYN/ACK rồi đóng). */
function checkTcp(host: string, port: number): Promise<{ ok: boolean; latencyMs: number | null }> {
  return new Promise((resolve) => {
    const started = Date.now()
    let settled = false
    const done = (ok: boolean): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve({ ok, latencyMs: ok ? Date.now() - started : null })
    }
    const socket = connect({ host, port, timeout: CONNECT_TIMEOUT_MS })
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/**
 * F39 — Uptime/port watcher nền: TCP check cả fleet mỗi 60s KHÔNG mở session SSH.
 * Renderer đặt danh sách target (start = THAY tập cũ + sweep ngay); kết quả bắn về
 * qua WATCHER_STATUS (mảng đủ target mỗi sweep). Best-effort: host sau login-script
 * gate check tới địa chỉ gate — vẫn có giá trị "gate còn sống".
 */
export function registerWatcherIpc(): () => void {
  let targets: WatcherTargetDto[] = []
  let subscriber: WebContents | null = null
  let timer: NodeJS.Timeout | null = null
  let sweeping = false
  /** Kết quả lần trước theo host — chỉ ghi sự kiện khi ĐỔI trạng thái (down↔up), không ghi mỗi sweep. */
  const lastOk = new Map<string, boolean>()

  const sweep = async (): Promise<void> => {
    if (sweeping || targets.length === 0) return // sweep trước còn dở (mạng chậm) → bỏ lượt
    sweeping = true
    try {
      const snapshot = targets
      const results: WatcherStatusDto[] = await Promise.all(
        snapshot.map(async (t) => {
          const r = await checkTcp(t.host, t.port)
          return { hostId: t.hostId, ok: r.ok, latencyMs: r.latencyMs, ts: Date.now() }
        })
      )
      if (subscriber && !subscriber.isDestroyed()) subscriber.send(IPC.WATCHER_STATUS, results)
      // Trung tâm thông báo: lần đầu thấy host (chưa có "trước") thì không ghi — chưa biết ≠ vừa đổi
      for (const [i, r] of results.entries()) {
        const before = lastOk.get(r.hostId)
        lastOk.set(r.hostId, r.ok)
        if (before === undefined || before === r.ok) continue
        const t = snapshot[i]!
        const label = t.label ?? t.host
        recordEvent(
          r.ok
            ? { kind: 'recover', source: 'watcher', severity: 'info', hostId: r.hostId, title: `✅ [${label}] phản hồi lại`, ts: r.ts }
            : {
                kind: 'alert',
                source: 'watcher',
                severity: 'critical',
                hostId: r.hostId,
                title: `🔴 [${label}] không phản hồi`,
                detail: `TCP ${t.host}:${t.port} không mở trong ${CONNECT_TIMEOUT_MS / 1000}s`,
                ts: r.ts
              }
        )
      }
    } finally {
      sweeping = false
    }
  }

  const stop = (): void => {
    targets = []
    lastOk.clear() // bật lại watcher = bắt đầu quan sát mới, không ghi "đổi trạng thái" so với phiên trước
    if (timer) clearInterval(timer)
    timer = null
  }

  // Renderer gọi start lại mỗi khi hosts đổi — chỉ gắn listener 'destroyed' 1 lần/sender
  const watched = new WeakSet<WebContents>()

  ipcMain.on(IPC.WATCHER_START, (event, list: WatcherTargetDto[]) => {
    targets = Array.isArray(list) ? list : []
    subscriber = event.sender
    if (!watched.has(event.sender)) {
      watched.add(event.sender)
      event.sender.once('destroyed', () => stop())
    }
    if (!timer) timer = setInterval(() => void sweep(), SWEEP_INTERVAL_MS)
    void sweep() // kết quả đầu ngay, không chờ 60s
  })

  ipcMain.on(IPC.WATCHER_STOP, () => stop())

  return stop
}
