import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, Notification } from 'electron'
import {
  HttpCheckStore,
  buildWebhookRequestFor,
  evaluateProbe,
  probeUrl,
  sanitizeHttpCheck,
  summarizeResults
} from '@infra/core'
import { IPC, type HttpCheckDto, type HttpCheckInput, type HttpCheckResultDto, type HttpCheckSummaryDto } from '@infra/shared'
import { recordEvent } from './events'
import { postWebhook, readMonitorSettings } from './monitorSettings'

/**
 * Theo dõi URL — lịch chạy ở main.
 *
 * Cấu hình nằm ở `http-checks.json` (userData) chứ KHÔNG trong vault: check phải chạy cả khi
 * vault tự khoá sau 15 phút, và URL không phải bí mật (cùng lý do với monitor-settings.json).
 * Kết quả vào `checks.db`. Mỗi check một timer theo `intervalSec`; fail ≥ `failsBeforeAlert`
 * lần liên tiếp thì mới báo (toast + OS notification + webhook dùng chung cài đặt của
 * Monitoring) và ghi vào trung tâm sự kiện; lần ok đầu sau đó ghi "hồi phục".
 */

const SUMMARY_WINDOW_MS = 24 * 3_600_000

let checks: HttpCheckDto[] = []
let loaded = false
let store: HttpCheckStore | null = null
const timers = new Map<string, NodeJS.Timeout>()
const running = new Set<string>()
/** Đang trong trạng thái cảnh báo (đã báo, chưa hồi) — không báo lại mỗi chu kỳ. */
const alerting = new Set<string>()

function configPath(): string {
  return join(app.getPath('userData'), 'http-checks.json')
}

function getStore(): HttpCheckStore {
  store ??= new HttpCheckStore(join(app.getPath('userData'), 'checks.db'))
  return store
}

function loadChecks(): HttpCheckDto[] {
  if (loaded) return checks
  loaded = true
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf8')) as unknown
    const list = Array.isArray(raw) ? raw : []
    const now = Date.now()
    checks = list.map((c) => sanitizeHttpCheck(c as Partial<HttpCheckInput>, now)).filter((c): c is HttpCheckDto => c !== null)
  } catch {
    checks = [] // chưa có file hoặc hỏng → bắt đầu trống, file được ghi lại ở lần lưu sau
  }
  return checks
}

function saveChecks(): void {
  try {
    writeFileSync(configPath(), JSON.stringify(checks, null, 2), 'utf8')
  } catch (error) {
    console.error('[http-checks] cannot write config:', error instanceof Error ? error.message : error)
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function summaryOf(check: HttpCheckDto): HttpCheckSummaryDto {
  const results = getStore().recent(check.id, Date.now() - SUMMARY_WINDOW_MS)
  return summarizeResults(check.id, results, alerting.has(check.id))
}

/** Báo ra 3 kênh + kho sự kiện — cùng cách Monitoring làm. */
function notify(check: HttpCheckDto, kind: 'alert' | 'recover', reason: string | null): void {
  const text = kind === 'alert' ? `🔴 [${check.label}] ${reason ?? 'không phản hồi'}` : `✅ [${check.label}] đã lên lại`
  recordEvent({
    kind,
    source: 'http',
    severity: kind === 'alert' ? 'critical' : 'info',
    hostId: check.hostId,
    title: text,
    detail: check.url
  })
  const settings = readMonitorSettings()
  if (kind === 'alert' && settings.osNotify && Notification.isSupported()) {
    const n = new Notification({ title: 'Infra Companion — theo dõi URL', body: text })
    n.on('click', () => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      }
    })
    n.show()
  }
  if (settings.webhookUrl) {
    const req = buildWebhookRequestFor(settings.webhookUrl, text, { checkId: check.id, url: check.url, kind, reason })
    if (req) void postWebhook(req).catch((e) => console.error('[http-checks] webhook failed:', (e as Error).message))
  }
}

