import { create } from 'zustand'
import type { SessionKind, SessionStatus, TerminalCreateRequest } from '@infra/shared'
import { clearTermSession } from '../lib/termBus'
import { errorMessage, useToastsStore } from './toasts'
import { useDataStore } from './data'
import { useToolUsageStore } from './toolUsage'

/**
 * Cách mở lại 1 pane — lưu vào workspace để dựng lại layout. Chỉ tham chiếu hostId
 * (không denormalize) nên host đồng bộ tới máy nào là mở được tới đó.
 */
export type PaneOrigin =
  | { kind: 'local'; profileId?: string }
  | { kind: 'host'; hostId: string }
  | { kind: 'quick'; target: string }
  /** Shell tại thư mục 1 site local dev. CHỈ giữ siteId (không denormalize cwd/env): đường dẫn
   *  runtime được resolve lại lúc mở, nên workspace lưu rồi mở lại vẫn đúng sau khi đổi
   *  thư mục gốc hoặc nâng version PHP. */
  | { kind: 'site-shell'; siteId: string }

/** Một pane terminal trong tab (mỗi pane = 1 phiên local/ssh riêng). */
export interface Pane {
  id: string
  sessionId: string
  kind: SessionKind
  title: string
  subtitle?: string
  status: SessionStatus | 'exited'
  statusDetail?: string
  exitCode?: number | null
  exitReason?: string
  /** Cách tạo pane này — để lưu/dựng lại workspace. */
  origin?: PaneOrigin
}

/**
 * Tab công cụ = tab KHÔNG giữ session nào (state sống trong store/main), mỗi loại nhiều nhất 1 tab.
 * Mở ở tab thay vì popup để không khoá cả app trong lúc công cụ đang chạy dài (chẩn đoán AI,
 * theo dõi tunnel, xem tiến trình…) — đây là lý do tồn tại của nhóm này.
 */
export const TOOL_TAB_KINDS = [
  'monitor',
  'compare',
  'localdev',
  'tunnels',
  'processes',
  'services',
  'ai-diagnose',
  'replication',
  'help',
  /** Danh sách đầy đủ mọi công cụ — menu `⋯` chỉ giữ thứ dùng hằng ngày. */
  'features',
  // Công cụ chẩn đoán/vận hành thêm ở v0.2.10–0.2.12: đều là việc CHẠY LÂU (quét cả fleet,
  // theo dõi log, xoay key tuần tự) nên mở dạng popup là khoá cả app trong lúc chờ.
  'log-tail',
  'cron',
  'key-rotate',
  'disk-usage',
  'pkg-updates',
  'known-hosts',
  /** Trang SFTP "mở trước, chọn host sau" — tab riêng cho theme Infra (Navigator có mục 📁 SFTP). */
  'files',
  /** Trung tâm thông báo — lịch sử cảnh báo mọi hệ theo dõi + đánh dấu sự kiện. */
  'notifications',
  /** Theo dõi URL (synthetic HTTP monitoring). */
  'http-checks',
  /** Kiểm kê fleet — bảng rộng, hợp tab hơn popup. */
  'inventory',
  /** Sổ tay vận hành — đọc cạnh terminal đang làm. */
  'runbooks',
  /** Lịch chạy tự động — danh sách việc + lịch sử lượt. */
  'jobs',
  /** Kiểm an ninh nhanh cả fleet. */
  'security',
  /** So lệch thư mục local ↔ remote — bảng rộng, hợp tab hơn popup. */
  'folder-sync',
  /**
   * Trợ lý AI — mặc định là cột DOCK cạnh terminal; nút ⛶ mở nó thành TAB khi câu trả lời dài
   * (một script nhiều dòng, một bảng so sánh) và cột 400px thành chỗ cuộn liên tục.
   */
  'ai',
  /**
   * Agent Codex — TAB ngay từ đầu, không phải cột dock.
   *
   * Khác Trợ lý AI ở chỗ nó **là** việc chính chứ không phải thứ hỗ trợ đọc terminal: output
   * gồm diff của patch, danh sách file, khối lệnh kèm kết quả. Một diff trong cột 400px thì
   * không đọc nổi, mà hộp duyệt lệnh lại là chỗ phải đọc HẾT trước khi bấm.
   */
  'codex'
] as const
export type ToolTabKind = (typeof TOOL_TAB_KINDS)[number]

