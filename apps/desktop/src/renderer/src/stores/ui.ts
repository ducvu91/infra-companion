import { create } from 'zustand'
import { startupNavSection, type NavMenuId } from '@infra/shared'
import { useNavMenuStore } from './navMenu'
import { useToolUsageStore } from './toolUsage'

export type AppModal =
  | 'export-hosts'
  | 'do-import'
  | 'known-hosts'
  | 'log-tail'
  | 'cron'
  | 'key-rotate'
  | 'disk-usage'
  | 'pkg-updates'
  | 'snippets'
  | 'tunnels'
  | 'keys'
  | 'bulk'
  | 'net'
  | 'monitor'
  | 'sync'
  | 'ai'
  | 'ai-diagnose'
  | 'recordings'
  | 'settings'
  | 'workspaces'
  | 'plugins'
  | 'processes'
  | 'services'
  | 'replication'
  | 'compare'
  | 'hostmap'
  | 'localdev-settings'
  | 'help'
  | 'notifications'
  | 'http-checks'
  | 'client-import'
  | 'inventory'
  | 'runbooks'
  | 'jobs'
  | 'security'
  | 'folder-sync'
  | null

/**
 * Mục đang chọn trên thanh điều hướng của theme Navigator. Vùng chính (khi không tab nào
 * active) vẽ đúng mục này. Theme Infra/Workbench không đọc giá trị này (🏠 của chúng vẫn gọi
 * `goToSection('dashboard')` — vô hại, vùng chính ở đó luôn là Dashboard).
 */
export type NavSection = NavMenuId

/**
 * Mục đang mở trong PANEL PHỤ của theme Workbench. Tách khỏi `navSection`: nút 🏠 đặt
 * `navSection = 'dashboard'` (đúng cho Navigator) mà nếu Workbench cũng đọc cờ đó thì bấm 🏠 làm
 * panel đang xem Tunnels nhảy về Hosts. Dashboard/SFTP không phải panel (chúng là vùng làm việc).
 */
export type WorkbenchPanel = 'hosts' | 'tunnels' | 'snippets' | 'keys' | 'workspaces' | 'history' | 'tools'

const WORKBENCH_PANELS: readonly WorkbenchPanel[] = ['hosts', 'tunnels', 'snippets', 'keys', 'workspaces', 'history', 'tools']
/** Bề rộng panel phụ Workbench (px) — kẹp để không kéo mất terminal hay bé tới mức vô dụng. */
export const WORKBENCH_PANEL_MIN = 200
export const WORKBENCH_PANEL_MAX = 520
const WORKBENCH_PANEL_DEFAULT = 260

/**
 * Panel ĐÁY của theme Workbench (dưới terminal, kiểu VS Code `Ctrl+J`): chỗ ở cố định cho những
 * thứ vốn nổi lơ lửng góc phải — Monitoring, Xem log, Tunnels. Tab đang chọn, đang mở/đóng và
 * chiều cao đều nhớ qua localStorage.
 */
export type WorkbenchBottomTab = 'monitor' | 'log' | 'tunnels'
export const WORKBENCH_BOTTOM_TABS: readonly WorkbenchBottomTab[] = ['monitor', 'log', 'tunnels']
export const WORKBENCH_BOTTOM_MIN = 120
export const WORKBENCH_BOTTOM_MAX = 600
const WORKBENCH_BOTTOM_DEFAULT = 240

