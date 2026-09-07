import type { I18nKey } from '../i18n/dict'
import { useSettingsStore } from '../stores/settings'
import { useTabsStore, type ToolTabKind } from '../stores/tabs'
import { useUiStore, type AppModal } from '../stores/ui'
import { goToSection } from '../features/navigator/nav'

/**
 * Danh mục CÔNG CỤ dùng chung — nguồn duy nhất cho menu `⋯`, lưới trên Dashboard và tab
 * "Tất cả tính năng".
 *
 * Trước đây menu và lưới khai hai danh sách riêng, nên thêm một công cụ là phải nhớ sửa hai
 * chỗ (và đã lệch thật). Thêm tab thứ ba mà vẫn giữ kiểu cũ thì lệch ba chỗ.
 *
 * `common: true` = ở lại menu `⋯`. Menu là đường vào duy nhất khi đang ở tab terminal, nên nó
 * chỉ nên chứa thứ dùng hằng ngày; phần còn lại sống trong tab "Tất cả tính năng". Công cụ
 * MỚI mặc định KHÔNG common — menu dài ra là menu không ai đọc nữa.
 */
export type ToolCategory = 'session' | 'fleet' | 'diagnostics' | 'security' | 'data' | 'app'

interface ToolEntryBase {
  /** Khoá ổn định cho React + tìm kiếm. */
  id: string
  /** Nhãn menu dạng "<icon> <tên>" — icon khai MỘT chỗ, trong `dict.ts`. */
  menuKey: I18nKey
  /** Mô tả một dòng, chỉ hiện ở tab "Tất cả tính năng". */
  descKey: I18nKey
  category: ToolCategory
  /** Có mặt trong menu `⋯` hay không. */
  common: boolean
}

/**
 * Một công cụ mở HOẶC popup (`modal`) HOẶC tab (`tab`) — đúng một trong hai. Trước đây mọi công
 * cụ đều là modal; trang SFTP là công cụ đầu tiên sống trong tab ngay từ đầu (nó là một vùng làm
 * việc, không phải hộp thoại). Khoá đếm mức dùng = `modal` hoặc `tab` (cùng bảng với
 * `ui.setModal` / `tabs.openToolTab`).
 */
export type ToolEntry = ToolEntryBase &
  ({ modal: Exclude<AppModal, null>; tab?: undefined } | { modal?: undefined; tab: ToolTabKind })

/** Khoá đếm mức dùng / id ô lưới của một công cụ. */
export function toolKey(tool: ToolEntry): string {
  return tool.modal ?? tool.tab
}

/**
 * Mở một công cụ — nơi DUY NHẤT biết công cụ đó là popup hay tab. Ba nơi liệt kê công cụ (menu
 * `⋯`, lưới Dashboard, tab Tất cả tính năng) gọi hàm này thay vì tự `setModal`.
 *
 * Trang SFTP ở theme Navigator là một MỤC trên cột trái: mở thêm tab nữa là hai bản cùng một
 * phiên; nên ở theme đó chuyển sang mục thay vì mở tab.
 */
export function openTool(tool: ToolEntry): void {
  if (tool.tab) {
    if (tool.tab === 'files' && useSettingsStore.getState().layout === 'navigator') {
      goToSection('sftp')
      return
    }
    useTabsStore.getState().openToolTab(tool.tab)
    return
  }
  useUiStore.getState().setModal(tool.modal)
}

export const TOOL_CATEGORIES: ReadonlyArray<{ id: ToolCategory; titleKey: I18nKey }> = [
  { id: 'session', titleKey: 'features.catSession' },
  { id: 'fleet', titleKey: 'features.catFleet' },
  { id: 'diagnostics', titleKey: 'features.catDiagnostics' },
  { id: 'security', titleKey: 'features.catSecurity' },
  { id: 'data', titleKey: 'features.catData' },
  { id: 'app', titleKey: 'features.catApp' }
]