export type TabKind = 'terminal' | 'sftp' | 'vnc' | ToolTabKind

export interface AppTab {
  id: string
  kind: TabKind
  /** terminal: nhiều pane bố trí dạng lưới; gõ broadcast gửi tới mọi pane. */
  panes: Pane[]
  activePaneId: string | null
  broadcast: boolean
  /** sftp: phiên SFTP + home. */
  sftpSessionId?: string
  sftpTitle?: string
  sftpHome?: string
  /** sftp: host đã mở — để lưu/dựng lại workspace. */
  sftpHostId?: string
  /** vnc (F13): phiên VNC — noVNC nối vào ws://127.0.0.1:<wsPort>/?token=<token>. */
  vncSessionId?: string
  vncWsPort?: number
  vncToken?: string
  vncTitle?: string
  vncHostId?: string
}

/** Một tab trong workspace đã lưu (chỉ spec để mở lại, không có session sống). */
export type WorkspaceTab =
  | { kind: 'terminal'; broadcast: boolean; panes: PaneOrigin[] }
  | { kind: 'sftp'; hostId: string }

let tabSeq = 1
let paneSeq = 1
const newTabId = (): string => `tab-${tabSeq++}`
const newPaneId = (): string => `pane-${paneSeq++}`

const toastError = (error: unknown): void => useToastsStore.getState().push(errorMessage(error))