interface UiState {
  modal: AppModal
  /** Theme Workbench: panel phụ đang hiện gì (nhớ qua localStorage). */
  workbenchPanel: WorkbenchPanel
  setWorkbenchPanel: (p: WorkbenchPanel) => void
  /** Theme Workbench: bề rộng panel phụ (kéo mép để đổi, nhớ qua localStorage). */
  workbenchPanelWidth: number
  setWorkbenchPanelWidth: (px: number) => void
  /** Theme Workbench: panel đáy — tab đang chọn, đang mở không, chiều cao (px). */
  workbenchBottomTab: WorkbenchBottomTab
  workbenchBottomOpen: boolean
  workbenchBottomHeight: number
  /** Mở panel đáy (và chuyển tab nếu truyền). */
  openWorkbenchBottom: (tab?: WorkbenchBottomTab) => void
  closeWorkbenchBottom: () => void
  toggleWorkbenchBottom: () => void
  setWorkbenchBottomHeight: (px: number) => void
  /** Theme Navigator: mục đang chọn ở cột trái (nhớ qua localStorage để mở lại đúng chỗ). */
  navSection: NavSection
  setNavSection: (s: NavSection) => void
  setModal: (m: AppModal) => void
  /**
   * F48 — cửa sổ AI chẩn đoán đang thu nhỏ xuống pill (session vẫn chạy nền trong store
   * aiDiagnose). Tách khỏi `modal` để khi thu nhỏ thì bỏ backdrop (app dùng được) mà
   * vẫn còn pill để bung lại. Mở lại ('ai-diagnose') tự xoá cờ này.
   */
  aiDiagnoseMin: boolean
  /** Thu nhỏ cửa sổ chẩn đoán: ẩn modal (bỏ backdrop) + hiện pill. */
  minimizeAiDiagnose: () => void
  /** Đóng pill (không dừng session — mở lại qua menu/palette vẫn thấy phiên đang chạy). */
  setAiDiagnoseMin: (v: boolean) => void
  /** Thu gọn cột host bên trái để phóng to vùng làm việc (nhớ qua localStorage). */
  sidebarCollapsed: boolean
  toggleSidebar: () => void
  /** Command Palette (Ctrl+Shift+P) — đưa lên store để nút toolbar cũng mở được. */
  paletteOpen: boolean
  setPaletteOpen: (v: boolean) => void
  togglePalette: () => void
}

const SIDEBAR_KEY = 'infra.sidebar.collapsed'
const NAV_KEY = 'infra.nav.section'
const WB_PANEL_KEY = 'infra.workbench.panel'
const WB_WIDTH_KEY = 'infra.workbench.panelWidth'
const WB_BOTTOM_TAB_KEY = 'infra.workbench.bottom.tab'
const WB_BOTTOM_OPEN_KEY = 'infra.workbench.bottom.open'
const WB_BOTTOM_HEIGHT_KEY = 'infra.workbench.bottom.height'

function readBottomTab(): WorkbenchBottomTab {
  const v = localStorage.getItem(WB_BOTTOM_TAB_KEY)
  return (WORKBENCH_BOTTOM_TABS as readonly string[]).includes(v ?? '') ? (v as WorkbenchBottomTab) : 'monitor'
}

function readBottomHeight(): number {
  const n = Number(localStorage.getItem(WB_BOTTOM_HEIGHT_KEY))
  return Number.isFinite(n) && n >= WORKBENCH_BOTTOM_MIN && n <= WORKBENCH_BOTTOM_MAX ? Math.round(n) : WORKBENCH_BOTTOM_DEFAULT
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* localStorage lỗi — chỉ mất persist */
  }
}

function readWorkbenchPanel(): WorkbenchPanel {
  const v = localStorage.getItem(WB_PANEL_KEY)
  return (WORKBENCH_PANELS as readonly string[]).includes(v ?? '') ? (v as WorkbenchPanel) : 'hosts'
}

function readWorkbenchWidth(): number {
  const n = Number(localStorage.getItem(WB_WIDTH_KEY))
  return Number.isFinite(n) && n >= WORKBENCH_PANEL_MIN && n <= WORKBENCH_PANEL_MAX ? Math.round(n) : WORKBENCH_PANEL_DEFAULT
}

/**
 * Mục mở app vào: chỉ nhận mục đang CÓ trên menu Navigator, còn lại về Hosts. Ca thật: bản
 * v0.2.20 nhớ `dashboard` (khi đó Dashboard mặc định bật), nay Dashboard mặc định tắt — mở app
 * mà rơi vào Dashboard với menu không sáng mục nào thì trái với "bắt đầu từ Hosts". Trong phiên
 * thì `setNavSection` nhận mọi mục hợp lệ (palette vẫn mở được mục đã tắt).
 */
function readNavSection(): NavSection {
  const menu = useNavMenuStore.getState()
  return startupNavSection(localStorage.getItem(NAV_KEY), menu.order, menu.enabled)
}

