import { app, ipcMain, Notification, BrowserWindow, type WebContents } from 'electron'
import { join } from 'node:path'
import { AlertEngine, MetricsStore, MonitorService, buildWebhookRequest, formatAlertText, type AlertRules } from '@infra/core'
import { IPC, type MonitorAlertDto, type MonitorSettingsDto } from '@infra/shared'
import { touchActivity } from './vault'
import { makeHostKeyVerifier, prepareConnection } from './connection'
import { recordEvent } from './events'
import { postWebhook, readMonitorSettings, registerMonitorSettingsIpc } from './monitorSettings'

/** AlertRules cho engine = settings bỏ phần webhook/osNotify. */
function toRules(s: MonitorSettingsDto): AlertRules {
  return { defaults: s.defaults, perHost: s.perHost }
}

/**
 * Theo dõi tài nguyên host (CPU load/mem/disk/uptime) qua SSH. Trả về hàm dispose.
 * F04/F32 cắm tại event 'sample': đánh giá ngưỡng (AlertEngine) + ghi lịch sử (MetricsStore).
 */
export function registerMonitorIpc(): () => void {
  const service = new MonitorService()
  // Set thay vì 1 biến — biến đơn bị ghi đè khi có 2 cửa sổ/2 nơi cùng start
  const subscribers = new Set<WebContents>()
  // Sample mới nhất mỗi host — replay ngay cho subscriber mới (vd cửa sổ tách rời) để không phải chờ poll kế
  const lastSamples = new Map<string, import('@infra/shared').MetricSampleDto>()
  // Label host ghi lúc START (renderer gửi kèm) — dựng thông báo/webhook không cần vault (có thể đang khoá)
  const labels = new Map<string, string>()

  /** Thêm 1 WebContents vào tập nhận sample (idempotent) + tự gỡ khi cửa sổ đóng. */
  const addSubscriber = (sender: WebContents): void => {
    if (subscribers.has(sender)) return
    subscribers.add(sender)
    sender.once('destroyed', () => subscribers.delete(sender))
  }
  let settings = readMonitorSettings()
  const engine = new AlertEngine(toRules(settings))
  // Lazy: chỉ mở metrics.db khi thật sự cần (start monitor / xem lịch sử)
  let metrics: MetricsStore | null = null
  const getMetrics = (): MetricsStore => (metrics ??= new MetricsStore(join(app.getPath('userData'), 'metrics.db')))

  /** Phát 1 cảnh báo ra 3 kênh: renderer toast, OS notification (chỉ breach), webhook. */
  const dispatch = (alert: ReturnType<AlertEngine['onSample']>[number]): void => {
    const dto: MonitorAlertDto = { ...alert, label: labels.get(alert.hostId) ?? alert.hostId }
    for (const subscriber of subscribers) {
      if (!subscriber.isDestroyed()) subscriber.send(IPC.MONITOR_ALERT, dto)
    }
    // Kênh thứ 4: trung tâm thông báo (toast trôi là mất; đây là bản ghi còn lại + vạch trên biểu đồ)
    recordEvent({
      kind: dto.kind === 'breach' ? 'alert' : 'recover',
      source: 'monitor',
      severity: dto.kind === 'breach' ? (dto.metric === 'offline' ? 'critical' : 'warning') : 'info',
      hostId: dto.hostId,
      title: formatAlertText(dto),
      ts: dto.ts
    })
    if (dto.kind === 'breach' && settings.osNotify && Notification.isSupported()) {
      const notification = new Notification({ title: 'Infra Companion — cảnh báo', body: formatAlertText(dto) })
      notification.on('click', () => {
        const win = BrowserWindow.getAllWindows()[0]
        if (win) {
          if (win.isMinimized()) win.restore()
          win.focus()
        }
      })
      notification.show()
    }
    if (settings.webhookUrl) {
      const req = buildWebhookRequest(settings.webhookUrl, dto)
      // fire-and-forget, KHÔNG retry — cooldown 15' của engine đã chặn storm
      if (req) void postWebhook(req).catch((e) => console.error('[monitor] webhook lỗi:', (e as Error).message))
    }
  }

  service.on('sample', (sample) => {
    lastSamples.set(sample.hostId, sample)
    for (const subscriber of subscribers) {
      if (!subscriber.isDestroyed()) subscriber.send(IPC.MONITOR_SAMPLE, sample)
    }
    getMetrics().record(sample) // F32
    for (const alert of engine.onSample(sample)) dispatch(alert) // F04
  })

  // Cửa sổ tách rời chỉ NHẬN sample (không tự start SSH): join tập subscriber + replay sample gần nhất
  ipcMain.on(IPC.MONITOR_SUBSCRIBE, (event) => {
    addSubscriber(event.sender)
    for (const sample of lastSamples.values()) {
      if (!event.sender.isDestroyed()) event.sender.send(IPC.MONITOR_SAMPLE, sample)
    }
  })

  ipcMain.handle(IPC.MONITOR_START, async (event, hosts: Array<{ id: string; label: string }>) => {
    touchActivity()
    addSubscriber(event.sender)
    const verify = makeHostKeyVerifier(event.sender)
    for (const host of hosts) {
      labels.set(host.id, host.label)
      try {
        const prepared = await prepareConnection(event.sender, host.id)
        await service.start({ hostId: host.id, chain: prepared.chain, loginSteps: prepared.loginSteps }, verify)
      } catch (error) {
        event.sender.send(IPC.MONITOR_SAMPLE, {
          hostId: host.id,
          ts: Date.now(),
          ok: false,
          load1: null,
          loadText: null,
          memUsedPct: null,
          diskUsedPct: null,
          diskMount: null,
          inodeUsedPct: null,
          uptimeSec: null,
          cpuCount: null,
          cpuPct: null,
          cpuUserPct: null,
          cpuSystemPct: null,
          cpuIowaitPct: null,
          cpuStealPct: null,
          runQueue: null,
          swapUsedMb: null,
          swapTotalMb: null,
          netRxKbps: null,
          netTxKbps: null,
          tcpConns: null,
          tcpTimeWait: null,
          topProc: null,
          services: null,
          error: error instanceof Error ? error.message : String(error)
        } satisfies import('@infra/shared').MetricSampleDto)
      }
    }
  })

  ipcMain.on(IPC.MONITOR_STOP, (_e, hostId: string) => {
    service.stop(hostId)
    engine.removeHost(hostId) // không emit recover — dừng ≠ hồi phục
    metrics?.flushHost(hostId)
    labels.delete(hostId)
    lastSamples.delete(hostId)
  })
  ipcMain.on(IPC.MONITOR_STOP_ALL, (event) => {
    service.stopAll()
    engine.clear()
    metrics?.flushAll()
    labels.clear()
    lastSamples.clear()
    // Báo các cửa sổ KHÁC reset store (vd bấm Dừng từ cửa sổ tách rời → dock chính reset).
    // KHÔNG dội về sender: sender tự quản store của nó — stop() đã tự reset, còn start()
    // gọi stopAll chỉ để THAY tập host; dội về sẽ đè active:true vừa set → monitor "chết"
    // cho tới khi restart app (bug đã dính).
    for (const subscriber of subscribers) {
      if (subscriber !== event.sender && !subscriber.isDestroyed()) subscriber.send(IPC.MONITOR_STOPPED)
    }
  })

  // Lịch sử metrics — lazy-open để xem được cả khi chưa start monitoring phiên này
  ipcMain.handle(IPC.METRICS_QUERY, (_event, hostId: string, fromTs: number, toTs: number, res: 1 | 10) =>
    getMetrics().query(hostId, fromTs, toTs, res === 10 ? 10 : 1)
  )
  // Danh sách host từng được monitor (mục "Lịch sử monitoring" trên Dashboard)
  ipcMain.handle(IPC.METRICS_HOSTS, () => getMetrics().listHosts())

  registerMonitorSettingsIpc((s) => {
    settings = s
    engine.setRules(toRules(s))
  })

  return () => {
    service.stopAll()
    metrics?.close() // flush bucket dở + đóng WAL
  }
}