interface TabsState {
  tabs: AppTab[]
  activeId: string | null
  /**
   * Tab terminal user vào GẦN NHẤT — đích của những nút "gửi lệnh vào terminal" khi bản thân
   * công cụ đang là tab đang mở (Sổ tay vận hành mở dạng tab thì `activeId` trỏ vào chính nó).
   *
   * Cố ý là "gần nhất" chứ không phải "tab terminal đầu tiên tìm thấy": gửi một lệnh `iptables`
   * vào máy khác không phải máy user đang làm là hỏng thật, nên đích phải là chỗ user vừa đứng.
   * Cập nhật ở MỘT chỗ (subscribe cuối file) thay vì rải theo từng lời gọi `set({ activeId })`.
   */
  lastTerminalTabId: string | null
  /** Gộp mọi tab terminal thành pane trong tab này (1 toolbar, broadcast dùng chung). */
  mergeTabs: (tabId: string) => void
  /** Gộp CHỌN LỌC: chỉ gộp các tab terminal trong `tabIds` (luôn gồm tab đích) vào tab đích. */
  mergeTabsSelected: (tabId: string, tabIds: string[]) => void
  /** Tách mỗi pane của tab thành 1 tab riêng (đảo của mergeTabs). */
  unmergeTab: (tabId: string) => void
  /** Đổi vị trí 1 pane trong tab (delta -1 = sang trái/lên, +1 = sang phải/xuống). */
  movePane: (tabId: string, paneId: string, delta: -1 | 1) => void
  /** Kéo-thả sắp xếp thanh tab: chuyển `dragId` tới ngay TRƯỚC/SAU `targetId`. */
  moveTab: (dragId: string, targetId: string, side: 'before' | 'after') => void
  /** Đưa 1 pane lên đầu danh sách — thành "cửa sổ chính" ở layout main-left/main-top. */
  setMainPane: (tabId: string, paneId: string) => void
  /** Kéo-thả trong lưới split: hai pane ĐỔI CHỖ cho nhau. */
  swapPanes: (tabId: string, aId: string, bId: string) => void
  openLocal: (profileId?: string) => Promise<void>
  openSsh: (hostId: string) => Promise<void>
  /** Mở nhiều host cùng lúc: mỗi host 1 pane trong CÙNG 1 tab mới (chia màn hình sẵn). */
  openSshGroup: (hostIds: string[]) => Promise<void>
  openQuick: (target: string) => Promise<void>
  openSftp: (hostId: string) => Promise<void>
  /** Mở tab VNC (F13): main dựng cầu ws↔tcp qua jump host, noVNC render trong tab. */
  openVnc: (hostId: string) => Promise<void>
  /** Hiện trang Dashboard (home) — KHÔNG phải tab: activeId=null là đang ở home, chọn tab để quay lại. */
  showDashboard: () => void
  /** Mở Monitoring thành 1 tab riêng (như tab server) — chỉ 1 tab monitor duy nhất; đã có thì focus lại.
   *  Tab này đọc dữ liệu real-time từ useMonitorStore (chung với dock/cửa sổ tách rời). */
  openMonitorTab: () => void
  /** Mở So sánh config thành 1 tab riêng (chỉ 1 tab compare duy nhất; đã có thì focus lại). */
  openCompareTab: () => void
  /** Mở Local dev (stack + site local) thành 1 tab riêng — 1 tab duy nhất, có sub-nav bên trong. */
  openLocaldevTab: () => void
  /** Mở (hoặc focus) 1 tab công cụ — Tunnels / Tiến trình / Services / AI chẩn đoán… */
  openToolTab: (kind: ToolTabKind) => void
  /** Mở terminal tại thư mục 1 site local dev, có php/wp sẵn trong PATH. */
  openSiteShell: (siteId: string) => Promise<void>
  /** Mở thêm pane trong tab đang active (split). opener tạo phiên. */
  splitLocal: (profileId?: string) => Promise<void>
  splitSsh: (hostId: string) => Promise<void>
  closeTab: (id: string) => void
  closePane: (tabId: string, paneId: string) => void
  /** Mở lại phiên cho pane đã exited (vd mất kết nối sau 3 lần auto-retry) — giữ nguyên pane/layout,
   *  scrollback cũ được nối tiếp (TerminalPane chụp snapshot theo sessionId MỚI khi remount). */
  reconnectPane: (tabId: string, paneId: string) => Promise<void>
  setActive: (id: string) => void
  setActivePane: (tabId: string, paneId: string) => void
  toggleBroadcast: (tabId: string) => void
  applyStatus: (sessionId: string, status: SessionStatus, detail?: string) => void
  applyExit: (sessionId: string, exitCode: number | null, reason?: string) => void
  cycleTab: (direction: 1 | -1) => void
  activeTab: () => AppTab | undefined
  /** Chụp layout hiện tại thành spec để lưu workspace (bỏ pane/tab không mở lại được). */
  snapshotWorkspace: () => WorkspaceTab[]
  /** Dựng lại layout từ workspace — CỘNG THÊM tab (không đóng tab đang mở). */
  restoreWorkspace: (tabs: WorkspaceTab[]) => Promise<void>
}

/** Suy ra cách mở lại pane từ request tạo phiên. Nguồn DUY NHẤT gán origin. */
function originOf(req: TerminalCreateRequest): PaneOrigin {
  if (req.kind === 'local') return { kind: 'local', profileId: req.profileId }
  if (req.quickTarget) return { kind: 'quick', target: req.quickTarget }
  if (req.hostId) return { kind: 'host', hostId: req.hostId }
  return { kind: 'local' }
}

/** Chuyển origin → request để mở lại. */
function reqOf(origin: PaneOrigin): TerminalCreateRequest {
  if (origin.kind === 'local') return { kind: 'local', profileId: origin.profileId, cols: 80, rows: 24 }
  if (origin.kind === 'quick') return { kind: 'ssh', quickTarget: origin.target, cols: 80, rows: 24 }
  // site-shell: cwd/env phải resolve lại từ main (không lưu sẵn) → xử lý ở reconnect/restore
  if (origin.kind === 'site-shell') return { kind: 'local', cols: 80, rows: 24 }
  return { kind: 'ssh', hostId: origin.hostId, cols: 80, rows: 24 }
}

/** Request mở lại shell của site — resolve cwd/env từ main tại thời điểm mở. */
async function siteShellRequest(siteId: string): Promise<{ req: TerminalCreateRequest; title: string }> {
  const env = await window.infra.localdev.siteShellEnv(siteId)
  if (!env.ok) throw new Error(env.error ?? 'Không mở được terminal cho site')
  return {
    req: { kind: 'local', cols: 80, rows: 24, cwd: env.cwd, env: env.env },
    title: env.title
  }
}

