import { useEffect, useRef, useState } from 'react'
import type { ShellProfile, SnippetDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { useLocaldevStore, stackDot, type LdStackDot } from '../stores/localdev'
import { useSettingsStore } from '../stores/settings'
import { useTabsStore, type AppTab, type ToolTabKind } from '../stores/tabs'
import { tabColor } from '../lib/groupColor'
import { goToSection } from '../features/navigator/nav'
import { RunSnippetModal } from './RunSnippetModal'
import { useT } from '../i18n'

/** Nhãn + icon của các tab CÔNG CỤ (tab không giữ session; xem TOOL_TAB_KINDS). */
const TOOL_TAB_META: Record<ToolTabKind, { label: string; icon: string }> = {
  monitor: { label: 'Monitoring', icon: '📊' },
  compare: { label: 'Compare', icon: '🔍' },
  localdev: { label: 'Local dev', icon: '🧱' },
  tunnels: { label: 'Tunnels', icon: '🔀' },
  processes: { label: 'Processes', icon: '📋' },
  services: { label: 'Services', icon: '⚙' },
  'ai-diagnose': { label: 'AI diagnose', icon: '🩺' },
  replication: { label: 'Replication', icon: '🔁' },
  help: { label: 'Help', icon: '❓' },
  features: { label: 'Tính năng', icon: '⊞' },
  'log-tail': { label: 'Log', icon: '🪵' },
  cron: { label: 'Cron', icon: '⏰' },
  'key-rotate': { label: 'Key rotate', icon: '🔄' },
  'disk-usage': { label: 'Disk', icon: '💾' },
  'pkg-updates': { label: 'Updates', icon: '📦' },
  'known-hosts': { label: 'Fingerprints', icon: '🔏' },
  files: { label: 'SFTP', icon: '📁' },
  notifications: { label: 'Notifications', icon: '🔔' },
  'http-checks': { label: 'URL', icon: '🌐' },
  inventory: { label: 'Inventory', icon: '📇' },
  runbooks: { label: 'Runbooks', icon: '📖' }
}

function toolMeta(kind: AppTab['kind']): { label: string; icon: string } | undefined {
  return (TOOL_TAB_META as Partial<Record<AppTab['kind'], { label: string; icon: string }>>)[kind]
}

/** Tiêu đề tab: SFTP → sftpTitle; vnc → vncTitle; tab công cụ → nhãn cố định; terminal → pane active. */
function tabTitle(tab: AppTab): string {
  if (tab.kind === 'sftp') return tab.sftpTitle ?? 'SFTP'
  if (tab.kind === 'vnc') return tab.vncTitle ?? 'VNC'
  const tool = toolMeta(tab.kind)
  if (tool) return tool.label
  const active = tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0]
  if (tab.panes.length > 1) return `${active?.title ?? 'terminal'} +${tab.panes.length - 1}`
  return active?.title ?? 'terminal'
}

function tabSubtitle(tab: AppTab): string | undefined {
  if (tab.kind === 'sftp') return tab.sftpTitle
  if (tab.kind === 'vnc') return tab.vncTitle
  const tool = toolMeta(tab.kind)
  if (tool) return tool.label
  const active = tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0]
  return active?.subtitle
}

/**
 * Chấm trạng thái: terminal lấy theo pane active; sftp/vnc/monitor/compare luôn xanh.
 * `localdev` là tab ĐẦU TIÊN có chấm sống thật (phản ánh stack local đang chạy hay chết) →
 * phải truyền `ldDot` từ store vào, không tự tính trong hàm thuần này.
 */
function statusDotClass(tab: AppTab, ldDot: LdStackDot): string {
  if (tab.kind === 'localdev') {
    if (ldDot === 'running') return 'bg-success'
    if (ldDot === 'partial') return 'bg-warning'
    if (ldDot === 'error') return 'bg-danger'
    return 'bg-edge-strong'
  }
  // Tab công cụ khác (kể cả tunnels/processes/services/ai-diagnose) không có trạng thái kết nối
  // riêng → luôn xanh. Tunnel có trạng thái nhưng là của TỪNG rule, không phải của cả tab.
  if (tab.kind === 'sftp' || tab.kind === 'vnc' || toolMeta(tab.kind)) return 'bg-success'
  const active = tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0]
  const status = active?.status ?? 'connecting'
  if (status === 'connected') return 'bg-success'
  if (status === 'exited') return 'bg-danger'
  return 'bg-warning animate-pulse'
}

/** Vị trí sẽ chèn khi thả: ngay trước hoặc ngay sau tab `id`. */
interface DropAt {
  id: string
  side: 'before' | 'after'
}

/** Bề rộng vùng mép thanh tab kích hoạt tự cuộn khi kéo, và số px cuộn mỗi nhịp. */
const EDGE_ZONE_PX = 48
const EDGE_SCROLL_PX = 24

