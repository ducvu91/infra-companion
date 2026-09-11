import { create } from 'zustand'
import { startupNavSection, type NavMenuId } from '@infra/shared'
import { useNavMenuStore } from './navMenu'
import { useToolUsageStore } from './toolUsage'

export type AppModal =
  /**
   * Codex ở CỘT DOCK (khác entry `codex` trong catalog, cái đó mở dạng TAB).
   *
   * Không phải modal thật — `setModal` chuyển hướng nó sang cờ `codexPanelOpen`, cùng khuôn
   * `'ai'` và `'ai-diagnose'`. Có mặt trong union này để mọi lối vào sẵn có (menu ⋯, palette,
   * lưới công cụ) dùng được mà không cần đường riêng.
   */
  | 'codex-dock'
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
  /**
   * F24 — ô tìm lệnh đã chạy. KHÔNG phải modal thật: `setModal` chuyển nó sang `cmdHistoryOpen`.
   * Có mặt trong union này để vào được `toolCatalog` — nhờ đó nó xuất hiện ở menu ⋯, lưới công
   * cụ Dashboard, tab "Tất cả tính năng" và panel Tools của Workbench, thay vì chỉ mở được
   * bằng phím tắt (tính năng chỉ có phím tắt là tính năng người không đọc changelog không
   * biết là có).
   */
  | 'cmd-history'
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

/**
 * Cột dock Trợ lý AI — bên phải vùng làm việc, kiểu panel Claude Code trong VS Code.
 *
 * Dock CHIẾM CHỖ THẬT (terminal hẹp lại) chứ không nổi đè lên: một panel nổi vẫn che output đúng
 * lúc đang đọc, mà đọc output là nửa còn lại của việc hỏi AI. Kéo mép trái để đổi bề rộng.
 */
export const AI_DOCK_MIN = 280
export const AI_DOCK_MAX = 720
const AI_DOCK_DEFAULT = 400

/**
 * Hai công cụ AI dùng CHUNG một cột dock, chọn bằng tab — không phải hai cột cạnh nhau.
 *
 * Mỗi cột rộng mặc định 400px, nên mở cả hai kiểu cột-riêng là ngốn 800px và terminal còn một
 * mẩu — trong khi cả hai đều là thứ vừa-hỏi-vừa-nhìn-output, mất output thì mở ra làm gì. Tab
 * cũng đúng với thói quen: người ta hỏi AI *hoặc* đang chẩn đoán, hiếm khi đọc cả hai cùng lúc.
 * Panel không hiện vẫn `mounted` (chỉ ẩn bằng CSS) nên câu đang gõ và phiên chẩn đoán còn nguyên.
 */
export type AiDockTab = 'ai' | 'ai-diagnose' | 'codex'

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
   * Trợ lý AI (F09) — DOCK cạnh terminal, nên có cờ riêng thay vì nằm trong `modal`.
   *
   * `modal` chỉ giữ được MỘT giá trị: để AI ở đó thì mở bất cứ hộp nào khác là AI bị đóng và
   * câu hỏi đang gõ mất — đúng một nửa của cái "mở AI lên là không dùng được gì khác".
   * `setModal('ai')` được chuyển hướng sang cờ này để mọi lối vào cũ vẫn hoạt động.
   */
  aiPanelOpen: boolean
  setAiPanelOpen: (open: boolean) => void
  /**
   * Codex ở cột dock (tab thứ 3), bên cạnh chế độ TAB đã có.
   *
   * Tab vẫn là chế độ chính vì output có diff/danh sách file, nhưng dock giải quyết ca thật:
   * theo dõi một lượt dài trong khi vẫn làm việc ở terminal.
   */
  codexPanelOpen: boolean
  setCodexPanelOpen: (open: boolean) => void
  /** Bề rộng cột dock Trợ lý AI (kéo mép trái để đổi, nhớ qua localStorage). */
  aiDockWidth: number
  setAiDockWidth: (px: number) => void
  /** Tab đang hiện trong dock AI dùng chung. Chỉ có nghĩa khi cả hai panel cùng mở. */
  aiDockTab: AiDockTab
  setAiDockTab: (tab: AiDockTab) => void
  /**
   * F48 — dock AI chẩn đoán đang mở. Cờ RIÊNG với `aiPanelOpen`: hai công cụ khác nhau, và mở
   * cả hai cùng lúc là hợp lệ (hỏi cách đọc kết quả chẩn đoán chẳng hạn).
   */
  aiDiagnoseOpen: boolean
  setAiDiagnoseOpen: (open: boolean) => void
  /**
   * F48 — dock chẩn đoán đã cất đi mà phiên VẪN CHẠY nền (store aiDiagnose) → hiện pill.
   *
   * Pill là thứ duy nhất còn báo "AI đã đề xuất lệnh, đang chờ bạn duyệt" khi dock đóng, nên nó
   * vẫn cần dù dock (khác modal) không chặn gì cả. Mở lại ('ai-diagnose') tự xoá cờ này.
   */
  aiDiagnoseMin: boolean
  /** Cất dock chẩn đoán đi nhưng giữ pill — KHÔNG dừng phiên đang chạy. */
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
  /** F24 — ô tìm lệnh đã chạy (Ctrl+Shift+R). Cùng khuôn với palette để nút/menu cũng mở được. */
  cmdHistoryOpen: boolean
  setCmdHistoryOpen: (v: boolean) => void
}