/**
 * Như `reqOf` nhưng resolve được cả `site-shell` (cần gọi main để lấy cwd/env).
 * Dùng ở MỌI chỗ mở lại pane (reconnect / restore workspace) — nếu dùng `reqOf` thuần thì
 * shell của site sẽ âm thầm mở thành shell trần ở home, mất cwd và mất php trong PATH.
 */
async function reqOfAsync(origin: PaneOrigin): Promise<TerminalCreateRequest> {
  if (origin.kind === 'site-shell') return (await siteShellRequest(origin.siteId)).req
  return reqOf(origin)
}

/** Tạo 1 phiên terminal qua IPC và trả về Pane (kèm origin để lưu workspace). */
async function createPane(req: TerminalCreateRequest): Promise<Pane> {
  const res = await window.infra.terminal.create(req)
  return {
    id: newPaneId(),
    sessionId: res.sessionId,
    kind: res.kind,
    title: res.title,
    subtitle: res.subtitle,
    status: res.kind === 'local' ? 'connected' : 'connecting',
    origin: originOf(req)
  }
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeId: null,
  lastTerminalTabId: null,

  mergeTabs: (tabId) =>
    set((state) => {
      const target = state.tabs.find((t) => t.id === tabId)
      if (target?.kind !== 'terminal') return {}
      const terminals = state.tabs.filter((t) => t.kind === 'terminal')
      if (terminals.length < 2) return {}
      // Gom pane theo thứ tự tab trên thanh tab; tab đích giữ vị trí, các tab terminal khác đóng lại
      const panes = terminals.flatMap((t) => t.panes)
      const tabs = state.tabs
        .filter((t) => t.kind !== 'terminal' || t.id === tabId)
        .map((t) => (t.id === tabId ? { ...t, panes } : t))
      return { tabs, activeId: tabId }
    }),

  mergeTabsSelected: (tabId, tabIds) =>
    set((state) => {
      const target = state.tabs.find((t) => t.id === tabId)
      if (target?.kind !== 'terminal') return {}
      const ids = new Set(tabIds)
      ids.add(tabId) // tab đích luôn nằm trong nhóm gộp
      // Các tab terminal được chọn, giữ thứ tự trên thanh tab
      const chosen = state.tabs.filter((t) => t.kind === 'terminal' && ids.has(t.id))
      if (chosen.length < 2) return {} // không đủ để gộp
      const panes = chosen.flatMap((t) => t.panes)
      const tabs = state.tabs
        // Giữ lại: tab không phải terminal, tab terminal KHÔNG chọn, và chính tab đích
        .filter((t) => t.kind !== 'terminal' || !ids.has(t.id) || t.id === tabId)
        .map((t) => (t.id === tabId ? { ...t, panes } : t))
      return { tabs, activeId: tabId }
    }),

  unmergeTab: (tabId) =>
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === tabId)
      const tab = state.tabs[index]
      if (tab?.kind !== 'terminal' || tab.panes.length < 2) return {}
      const split = tab.panes.map<AppTab>((pane) => ({
        id: newTabId(),
        kind: 'terminal',
        panes: [pane],
        activePaneId: pane.id,
        broadcast: false
      }))
      const tabs = [...state.tabs.slice(0, index), ...split, ...state.tabs.slice(index + 1)]
      const activeId = split.find((t) => t.panes[0]?.id === tab.activePaneId)?.id ?? split[0].id
      return { tabs, activeId }
    }),

  activeTab: () => get().tabs.find((t) => t.id === get().activeId),

  openLocal: async (profileId) => {
    try {
      const pane = await createPane({ kind: 'local', profileId, cols: 80, rows: 24 })
      addTab(set, pane)
    } catch (error) {
      toastError(error)
    }
  },

  openSsh: async (hostId) => {
    try {
      const pane = await createPane({ kind: 'ssh', hostId, cols: 80, rows: 24 })
      addTab(set, pane)
    } catch (error) {
      toastError(error)
    }
  },

  openSshGroup: async (hostIds) => {
    let tabId: string | null = null
    for (const hostId of hostIds) {
      try {
        const pane = await createPane({ kind: 'ssh', hostId, cols: 80, rows: 24 })
        // Host đầu tiên tạo tab mới, các host sau thêm pane vào đó; 1 host lỗi không chặn host khác
        if (tabId === null) tabId = addTab(set, pane)
        else addPane(set, tabId, pane)
      } catch (error) {
        toastError(error)
      }
    }
  },

  openQuick: async (target) => {
    try {
      const pane = await createPane({ kind: 'ssh', quickTarget: target, cols: 80, rows: 24 })
      addTab(set, pane)
    } catch (error) {
      toastError(error)
    }
  },

  openSftp: async (hostId) => {
    try {
      const res = await window.infra.sftp.open(hostId)
      const tab: AppTab = {
        id: newTabId(),
        kind: 'sftp',
        panes: [],
        activePaneId: null,
        broadcast: false,
        sftpSessionId: res.sessionId,
        sftpTitle: res.title,
        sftpHome: res.home,
        sftpHostId: hostId
      }
      set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }))
    } catch (error) {
      toastError(error)
    }
  },

  openVnc: async (hostId) => {
    try {
      const res = await window.infra.vnc.open(hostId)
      const tab: AppTab = {
        id: newTabId(),
        kind: 'vnc',
        panes: [],
        activePaneId: null,
        broadcast: false,
        vncSessionId: res.sessionId,
        vncWsPort: res.wsPort,
        vncToken: res.token,
        vncTitle: res.title,
        vncHostId: hostId
      }
      set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }))
    } catch (error) {
      toastError(error)
    }
  },

  showDashboard: () => set({ activeId: null }),

  /**
   * Mở (hoặc focus) tab công cụ. Mỗi loại NHIỀU NHẤT 1 tab: các công cụ này đọc chung 1 store,
   * mở 2 tab cùng loại chỉ tạo 2 bản UI dẫm chân nhau chứ không thêm giá trị gì.
   */
  openToolTab: (kind) => {
    // Cùng bảng đếm với `ui.setModal` (khoá = tên công cụ): một công cụ mở được cả ở popup
    // lẫn ở tab, nên hai đường phải cộng vào cùng một chỗ, nếu không lưới sẽ hiểu sai mức dùng.
    // 'features' là chính ô "Tất cả" — nó luôn có ô cố định nên không cần điểm.
    if (kind !== 'features') useToolUsageStore.getState().record(kind)
    set((state) => {
      const existing = state.tabs.find((t) => t.kind === kind)
      if (existing) return { activeId: existing.id }
      const tab: AppTab = { id: newTabId(), kind, panes: [], activePaneId: null, broadcast: false }
      return { tabs: [...state.tabs, tab], activeId: tab.id }
    })
  },

  openMonitorTab: () => get().openToolTab('monitor'),
  openCompareTab: () => get().openToolTab('compare'),

  openSiteShell: async (siteId) => {
    try {
      const { req, title } = await siteShellRequest(siteId)
      const res = await window.infra.terminal.create(req)
      addTab(set, {
        id: newPaneId(),
        sessionId: res.sessionId,
        kind: res.kind,
        title: `⌨ ${title}`,
        subtitle: req.cwd,
        status: 'connected',
        // Giữ siteId để lưu/mở lại workspace mà không denormalize đường dẫn
        origin: { kind: 'site-shell', siteId }
      })
    } catch (error) {
      toastError(error)
    }
  },

  // Tab localdev KHÔNG giữ session nào: supervisor sống trong main process và sống LÂU HƠN tab.
  // Tab localdev KHÔNG giữ session nào: supervisor sống trong main process và sống LÂU HƠN tab.
  openLocaldevTab: () => get().openToolTab('localdev'),

  splitLocal: async (profileId) => {
    const tab = get().activeTab()
    if (!tab || tab.kind !== 'terminal') return get().openLocal(profileId)
    try {
      const pane = await createPane({ kind: 'local', profileId, cols: 80, rows: 24 })
      addPane(set, tab.id, pane)
    } catch (error) {
      toastError(error)
    }
  },

  splitSsh: async (hostId) => {
    const tab = get().activeTab()
    if (!tab || tab.kind !== 'terminal') return get().openSsh(hostId)
    try {
      const pane = await createPane({ kind: 'ssh', hostId, cols: 80, rows: 24 })
      addPane(set, tab.id, pane)
    } catch (error) {
      toastError(error)
    }
  },

  closeTab: (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab) return
    if (tab.kind === 'sftp') {
      if (tab.sftpSessionId) window.infra.sftp.close(tab.sftpSessionId)
    } else if (tab.kind === 'vnc') {
      if (tab.vncSessionId) window.infra.vnc.close(tab.vncSessionId)
    } else if (tab.kind === 'terminal') {
      for (const pane of tab.panes) {
        window.infra.terminal.kill(pane.sessionId)
        clearTermSession(pane.sessionId)
      }
    }
    // kind 'monitor'/'compare'/'localdev': không có phiên nào để dọn — chỉ gỡ tab.
    // ⚠️ 'localdev': TUYỆT ĐỐI KHÔNG stop service ở đây. Stack local sống trong main process
    // và phải sống lâu hơn tab (đóng tab ≠ tắt web server đang chạy). Muốn dừng thì dùng
    // nút Dừng trong tab, hoặc lệnh palette "Dừng mọi service local".
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === id)
      const tabs = state.tabs.filter((t) => t.id !== id)
      let activeId = state.activeId
      if (activeId === id) activeId = tabs[Math.min(index, tabs.length - 1)]?.id ?? null
      return { tabs, activeId }
    })
  },

  closePane: (tabId, paneId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab) return
    // Pane cuối cùng → đóng cả tab
    if (tab.panes.length <= 1) return get().closeTab(tabId)
    const pane = tab.panes.find((p) => p.id === paneId)
    if (pane) {
      window.infra.terminal.kill(pane.sessionId)
      clearTermSession(pane.sessionId)
    }
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t
        const panes = t.panes.filter((p) => p.id !== paneId)
        const activePaneId = t.activePaneId === paneId ? (panes[0]?.id ?? null) : t.activePaneId
        return { ...t, panes, activePaneId }
      })
    }))
  },

  reconnectPane: async (tabId, paneId) => {
    const tab = get().tabs.find((t) => t.id === tabId)
    const pane = tab?.panes.find((p) => p.id === paneId)
    const origin = pane?.origin
    // Chỉ pane đã exited và có origin (cách mở lại) — status connecting chặn luôn double-click
    if (!pane || pane.status !== 'exited' || !origin) return
    const prev = pane
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id !== tabId
          ? t
          : { ...t, panes: t.panes.map((p) => (p.id === paneId ? { ...p, status: 'connecting' as const } : p)) }
      )
    }))
    try {
      const res = await window.infra.terminal.create(await reqOfAsync(origin))
      // Dọn phiên cũ: main đã dọn khi exit (kill chỉ để chắc), termBus xoá hàng đợi/snapshot id cũ
      window.infra.terminal.kill(prev.sessionId)
      clearTermSession(prev.sessionId)
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id !== tabId
            ? t
            : {
                ...t,
                panes: t.panes.map((p) =>
                  p.id !== paneId
                    ? p
                    : {
                        ...p,
                        sessionId: res.sessionId,
                        kind: res.kind,
                        title: res.title,
                        subtitle: res.subtitle,
                        status: res.kind === 'local' ? 'connected' : 'connecting',
                        statusDetail: undefined,
                        exitCode: undefined,
                        exitReason: undefined
                      }
                )
              }
        )
      }))
    } catch (error) {
      // Tạo phiên thất bại (host đã xoá, huỷ nhập password…) → toast + trả lại overlay exited cũ
      toastError(error)
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id !== tabId
            ? t
            : {
                ...t,
                panes: t.panes.map((p) =>
                  p.id === paneId
                    ? { ...p, status: 'exited' as const, exitCode: prev.exitCode, exitReason: prev.exitReason }
                    : p
                )
              }
        )
      }))
    }
  },

  setActive: (id) => set({ activeId: id }),

  setActivePane: (tabId, paneId) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, activePaneId: paneId } : t))
    })),

  movePane: (tabId, paneId, delta) =>
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t
        const idx = t.panes.findIndex((p) => p.id === paneId)
        const to = idx + delta
        if (idx < 0 || to < 0 || to >= t.panes.length) return t
        const panes = [...t.panes]
        const [moved] = panes.splice(idx, 1)
        panes.splice(to, 0, moved!)
        return { ...t, panes }
      })
    })),

  /**
   * Kéo-thả sắp xếp tab. Vị trí chèn tính LẠI sau khi đã rút tab bị kéo ra khỏi mảng — dùng
   * chỉ số cũ thì kéo sang phải sẽ lệch đúng 1 ô (tab bị rút làm mọi thứ phía sau dồn lên).
   * KHÔNG đổi `activeId`: kéo để sắp xếp, không phải để chuyển tab.
   */
  moveTab: (dragId, targetId, side) =>
    set((state) => {
      if (dragId === targetId) return {}
      const from = state.tabs.findIndex((t) => t.id === dragId)
      if (from < 0 || !state.tabs.some((t) => t.id === targetId)) return {}
      const tabs = [...state.tabs]
      const [moved] = tabs.splice(from, 1)
      const target = tabs.findIndex((t) => t.id === targetId)
      tabs.splice(side === 'after' ? target + 1 : target, 0, moved!)
      return { tabs }
    }),

  setMainPane: (tabId, paneId) =>
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId) return t
        const idx = t.panes.findIndex((p) => p.id === paneId)
        if (idx <= 0) return t // đã là pane đầu → không cần đổi
        const panes = [...t.panes]
        const [moved] = panes.splice(idx, 1)
        panes.unshift(moved!)
        return { ...t, panes }
      })
    })),

  /**
   * Kéo-thả trong lưới split: ĐỔI CHỖ chứ không chèn-đẩy.
   *
   * Vì sao đổi chỗ: chèn-đẩy như thanh tab sẽ làm MỌI pane phía sau nhảy một ô — trong lưới
   * toàn terminal đang chạy thì đó là cả màn hình xáo lại chỉ vì muốn chuyển một cái. Đổi chỗ
   * chỉ động đúng 2 ô, và thả lên ô chính (index 0) của layout main-* chính là "đặt làm chính".
   */
  swapPanes: (tabId, aId, bId) =>
    set((state) => ({
      tabs: state.tabs.map((t) => {
        if (t.id !== tabId || aId === bId) return t
        const a = t.panes.findIndex((p) => p.id === aId)
        const b = t.panes.findIndex((p) => p.id === bId)
        if (a < 0 || b < 0) return t
        const panes = [...t.panes]
        ;[panes[a], panes[b]] = [panes[b]!, panes[a]!]
        return { ...t, panes }
      })
    })),

  toggleBroadcast: (tabId) =>
    set((state) => ({
      // Chỉ tab terminal mới có broadcast (sftp/dashboard không có pane để gõ)
      tabs: state.tabs.map((t) => (t.id === tabId && t.kind === 'terminal' ? { ...t, broadcast: !t.broadcast } : t))
    })),

  applyStatus: (sessionId, status, detail) => {
    set((state) => ({ tabs: mapPaneBySession(state.tabs, sessionId, (p) => ({ ...p, status, statusDetail: detail })) }))
    if (status === 'connected') void useDataStore.getState().refreshHistory()
  },

  applyExit: (sessionId, exitCode, reason) =>
    set((state) => ({
      tabs: mapPaneBySession(state.tabs, sessionId, (p) => ({ ...p, status: 'exited', exitCode, exitReason: reason }))
    })),

  cycleTab: (direction) => {
    const { tabs, activeId } = get()
    if (tabs.length < 2 || !activeId) return
    const index = tabs.findIndex((t) => t.id === activeId)
    const next = tabs[(index + direction + tabs.length) % tabs.length]
    if (next) set({ activeId: next.id })
  },

  snapshotWorkspace: () => {
    const result: WorkspaceTab[] = []
    for (const tab of get().tabs) {
      if (tab.kind === 'sftp') {
        if (tab.sftpHostId) result.push({ kind: 'sftp', hostId: tab.sftpHostId })
        continue
      }
      // Bỏ pane không có origin (không mở lại được); tab rỗng thì bỏ luôn
      const panes = tab.panes.map((p) => p.origin).filter((o): o is PaneOrigin => o !== undefined)
      if (panes.length > 0) result.push({ kind: 'terminal', broadcast: tab.broadcast, panes })
    }
    return result
  },

  restoreWorkspace: async (wtabs) => {
    for (const wt of wtabs) {
      if (wt.kind === 'sftp') {
        await get().openSftp(wt.hostId) // openSftp tự toast nếu host lỗi/đã xoá
        continue
      }
      let tabId: string | null = null
      for (const origin of wt.panes) {
        try {
          const pane = await createPane(await reqOfAsync(origin))
          // 1 pane lỗi (host đã xoá…) không chặn các pane khác trong tab
          if (tabId === null) tabId = addTab(set, pane)
          else addPane(set, tabId, pane)
        } catch (error) {
          toastError(error)
        }
      }
      if (tabId !== null && wt.broadcast) {
        const id = tabId
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, broadcast: true } : t)) }))
      }
    }
  }
}))

