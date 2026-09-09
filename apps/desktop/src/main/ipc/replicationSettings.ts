import { app, ipcMain } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { IPC, type ReplSettingsDto, type ReplThresholdsDto } from '@infra/shared'
import { buildReplWebhookRequest, type ReplAlertEvent } from '@infra/core'
import { postWebhook } from './monitorSettings'

/**
 * F55 — Ngưỡng cảnh báo replication: `repl-settings.json` trong userData.
 *
 * CHỦ Ý để NGOÀI vault, cùng lý do đã ghi ở `monitorSettings.ts`: vault tự khoá sau 15 phút
 * không hoạt động, còn cảnh báo phải đọc được ngưỡng/webhook suốt đêm. Đánh đổi: webhook URL
 * nằm plaintext trên máy user. Ở đây KHÔNG có bất kỳ credential DB nào — mật khẩu MySQL vẫn
 * nằm trong vault đã mã hoá.
 */

/** Trần cho từng ngưỡng — chống giá trị vô lý làm engine tính sai. */
const LAG_MAX_SEC = 30 * 86_400
const GAP_MAX_BYTES = 1024 ** 4 // 1 TB

export const DEFAULT_REPL_SETTINGS: ReplSettingsDto = {
  // applyGap TẮT mặc định: baseline mỗi hệ thống một khác, bật sẵn sẽ spam.
  // Ba metric nhị phân (đứt / có lỗi / slave ghi được) thì luôn là sự cố thật → bật sẵn.
  defaults: { lagSec: 60, applyGapBytes: null, threads: true, error: true, writable: true, probe: true },
  perPair: {},
  webhookUrl: '',
  osNotify: true
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'repl-settings.json')
}

/** Chuẩn hoá 1 ngưỡng số: 0..max (làm tròn) hoặc null = tắt. Giá trị rác → fallback. */
function saneNum(value: unknown, fallback: number | null, max: number): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(0, Math.round(value)))
}

const NUM_LIMITS: Array<[keyof Pick<ReplThresholdsDto, 'lagSec' | 'applyGapBytes'>, number]> = [
  ['lagSec', LAG_MAX_SEC],
  ['applyGapBytes', GAP_MAX_BYTES]
]
const FLAGS: Array<keyof Pick<ReplThresholdsDto, 'threads' | 'error' | 'writable' | 'probe'>> = [
  'threads',
  'error',
  'writable',
  'probe'
]

function saneThresholds(raw: unknown, base: ReplThresholdsDto): ReplThresholdsDto {
  const t = (raw ?? {}) as Partial<ReplThresholdsDto>
  const out = { ...base }
  for (const [key, max] of NUM_LIMITS) out[key] = saneNum(t[key], base[key], max)
  for (const key of FLAGS) {
    if (typeof t[key] === 'boolean') out[key] = t[key]
  }
  return out
}

/** Override 1 cặp: chỉ giữ field CÓ MẶT — thiếu = kế thừa defaults (khác null = tắt riêng cặp đó). */
function saneOverride(raw: unknown): Partial<ReplThresholdsDto> | null {
  if (!raw || typeof raw !== 'object') return null
  const over = raw as Partial<ReplThresholdsDto>
  const clean: Partial<ReplThresholdsDto> = {}
  for (const [key, max] of NUM_LIMITS) {
    if (key in over) clean[key] = saneNum(over[key], null, max)
  }
  for (const key of FLAGS) {
    if (typeof over[key] === 'boolean') clean[key] = over[key]
  }
  return Object.keys(clean).length > 0 ? clean : null
}

/** Validate + điền field thiếu — dùng cho cả đọc file lẫn payload từ renderer. */
function sanitize(raw: unknown): ReplSettingsDto {
  const s = (raw ?? {}) as Partial<ReplSettingsDto>
  const perPair: ReplSettingsDto['perPair'] = {}
  if (s.perPair && typeof s.perPair === 'object') {
    for (const [pairId, over] of Object.entries(s.perPair)) {
      const clean = saneOverride(over)
      if (clean) perPair[pairId] = clean
    }
  }
  return {
    defaults: saneThresholds(s.defaults, DEFAULT_REPL_SETTINGS.defaults),
    perPair,
    webhookUrl: typeof s.webhookUrl === 'string' ? s.webhookUrl.trim() : '',
    osNotify: typeof s.osNotify === 'boolean' ? s.osNotify : true
  }
}

export function readReplSettings(): ReplSettingsDto {
  try {
    return sanitize(JSON.parse(readFileSync(settingsPath(), 'utf8')))
  } catch {
    return structuredClone(DEFAULT_REPL_SETTINGS)
  }
}

function writeReplSettings(s: ReplSettingsDto): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify(s, null, 2))
  } catch (e) {
    console.error('[repl] cannot write repl-settings.json:', e)
  }
}

/** Gửi cảnh báo replication ra webhook. Fire-and-forget — cooldown 15' của engine đã chặn storm. */
export function postReplWebhook(url: string, alert: ReplAlertEvent & { label: string }): void {
  const req = buildReplWebhookRequest(url, alert)
  if (!req) return
  void postWebhook(req).catch((e) => console.error('[repl] webhook failed:', (e as Error).message))
}

/** Đăng ký GET/SET — onChanged để replication.ts cập nhật engine ngay khi user lưu. */
export function registerReplicationSettingsIpc(onChanged: (s: ReplSettingsDto) => void): void {
  ipcMain.handle(IPC.REPL_GET_SETTINGS, () => readReplSettings())

  ipcMain.handle(IPC.REPL_SET_SETTINGS, (_event, raw: unknown) => {
    const clean = sanitize(raw)
    writeReplSettings(clean)
    onChanged(clean)
  })
}