export const TOOLS: readonly ToolEntry[] = [
  // --- Phiên làm việc: dùng hằng ngày, giữ trong menu ---
  { id: 'workspaces', menuKey: 'menu.workspaces', descKey: 'features.dWorkspaces', category: 'session', modal: 'workspaces', common: true },
  { id: 'snippets', menuKey: 'menu.snippets', descKey: 'features.dSnippets', category: 'session', modal: 'snippets', common: true },
  { id: 'tunnels', menuKey: 'menu.tunnels', descKey: 'features.dTunnels', category: 'session', modal: 'tunnels', common: true },
  // Trang SFTP: mở TAB (theme Infra) hoặc chuyển mục 📁 SFTP (theme Navigator) — xem openTool
  { id: 'sftp', menuKey: 'menu.sftp', descKey: 'features.dSftp', category: 'session', tab: 'files', common: true },
  { id: 'recordings', menuKey: 'menu.recordings', descKey: 'features.dRecordings', category: 'session', modal: 'recordings', common: false },

  // --- Cả fleet ---
  { id: 'bulk', menuKey: 'menu.bulk', descKey: 'features.dBulk', category: 'fleet', modal: 'bulk', common: true },
  { id: 'monitor', menuKey: 'menu.monitor', descKey: 'features.dMonitor', category: 'fleet', modal: 'monitor', common: true },
  { id: 'notifications', menuKey: 'menu.notifications', descKey: 'features.dNotifications', category: 'fleet', modal: 'notifications', common: false },
  { id: 'http-checks', menuKey: 'menu.httpChecks', descKey: 'features.dHttpChecks', category: 'fleet', modal: 'http-checks', common: false },
  // Bảng kiểm kê rộng → mở dạng TAB ngay từ đầu (như SFTP), không phải popup
  { id: 'inventory', menuKey: 'menu.inventory', descKey: 'features.dInventory', category: 'fleet', tab: 'inventory', common: false },
  { id: 'pkg-updates', menuKey: 'menu.pkgUpdates', descKey: 'features.dPkgUpdates', category: 'fleet', modal: 'pkg-updates', common: false },
  { id: 'key-rotate', menuKey: 'menu.keyRotate', descKey: 'features.dKeyRotate', category: 'fleet', modal: 'key-rotate', common: false },

  // --- Chẩn đoán ---
  // Sổ tay vận hành ở LẠI menu `⋯`: đây là thứ người ta cần đúng lúc đang ở tab terminal
  { id: 'runbooks', menuKey: 'menu.runbooks', descKey: 'features.dRunbooks', category: 'diagnostics', modal: 'runbooks', common: true },
  { id: 'processes', menuKey: 'menu.processes', descKey: 'features.dProcesses', category: 'diagnostics', modal: 'processes', common: false },
  { id: 'services', menuKey: 'menu.services', descKey: 'features.dServices', category: 'diagnostics', modal: 'services', common: false },
  { id: 'disk-usage', menuKey: 'menu.diskUsage', descKey: 'features.dDiskUsage', category: 'diagnostics', modal: 'disk-usage', common: false },
  { id: 'log-tail', menuKey: 'menu.logTail', descKey: 'features.dLogTail', category: 'diagnostics', modal: 'log-tail', common: false },
  { id: 'cron', menuKey: 'menu.cron', descKey: 'features.dCron', category: 'diagnostics', modal: 'cron', common: false },
  { id: 'replication', menuKey: 'menu.replication', descKey: 'features.dReplication', category: 'diagnostics', modal: 'replication', common: false },
  { id: 'compare', menuKey: 'menu.compare', descKey: 'features.dCompare', category: 'diagnostics', modal: 'compare', common: false },
  { id: 'net', menuKey: 'menu.net', descKey: 'features.dNet', category: 'diagnostics', modal: 'net', common: false },
  { id: 'hostmap', menuKey: 'menu.hostmap', descKey: 'features.dHostmap', category: 'diagnostics', modal: 'hostmap', common: false },
  { id: 'ai-diagnose', menuKey: 'menu.aiDiagnose', descKey: 'features.dAiDiagnose', category: 'diagnostics', modal: 'ai-diagnose', common: false },

  // --- Bí mật & an ninh ---
  { id: 'keys', menuKey: 'menu.keys', descKey: 'features.dKeys', category: 'security', modal: 'keys', common: false },
  { id: 'known-hosts', menuKey: 'menu.knownHosts', descKey: 'features.dKnownHosts', category: 'security', modal: 'known-hosts', common: false },

  // --- Dữ liệu vào/ra ---
  { id: 'sync', menuKey: 'menu.sync', descKey: 'features.dSync', category: 'data', modal: 'sync', common: true },
  { id: 'export-hosts', menuKey: 'menu.export', descKey: 'features.dExport', category: 'data', modal: 'export-hosts', common: false },
  { id: 'do-import', menuKey: 'menu.doImport', descKey: 'features.dDoImport', category: 'data', modal: 'do-import', common: false },
  { id: 'client-import', menuKey: 'menu.clientImport', descKey: 'features.dClientImport', category: 'data', modal: 'client-import', common: false },

  // --- Ứng dụng ---
  { id: 'ai', menuKey: 'menu.ai', descKey: 'features.dAi', category: 'app', modal: 'ai', common: false },
  { id: 'plugins', menuKey: 'menu.plugins', descKey: 'features.dPlugins', category: 'app', modal: 'plugins', common: false },
  // `common: false` cho Cài đặt / Trợ giúp KHÔNG có nghĩa là ẩn chúng khỏi menu: hai mục này
  // được vẽ tay ở CUỐI menu (sau separator) theo lệ chung của mọi app. Đặt `true` ở đây là ra
  // hai lần trong cùng một menu — đã dính đúng vậy.
  { id: 'settings', menuKey: 'menu.settings', descKey: 'features.dSettings', category: 'app', modal: 'settings', common: false },
  { id: 'help', menuKey: 'menu.help', descKey: 'features.dHelp', category: 'app', modal: 'help', common: false }
]

/**
 * Tách nhãn dạng "<icon> <tên>". Icon luôn là cụm đầu tiên trước dấu cách.
 * Giữ ở đây để cả ba nơi dùng chung một cách tách, không ai tự chế bản riêng.
 */
export function splitMenuLabel(label: string): { icon: string; name: string } {
  const at = label.indexOf(' ')
  if (at <= 0) return { icon: label, name: label }
  return { icon: label.slice(0, at), name: label.slice(at + 1).trim() }
}