function addTab(set: (fn: (s: TabsState) => Partial<TabsState>) => void, pane: Pane): string {
  const tab: AppTab = {
    id: newTabId(),
    kind: 'terminal',
    panes: [pane],
    activePaneId: pane.id,
    broadcast: false
  }
  set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }))
  return tab.id
}

function addPane(set: (fn: (s: TabsState) => Partial<TabsState>) => void, tabId: string, pane: Pane): void {
  set((s) => ({
    tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, panes: [...t.panes, pane], activePaneId: pane.id } : t))
  }))
}

function mapPaneBySession(tabs: AppTab[], sessionId: string, fn: (p: Pane) => Pane): AppTab[] {
  return tabs.map((t) => {
    if (!t.panes.some((p) => p.sessionId === sessionId)) return t
    return { ...t, panes: t.panes.map((p) => (p.sessionId === sessionId ? fn(p) : p)) }
  })
}

/**
 * Ghi lại tab terminal user vào gần nhất. Một chỗ duy nhất — `activeId` bị `set` ở gần chục lời
 * gọi (mở tab, đóng tab, gộp, tách, Ctrl+Tab, workspace…), gắn theo từng lời gọi thì chắc chắn sót.
 */
useTabsStore.subscribe((state) => {
  if (!state.activeId) return
  const tab = state.tabs.find((t) => t.id === state.activeId)
  if (tab?.kind === 'terminal' && state.lastTerminalTabId !== tab.id) {
    useTabsStore.setState({ lastTerminalTabId: tab.id })
  }
})

/**
 * Pane terminal ĐANG KẾT NỐI để gửi lệnh vào — dùng cho nút "Gửi" của Sổ tay vận hành và mọi
 * công cụ tương tự.
 *
 * Ưu tiên tab đang mở; nếu tab đang mở không phải terminal (công cụ mở dạng tab, hoặc đang ở
 * Dashboard) thì rơi về tab terminal user vào gần nhất. Không bao giờ đoán bừa một tab terminal
 * nào đó: lệnh vận hành gửi sai máy là hỏng thật, thà báo "chưa có phiên nào" còn hơn.
 */
export function terminalTargetPane(): { pane: Pane; tabId: string } | null {
  const { tabs, activeId, lastTerminalTabId } = useTabsStore.getState()
  const pick = (tabId: string | null): { pane: Pane; tabId: string } | null => {
    const tab = tabs.find((t) => t.id === tabId)
    if (!tab || tab.kind !== 'terminal') return null
    const pane = tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0]
    return pane && pane.status === 'connected' ? { pane, tabId: tab.id } : null
  }
  return pick(activeId) ?? pick(lastTerminalTabId)
}
