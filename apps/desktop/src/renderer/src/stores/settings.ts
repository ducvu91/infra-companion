import { create } from 'zustand'
import { DEFAULT_GUARD_PATTERNS } from '../lib/commandGuard'
import { CURSOR_CUSTOM_MAX, currentAccent, isCustomCursor, resolveCursor, type CustomCursor } from '../lib/cursors'
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, isValidShortcut, type ShortcutAction } from '../lib/shortcuts'

export type ThemeMode = 'dark' | 'light'
/**
 * Theme BỐ CỤC của app (khác với chế độ màu dark/light):
 * - `infra`     — giao diện gốc: cột trái liệt kê host theo nhóm và sổ ra tại chỗ; Dashboard là trang chủ
 * - `navigator` — kiểu Termius: cột trái chỉ là MENU (Hosts · Tunnels · Snippets · Keys…), bấm mục nào
 *                 thì nội dung hiện ở VÙNG CHÍNH thay cho Dashboard, không sổ ra trong cột
 * - `workbench` — kiểu VS Code: thanh icon 48px chọn PANEL PHỤ (host, tunnel, snippet…) nằm cạnh; vùng chính
 *                 luôn là terminal, duyệt danh bạ mà không rời màn hình đang làm việc
 */
export type LayoutTheme = 'infra' | 'navigator' | 'workbench'
export const LAYOUT_THEMES: readonly LayoutTheme[] = ['infra', 'navigator', 'workbench']
export type Language = 'vi' | 'en' | 'ja'
/** Vị trí ảnh nền (background-position keyword). */
export type BgPosition = 'center' | 'left' | 'right' | 'top' | 'bottom'
/** Kiểu lấp khung: cover = phủ kín (cắt bớt), contain = vừa khung (không cắt). */
export type BgFit = 'cover' | 'contain'
/** Kiểu con trỏ terminal (xterm cursorStyle). */
export type TermCursor = 'block' | 'bar' | 'underline'
/** Trang mở khi khởi động app (sau khi unlock vault). */
export type StartupPage = 'dashboard' | 'terminal'
/**
 * Bố cục sắp xếp các pane khi Split:
 * - `auto`       — lưới vuông tự động (mặc định, hành vi cũ)
 * - `columns`    — mọi pane cạnh nhau thành cột dọc (1 hàng)
 * - `rows`       — mọi pane xếp chồng thành hàng ngang (1 cột)
 * - `main-left`  — 1 pane chính lớn bên trái, các pane còn lại xếp cột bên phải
 * - `main-top`   — 1 pane chính lớn bên trên, các pane còn lại thành hàng bên dưới
 */
export type PaneLayout = 'auto' | 'columns' | 'rows' | 'main-left' | 'main-top'
/** Thứ tự hiển thị các layout trong picker (Settings + toolbar). */
export const PANE_LAYOUTS: PaneLayout[] = ['auto', 'columns', 'rows', 'main-left', 'main-top']
/**
 * Kiểu khung (header) của mỗi pane khi Split:
 * - `bar` — thanh tiêu đề gọn: chấm trạng thái + tên + nút ✕ (mặc định)
 * - `mac` — kiểu macOS: 3 chấm tròn traffic-light bên trái, chấm đỏ = đóng
 */
export type PaneFrame = 'bar' | 'mac'
export const PANE_FRAMES: PaneFrame[] = ['bar', 'mac']

/** Một mục auto-complete: gõ `trigger` ở terminal → gợi ý chèn `command` đầy đủ. */
export interface CommandAlias {
  trigger: string
  command: string
  note?: string
}

const THEME_KEY = 'infra.theme'
const LAYOUT_KEY = 'infra.layout'
const LANG_KEY = 'infra.lang'
const ACCENT_KEY = 'infra.accent'
const BG_IMAGE_KEY = 'infra.bg.image'
const BG_OPACITY_KEY = 'infra.bg.opacity'
const BG_BLUR_KEY = 'infra.bg.blur'
const BG_POSITION_KEY = 'infra.bg.position'
const BG_FIT_KEY = 'infra.bg.fit'
const TERM_FONT_KEY = 'infra.term.font'
const TERM_SIZE_KEY = 'infra.term.size'
const TERM_LH_KEY = 'infra.term.lineHeight'
const TERM_CURSOR_KEY = 'infra.term.cursor'
const TERM_WEBGL_KEY = 'infra.term.webgl'
const PANE_LAYOUT_KEY = 'infra.term.paneLayout'
const PANE_FRAME_KEY = 'infra.term.paneFrame'
const CUSTOM_COLORS_KEY = 'infra.theme.custom'
const STARTUP_KEY = 'infra.startup.page'
const CMD_GUARD_ON_KEY = 'infra.cmdGuard.on'
const CMD_GUARD_PATTERNS_KEY = 'infra.cmdGuard.patterns'
const SHORTCUTS_KEY = 'infra.term.shortcuts'
const AUTOCOMPLETE_ON_KEY = 'infra.term.autocomplete'
const SHELL_MARKS_KEY = 'infra.term.shellMarks'
const NOTIFY_LONG_KEY = 'infra.term.notifyLong'
const CMD_HISTORY_KEY = 'infra.term.commandHistory'
const ALIASES_KEY = 'infra.term.aliases'
const CURSOR_KEY = 'infra.cursor.id'
const CURSOR_LIST_KEY = 'infra.cursor.custom'

