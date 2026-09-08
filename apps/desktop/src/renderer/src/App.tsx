import { useEffect, useRef, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { NavRail } from './components/NavRail'
import { ActivityBar } from './components/workbench/ActivityBar'
import { SidePanel } from './components/workbench/SidePanel'
import { WORKBENCH_BOTTOM_TABS_META, WORKBENCH_PANELS, openWorkbenchPanel } from './features/workbench/workbench'
import { StatusBar } from './components/StatusBar'
import { TabsBar } from './components/TabsBar'
import { PromptsHost } from './components/PromptsHost'
import { VaultGate } from './components/VaultGate'
import { CommandPalette, type Command } from './components/CommandPalette'
import { SnippetsModal } from './components/SnippetsModal'
import { TunnelsModal } from './components/TunnelsModal'
import { KeysModal } from './components/KeysModal'
import { BulkRunModal } from './components/BulkRunModal'
import { NetToolboxModal } from './components/NetToolboxModal'
import { MonitorModal } from './components/MonitorModal'
import { MonitorDock } from './components/MonitorDock'
import { BottomPanel } from './components/workbench/BottomPanel'
import { NotificationsModal } from './components/NotificationsModal'
import { HttpChecksModal } from './components/HttpChecksModal'
import { ClientImportModal } from './components/ClientImportModal'
import { InventoryModal } from './components/InventoryModal'
import { RunbooksModal } from './components/RunbooksModal'
import { JobsModal } from './components/JobsModal'
import { SecurityAuditModal } from './components/SecurityAuditModal'
import { FolderSyncModal } from './components/FolderSyncModal'
import { useFolderSyncStore } from './stores/folderSync'
import { useJobsStore } from './stores/jobs'
import { useInventoryStore } from './stores/inventory'
import { useEventsStore } from './stores/events'
import { useHttpChecksStore } from './stores/httpChecks'
import { MonitorTabView } from './components/MonitorTabView'
import { CompareTabView } from './components/CompareTabView'
import { LocaldevTabView } from './features/localdev/LocaldevTabView'
import { LocaldevSettingsModal } from './features/localdev/LocaldevSettingsModal'
import { MetricsHistoryModal } from './components/MetricsHistoryModal'
import { SyncModal } from './components/SyncModal'
import { ExportHostsModal } from './components/ExportHostsModal'
import { CloudImportModal } from './components/CloudImportModal'
import { KnownHostsModal } from './components/KnownHostsModal'
import { DiskUsageModal } from './components/DiskUsageModal'
import { LogTailModal } from './components/LogTailModal'
import { CronModal } from './components/CronModal'
import { KeyRotateModal } from './components/KeyRotateModal'
import { PackageUpdatesModal } from './components/PackageUpdatesModal'
import { AiModal } from './components/AiModal'
import { AiDiagnoseModal } from './components/AiDiagnoseModal'
import { AiDiagnosePill } from './components/AiDiagnosePill'
import { RecordingsModal } from './components/RecordingsModal'
import { SettingsModal } from './components/SettingsModal'
import { HelpModal, type HelpTab } from './components/HelpModal'
import { WorkspacesModal } from './components/WorkspacesModal'
import { PluginsModal } from './components/PluginsModal'
import { PluginPanelModal } from './components/PluginPanelModal'
import { AiExplainPanel } from './components/AiExplainPanel'
import { UpdateBanner } from './components/UpdateBanner'
import { SftpView } from './features/sftp/SftpView'
import { SftpHome } from './features/sftp/SftpHome'
import { VncView } from './features/vnc/VncView'
import { RdpDock } from './components/RdpDock'
import { HomeView } from './features/navigator/NavigatorHome'
import { NAV_ITEMS, goToSection } from './features/navigator/nav'
import { FeaturesTabView } from './components/FeaturesTabView'
import { translate, useT } from './i18n'
import { TerminalTabView } from './features/terminal/TerminalTabView'
import { useDataStore } from './stores/data'
import { TOOL_TAB_KINDS, useTabsStore, type ToolTabKind } from './stores/tabs'
import { useSettingsStore } from './stores/settings'
import { useToastsStore } from './stores/toasts'
import { useUiStore } from './stores/ui'
import { usePluginStore } from './stores/plugins'
import { useMonitorStore } from './stores/monitor'
import { useTrayStore } from './stores/tray'
import { useLocaldevStore } from './stores/localdev'
import { useFontsStore } from './stores/fonts'
import { useWatcherStore } from './stores/watcher'
import { useReplicationStore } from './stores/replication'
import { useVaultStore } from './stores/vault'
import { ProcessesModal } from './components/ProcessesModal'
import { ServicesModal } from './components/ServicesModal'
import { ReplicationModal } from './components/ReplicationModal'
import { CompareModal } from './components/CompareModal'
import { HostMapModal } from './components/HostMapModal'
import { ToolTabView } from './components/ToolTabView'

/** Toast cảnh báo monitoring — chạy ngoài component (trong subscribe) nên đọc ngôn ngữ từ store. */
function formatAlertToast(a: import('@infra/shared').MonitorAlertDto): string {
  const lang = useSettingsStore.getState().language
  if (a.metric === 'offline') {
    return translate(lang, a.kind === 'breach' ? 'monitor.alertOffline' : 'monitor.alertOnline', { host: a.label })
  }
  const names: Record<string, string> = {
    load: 'Load',
    mem: 'RAM',
    disk: 'Disk',
    steal: 'CPU steal',
    conn: translate(lang, 'monitor.metricConn')
  }
  const metric = names[a.metric] ?? a.metric
  // conn là số tuyệt đối — không gắn %; template i18n không chứa đơn vị
  const unit = a.metric === 'conn' ? '' : '%'
  if (a.kind === 'breach') {
    return translate(lang, 'monitor.alertBreach', {
      host: a.label,
      metric,
      value: `${a.value ?? 0}${unit}`,
      threshold: `${a.threshold ?? 0}${unit}`
    })
  }
  return translate(lang, 'monitor.alertRecover', { host: a.label, metric, value: `${a.value ?? 0}${unit}` })
}

export default function App() {
  const t = useT()
  // Thẻ mở sẵn của Trợ giúp: F1 vào Giới thiệu, Ctrl+/ nhảy thẳng bảng phím tắt
  const [helpTab, setHelpTab] = useState<HelpTab>('about')
  const vaultState = useVaultStore((s) => s.state)
  const { tabs, activeId, openLocal } = useTabsStore()
  const toasts = useToastsStore((s) => s.toasts)
  const dismiss = useToastsStore((s) => s.dismiss)
  const bgImage = useSettingsStore((s) => s.backgroundImage)
  const bgOpacity = useSettingsStore((s) => s.backgroundOpacity)
  const bgBlur = useSettingsStore((s) => s.backgroundBlur)
  const bgPosition = useSettingsStore((s) => s.backgroundPosition)
  const bgFit = useSettingsStore((s) => s.backgroundFit)
  // Theme bố cục: Infra (cột host sổ tại chỗ) hay Navigator (cột trái là menu, nội dung ở vùng chính)
  const layout = useSettingsStore((s) => s.layout)
  const language = useSettingsStore((s) => s.language)
  // F53: đóng cửa sổ có thu vào khay không — main cần biết, gửi sang mỗi khi đổi
  const closeToTray = useTrayStore((s) => s.closeToTray)
  // Workbench: cờ này = "panel phụ đang đóng" (activity bar vẫn còn)
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed)
  const bottomOpen = useUiStore((s) => s.workbenchBottomOpen)
  // Command Palette lên store chung để nút toolbar (TerminalTabView) cũng mở được
  const paletteOpen = useUiStore((s) => s.paletteOpen)
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen)
  const togglePalette = useUiStore((s) => s.togglePalette)
  // store chung để Sidebar/palette cùng mở — tránh 2 instance modal dẫm chân nhau
  const modal = useUiStore((s) => s.modal)
  const setModal = useUiStore((s) => s.setModal)
  const minimizeAiDiagnose = useUiStore((s) => s.minimizeAiDiagnose)
  const pluginPanel = usePluginStore((s) => s.panel)
  const monitorActive = useMonitorStore((s) => s.active)
  const monitorDetached = useMonitorStore((s) => s.detached)
  const historyHostId = useMonitorStore((s) => s.historyHostId)
  const pluginCommands = usePluginStore((s) => s.contributions)
  const watcherEnabled = useWatcherStore((s) => s.enabled)
  const localdevEnabled = useLocaldevStore((s) => s.enabled)
  const allHosts = useDataStore((s) => s.hosts)
  const booted = useRef(false)
  const openedInitialTab = useRef(false)

  // F39: đồng bộ danh sách host cần watch sang main mỗi khi bật/tắt hoặc hosts đổi.
  // serial loại (hostname = COM port, không phải TCP); tắt thì store đã gọi watcher.stop().
  useEffect(() => {
    if (!watcherEnabled) return
    const targets = allHosts
      .filter((h) => h.protocol !== 'serial')
      .map((h) => ({ hostId: h.id, host: h.hostname, port: h.port, label: h.label }))
    if (targets.length > 0) window.infra.watcher.start(targets)
  }, [watcherEnabled, allHosts])

  useEffect(() => {
    // refresh chỉ chạy 1 lần; listener thì subscribe/unsubscribe theo vòng đời effect
    // (guard cả effect bằng booted sẽ làm listener chết vĩnh viễn nếu bật StrictMode)
    if (!booted.current) {
      booted.current = true
      void useVaultStore.getState().refresh()
      // Font user tự thêm phải được đăng ký vào document TRƯỚC khi terminal vẽ, nên nạp ở
      // đây chứ không đợi mở Settings (không phụ thuộc vault: font không phải dữ liệu bí mật)
      void useFontsStore.getState().load()
    }
    const offLocked = window.infra.vault.onLocked(() => useVaultStore.getState().markLocked())
    // Auto-sync chạy ở main: không nạp lại thì UI đứng ở bản cũ trong khi vault đã đổi
    const offPulled = window.infra.sync.onPulled((pulled) => {
      void useDataStore.getState().refreshAll()
      const toastLang = useSettingsStore.getState().language
      useToastsStore.getState().push(translate(toastLang, 'sync.autoPulled', { n: pulled }), 'info')
    })
    const offExit = window.infra.terminal.onExit((e) =>
      useTabsStore.getState().applyExit(e.sessionId, e.exitCode, e.reason)
    )
    const offStatus = window.infra.terminal.onStatus((e) =>
      useTabsStore.getState().applyStatus(e.sessionId, e.status, e.detail)
    )
    const offTunnel = window.infra.tunnels.onState((e) =>
      useDataStore.getState().applyTunnelState(e.ruleId, e.status, e.detail)
    )
    const offContrib = window.infra.plugins.onContributionsChanged((list) =>
      usePluginStore.getState().applyContributions(list)
    )
    const offPanel = window.infra.plugins.onPanel((p) => usePluginStore.getState().setPanel(p))
    const offNotify = window.infra.plugins.onNotify((n) => useToastsStore.getState().push(n.message))
    const offSample = window.infra.monitor.onSample((s) => useMonitorStore.getState().applySample(s))
    const offAlert = window.infra.monitor.onAlert((a) =>
      useToastsStore.getState().push(formatAlertToast(a), a.kind === 'breach' ? 'error' : 'info')
    )
    const offDetached = window.infra.monitor.onDetachedState((open) => useMonitorStore.getState().setDetached(open))
    // Dừng từ bất kỳ cửa sổ nào (vd cửa sổ tách rời) → reset store; KHÔNG gọi stopAll lại (tránh vòng lặp)
    const offStopped = window.infra.monitor.onStopped(() =>
      useMonitorStore.setState({ active: false, data: {}, detached: false })
    )
    // F55: kết quả đo replication (đăng ký ở App để cửa sổ nào cũng nhận, kể cả khi panel đóng)
    const offRepl = window.infra.replication.onSample((s) => useReplicationStore.getState().applySnapshot(s))
    const offReplAlert = window.infra.replication.onAlert((a) =>
      useToastsStore.getState().push(a.text, a.kind === 'breach' ? 'error' : 'info')
    )
    window.infra.replication.subscribe()
    // F39: kết quả sweep watcher nền → chấm xanh/đỏ ở sidebar
    const offWatcher = window.infra.watcher.onStatus((list) => useWatcherStore.getState().applyStatuses(list))
    // Trung tâm thông báo: sự kiện mới từ mọi hệ theo dõi + số chưa đọc (chuông ở StatusBar)
    const offEventNew = window.infra.events.onNew((ev) => useEventsStore.getState().applyNew(ev))
    const offEventChanged = window.infra.events.onChanged((n) => useEventsStore.getState().setUnread(n))
    void useEventsStore.getState().refreshUnread()
    // Theo dõi URL: nạp cấu hình + tóm tắt (không cần vault) để Dashboard biết URL nào đang lỗi
    const offHttpSummary = window.infra.httpChecks.onSummary((s) => useHttpChecksStore.getState().applySummary(s))
    void useHttpChecksStore.getState().load()
    // Kiểm kê fleet: tiến độ đợt thu (main gửi từng host xong)
    const offInvProgress = window.infra.inventory.onProgress((p) => useInventoryStore.getState().applyProgress(p))
    // Lịch chạy tự động: lượt bắt đầu/kết thúc (kể cả lượt do scheduler tự chạy khi màn hình đóng)
    const offJobRun = window.infra.jobs.onRunEvent((e) => useJobsStore.getState().applyRunEvent(e))
    // Theo dõi thư mục: watcher chạy ở main nên file được đẩy cả khi tab so lệch đang đóng
    const offFolderSync = window.infra.folderSync.onEvent((e) => useFolderSyncStore.getState().applyEvent(e))
    // Local dev: trạng thái service / tiến độ tải runtime / tiến độ thao tác site (main là nguồn sự thật)
    const offLdService = window.infra.localdev.onServiceEvent((s) =>
      useLocaldevStore.getState().applyServiceEvent(s)
    )
    const offLdRuntime = window.infra.localdev.onRuntimeProgress((p) =>
      useLocaldevStore.getState().applyRuntimeProgress(p)
    )
    const offLdSite = window.infra.localdev.onSiteEvent((e) => useLocaldevStore.getState().applySiteEvent(e))
    // Đọc cờ enabled sớm: quyết định có hiện entry point local dev hay không
    void useLocaldevStore.getState().refreshEnabled()
    return () => {
      offRepl()
      offReplAlert()
      offWatcher()
      offLdService()
      offLdRuntime()
      offLdSite()
      offPulled()
      offLocked()
      offExit()
      offStatus()
      offTunnel()
      offContrib()
      offPanel()
      offNotify()
      offSample()
      offAlert()
      offDetached()
      offStopped()
      offEventNew()
      offEventChanged()
      offHttpSummary()
      offInvProgress()
      offJobRun()
      offFolderSync()
    }
  }, [])

  // F53: main giữ tuỳ chọn khay (đóng-về-khay + ngôn ngữ menu khay) — gửi lúc khởi động và mỗi khi đổi
  useEffect(() => {
    window.infra.app.setTrayPrefs({ closeToTray, language })
  }, [closeToTray, language])

  // Workbench: Monitoring bật lên là vào panel đáy (thay cho dock nổi góc phải ở hai theme kia).
  // Chỉ chạy khi cờ ĐỔI — user đóng panel trong lúc đang theo dõi thì không bị mở lại.
  useEffect(() => {
    if (layout === 'workbench' && monitorActive) useUiStore.getState().openWorkbenchBottom('monitor')
  }, [layout, monitorActive])

  useEffect(() => {
    if (vaultState !== 'unlocked') return
    void useDataStore.getState().refreshAll()
    void usePluginStore.getState().refresh()
    // F15: bật các tunnel có cờ "tự bật" — main tự chặn lần gọi thứ hai trong cùng tiến trình
    // (khoá rồi mở lại vault không làm bật lại tunnel user đã chủ ý dừng)
    void window.infra.tunnels.autoStart()
    if (!openedInitialTab.current) {
      openedInitialTab.current = true
      // Mặc định khởi động vào Dashboard (activeId=null = home, không cần mở gì);
      // chọn "Terminal" trong Settings thì auto-mở shell local như bản cũ
      if (useTabsStore.getState().tabs.length === 0 && useSettingsStore.getState().startupPage === 'terminal') {
        void openLocal()
      }
    }
  }, [vaultState, openLocal])

  // Báo main phiên terminal đang active (cho plugin api.terminal.getActiveSessionId)
  useEffect(() => {
    const tab = tabs.find((tb) => tb.id === activeId)
    let sid: string | null = null
    if (tab && tab.kind === 'terminal') {
      const pane = tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0]
      sid = pane?.sessionId ?? null
    }
    window.infra.terminal.setActive(sid)
  }, [tabs, activeId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // vault đang khoá: không cho shortcut mở tab/modal sau lưng màn hình khoá
      if (useVaultStore.getState().state !== 'unlocked') return
      // Command palette: Ctrl+Shift+P
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyP') {
        event.preventDefault()
        event.stopPropagation()
        togglePalette()
        return
      }
      // Trợ giúp: F1 (không có modifier nên phải xét TRƯỚC guard ctrlKey bên dưới)
      if (event.code === 'F1') {
        event.preventDefault()
        event.stopPropagation()
        setHelpTab('about')
        setModal('help')
        return
      }
      // Ctrl+/ — bảng phím tắt. code 'Slash' là phím vật lý, không lệ thuộc layout
      if (event.ctrlKey && !event.shiftKey && event.code === 'Slash') {
        event.preventDefault()
        event.stopPropagation()
        setHelpTab('shortcuts')
        setModal('help')
        return
      }
      if (!event.ctrlKey) return
      const state = useTabsStore.getState()
      if (event.shiftKey && event.code === 'Tab') {
        event.preventDefault()
        event.stopPropagation()
        state.cycleTab(-1)
      } else if (event.code === 'Tab') {
        event.preventDefault()
        event.stopPropagation()
        state.cycleTab(1)
      } else if (event.shiftKey && event.code === 'KeyT') {
        event.preventDefault()
        event.stopPropagation()
        void state.openLocal()
      } else if (event.shiftKey && event.code === 'KeyW') {
        event.preventDefault()
        event.stopPropagation()
        if (state.activeId) state.closeTab(state.activeId)
      } else if (event.shiftKey && event.code === 'KeyD') {
        event.preventDefault()
        event.stopPropagation()
        void state.splitLocal()
      } else if (event.shiftKey && event.code === 'KeyB') {
        event.preventDefault()
        event.stopPropagation()
        if (state.activeId) state.toggleBroadcast(state.activeId)
      } else if (event.shiftKey && event.code === 'KeyH') {
        event.preventDefault()
        event.stopPropagation()
        useUiStore.getState().toggleSidebar()
      } else if (!event.shiftKey && event.code === 'KeyJ') {
        // Ctrl+J: panel đáy của theme Workbench (kiểu VS Code). Theme khác không có panel này nên
        // để phím đi tiếp xuống terminal (Ctrl+J là ký tự xuống dòng). Đọc layout từ store vì
        // effect này đăng ký một lần.
        if (useSettingsStore.getState().layout !== 'workbench') return
        event.preventDefault()
        event.stopPropagation()
        useUiStore.getState().toggleWorkbenchBottom()
      } else if (!event.shiftKey && event.code === 'KeyI') {
        event.preventDefault()
        event.stopPropagation()
        setModal('ai')
      }
    }
    // capture: chặn trước khi xterm xử lý (Ctrl+I là ký tự Tab trong terminal — không chặn sẽ dính cả 2)
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  if (vaultState === 'loading') {
    return <div className="bg-app h-screen" />
  }

  // Khoá vault: phủ VaultGate dạng overlay, KHÔNG unmount cây tab —
  // unmount sẽ dispose xterm → mất sạch scrollback dù session trong main vẫn sống (auto-lock 15')
  const locked = vaultState !== 'unlocked'

  const paletteCommands: Command[] = [
    // Theme Navigator: Dashboard đã nằm trong bộ `nav-*` bên dưới — không thêm lệnh trùng.
    ...(layout === 'navigator'
      ? []
      : [{ id: 'open-dashboard', label: t('menu.dashboard'), run: () => goToSection('dashboard') }]),
    // Theme Navigator: mỗi mục cũng gọi được từ palette — ĐỦ bộ, kể cả mục user đã tắt trên cột
    // trái (tắt là bỏ khỏi cột, không phải cấm dùng; palette là lối vào còn lại của nó).
    ...(layout === 'navigator'
      ? NAV_ITEMS.map((item) => ({
          id: `nav-${item.id}`,
          label: `${item.icon} ${t(item.titleKey)}`,
          run: () => goToSection(item.id)
        }))
      : []),
    { id: 'open-workspaces', label: t('menu.workspaces'), run: () => setModal('workspaces') },
    { id: 'open-bulk', label: t('menu.bulk'), run: () => setModal('bulk') },
    { id: 'open-monitor', label: t('menu.monitor'), run: () => setModal('monitor') },
    { id: 'open-notifications', label: t('menu.notifications'), run: () => setModal('notifications') },
    { id: 'open-http-checks', label: t('menu.httpChecks'), run: () => setModal('http-checks') },
    { id: 'open-client-import', label: t('menu.clientImport'), run: () => setModal('client-import') },
    { id: 'open-inventory', label: t('menu.inventory'), run: () => useTabsStore.getState().openToolTab('inventory') },
    { id: 'open-runbooks', label: t('menu.runbooks'), run: () => setModal('runbooks') },
    { id: 'open-jobs', label: t('menu.jobs'), run: () => setModal('jobs') },
    { id: 'open-security', label: t('menu.security'), run: () => setModal('security') },
    { id: 'open-folder-sync', label: t('menu.folderSync'), run: () => useTabsStore.getState().openToolTab('folder-sync') },
    { id: 'open-monitor-tab', label: `📊 ${t('monitor.openInTab')}`, run: () => useTabsStore.getState().openMonitorTab() },
    { id: 'open-processes', label: t('menu.processes'), run: () => setModal('processes') },
    {
      id: 'open-processes-tab',
      label: `📋 ${t('procs.title')} — ${t('tabs.openInTab')}`,
      run: () => useTabsStore.getState().openToolTab('processes')
    },
    { id: 'open-services', label: t('menu.services'), run: () => setModal('services') },
    {
      id: 'open-services-tab',
      label: `⚙ ${t('svc.title')} — ${t('tabs.openInTab')}`,
      run: () => useTabsStore.getState().openToolTab('services')
    },
    { id: 'open-compare', label: t('menu.compare'), run: () => setModal('compare') },
    { id: 'open-compare-tab', label: `🔍 ${t('compare.openInTab')}`, run: () => useTabsStore.getState().openCompareTab() },
    { id: 'open-hostmap', label: t('menu.hostmap'), run: () => setModal('hostmap') },
    // Local dev: chỉ hiện lệnh khi tính năng đã bật (tránh loãng palette cho user chỉ dùng SSH).
    // "Dừng mọi service" luôn hiện khi đã bật — escape hatch cho process kẹt.
    ...(localdevEnabled
      ? [
          { id: 'open-localdev', label: t('menu.localdev'), run: () => useTabsStore.getState().openLocaldevTab() },
          { id: 'localdev-settings', label: `⚙ ${t('settings.localdev')}`, run: () => setModal('localdev-settings') },
          { id: 'localdev-stop-all', label: t('localdev.stopAll'), run: () => void useLocaldevStore.getState().stopAll() }
        ]
      : []),
    // Theme Workbench: mỗi panel phụ cũng gọi được từ palette (mở panel + chuyển mục)
    ...(layout === 'workbench'
      ? [
          ...WORKBENCH_PANELS.map((p) => ({
            id: `wb-${p.id}`,
            label: `${p.icon} ${t(p.titleKey)}`,
            run: () => openWorkbenchPanel(p.id)
          })),
          // Panel đáy: bật/tắt + mở thẳng từng tab
          {
            id: 'wb-bottom-toggle',
            label: `⬒ ${t('workbench.bottomToggle')}`,
            run: () => useUiStore.getState().toggleWorkbenchBottom()
          },
          ...WORKBENCH_BOTTOM_TABS_META.map((b) => ({
            id: `wb-bottom-${b.id}`,
            label: `⬒ ${b.icon} ${t(b.titleKey)}`,
            run: () => useUiStore.getState().openWorkbenchBottom(b.id)
          }))
        ]
      : []),
    // Trang SFTP: ở theme Navigator đã có lệnh `nav-sftp` phía trên; theme Infra/Workbench mở dạng tab
    ...(layout !== 'navigator'
      ? [{ id: 'open-sftp', label: t('menu.sftp'), run: () => useTabsStore.getState().openToolTab('files') }]
      : []),
    { id: 'open-net', label: t('menu.net'), run: () => setModal('net') },
    { id: 'open-ai', label: t('menu.ai'), run: () => setModal('ai') },
    { id: 'open-ai-diagnose', label: `🩺 ${t('ai.diagnose.title')}`, run: () => setModal('ai-diagnose') },
    {
      id: 'open-ai-diagnose-tab',
      label: `🩺 ${t('ai.diagnose.title')} — ${t('tabs.openInTab')}`,
      run: () => useTabsStore.getState().openToolTab('ai-diagnose')
    },
    { id: 'open-replication', label: `🔁 ${t('repl.title')}`, run: () => setModal('replication') },
    {
      id: 'open-replication-tab',
      label: `🔁 ${t('repl.title')} — ${t('tabs.openInTab')}`,
      run: () => useTabsStore.getState().openToolTab('replication')
    },
    { id: 'open-recordings', label: t('menu.recordings'), run: () => setModal('recordings') },
    { id: 'open-features', label: t('menu.features'), run: () => useTabsStore.getState().openToolTab('features') },
    { id: 'open-sync', label: t('menu.sync'), run: () => setModal('sync') },
    { id: 'export-hosts', label: t('menu.export'), run: () => setModal('export-hosts') },
    { id: 'do-import', label: t('menu.doImport'), run: () => setModal('do-import') },
    { id: 'known-hosts', label: t('menu.knownHosts'), run: () => setModal('known-hosts') },
    { id: 'disk-usage', label: t('menu.diskUsage'), run: () => setModal('disk-usage') },
    { id: 'log-tail', label: t('menu.logTail'), run: () => setModal('log-tail') },
    { id: 'cron', label: t('menu.cron'), run: () => setModal('cron') },
    { id: 'key-rotate', label: t('menu.keyRotate'), run: () => setModal('key-rotate') },
    { id: 'pkg-updates', label: t('menu.pkgUpdates'), run: () => setModal('pkg-updates') },
    { id: 'open-snippets', label: t('menu.snippets'), run: () => setModal('snippets') },
    { id: 'open-tunnels', label: t('menu.tunnels'), run: () => setModal('tunnels') },
    {
      id: 'open-tunnels-tab',
      label: `🔀 ${t('tunnel.title')} — ${t('tabs.openInTab')}`,
      run: () => useTabsStore.getState().openToolTab('tunnels')
    },
    {
      id: 'open-tunnels-detached',
      label: `⧉ ${t('tunnel.title')} — ${t('tunnel.detach')}`,
      run: () => void window.infra.tunnels.openDetached()
    },
    { id: 'open-keys', label: `🔑 ${t('sidebar.keys')}`, run: () => setModal('keys') },
    { id: 'open-settings', label: t('menu.settings'), run: () => setModal('settings') },
    { id: 'open-plugins', label: t('menu.plugins'), run: () => setModal('plugins') },
    { id: 'open-logs', label: t('menu.openLogs'), run: () => window.infra.terminal.openLogFolder() },
    {
      id: 'open-help',
      label: t('menu.help'),
      hint: 'F1',
      run: () => {
        setHelpTab('about')
        setModal('help')
      }
    },
    {
      id: 'open-help-shortcuts',
      label: `❓ ${t('help.tab.shortcuts')}`,
      hint: 'Ctrl+/',
      run: () => {
        setHelpTab('shortcuts')
        setModal('help')
      }
    },
    {
      id: 'open-help-tab',
      label: `❓ ${t('help.title')} — ${t('tabs.openInTab')}`,
      run: () => useTabsStore.getState().openToolTab('help')
    },
    { id: 'toggle-sidebar', label: t('menu.toggleSidebar'), run: () => useUiStore.getState().toggleSidebar() },
    ...pluginCommands.map((c) => ({
      id: `plugin-${c.pluginId}-${c.commandId}`,
      label: c.title,
      hint: 'plugin',
      run: () => {
        const tab = tabs.find((tb) => tb.id === activeId)
        const sid =
          tab && tab.kind === 'terminal'
            ? ((tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0])?.sessionId ?? null)
            : null
        void window.infra.plugins.invokeCommand(c.pluginId, c.commandId, sid)
      }
    }))
  ]

  return (
    // isolate: App root là stacking context riêng → ảnh nền ở z âm nằm trên nền bg-app
    // nhưng dưới MỌI nội dung & overlay (modal/prompt/palette) mà không cần nâng z nội dung
    <div className="bg-app text-content relative isolate flex h-screen flex-col">
      {bgImage && (
        <div
          aria-hidden
          // -inset-8 để mép blur tràn ra ngoài viewport (body overflow:hidden cắt), tránh viền nhạt
          className="pointer-events-none absolute -inset-8"
          style={{
            zIndex: -10,
            backgroundImage: `url(${bgImage})`,
            backgroundSize: bgFit,
            backgroundPosition: bgPosition,
            backgroundRepeat: 'no-repeat',
            opacity: bgOpacity,
            filter: bgBlur > 0 ? `blur(${bgBlur}px)` : undefined
          }}
        />
      )}
      <div className="flex min-h-0 flex-1">
        {/* Cột trái theo theme: Infra = danh sách host sổ tại chỗ; Navigator = menu, nội dung ở vùng chính */}
        {layout === 'navigator' ? (
          <NavRail />
        ) : layout === 'workbench' ? (
          <>
            <ActivityBar />
            {!sidebarCollapsed && <SidePanel />}
          </>
        ) : (
          <Sidebar />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <UpdateBanner />
          <TabsBar />
          <div className="relative flex-1 overflow-hidden">
            {/* Tab ẩn được giấu bằng CSS (active=false), KHÔNG unmount — unmount xterm → mất scrollback */}
            <div className="relative h-full">
              {/* Home = màn hình nằm dưới các tab, hiện khi không tab nào active (nút 🏠 / đóng hết tab):
                  Dashboard ở theme Infra, hoặc mục đang chọn trên NavRail ở theme Navigator */}
              <HomeView active={activeId === null} />
              {tabs.map((tab) => {
                if (tab.kind === 'sftp') return <SftpView key={tab.id} tab={tab} active={tab.id === activeId} />
                if (tab.kind === 'vnc') return <VncView key={tab.id} tab={tab} active={tab.id === activeId} />
                if (tab.kind === 'monitor') return <MonitorTabView key={tab.id} tab={tab} active={tab.id === activeId} />
                if (tab.kind === 'compare') return <CompareTabView key={tab.id} active={tab.id === activeId} />
                if (tab.kind === 'localdev') return <LocaldevTabView key={tab.id} active={tab.id === activeId} />
                if (tab.kind === 'features') return <FeaturesTabView key={tab.id} active={tab.id === activeId} />
                if (tab.kind === 'files') return <SftpHome key={tab.id} active={tab.id === activeId} />
                {
                  /* Mọi tab công cụ CÒN LẠI đều do ToolTabView vẽ. Kiểm theo danh sách chứ
                     không viết tay từng `kind ===`: thêm công cụ mới mà quên nối vào đây thì
                     tab mở ra lại là một terminal, và lỗi đó chỉ lộ khi có người bấm thử.
                     Các kind có view riêng (monitor/compare/localdev/features) đã return ở trên. */
                }
                if ((TOOL_TAB_KINDS as readonly string[]).includes(tab.kind)) {
                  return <ToolTabView key={tab.id} kind={tab.kind as ToolTabKind} active={tab.id === activeId} />
                }
                return <TerminalTabView key={tab.id} tab={tab} active={tab.id === activeId} />
              })}
            </div>
          </div>
          {/* Workbench: panel đáy (Monitoring / Log / Tunnels) dưới vùng tab, Ctrl+J — terminal tự fit lại qua ResizeObserver */}
          {layout === 'workbench' && bottomOpen && <BottomPanel />}
        </div>
      </div>
      <StatusBar />

      <PromptsHost />
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} extraCommands={paletteCommands} />}
      {modal === 'snippets' && <SnippetsModal onClose={() => setModal(null)} />}
      {modal === 'tunnels' && <TunnelsModal onClose={() => setModal(null)} />}
      {modal === 'keys' && <KeysModal onClose={() => setModal(null)} />}
      {modal === 'notifications' && <NotificationsModal onClose={() => setModal(null)} />}
      {modal === 'http-checks' && <HttpChecksModal onClose={() => setModal(null)} />}
      {modal === 'client-import' && <ClientImportModal onClose={() => setModal(null)} />}
      {modal === 'inventory' && <InventoryModal onClose={() => setModal(null)} />}
      {modal === 'runbooks' && <RunbooksModal onClose={() => setModal(null)} />}
      {modal === 'jobs' && <JobsModal onClose={() => setModal(null)} />}
      {modal === 'security' && <SecurityAuditModal onClose={() => setModal(null)} />}
      {modal === 'folder-sync' && <FolderSyncModal onClose={() => setModal(null)} />}
      {modal === 'bulk' && <BulkRunModal onClose={() => setModal(null)} />}
      {modal === 'net' && <NetToolboxModal onClose={() => setModal(null)} />}
      {modal === 'monitor' && <MonitorModal onClose={() => setModal(null)} />}
      {modal === 'sync' && <SyncModal onClose={() => setModal(null)} />}
      {modal === 'export-hosts' && <ExportHostsModal onClose={() => setModal(null)} />}
      {modal === 'do-import' && <CloudImportModal onClose={() => setModal(null)} />}
      {modal === 'known-hosts' && <KnownHostsModal onClose={() => setModal(null)} />}
      {modal === 'disk-usage' && <DiskUsageModal host={null} onClose={() => setModal(null)} />}
      {modal === 'log-tail' && <LogTailModal onClose={() => setModal(null)} />}
      {modal === 'cron' && <CronModal onClose={() => setModal(null)} />}
      {modal === 'key-rotate' && <KeyRotateModal onClose={() => setModal(null)} />}
      {modal === 'pkg-updates' && <PackageUpdatesModal onClose={() => setModal(null)} />}
      {modal === 'ai' && <AiModal onClose={() => setModal(null)} />}
      {modal === 'ai-diagnose' && (
        <AiDiagnoseModal onClose={() => setModal(null)} onMinimize={minimizeAiDiagnose} />
      )}
      {modal === 'recordings' && <RecordingsModal onClose={() => setModal(null)} />}
      {modal === 'settings' && <SettingsModal onClose={() => setModal(null)} />}
      {modal === 'workspaces' && <WorkspacesModal onClose={() => setModal(null)} />}
      {modal === 'plugins' && <PluginsModal onClose={() => setModal(null)} />}
      {modal === 'processes' && <ProcessesModal onClose={() => setModal(null)} />}
      {modal === 'services' && <ServicesModal onClose={() => setModal(null)} />}
      {modal === 'replication' && <ReplicationModal onClose={() => setModal(null)} />}
      {modal === 'compare' && <CompareModal onClose={() => setModal(null)} />}
      {modal === 'hostmap' && <HostMapModal onClose={() => setModal(null)} />}
      {modal === 'localdev-settings' && <LocaldevSettingsModal onClose={() => setModal(null)} />}
      {modal === 'help' && <HelpModal initialTab={helpTab} onClose={() => setModal(null)} />}
      {historyHostId && (
        <MetricsHistoryModal
          hostId={historyHostId}
          // label: ưu tiên dock đang chạy, fallback danh sách host (xem lịch sử khi monitor đã dừng)
          label={
            useMonitorStore.getState().data[historyHostId]?.label ??
            useDataStore.getState().hosts.find((h) => h.id === historyHostId)?.label ??
            historyHostId
          }
          onClose={() => useMonitorStore.getState().setHistoryHost(null)}
        />
      )}
      {/* Ẩn dock góc phải khi: (a) đã tách ra cửa sổ riêng, HOẶC (b) đang mở Monitoring trong tab
          (nút – trong tab đóng tab → dock hiện lại → chuyển qua lại giữa tab và dock). */}
      {/* Dock nổi góc phải — trừ theme Workbench: ở đó Monitoring có chỗ cố định trong panel đáy */}
      {layout !== 'workbench' && monitorActive && !monitorDetached && !tabs.some((t) => t.kind === 'monitor') && (
        <MonitorDock />
      )}
      <RdpDock />{/* tự return null khi không có tunnel RDP nào */}
      {pluginPanel && (
        <PluginPanelModal panel={pluginPanel} onClose={() => usePluginStore.getState().setPanel(null)} />
      )}
      <AiExplainPanel />{/* tự return null khi không có yêu cầu giải thích */}
      <AiDiagnosePill />{/* pill khi cửa sổ AI chẩn đoán thu nhỏ; tự return null nếu không thu nhỏ */}

      {locked && (
        <div className="absolute inset-0 z-[100]">
          <VaultGate />
        </div>
      )}

      {toasts.length > 0 && (
        <div className="absolute right-3 bottom-9 z-50 flex flex-col gap-2">
          {toasts.map((toast) => (
            <button
              key={toast.id}
              className={`max-w-96 rounded border px-3 py-2 text-left text-xs shadow-lg ${
                toast.kind === 'error'
                  ? 'border-danger/60 bg-danger/15 text-danger'
                  : 'border-edge-strong bg-elevated text-content'
              }`}
              onClick={() => dismiss(toast.id)}
            >
              {toast.message}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
