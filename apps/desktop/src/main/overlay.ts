import { join } from 'node:path'
import { BrowserWindow, ipcMain, screen } from 'electron'
import { IPC, type AppEventDto } from '@infra/shared'
import { readSettings } from './ipc/vrm'

/**
 * F70 — nhân vật hiện NGOÀI desktop khi app đang ở khay / thu nhỏ mà có thông báo.
 *
 * Vì sao cần: thu vào khay là lúc user không nhìn app, cũng là lúc cảnh báo dễ trôi nhất. Đã có
 * thật: 11 thông báo tới trong lúc app ở khay mà không ai biết — nhân vật chỉ sống trong cửa sổ
 * chính đang ẩn. Nay một cửa sổ nhỏ, trong suốt, không khung, luôn nổi ở góc phải-dưới màn hình
 * chính, nạp CÙNG renderer với route `#vrm-overlay` (xem `VrmOverlayApp`) nên dùng lại stage +
 * bong bóng thoại + preload sẵn có; cửa sổ này chỉ dựng model và nói, main quyết định hiện/ẩn.
 *
 * Vòng đời: tạo LƯỜI ở thông báo đầu tiên lúc app đang ẩn — không phải lúc ẩn: user thu app vào
 * khay cả ngày không có cảnh báo thì không tốn một context WebGL nào. Sau đó GIỮ và chỉ ẩn/hiện
 * (nạp model 40 MB mất vài giây, không nạp lại mỗi lần). Huỷ khi cửa sổ chính đóng thật.
 *
 * `focusable: false`: hiện lên không cướp focus khỏi thứ user đang gõ ở app khác — một cảnh báo
 * làm mất chữ đang gõ là lý do để tắt tính năng ngay. Click chuột vẫn nhận được bình thường.
 */

interface OverlayDeps {
  getMainWindow: () => BrowserWindow | null
  showMainWindow: () => void
  /** Cùng hàm nạp renderer của cửa sổ chính (dev: URL Vite, prod: file); hash là route. */
  loadRenderer: (win: BrowserWindow, hash: string) => void
}

const WIDTH = 300
const HEIGHT = 460
/** Ẩn sau chừng này kể từ thông báo cuối. Chuột đang trên nhân vật thì không đếm. */
const HIDE_AFTER_MS = 15_000
/** Chuột vừa rời khỏi nhân vật → đếm lại ngắn hơn. */
const HIDE_AFTER_LEAVE_MS = 4_000
/** Chống bão: chỉ giữ vài thông báo mới nhất trong lúc chờ model nạp xong. */
const MAX_PENDING = 3

let deps: OverlayDeps | null = null
let win: BrowserWindow | null = null
/** Renderer đã dựng xong model (`VRM_OVERLAY_READY`) — trước đó chỉ xếp hàng, chưa hiện. */
let ready = false
let pending: AppEventDto[] = []
let hideTimer: ReturnType<typeof setTimeout> | null = null
let held = false

/** Cửa sổ chính đang KHÔNG hiện với user: đã ẩn vào khay hoặc thu nhỏ xuống taskbar. */
function mainHidden(): boolean {
  const main = deps?.getMainWindow()
  return !main || main.isDestroyed() || !main.isVisible() || main.isMinimized()
}

/** Góc phải-dưới vùng làm việc của màn hình chính (trên taskbar). Đặt lại mỗi lần hiện: user có thể đã đổi màn hình. */
function place(w: BrowserWindow): void {
  const { workArea } = screen.getPrimaryDisplay()
  w.setBounds({
    x: workArea.x + workArea.width - WIDTH - 12,
    y: workArea.y + workArea.height - HEIGHT - 4,
    width: WIDTH,
    height: HEIGHT
  })
}

function clearHide(): void {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function armHide(ms: number): void {
  clearHide()
  if (held) return
  hideTimer = setTimeout(() => {
    hideTimer = null
    hideOverlay()
  }, ms)
}

/** Ẩn (không huỷ) — gọi khi cửa sổ chính hiện lại, khi user bấm vào nhân vật, hoặc hết giờ. */
export function hideOverlay(): void {
  clearHide()
  if (win && !win.isDestroyed() && win.isVisible()) win.hide()
}

/** Đẩy các thông báo đang chờ sang renderer rồi hiện cửa sổ (không cướp focus). */
function flush(): void {
  if (!win || win.isDestroyed() || !ready) return
  for (const ev of pending) win.webContents.send(IPC.VRM_OVERLAY_EVENT, ev)
  pending = []
  if (!win.isVisible()) {
    place(win)
    win.showInactive()
  }
  armHide(HIDE_AFTER_MS)
}

function create(d: OverlayDeps): BrowserWindow {
  const w = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,
    hasShadow: false,
    title: 'Infra Companion',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Cửa sổ này sống phần lớn thời gian ở trạng thái ẩn; không được để Chromium bóp nhịp
      // rồi lúc hiện lên nhân vật đứng đơ nửa giây đầu.
      backgroundThrottling: false
    }
  })
  w.setAlwaysOnTop(true, 'floating')
  w.setMenuBarVisibility(false)
  w.on('closed', () => {
    win = null
    ready = false
    pending = []
    clearHide()
  })
  place(w)
  d.loadRenderer(w, 'vrm-overlay')
  return w
}

/**
 * Gọi từ `recordEvent()` với MỌI sự kiện — ở đây mới quyết có nói ngoài desktop hay không.
 * Không bao giờ ném: đây là đường phụ của một alert thật.
 */
export function overlayOnEvent(ev: AppEventDto): void {
  const d = deps
  // Marker là user tự đánh dấu (deploy…), không phải chuyện bất thường — cùng luật với VrmPanel
  if (!d || ev.kind === 'marker' || !mainHidden()) return
  readSettings()
    .then((s) => {
      // Kiểm `mainHidden()` lần nữa: đọc file là bất đồng bộ, user có thể vừa mở app lên
      if (!s.activeId || !s.desktopOverlay || !s.reactToEvents || !mainHidden()) return
      pending = [...pending, ev].slice(-MAX_PENDING)
      if (!win || win.isDestroyed()) {
        // Lần đầu: dựng cửa sổ, `flush()` sẽ chạy khi renderer báo READY
        win = create(d)
        return
      }
      flush()
    })
    .catch((error: unknown) => {
      console.error('[overlay] cannot read VRM settings:', error instanceof Error ? error.message : error)
    })
}

export function initOverlay(d: OverlayDeps): void {
  deps = d
  ipcMain.on(IPC.VRM_OVERLAY_READY, (e) => {
    if (!win || win.isDestroyed() || e.sender.id !== win.webContents.id) return
    ready = true
    // Nạp xong mà user đã mở app lên rồi → bỏ hàng đợi, cửa sổ chính đã tự nói những cái đó
    if (mainHidden()) flush()
    else pending = []
  })
  ipcMain.on(IPC.VRM_OVERLAY_OPEN, () => {
    hideOverlay()
    d.showMainWindow()
  })
  ipcMain.on(IPC.VRM_OVERLAY_HOLD, () => {
    held = true
    clearHide()
  })
  ipcMain.on(IPC.VRM_OVERLAY_RELEASE, () => {
    held = false
    if (win && !win.isDestroyed() && win.isVisible()) armHide(HIDE_AFTER_LEAVE_MS)
  })
}

/** Huỷ hẳn — cửa sổ chính đóng thật hoặc app thoát. */
export function destroyOverlay(): void {
  clearHide()
  pending = []
  ready = false
  if (win && !win.isDestroyed()) win.destroy()
  win = null
}