/** Các biến màu UI cho phép tuỳ biến (accent có control riêng nên không nằm ở đây). */
export const CUSTOM_PALETTE_VARS = [
  '--c-app',
  '--c-panel',
  '--c-elevated',
  '--c-input',
  '--c-hover',
  '--c-edge-strong',
  '--c-content',
  '--c-muted',
  '--c-danger',
  '--c-success',
  '--c-warning'
] as const
export type PaletteVar = (typeof CUSTOM_PALETTE_VARS)[number]
/** Override màu theo từng base theme (màu dark khác light nên lưu tách). */
export type CustomColors = Record<ThemeMode, Partial<Record<PaletteVar, string>>>

const HEX_RE = /^#[0-9a-fA-F]{6}$/

const BG_OPACITY_DEFAULT = 0.25
const BG_BLUR_DEFAULT = 0
const BG_POSITIONS: BgPosition[] = ['center', 'left', 'right', 'top', 'bottom']

/** Font terminal mặc định (khớp giá trị cũ hardcode để không đổi hiển thị của user hiện tại). */
export const TERM_FONT_DEFAULT = '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace'
const TERM_SIZE_DEFAULT = 14
const TERM_LH_DEFAULT = 1.2

function readTheme(): ThemeMode {
  const v = localStorage.getItem(THEME_KEY)
  return v === 'light' ? 'light' : 'dark'
}

/** Theme bố cục — mặc định `infra` (giao diện cũ), giá trị lạ trong localStorage cũng về đó. */
function readLayout(): LayoutTheme {
  const v = localStorage.getItem(LAYOUT_KEY)
  return v === 'navigator' || v === 'workbench' ? v : 'infra'
}

function readLang(): Language {
  const v = localStorage.getItem(LANG_KEY)
  return v === 'en' || v === 'ja' ? v : 'vi'
}

/** Hex màu accent tùy chỉnh (#rrggbb) hoặc null = dùng accent mặc định của theme. */
function readAccent(): string | null {
  const v = localStorage.getItem(ACCENT_KEY)
  return v && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null
}

function readBgImage(): string | null {
  return localStorage.getItem(BG_IMAGE_KEY)
}

function readBgOpacity(): number {
  const v = Number(localStorage.getItem(BG_OPACITY_KEY))
  return Number.isFinite(v) && v > 0 ? Math.min(v, 1) : BG_OPACITY_DEFAULT
}

function readBgBlur(): number {
  const v = Number(localStorage.getItem(BG_BLUR_KEY))
  return Number.isFinite(v) && v >= 0 ? Math.min(v, 24) : BG_BLUR_DEFAULT
}

function readBgPosition(): BgPosition {
  const v = localStorage.getItem(BG_POSITION_KEY) as BgPosition | null
  return v && BG_POSITIONS.includes(v) ? v : 'center'
}

function readBgFit(): BgFit {
  return localStorage.getItem(BG_FIT_KEY) === 'contain' ? 'contain' : 'cover'
}

function readTermFont(): string {
  return localStorage.getItem(TERM_FONT_KEY) || TERM_FONT_DEFAULT
}

function readTermSize(): number {
  const v = Number(localStorage.getItem(TERM_SIZE_KEY))
  return Number.isFinite(v) && v >= 8 && v <= 28 ? v : TERM_SIZE_DEFAULT
}

function readTermLineHeight(): number {
  const v = Number(localStorage.getItem(TERM_LH_KEY))
  return Number.isFinite(v) && v >= 1 && v <= 2 ? v : TERM_LH_DEFAULT
}

function readTermCursor(): TermCursor {
  const v = localStorage.getItem(TERM_CURSOR_KEY)
  return v === 'bar' || v === 'underline' ? v : 'block'
}

/** GPU render (WebGL) cho terminal — mặc định BẬT; '0' = user đã tắt (máy có vấn đề GPU). */
function readTermWebgl(): boolean {
  return localStorage.getItem(TERM_WEBGL_KEY) !== '0'
}