const SIDEBAR_KEY = 'infra.sidebar.collapsed'
const NAV_KEY = 'infra.nav.section'
const WB_PANEL_KEY = 'infra.workbench.panel'
const WB_WIDTH_KEY = 'infra.workbench.panelWidth'
const AI_DOCK_WIDTH_KEY = 'infra.ai.dockWidth'
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

function readAiDockWidth(): number {
  const n = Number(localStorage.getItem(AI_DOCK_WIDTH_KEY))
  return Number.isFinite(n) && n >= AI_DOCK_MIN && n <= AI_DOCK_MAX ? Math.round(n) : AI_DOCK_DEFAULT
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
    // Trợ lý AI là PANEL ghim, không phải modal: nó phải sống song song với terminal VÀ với modal
    // khác (mở Snippets giữa lúc đang hỏi AI thì câu hỏi không được biến mất). `modal` là một giá
    // trị duy nhất nên không chứa được nó — chuyển sang cờ riêng ngay tại đây, chỗ mà MỌI lối vào
    // (menu ⋯, palette, lưới công cụ, catalog, Ctrl+I) đều đi qua.
    if (modal === 'ai') {
      set({ aiPanelOpen: true, aiDockTab: 'ai' })
      return
    }
    // Codex ở cột dock — cùng lý do như 'ai': nó là panel ghim sống song song với terminal,
    // không phải hộp thoại, nên không thể nằm trong `modal` (chỉ giữ MỘT giá trị).
    if (modal === 'codex-dock') {
      set({ codexPanelOpen: true, aiDockTab: 'codex' })
      return
    }
    // F24 — ô tìm lệnh cũng là overlay riêng, cùng lý do: nó mở ĐÈ lên mọi thứ rồi đóng ngay
    // sau khi chọn, không nên chiếm chỗ của một hộp thoại đang mở.
    if (modal === 'cmd-history') {
      set({ cmdHistoryOpen: true })
      return
    }
    // AI chẩn đoán cũng là DOCK: một phiên chạy nhiều bước, mỗi bước chờ user duyệt — có backdrop
    // thì suốt phiên không xem được gì khác, kể cả terminal của chính máy đang chẩn đoán.
    if (modal === 'ai-diagnose') {
      set({ aiDiagnoseOpen: true, aiDiagnoseMin: false, aiDockTab: 'ai-diagnose' })
      return
    }
    set({ modal })
  },
  // Mở panel = đưa nó lên MẶT TRƯỚC của dock chung. Không kéo tab theo thì bấm "Trợ lý AI" lúc
  // đang xem tab chẩn đoán sẽ như không có gì xảy ra — panel đã mở sẵn, chỉ nằm ở tab kia.
  aiPanelOpen: false,
  setAiPanelOpen: (aiPanelOpen) => set(aiPanelOpen ? { aiPanelOpen, aiDockTab: 'ai' } : { aiPanelOpen }),
  codexPanelOpen: false,
  setCodexPanelOpen: (codexPanelOpen) =>
    set(codexPanelOpen ? { codexPanelOpen, aiDockTab: 'codex' } : { codexPanelOpen }),
  aiDockWidth: readAiDockWidth(),
  aiDiagnoseOpen: false,
  setAiDiagnoseOpen: (aiDiagnoseOpen) =>
    set(aiDiagnoseOpen ? { aiDiagnoseOpen, aiDockTab: 'ai-diagnose' } : { aiDiagnoseOpen }),
  aiDockTab: 'ai',
  setAiDockTab: (aiDockTab) => set({ aiDockTab }),
  setAiDockWidth: (px) => {
    const aiDockWidth = Math.round(Math.min(AI_DOCK_MAX, Math.max(AI_DOCK_MIN, px)))
    try {
      localStorage.setItem(AI_DOCK_WIDTH_KEY, String(aiDockWidth))
    } catch {
      /* localStorage lỗi — chỉ mất persist */
    }
    set({ aiDockWidth })
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
  // "Thu nhỏ" giờ = đóng DOCK nhưng giữ pill: phiên vẫn chạy nền và pill là thứ duy nhất còn
  // báo "AI đang chờ bạn duyệt lệnh" khi dock đã cất đi.
  minimizeAiDiagnose: () => set({ aiDiagnoseOpen: false, aiDiagnoseMin: true }),
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
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  cmdHistoryOpen: false,
  setCmdHistoryOpen: (cmdHistoryOpen) => set({ cmdHistoryOpen })
}))