/** Thanh tab trên cùng: danh sách tab + nút snippet ⚡ + nút mở tab local mới. */
export function TabsBar() {
  const t = useT()
  const layout = useSettingsStore((s) => s.layout)
  const { tabs, activeId, openLocal, closeTab, setActive, moveTab } = useTabsStore()
  const snippets = useDataStore((s) => s.snippets)
  // Chấm của tab localdev phản ánh stack thật (chạy/một phần/chết) — lấy từ store dùng chung
  const ldDot = useLocaldevStore(stackDot)
  // Màu group (production đỏ…) — sọc trên đầu tab của host thuộc group có màu
  const hosts = useDataStore((s) => s.hosts)
  const groups = useDataStore((s) => s.groups)
  const [menuOpen, setMenuOpen] = useState(false)
  const [snippetMenuOpen, setSnippetMenuOpen] = useState(false)
  const [runSnippet, setRunSnippet] = useState<SnippetDto | null>(null)
  const [shells, setShells] = useState<ShellProfile[]>([])
  const menuRef = useRef<HTMLDivElement>(null)
  const snippetMenuRef = useRef<HTMLDivElement>(null)
  // Kéo-thả sắp xếp tab
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<DropAt | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  const endDrag = (): void => {
    setDragId(null)
    setDropAt(null)
  }

  /** Kéo tới sát mép thanh tab thì tự cuộn — nhiều tab thì đích đến đang nằm ngoài màn hình. */
  const autoScroll = (clientX: number): void => {
    const el = stripRef.current
    if (!el || el.scrollWidth <= el.clientWidth) return
    const rect = el.getBoundingClientRect()
    if (clientX < rect.left + EDGE_ZONE_PX) el.scrollLeft -= EDGE_SCROLL_PX
    else if (clientX > rect.right - EDGE_ZONE_PX) el.scrollLeft += EDGE_SCROLL_PX
  }

  const drop = (): void => {
    if (dragId && dropAt) moveTab(dragId, dropAt.id, dropAt.side)
    endDrag()
  }

  useEffect(() => {
    if (!snippetMenuOpen) return
    const onClickOutside = (event: MouseEvent): void => {
      if (snippetMenuRef.current && !snippetMenuRef.current.contains(event.target as Node)) {
        setSnippetMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', onClickOutside)
    return () => window.removeEventListener('mousedown', onClickOutside)
  }, [snippetMenuOpen])

  useEffect(() => {
    void window.infra.data.listShells().then(setShells)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onClickOutside = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', onClickOutside)
    return () => window.removeEventListener('mousedown', onClickOutside)
  }, [menuOpen])

  return (
    <div className="border-edge bg-panel flex h-9 shrink-0 items-stretch gap-px border-b pl-1 select-none">
      {/* 🏠 CHÍNH LÀ Dashboard (home, không phải tab) — sáng khi không tab nào active.
          Theme Navigator KHÔNG có nút này: cột trái đã là menu, bấm mục nào cũng về vùng chính,
          còn Dashboard ở đó chỉ là một mục tuỳ chọn (mặc định tắt) nên 🏠 không có gì để trỏ tới. */}
      {layout !== 'navigator' && (
        <div className="flex items-center">
          <button
            aria-selected={activeId === null}
            className={`flex h-7 items-center rounded px-2 ${
              activeId === null ? 'bg-app text-content' : 'text-muted hover:bg-hover hover:text-content'
            }`}
            title={t('tabs.openDashboard')}
            onClick={() => goToSection('dashboard')}
          >
            🏠
          </button>
        </div>
      )}
      <div
        ref={stripRef}
        className="flex flex-1 items-stretch gap-px overflow-x-auto"
        // Vùng TRỐNG cuối thanh: thả ở đây = đưa tab về cuối. Tab tự xử lý phần của nó nên chỉ
        // nhận khi event phát ra từ đúng container (target === currentTarget).
        onDragOver={(e) => {
          if (!dragId) return
          e.preventDefault()
          autoScroll(e.clientX)
          if (e.target !== e.currentTarget) return
          const last = tabs[tabs.length - 1]
          if (last && last.id !== dragId) setDropAt({ id: last.id, side: 'after' })
        }}
        onDrop={(e) => {
          e.preventDefault()
          drop()
        }}
      >
        {tabs.map((tab) => {
          const color = tabColor(tab, hosts, groups)
          const marker =
            dropAt?.id === tab.id
              ? `inset ${dropAt.side === 'before' ? '2px' : '-2px'} 0 0 var(--c-accent)`
              : null
          // Sọc màu group trên đầu tab (nhận diện production/staging) + vạch chỉ chỗ sắp thả.
          // Cả hai dùng inset shadow chứ KHÔNG dùng border: border làm tab rộng thêm 2px nên
          // cả thanh giật mỗi lần vạch nhảy sang tab khác.
          const shadow = [color ? `inset 0 2px 0 ${color}` : null, marker].filter(Boolean).join(', ')
          return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={tab.id === activeId}
            draggable
            className={`group flex max-w-52 min-w-28 cursor-pointer items-center gap-2 rounded-t px-3 text-xs ${
              tab.id === activeId
                ? 'bg-app text-content'
                : 'text-muted hover:bg-hover hover:text-content'
            } ${dragId === tab.id ? 'opacity-40' : ''}`}
            style={shadow ? { boxShadow: shadow } : undefined}
            onClick={() => setActive(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) closeTab(tab.id) // middle click đóng tab
            }}
            onDragStart={(e) => {
              setDragId(tab.id)
              e.dataTransfer.effectAllowed = 'move'
              // Không có payload thì một số engine bỏ qua luôn chuỗi dragover; giá trị không dùng tới
              e.dataTransfer.setData('text/plain', tab.id)
            }}
            onDragOver={(e) => {
              if (!dragId || dragId === tab.id) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              // Nửa trái = chèn trước, nửa phải = chèn sau → thả được vào cả hai đầu danh sách
              const rect = e.currentTarget.getBoundingClientRect()
              const side = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
              setDropAt((prev) => (prev?.id === tab.id && prev.side === side ? prev : { id: tab.id, side }))
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              drop()
            }}
            // Thả ra ngoài thanh tab / bấm Esc giữa chừng: dragend LUÔN chạy, nếu không dọn ở đây
            // thì tab kéo dở kẹt mờ và vạch chỉ chỗ nằm lại trên màn hình
            onDragEnd={endDrag}
            title={tabSubtitle(tab) ?? tabTitle(tab)}
          >
            <span className={`size-1.5 shrink-0 rounded-full ${statusDotClass(tab, ldDot)}`} />
            {tab.kind === 'sftp' && <span className="text-subtle shrink-0">📁</span>}
            {tab.kind === 'vnc' && <span className="text-subtle shrink-0">🖥️</span>}
            {toolMeta(tab.kind) && <span className="text-subtle shrink-0">{toolMeta(tab.kind)!.icon}</span>}
            {tab.broadcast && <span className="text-warning shrink-0" title="Broadcast ON">📡</span>}
            <span className="truncate">{tabTitle(tab)}</span>
            <button
              className="text-subtle hover:bg-edge-strong hover:text-content ml-auto rounded p-0.5 opacity-0 group-hover:opacity-100"
              title={t('tabs.close')}
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          )
        })}
      </div>

      <div className="relative flex items-center" ref={snippetMenuRef}>
        <button
          className="text-muted hover:bg-hover hover:text-warning flex h-7 items-center px-2"
          title={t('tabs.runSnippet')}
          onClick={() => setSnippetMenuOpen((v) => !v)}
        >
          ⚡
        </button>
        {snippetMenuOpen && (
          <div className="border-edge-strong bg-elevated absolute top-8 right-0 z-50 min-w-48 rounded-md border py-1 shadow-xl">
            {snippets.map((snippet) => (
              <button
                key={snippet.id}
                className="text-muted hover:bg-hover hover:text-content block w-full px-3 py-1.5 text-left text-xs"
                onClick={() => {
                  setSnippetMenuOpen(false)
                  setRunSnippet(snippet)
                }}
              >
                {snippet.label}
              </button>
            ))}
            {snippets.length === 0 && (
              <p className="text-subtle px-3 py-1.5 text-xs">{t('tabs.noSnippet')}</p>
            )}
          </div>
        )}
      </div>

      <div className="relative flex items-center" ref={menuRef}>
        <button
          className="text-muted hover:bg-hover hover:text-content flex h-7 items-center rounded-l px-2"
          title={t('tabs.newLocal')}
          onClick={() => void openLocal()}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className="text-subtle hover:bg-hover hover:text-content flex h-7 items-center rounded-r px-1"
          title={t('tabs.chooseShell')}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        {menuOpen && (
          <div className="border-edge-strong bg-elevated absolute top-8 right-1 z-50 min-w-48 rounded-md border py-1 shadow-xl">
            {shells.map((shell) => (
              <button
                key={shell.id}
                className="text-muted hover:bg-hover hover:text-content block w-full px-3 py-1.5 text-left text-xs"
                onClick={() => {
                  setMenuOpen(false)
                  void openLocal(shell.id)
                }}
              >
                {shell.label}
              </button>
            ))}
            {shells.length === 0 && (
              <p className="text-subtle px-3 py-1.5 text-xs">{t('tabs.noShell')}</p>
            )}
          </div>
        )}
      </div>

      {runSnippet && <RunSnippetModal snippet={runSnippet} onClose={() => setRunSnippet(null)} />}
    </div>
  )
}