/** Bố cục pane khi Split — mặc định 'auto' (lưới vuông như cũ). */
function readPaneLayout(): PaneLayout {
  const v = localStorage.getItem(PANE_LAYOUT_KEY)
  return PANE_LAYOUTS.includes(v as PaneLayout) ? (v as PaneLayout) : 'auto'
}

/** Kiểu khung pane — mặc định 'bar' (thanh tiêu đề như cũ). */
function readPaneFrame(): PaneFrame {
  const v = localStorage.getItem(PANE_FRAME_KEY)
  return PANE_FRAMES.includes(v as PaneFrame) ? (v as PaneFrame) : 'bar'
}

function readStartupPage(): StartupPage {
  return localStorage.getItem(STARTUP_KEY) === 'terminal' ? 'terminal' : 'dashboard'
}

/** Guard lệnh nhạy cảm — mặc định BẬT; '0' = user đã tắt. */
function readCommandGuardOn(): boolean {
  return localStorage.getItem(CMD_GUARD_ON_KEY) !== '0'
}

/** Whitelist mẫu lệnh cần xác nhận. Khoá vắng (null) → danh sách mặc định; '[]' đã lưu → tôn trọng rỗng. */
function readCommandGuardPatterns(): string[] {
  const raw = localStorage.getItem(CMD_GUARD_PATTERNS_KEY)
  if (raw === null) return [...DEFAULT_GUARD_PATTERNS]
  try {
    const arr = JSON.parse(raw) as unknown
    if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === 'string')
  } catch {
    /* JSON hỏng → mặc định */
  }
  return [...DEFAULT_GUARD_PATTERNS]
}

/** Phím tắt terminal — trộn giá trị đã lưu (nếu hợp lệ) lên mặc định; khoá vắng → mặc định. */
function readShortcuts(): Record<ShortcutAction, string> {
  const out = { ...DEFAULT_SHORTCUTS }
  try {
    const raw = JSON.parse(localStorage.getItem(SHORTCUTS_KEY) || '{}') as Record<string, unknown>
    for (const action of SHORTCUT_ACTIONS) {
      const v = raw[action]
      if (typeof v === 'string' && isValidShortcut(v)) out[action] = v
    }
  } catch {
    /* JSON hỏng → mặc định */
  }
  return out
}

/** Auto-complete dropdown trong terminal — mặc định BẬT; '0' = user đã tắt. */
function readAutoComplete(): boolean {
  return localStorage.getItem(AUTOCOMPLETE_ON_KEY) !== '0'
}

/**
 * F23 — hiện exit code + thời gian chạy cạnh mỗi lệnh (cần shell trên remote gửi OSC 133).
 * Mặc định BẬT: không có marker thì phần này im lặng, nên bật sẵn không tốn gì.
 */
function readShellMarks(): boolean {
  return localStorage.getItem(SHELL_MARKS_KEY) !== '0'
}

/** F26 — báo khi lệnh dài chạy xong (chỉ khi pane đang ẩn). Mặc định BẬT. */
function readNotifyLong(): boolean {
  return localStorage.getItem(NOTIFY_LONG_KEY) !== '0'
}

/**
 * F24 — lưu lịch sử lệnh vào vault. Mặc định BẬT: giá trị của tính năng nằm ở chỗ lịch sử đã
 * có sẵn lúc cần tìm, mà thứ cần tìm luôn là lệnh của những tuần TRƯỚC — bật muộn thì không
 * hồi tố được. Ai không muốn ghi thì tắt trong Cài đặt, và có nút xoá sạch ngay cạnh.
 */
function readCommandHistoryEnabled(): boolean {
  return localStorage.getItem(CMD_HISTORY_KEY) !== '0'
}

/** Danh sách từ tắt → lệnh (localStorage, per-máy). Bỏ mục thiếu trigger/command. */
function readCommandAliases(): CommandAlias[] {
  try {
    const arr = JSON.parse(localStorage.getItem(ALIASES_KEY) || '[]') as unknown
    if (!Array.isArray(arr)) return []
    return arr
      .filter(
        (x): x is CommandAlias =>
          !!x &&
          typeof x === 'object' &&
          typeof (x as CommandAlias).trigger === 'string' &&
          typeof (x as CommandAlias).command === 'string'
      )
      .map((x) => ({ trigger: x.trigger, command: x.command, ...(typeof x.note === 'string' ? { note: x.note } : {}) }))
  } catch {
    return []
  }
}

/** Con trỏ chuột đang chọn: id preset hoặc `custom:<id>`. Mặc định 'system' = không đổi gì. */
function readMouseCursor(): string {
  return localStorage.getItem(CURSOR_KEY) || 'system'
}