async function runCheck(check: HttpCheckDto): Promise<HttpCheckResultDto | null> {
  if (running.has(check.id)) return null // lần trước còn dở (timeout dài hơn interval) → bỏ lượt
  running.add(check.id)
  try {
    const probe = await probeUrl(check)
    const evaluated = evaluateProbe(check, probe)
    const result: HttpCheckResultDto = {
      checkId: check.id,
      ts: evaluated.ts,
      ok: evaluated.ok,
      status: evaluated.status,
      latencyMs: evaluated.latencyMs,
      certDaysLeft: evaluated.certDaysLeft,
      error: evaluated.error
    }
    getStore().record(result)
    broadcast(IPC.HTTP_CHECKS_RESULT_EVENT, result)

    const summary = summaryOf(check)
    if (!result.ok && !alerting.has(check.id) && summary.consecutiveFails >= check.failsBeforeAlert) {
      alerting.add(check.id)
      notify(check, 'alert', evaluated.reason)
    } else if (result.ok && alerting.has(check.id)) {
      alerting.delete(check.id)
      notify(check, 'recover', null)
    }
    broadcast(IPC.HTTP_CHECKS_SUMMARY_EVENT, summaryOf(check))
    return result
  } finally {
    running.delete(check.id)
  }
}

function unschedule(id: string): void {
  const timer = timers.get(id)
  if (timer) clearInterval(timer)
  timers.delete(id)
}

function schedule(check: HttpCheckDto, immediate: boolean): void {
  unschedule(check.id)
  if (!check.enabled) return
  const timer = setInterval(() => void runCheck(check), check.intervalSec * 1000)
  timer.unref?.()
  timers.set(check.id, timer)
  if (immediate) void runCheck(check)
}

/** Gọi sau `app.whenReady()`: nạp cấu hình và bật timer cho mọi check đang enabled. */
export function startHttpChecks(): void {
  for (const check of loadChecks()) schedule(check, true)
}

export function registerHttpChecksIpc(): () => void {
  ipcMain.handle(IPC.HTTP_CHECKS_LIST, () => loadChecks())

  ipcMain.handle(IPC.HTTP_CHECKS_SAVE, (_e, input: HttpCheckInput): HttpCheckDto => {
    loadChecks()
    const existing = input.id ? checks.find((c) => c.id === input.id) : undefined
    const clean = sanitizeHttpCheck({ ...input, createdAt: existing?.createdAt }, Date.now())
    if (!clean) throw new Error('URL không hợp lệ — chỉ nhận http:// hoặc https://')
    if (existing) checks = checks.map((c) => (c.id === clean.id ? clean : c))
    else checks = [...checks, clean]
    saveChecks()
    // Sửa cấu hình = bắt đầu chuỗi đo mới: xoá trạng thái cảnh báo cũ để không kẹt ở "đang báo" của URL cũ
    alerting.delete(clean.id)
    schedule(clean, true)
    return clean
  })

  ipcMain.handle(IPC.HTTP_CHECKS_DELETE, (_e, id: string) => {
    loadChecks()
    checks = checks.filter((c) => c.id !== id)
    saveChecks()
    unschedule(id)
    alerting.delete(id)
    getStore().deleteCheck(id)
  })

  ipcMain.handle(IPC.HTTP_CHECKS_RUN_NOW, async (_e, id: string) => {
    const check = loadChecks().find((c) => c.id === id)
    return check ? runCheck(check) : null
  })

  ipcMain.handle(IPC.HTTP_CHECKS_RESULTS, (_e, id: string, sinceTs: number) => getStore().recent(String(id), Number(sinceTs) || 0))

  ipcMain.handle(IPC.HTTP_CHECKS_SUMMARIES, () => loadChecks().map(summaryOf))

  return () => {
    for (const id of [...timers.keys()]) unschedule(id)
    store?.close()
    store = null
  }
}