/**
 * Modal toàn cục mount MỘT instance duy nhất (ở App). Sidebar/Command Palette chỉ gọi setModal.
 * Trước đây Sidebar mount bộ modal riêng → mở Monitoring 2 nơi tạo 2 instance dẫm chân nhau
 * (main chỉ có 1 subscriber + STOP_ALL toàn cục).
 */
export const useUiStore = create<UiState>((set) => ({
  modal: null,
  // Mở cửa sổ chẩn đoán (từ menu/palette/pill) luôn xoá cờ thu nhỏ để hiện đầy đủ.
  setModal: (modal) => {
    // Đếm lượt dùng cho lưới công cụ Dashboard. Đặt ở ĐÂY vì mọi đường mở công cụ (menu `⋯`,
    // Command Palette, lưới, tab "Tất cả tính năng") đều đi qua `setModal` — đếm ở riêng lưới
    // thì công cụ chưa có ô sẽ không bao giờ kiếm được điểm để giành ô.
    // `null` là ĐÓNG modal, không phải mở gì.
    if (modal !== null) useToolUsageStore.getState().record(modal)
    set(modal === 'ai-diagnose' ? { modal, aiDiagnoseMin: false } : { modal })
  },
  navSection: readNavSection(),
  setNavSection: (navSection) => {
    try {
      localStorage.setItem(NAV_KEY, navSection)
    } catch {
      /* localStorage lỗi — chỉ mất persist */
    }
    set({ navSection })
  },
  workbenchPanel: readWorkbenchPanel(),
  setWorkbenchPanel: (workbenchPanel) => {
    try {
      localStorage.setItem(WB_PANEL_KEY, workbenchPanel)
    } catch {
      /* localStorage lỗi — chỉ mất persist */
    }
    set({ workbenchPanel })
  },
  workbenchPanelWidth: readWorkbenchWidth(),
  setWorkbenchPanelWidth: (px) => {
    const workbenchPanelWidth = Math.round(Math.min(WORKBENCH_PANEL_MAX, Math.max(WORKBENCH_PANEL_MIN, px)))
    try {
      localStorage.setItem(WB_WIDTH_KEY, String(workbenchPanelWidth))
    } catch {
      /* localStorage lỗi — chỉ mất persist */
    }
    set({ workbenchPanelWidth })
  },
  workbenchBottomTab: readBottomTab(),
  workbenchBottomOpen: localStorage.getItem(WB_BOTTOM_OPEN_KEY) === '1',
  workbenchBottomHeight: readBottomHeight(),
  openWorkbenchBottom: (tab) =>
    set((s) => {
      const workbenchBottomTab = tab ?? s.workbenchBottomTab
      save(WB_BOTTOM_TAB_KEY, workbenchBottomTab)
      save(WB_BOTTOM_OPEN_KEY, '1')
      return { workbenchBottomTab, workbenchBottomOpen: true }
    }),
  closeWorkbenchBottom: () => {
    save(WB_BOTTOM_OPEN_KEY, '0')
    set({ workbenchBottomOpen: false })
  },
  toggleWorkbenchBottom: () =>
    set((s) => {
      const workbenchBottomOpen = !s.workbenchBottomOpen
      save(WB_BOTTOM_OPEN_KEY, workbenchBottomOpen ? '1' : '0')
      return { workbenchBottomOpen }
    }),
  setWorkbenchBottomHeight: (px) => {
    const workbenchBottomHeight = Math.round(Math.min(WORKBENCH_BOTTOM_MAX, Math.max(WORKBENCH_BOTTOM_MIN, px)))
    save(WB_BOTTOM_HEIGHT_KEY, String(workbenchBottomHeight))
    set({ workbenchBottomHeight })
  },
  aiDiagnoseMin: false,
  minimizeAiDiagnose: () => set({ modal: null, aiDiagnoseMin: true }),
  setAiDiagnoseMin: (aiDiagnoseMin) => set({ aiDiagnoseMin }),
  sidebarCollapsed: localStorage.getItem(SIDEBAR_KEY) === '1',
  toggleSidebar: () =>
    set((s) => {
      const collapsed = !s.sidebarCollapsed
      try {
        localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0')
      } catch {
        /* localStorage lỗi — chỉ mất persist, vẫn toggle được */
      }
      return { sidebarCollapsed: collapsed }
    }),
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen }))
}))