/** Con trỏ user tự thêm. Bỏ mục hỏng (data URI sai dạng) thay vì làm vỡ cả danh sách. */
function readCustomCursors(): CustomCursor[] {
  try {
    const arr = JSON.parse(localStorage.getItem(CURSOR_LIST_KEY) || '[]') as unknown
    if (!Array.isArray(arr)) return []
    return arr.filter(isCustomCursor).slice(0, CURSOR_CUSTOM_MAX)
  } catch {
    return []
  }
}

function readCustomColors(): CustomColors {
  const out: CustomColors = { dark: {}, light: {} }
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_COLORS_KEY) || '{}') as Record<string, unknown>
    for (const theme of ['dark', 'light'] as const) {
      const m = raw[theme]
      if (m && typeof m === 'object') {
        for (const v of CUSTOM_PALETTE_VARS) {
          const hex = (m as Record<string, unknown>)[v]
          if (typeof hex === 'string' && HEX_RE.test(hex)) out[theme][v] = hex
        }
      }
    }
  } catch {
    /* JSON hỏng → mặc định rỗng */
  }
  return out
}

/** Áp theme + lang lên <html>. Gọi sớm (main.tsx) để tránh nháy màu khi load. */
export function applyTheme(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme
}
/** `data-layout` trên <html> — móc CSS cho theme bố cục (hiện chưa có rule nào cần, để sẵn). */
export function applyLayout(layout: LayoutTheme): void {
  document.documentElement.dataset.layout = layout
}
export function applyLang(lang: Language): void {
  document.documentElement.lang = lang
}
/** data-bg='on' → CSS làm nền terminal trong suốt để lộ ảnh nền phía sau. */
export function applyBackground(image: string | null): void {
  document.documentElement.dataset.bg = image ? 'on' : 'off'
}

/**
 * Áp cặp con trỏ (thường + hover) lên `<html>` qua CSS var + `data-cursor` / `data-cursor-hover`
 * (rule nằm ở styles/main.css). `cursor` là thuộc tính KẾ THỪA nên đặt ở gốc là phủ cả app;
 * ô nhập text vẫn giữ con trỏ ngữ cảnh của nó. Riêng terminal phải override thêm vì
 * xterm.css đặt cứng `cursor: text`.
 *
 * Hai cờ `data-*` tách riêng, KHÔNG gộp: nếu chỉ có `data-cursor` mà rule hover vẫn bật thì
 * `var(--app-cursor-hover)` không tồn tại → khai báo hỏng ở computed-value time → `cursor`
 * quay về **inherit** (kế thừa con trỏ thường) chứ KHÔNG về bàn tay mặc định. Preset `system`
 * sẽ mất luôn bàn tay khi hover nút — đúng kiểu lỗi im lặng khó truy.
 */
export function applyMouseCursor(selection: string, customs: CustomCursor[]): void {
  const root = document.documentElement
  const { normal, hover } = resolveCursor(selection, customs, currentAccent())
  if (normal) root.style.setProperty('--app-cursor', normal)
  else root.style.removeProperty('--app-cursor')
  root.dataset.cursor = normal ? 'on' : 'off'

  if (hover) root.style.setProperty('--app-cursor-hover', hover)
  else root.style.removeProperty('--app-cursor-hover')
  root.dataset.cursorHover = hover ? 'on' : 'off'
}

