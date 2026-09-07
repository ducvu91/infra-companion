import { EventEmitter } from 'node:events'
import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { TunnelService } from '@infra/core'
import { IPC, pickAutoStartRules, type TunnelRuleDto, type TunnelRuleInput } from '@infra/shared'
import { getVault, touchActivity } from './vault'
import { makeHostKeyVerifier, prepareConnection } from './connection'
import { recordEvent } from './events'

/**
 * Một TunnelService duy nhất cho cả app, ở scope module (không nằm trong `registerTunnelsIpc`) để
 * tính năng khác dùng lại được mà không phụ thuộc THỨ TỰ đăng ký IPC trong `main/index.ts`.
 * Khởi tạo rẻ và không side-effect (EventEmitter + Map).
 */
const service = new TunnelService()

export function getTunnelService(): TunnelService {
  return service
}

/** Danh sách rule vừa đổi (thêm/sửa/xoá) — menu khay hệ thống dựng lại theo sự kiện này. */
const rulesChanged = new EventEmitter()

export function onTunnelRulesChanged(cb: () => void): () => void {
  rulesChanged.on('change', cb)
  return () => {
    rulesChanged.off('change', cb)
  }
}

/** Bật một rule theo id — cho menu khay (không đi qua IPC của renderer). */
export async function startTunnelById(sender: WebContents, id: string): Promise<void> {
  const rule = getVault().getTunnel(id)
  if (!rule) throw new Error('Tunnel không tồn tại')
  await startRule(sender, rule)
}

/**
 * F15 — bật mọi rule có `autoStart`, MỘT lần cho mỗi tiến trình. Renderer gọi sau khi vault mở
 * (kể cả mở tự động bằng DPAPI lúc khởi động). Chặn lần thứ hai ở đây, không tin renderer: khoá
 * rồi mở lại vault, hay hai cửa sổ cùng nạp, đều không được làm bật lại tunnel user đã chủ ý dừng.
 *
 * Chạy song song: mỗi tunnel là một kết nối SSH riêng, và `TunnelService.start` nuốt lỗi vào
 * state nên `allSettled` chỉ để không bị một `prepareConnection` ném lỗi (host đã xoá) làm rơi
 * các rule còn lại. Kết quả thật tới renderer qua `TUNNELS_EVENT` như mọi lần bật khác.
 */
let autoStarted = false
export async function autoStartTunnels(sender: WebContents): Promise<number> {
  if (autoStarted) return 0
  autoStarted = true
  const rules = pickAutoStartRules(getVault().listTunnels())
  await Promise.allSettled(rules.map((rule) => startRule(sender, rule)))
  return rules.length
}

/** Bật một tunnel rule (idempotent — đang chạy thì bỏ qua). */
async function startRule(sender: WebContents, rule: TunnelRuleDto): Promise<void> {
  const prepared = await prepareConnection(sender, rule.hostId)
  // Via host vào bằng login-script → truyền loginSteps để tunnel L đi qua exec (nc trên máy trong),
  // vì máy chỉ vào được bằng `ssh` trong shell (không nhận jump host -J).
  await service.start(rule, {
    chain: prepared.chain,
    verifyHostKey: makeHostKeyVerifier(sender),
    loginSteps: prepared.loginSteps
  })
}

/**
 * Đảm bảo tunnel đang chạy rồi trả về rule — dùng cho F55 (đọc MySQL qua tunnel đã lưu).
 *
 * `TunnelService.start` NUỐT lỗi vào state chứ không throw, nên phải kiểm lại `isRunning` sau đó
 * và lấy `detail` ra để báo cho user lý do thật (thiếu `nc`, sai mật khẩu su, port bị chiếm…).
 */
export async function ensureTunnelRunning(sender: WebContents, ruleId: string): Promise<TunnelRuleDto> {
  touchActivity()
  const rule = getVault().getTunnel(ruleId)
  if (!rule) {
    throw new Error('Tunnel đã bị xoá — mở phần khai báo cặp và chọn lại tunnel (hoặc chuyển về host SSH)')
  }
  if (rule.type !== 'L') {
    throw new Error(`Tunnel "${rule.label}" không phải loại L (local forward) nên không nối MySQL vào được`)
  }
  if (service.isRunning(ruleId)) return rule

  await startRule(sender, rule)
  if (!service.isRunning(ruleId)) {
    const detail = service.states().find((s) => s.ruleId === ruleId)?.detail
    throw new Error(`Không bật được tunnel "${rule.label}"${detail ? ` — ${detail}` : ''}`)
  }
  return rule
}

/** CRUD tunnel rules + start/stop runtime. Trả về hàm dispose. */
export function registerTunnelsIpc(): () => void {
  /** Trạng thái lần trước theo rule — chỉ ghi sự kiện khi RƠI vào lỗi hoặc THOÁT khỏi lỗi, không ghi mỗi lần bật/tắt tay. */
  const lastStatus = new Map<string, string>()
  const ruleInfo = (id: string): { label: string; hostId: string | null } => {
    try {
      const rule = getVault().getTunnel(id)
      return rule ? { label: rule.label || `:${rule.bindPort}`, hostId: rule.hostId } : { label: id, hostId: null }
    } catch {
      return { label: id, hostId: null } // vault khoá — vẫn ghi được sự kiện, chỉ thiếu tên đẹp
    }
  }

  service.on('state', (state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IPC.TUNNELS_EVENT, state)
    }
    const prev = lastStatus.get(state.ruleId)
    lastStatus.set(state.ruleId, state.status)
    if (state.status === 'error' && prev !== 'error') {
      const info = ruleInfo(state.ruleId)
      recordEvent({
        kind: 'alert',
        source: 'tunnel',
        severity: 'warning',
        hostId: info.hostId,
        title: `⚠ Tunnel [${info.label}] lỗi`,
        detail: state.detail ?? null
      })
    } else if (state.status === 'active' && prev === 'error') {
      const info = ruleInfo(state.ruleId)
      recordEvent({ kind: 'recover', source: 'tunnel', severity: 'info', hostId: info.hostId, title: `✅ Tunnel [${info.label}] chạy lại` })
    }
  })

  ipcMain.handle(IPC.TUNNELS_LIST, () => {
    touchActivity()
    return getVault().listTunnels()
  })

  ipcMain.handle(IPC.TUNNELS_SAVE, (_event, input: TunnelRuleInput) => {
    touchActivity()
    const saved = getVault().saveTunnel(input)
    rulesChanged.emit('change')
    return saved
  })

  ipcMain.handle(IPC.TUNNELS_DELETE, (_event, id: string) => {
    touchActivity()
    service.stop(id)
    getVault().deleteTunnel(id)
    rulesChanged.emit('change')
  })

  ipcMain.handle(IPC.TUNNELS_AUTOSTART, (event) => {
    touchActivity()
    return autoStartTunnels(event.sender)
  })

  ipcMain.handle(IPC.TUNNELS_START, async (event, id: string) => {
    touchActivity()
    const rule = getVault().getTunnel(id)
    if (!rule) throw new Error('Tunnel không tồn tại')
    await startRule(event.sender, rule)
  })

  ipcMain.handle(IPC.TUNNELS_STOP, (_event, id: string) => {
    service.stop(id)
  })

  ipcMain.handle(IPC.TUNNELS_STATES, () => service.states())

  return () => service.stopAll()
}