/** Làm tối 1 màu hex theo tỉ lệ (0–1) — dùng cho accent-hover. */
function darkenHex(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  const f = 1 - amount
  const r = Math.round(((n >> 16) & 0xff) * f)
  const g = Math.round(((n >> 8) & 0xff) * f)
  const b = Math.round((n & 0xff) * f)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

/**
 * Ghi đè màu accent qua CSS var inline trên <html> (thắng stylesheet theme).
 * Một màu picked → accent + hover (tối hơn); accent-fg/soft = chính màu đó
 * (soft chỉ dùng kèm alpha modifier nên thành tint nhạt). null = gỡ override.
 */
export function applyAccent(color: string | null): void {
  const root = document.documentElement
  const vars = ['--c-accent', '--c-accent-hover', '--c-accent-fg', '--c-accent-soft']
  if (!color) {
    for (const v of vars) root.style.removeProperty(v)
    return
  }
  root.style.setProperty('--c-accent', color)
  root.style.setProperty('--c-accent-hover', darkenHex(color, 0.14))
  root.style.setProperty('--c-accent-fg', color)
  root.style.setProperty('--c-accent-soft', color)
}

/**
 * Áp bảng màu tuỳ chỉnh (override CSS var inline trên <html>) cho base theme hiện tại.
 * Gọi lại khi đổi theme dark↔light vì override lưu tách theo theme.
 */
export function applyCustomTheme(theme: ThemeMode, all: CustomColors): void {
  const root = document.documentElement
  const map = all[theme] ?? {}
  for (const v of CUSTOM_PALETTE_VARS) {
    const hex = map[v]
    if (hex) root.style.setProperty(v, hex)
    else root.style.removeProperty(v)
  }
}

interface SettingsState {
  theme: ThemeMode
  /** Theme bố cục: `infra` (mặc định) hay `navigator` (kiểu Termius). */
  layout: LayoutTheme
  language: Language
  /** Màu accent tùy chỉnh (#rrggbb) — null = mặc định theo theme. */
  accentColor: string | null
  /** Ảnh nền dạng data URL (đã downscale) — null = không dùng. */
  backgroundImage: string | null
  /** Độ hiện của ảnh nền (0–1). */
  backgroundOpacity: number
  /** Độ mờ (blur) ảnh nền tính bằng px — giúp chữ dễ đọc trên ảnh rối. */
  backgroundBlur: number
  /** Vị trí canh ảnh (giữa/trái/phải/trên/dưới). */
  backgroundPosition: BgPosition
  /** Phủ kín (cover) hay vừa khung (contain). */
  backgroundFit: BgFit
  /** Font terminal (CSS font-family). */
  termFontFamily: string
  /** Cỡ chữ terminal (px). */
  termFontSize: number
  /** Giãn dòng terminal. */
  termLineHeight: number
  /** Kiểu con trỏ terminal. */
  termCursor: TermCursor
  /** Render terminal bằng GPU (WebGL addon) — gõ/cuộn mượt hơn hẳn DOM renderer. */
  termWebgl: boolean
  /** Bố cục sắp xếp các pane khi Split. */
  paneLayout: PaneLayout
  /** Kiểu khung (header) của mỗi pane khi Split. */
  paneFrame: PaneFrame
  /** Trang mở khi khởi động: dashboard (mặc định) hay terminal local như trước. */
  startupPage: StartupPage
  /** Guard lệnh nhạy cảm: bấm Enter trên lệnh khớp whitelist → hiện popup xác nhận. */
  commandGuardEnabled: boolean
  /** Whitelist mẫu lệnh cần xác nhận (literal theo prefix hoặc regex /…/). */
  commandGuardPatterns: string[]
  /** Phím tắt terminal tuỳ biến (copy/paste/find/explain) — chuỗi combo "Ctrl+Shift+V". */
  shortcuts: Record<ShortcutAction, string>
  /** Auto-complete: gõ từ tắt ở terminal → dropdown gợi ý lệnh đầy đủ. */
  autoCompleteEnabled: boolean
  /** F23 — đọc OSC 133 để hiện exit code + thời gian chạy cạnh mỗi lệnh. */
  shellMarksEnabled: boolean
  /** F26 — báo khi lệnh chạy lâu xong trong lúc pane đang ẩn. */
  notifyLongCommands: boolean
  /** F24 — lưu lệnh đã chạy vào vault (mã hoá) để tìm lại bằng Ctrl+Shift+R. */
  commandHistoryEnabled: boolean
  /** Danh sách từ tắt → lệnh cho auto-complete (per-máy). */
  commandAliases: CommandAlias[]
  /** Con trỏ chuột toàn app: id preset hoặc `custom:<id>`. 'system' = giữ con trỏ của OS. */
  mouseCursor: string
  /** Con trỏ user tự thêm từ file ảnh. */
  customCursors: CustomCursor[]
  setTheme: (t: ThemeMode) => void
  setLayout: (l: LayoutTheme) => void
  setLanguage: (l: Language) => void
  setAccentColor: (c: string | null) => void
  /** Lưu/xoá ảnh nền. Trả về false nếu localStorage đầy (ảnh quá lớn). */
  setBackgroundImage: (image: string | null) => boolean
  setBackgroundOpacity: (v: number) => void
  setBackgroundBlur: (v: number) => void
  setBackgroundPosition: (p: BgPosition) => void
  setBackgroundFit: (f: BgFit) => void
  setTermFontFamily: (f: string) => void
  setTermFontSize: (n: number) => void
  setTermLineHeight: (n: number) => void
  setTermCursor: (c: TermCursor) => void
  setTermWebgl: (on: boolean) => void
  setPaneLayout: (l: PaneLayout) => void
  setPaneFrame: (f: PaneFrame) => void
  setStartupPage: (p: StartupPage) => void
  setCommandGuardEnabled: (on: boolean) => void
  setCommandGuardPatterns: (patterns: string[]) => void
  /** Gán 1 phím tắt (combo đã chuẩn hoá). */
  setShortcut: (action: ShortcutAction, combo: string) => void
  /** Trả mọi phím tắt về mặc định. */
  resetShortcuts: () => void
  setAutoCompleteEnabled: (on: boolean) => void
  setShellMarksEnabled: (on: boolean) => void
  setCommandHistoryEnabled: (on: boolean) => void
  setNotifyLongCommands: (on: boolean) => void
  /** Thay toàn bộ danh sách alias (Settings quản lý mảng, lưu localStorage). */
  setCommandAliases: (list: CommandAlias[]) => void
  /** Chọn con trỏ chuột (id preset hoặc `custom:<id>`). */
  setMouseCursor: (id: string) => void
  /**
   * Thêm 1 con trỏ tự tạo rồi chọn luôn nó.
   * Trả 'full' khi đã đủ `CURSOR_CUSTOM_MAX`, 'quota' khi localStorage đầy, 'ok' nếu xong.
   */
  addCustomCursor: (c: CustomCursor) => 'ok' | 'full' | 'quota'
  /** Sửa tên / điểm nhấn của 1 con trỏ tự thêm. */
  updateCustomCursor: (id: string, patch: Partial<Pick<CustomCursor, 'name' | 'hotX' | 'hotY'>>) => void
  /**
   * Gán / gỡ ảnh hover của 1 con trỏ tự thêm (null = gỡ).
   * Trả false khi localStorage đầy — lúc đó KHÔNG đổi gì.
   */
  setCustomCursorHover: (id: string, image: { dataUrl: string; width: number; height: number } | null) => boolean
  /** Xoá 1 con trỏ tự thêm; nếu đang chọn nó thì trả về con trỏ hệ thống. */
  removeCustomCursor: (id: string) => void
  /** Override màu UI theo base theme hiện tại. */
  customColors: CustomColors
  /** Đặt/gỡ 1 màu cho theme đang chọn (null = gỡ override). */
  setCustomColor: (varName: PaletteVar, hex: string | null) => void
  /** Gỡ mọi override màu của theme đang chọn. */
  resetCustomColors: () => void
  /** Xuất theme hiện tại (accent + palette override) ra JSON. */
  exportThemeJson: () => string
  /** Nhập theme từ JSON (áp accent + palette cho theme đang chọn). Trả về false nếu JSON sai. */
  importThemeJson: (text: string) => boolean
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: readTheme(),
  layout: readLayout(),
  language: readLang(),
  accentColor: readAccent(),
  customColors: readCustomColors(),
  backgroundImage: readBgImage(),
  backgroundOpacity: readBgOpacity(),
  backgroundBlur: readBgBlur(),
  backgroundPosition: readBgPosition(),
  backgroundFit: readBgFit(),
  termFontFamily: readTermFont(),
  termFontSize: readTermSize(),
  termLineHeight: readTermLineHeight(),
  termCursor: readTermCursor(),
  termWebgl: readTermWebgl(),
  paneLayout: readPaneLayout(),
  paneFrame: readPaneFrame(),
  startupPage: readStartupPage(),
  commandGuardEnabled: readCommandGuardOn(),
  commandGuardPatterns: readCommandGuardPatterns(),
  shortcuts: readShortcuts(),
  autoCompleteEnabled: readAutoComplete(),
  shellMarksEnabled: readShellMarks(),
  notifyLongCommands: readNotifyLong(),
  commandHistoryEnabled: readCommandHistoryEnabled(),
  commandAliases: readCommandAliases(),
  mouseCursor: readMouseCursor(),
  customCursors: readCustomCursors(),
  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme)
    applyTheme(theme)
    // Override màu lưu tách theo theme → áp lại bộ của theme mới
    applyCustomTheme(theme, get().customColors)
    // Accent mặc định khác nhau giữa dark/light → dựng lại con trỏ bản tô accent
    applyMouseCursor(get().mouseCursor, get().customCursors)
    set({ theme })
  },
  setLayout: (layout) => {
    localStorage.setItem(LAYOUT_KEY, layout)
    applyLayout(layout)
    set({ layout })
  },
  setLanguage: (language) => {
    localStorage.setItem(LANG_KEY, language)
    applyLang(language)
    set({ language })
  },
  setAccentColor: (color) => {
    if (color) localStorage.setItem(ACCENT_KEY, color)
    else localStorage.removeItem(ACCENT_KEY)
    applyAccent(color)
    applyMouseCursor(get().mouseCursor, get().customCursors)
    set({ accentColor: color })
  },
  setBackgroundImage: (image) => {
    try {
      if (image) localStorage.setItem(BG_IMAGE_KEY, image)
      else localStorage.removeItem(BG_IMAGE_KEY)
    } catch {
      return false // QuotaExceededError — ảnh sau khi nén vẫn quá lớn
    }
    applyBackground(image)
    set({ backgroundImage: image })
    return true
  },
  setBackgroundOpacity: (v) => {
    const opacity = Math.min(Math.max(v, 0.05), 1)
    localStorage.setItem(BG_OPACITY_KEY, String(opacity))
    set({ backgroundOpacity: opacity })
  },
  setBackgroundBlur: (v) => {
    const blur = Math.min(Math.max(v, 0), 24)
    localStorage.setItem(BG_BLUR_KEY, String(blur))
    set({ backgroundBlur: blur })
  },
  setBackgroundPosition: (position) => {
    localStorage.setItem(BG_POSITION_KEY, position)
    set({ backgroundPosition: position })
  },
  setBackgroundFit: (fit) => {
    localStorage.setItem(BG_FIT_KEY, fit)
    set({ backgroundFit: fit })
  },
  setTermFontFamily: (family) => {
    const value = family.trim() || TERM_FONT_DEFAULT
    localStorage.setItem(TERM_FONT_KEY, value)
    set({ termFontFamily: value })
  },
  setTermFontSize: (n) => {
    const size = Math.min(Math.max(Math.round(n), 8), 28)
    localStorage.setItem(TERM_SIZE_KEY, String(size))
    set({ termFontSize: size })
  },
  setTermLineHeight: (n) => {
    const lh = Math.min(Math.max(n, 1), 2)
    localStorage.setItem(TERM_LH_KEY, String(lh))
    set({ termLineHeight: lh })
  },
  setTermCursor: (cursor) => {
    localStorage.setItem(TERM_CURSOR_KEY, cursor)
    set({ termCursor: cursor })
  },
  setTermWebgl: (on) => {
    localStorage.setItem(TERM_WEBGL_KEY, on ? '1' : '0')
    set({ termWebgl: on })
  },
  setPaneLayout: (layout) => {
    localStorage.setItem(PANE_LAYOUT_KEY, layout)
    set({ paneLayout: layout })
  },
  setPaneFrame: (frame) => {
    localStorage.setItem(PANE_FRAME_KEY, frame)
    set({ paneFrame: frame })
  },
  setStartupPage: (page) => {
    localStorage.setItem(STARTUP_KEY, page)
    set({ startupPage: page })
  },
  setCommandGuardEnabled: (on) => {
    localStorage.setItem(CMD_GUARD_ON_KEY, on ? '1' : '0')
    set({ commandGuardEnabled: on })
  },
  setCommandGuardPatterns: (patterns) => {
    localStorage.setItem(CMD_GUARD_PATTERNS_KEY, JSON.stringify(patterns))
    set({ commandGuardPatterns: patterns })
  },
  setShortcut: (action, combo) =>
    set((s) => {
      const next = { ...s.shortcuts, [action]: combo }
      localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(next))
      return { shortcuts: next }
    }),
  resetShortcuts: () => {
    localStorage.removeItem(SHORTCUTS_KEY)
    set({ shortcuts: { ...DEFAULT_SHORTCUTS } })
  },
  setAutoCompleteEnabled: (on) => {
    localStorage.setItem(AUTOCOMPLETE_ON_KEY, on ? '1' : '0')
    set({ autoCompleteEnabled: on })
  },
  setShellMarksEnabled: (on) => {
    localStorage.setItem(SHELL_MARKS_KEY, on ? '1' : '0')
    set({ shellMarksEnabled: on })
  },
  setNotifyLongCommands: (on) => {
    localStorage.setItem(NOTIFY_LONG_KEY, on ? '1' : '0')
    set({ notifyLongCommands: on })
  },
  setCommandHistoryEnabled: (on) => {
    localStorage.setItem(CMD_HISTORY_KEY, on ? '1' : '0')
    set({ commandHistoryEnabled: on })
  },
  setCommandAliases: (list) => {
    // Lưu nguyên mảng (kể cả dòng đang nhập dở) — terminal tự bỏ qua mục trigger rỗng khi khớp.
    localStorage.setItem(ALIASES_KEY, JSON.stringify(list))
    set({ commandAliases: list })
  },
  setMouseCursor: (id) => {
    localStorage.setItem(CURSOR_KEY, id)
    applyMouseCursor(id, get().customCursors)
    set({ mouseCursor: id })
  },
  addCustomCursor: (cursor) => {
    const list = get().customCursors
    if (list.length >= CURSOR_CUSTOM_MAX) return 'full'
    const next = [...list, cursor]
    try {
      localStorage.setItem(CURSOR_LIST_KEY, JSON.stringify(next))
    } catch {
      return 'quota' // QuotaExceededError — localStorage đầy (thường do ảnh nền chiếm chỗ)
    }
    const selection = `custom:${cursor.id}`
    localStorage.setItem(CURSOR_KEY, selection)
    applyMouseCursor(selection, next)
    set({ customCursors: next, mouseCursor: selection })
    return 'ok'
  },
  updateCustomCursor: (id, patch) => {
    const next = get().customCursors.map((c) => (c.id === id ? { ...c, ...patch } : c))
    localStorage.setItem(CURSOR_LIST_KEY, JSON.stringify(next))
    applyMouseCursor(get().mouseCursor, next)
    set({ customCursors: next })
  },
  setCustomCursorHover: (id, image) => {
    const next = get().customCursors.map((c) =>
      c.id === id
        ? image
          ? { ...c, hoverDataUrl: image.dataUrl, hoverWidth: image.width, hoverHeight: image.height }
          : // Gỡ ảnh hover: phải XOÁ hẳn 3 khoá, để undefined thì JSON.stringify bỏ đi
            // nhưng object trong RAM vẫn còn khoá → `hoverDataUrl` undefined vẫn qua được `if`
            { id: c.id, name: c.name, dataUrl: c.dataUrl, hotX: c.hotX, hotY: c.hotY, width: c.width, height: c.height }
        : c
    )
    try {
      localStorage.setItem(CURSOR_LIST_KEY, JSON.stringify(next))
    } catch {
      return false
    }
    applyMouseCursor(get().mouseCursor, next)
    set({ customCursors: next })
    return true
  },
  removeCustomCursor: (id) => {
    const next = get().customCursors.filter((c) => c.id !== id)
    localStorage.setItem(CURSOR_LIST_KEY, JSON.stringify(next))
    // Đang dùng đúng con trỏ vừa xoá → quay về con trỏ hệ thống, đừng để trỏ vào chỗ trống
    const selection = get().mouseCursor === `custom:${id}` ? 'system' : get().mouseCursor
    localStorage.setItem(CURSOR_KEY, selection)
    applyMouseCursor(selection, next)
    set({ customCursors: next, mouseCursor: selection })
  },
  setCustomColor: (varName, hex) => {
    const { theme, customColors } = get()
    const next: CustomColors = {
      dark: { ...customColors.dark },
      light: { ...customColors.light }
    }
    if (hex && HEX_RE.test(hex)) next[theme][varName] = hex
    else delete next[theme][varName]
    localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(next))
    applyCustomTheme(theme, next)
    set({ customColors: next })
  },
  resetCustomColors: () => {
    const { theme, customColors } = get()
    const next: CustomColors = { dark: { ...customColors.dark }, light: { ...customColors.light } }
    next[theme] = {}
    localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(next))
    applyCustomTheme(theme, next)
    set({ customColors: next })
  },
  exportThemeJson: () => {
    const { theme, layout, accentColor, customColors } = get()
    // `layout` đi kèm để một file theme mang được cả bố cục; bản cũ không có trường này vẫn nhập được
    return JSON.stringify(
      { version: 1, theme, layout, accent: accentColor, colors: customColors[theme] },
      null,
      2
    )
  },
  importThemeJson: (text) => {
    let raw: Record<string, unknown>
    try {
      raw = JSON.parse(text) as Record<string, unknown>
    } catch {
      return false
    }
    if (!raw || typeof raw !== 'object') return false
    // Màu palette
    const colors: Partial<Record<PaletteVar, string>> = {}
    const rawColors = raw.colors
    if (rawColors && typeof rawColors === 'object') {
      for (const v of CUSTOM_PALETTE_VARS) {
        const hex = (rawColors as Record<string, unknown>)[v]
        if (typeof hex === 'string' && HEX_RE.test(hex)) colors[v] = hex
      }
    }
    // Accent (tuỳ chọn)
    const accent = raw.accent
    const accentColor = typeof accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : null

    const { theme, customColors } = get()
    const next: CustomColors = { dark: { ...customColors.dark }, light: { ...customColors.light } }
    next[theme] = colors
    localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(next))
    applyCustomTheme(theme, next)

    if (accentColor) localStorage.setItem(ACCENT_KEY, accentColor)
    else localStorage.removeItem(ACCENT_KEY)
    applyAccent(accentColor)
    applyMouseCursor(get().mouseCursor, get().customCursors)

    // Bố cục (tuỳ chọn, file theme bản cũ không có) — chỉ nhận giá trị hợp lệ, không có thì giữ nguyên
    const rawLayout = raw.layout
    if (rawLayout === 'infra' || rawLayout === 'navigator' || rawLayout === 'workbench') {
      localStorage.setItem(LAYOUT_KEY, rawLayout)
      applyLayout(rawLayout)
      set({ layout: rawLayout })
    }

    set({ customColors: next, accentColor })
    return true
  }
}))

/** Đọc giá trị ban đầu mà không cần mount React (cho main.tsx). */
export const initialSettings = {
  theme: readTheme(),
  layout: readLayout(),
  language: readLang(),
  backgroundImage: readBgImage(),
  accentColor: readAccent(),
  customColors: readCustomColors(),
  mouseCursor: readMouseCursor(),
  customCursors: readCustomCursors()
}
