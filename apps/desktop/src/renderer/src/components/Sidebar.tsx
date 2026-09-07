import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  filterHosts,
  groupHostSections,
  isGroupCollapsed,
  unseenHistory,
  visibleSidebarBlocks,
  type GroupDto,
  type HostDto,
  type SidebarBlockId
} from '@infra/shared'
import { useDataStore } from '../stores/data'
import { useTabsStore } from '../stores/tabs'
import { useToastsStore } from '../stores/toasts'
import { useRdpStore } from '../stores/rdp'
import { useWatcherStore } from '../stores/watcher'
import { useFavoritesStore } from '../stores/favorites'
import { useSidebarGroupsStore } from '../stores/sidebarGroups'
import { useWorkspacesStore } from '../stores/workspaces'
import { useUiStore, type AppModal } from '../stores/ui'
import { ToolsMenu } from './ToolsMenu'
import { SnippetsBlock, TunnelsBlock, WorkspacesBlock } from './SidebarBlocks'
import { SidebarLayoutPanel } from './SidebarLayoutPanel'
import { GroupMenuButton } from './GroupMenuButton'
import {
  Chevron,
  ChevronsIcon,
  CopyIcon,
  FolderIcon,
  GearIcon,
  NoteIcon,
  PencilIcon,
  SplitIcon,
  StarIcon
} from './icons'
import { GroupEditorModal } from './GroupEditorModal'
import { HostEditorModal } from './HostEditorModal'
import { NotesModal } from './NotesModal'
import { Button, ConfirmModal } from './ui'
import { useT, type I18nKey } from '../i18n'

const QUICK_PATTERN = /^[^@\s]+@[^@\s]+$/

/**
 * Số dòng "Kết nối gần đây". Trước là 8, nhưng lúc đó mục này còn lặp lại cả host đã lưu;
 * giờ chỉ còn quick-connect chưa lưu nên 4 là đủ, và đáy sidebar trả chỗ lại cho host.
 */
const RECENT_LIMIT = 4

// Modal toàn cục (bulk/monitor/ai…) chuyển sang useUiStore — App là nơi mount duy nhất.
// Sidebar chỉ giữ editor host/group (cần props).
type OpenModal =
  | { kind: 'host'; host: HostDto | null; duplicate?: boolean }
  | { kind: 'group'; group: GroupDto | null }
  | { kind: 'notes'; host: HostDto }
  | null

/**
 * Cột trái: Quick Connect / tìm kiếm, hosts theo group, lịch sử, menu công cụ.
 * `fluid` = nhúng vào panel phụ của theme Workbench: lấy hết bề rộng cha (panel tự có viền/nền),
 * thay cho cột 240px cố định.
 */
export function Sidebar({ fluid = false }: { readonly fluid?: boolean } = {}) {
  const t = useT()
  const { hosts, groups, history, refreshAll, deleteGroup } = useDataStore()
  const { openSsh, openQuick, openSshGroup } = useTabsStore()
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUiStore((s) => s.toggleSidebar)
  // (Local dev đã rời menu — vào tab "Tất cả tính năng"; nơi đó tự đọc cờ enabled của nó.)
  const favIds = useFavoritesStore((s) => s.ids)
  const collapsedIds = useSidebarGroupsStore((s) => s.collapsedIds)
  const toggleGroup = useSidebarGroupsStore((s) => s.toggle)
  const setAllCollapsed = useSidebarGroupsStore((s) => s.setAll)
  const blockOrder = useSidebarGroupsStore((s) => s.blockOrder)
  const blockEnabled = useSidebarGroupsStore((s) => s.blockEnabled)
  const blockCollapsed = useSidebarGroupsStore((s) => s.blockCollapsed)
  const toggleBlockCollapsed = useSidebarGroupsStore((s) => s.toggleBlockCollapsed)
  const [layoutOpen, setLayoutOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<OpenModal>(null)
  const [deletingGroup, setDeletingGroup] = useState<GroupDto | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  /** Group đang mở menu `⋯` — chỉ MỘT cái mở tại một thời điểm (id, hoặc `__ungrouped__`). */
  const [groupMenuId, setGroupMenuId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onClickOutside = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', onClickOutside)
    return () => window.removeEventListener('mousedown', onClickOutside)
  }, [menuOpen])

  const isQuick = QUICK_PATTERN.test(query.trim()) || /^[^@\s]+@.+:\d+$/.test(query.trim())

  const filtered = useMemo(() => filterHosts(hosts, query), [hosts, query])

  // Khi KHÔNG tìm kiếm: hiện cả group RỖNG (để đổi tên/xoá được — trước đây group không host
  // bị ẩn hoàn toàn nên kẹt luôn). Khi đang tìm kiếm thì chỉ hiện group có host khớp cho gọn.
  // Cùng hàm thuần với trang Hosts của theme Navigator — hai chỗ không lệch nhau.
  const sections = useMemo(
    () => groupHostSections(groups, filtered, !query.trim()),
    [filtered, groups, query]
  )

  // Host đã ghim (tôn trọng cả ô tìm kiếm); hiện ở mục "Yêu thích" đầu danh sách.
  const favHosts = useMemo(() => filtered.filter((h) => favIds.includes(h.id)), [filtered, favIds])

  /**
   * Đang tìm kiếm thì MỌI mục mở hết, bỏ qua trạng thái gập: tìm ra một host rồi lại giấu nó
   * trong một group đang gập là biến ô tìm thành vô dụng đúng lúc cần nó nhất.
   */
  const searching = query.trim() !== ''
  const groupsWithHosts = useMemo(() => groups.filter((g) => hosts.some((h) => h.groupId === g.id)), [groups, hosts])
  const allCollapsed = groupsWithHosts.length > 0 && groupsWithHosts.every((g) => collapsedIds.includes(g.id))

  /**
   * "Kết nối gần đây" chỉ hiện những gì KHÔNG có ở danh sách trên — thực tế mục này lặp lại
   * gần hết danh sách host (mở một host đã lưu là một dòng history trỏ về chính nó), nên tám
   * dòng cuối chỉ nhắc lại tám dòng ở trên và đẩy danh sách thật ra khỏi màn hình. Giá trị
   * thật của nó là quick-connect chưa lưu thành host.
   */
  const recent = useMemo(
    () => unseenHistory(history, filtered.map((h) => h.id), RECENT_LIMIT),
    [history, filtered]
  )

  const blocks = useMemo(() => visibleSidebarBlocks(blockOrder, blockEnabled), [blockOrder, blockEnabled])

  const snippets = useDataStore((s) => s.snippets)
  const tunnels = useDataStore((s) => s.tunnels)
  const workspaces = useWorkspacesStore((s) => s.workspaces)

  /**
   * Số hiện cạnh tên khối khi khối đang GẬP — gập rồi thì con số là thứ duy nhất còn nói được
   * "trong đây có gì". `groups` không có số vì nó không phải một khối gập chung.
   */
  const blockCounts: Partial<Record<SidebarBlockId, number>> = {
    favorites: favHosts.length,
    tunnels: tunnels.length,
    snippets: snippets.length,
    workspaces: workspaces.length,
    recent: recent.length
  }

  const openHostEditor = (host: HostDto, duplicate = false): void => setModal({ kind: 'host', host, duplicate })
  const openNotes = (host: HostDto): void => setModal({ kind: 'notes', host })

  const connectQuick = (): void => {
    if (!isQuick) return
    void openQuick(query.trim())
    setQuery('')
  }

  const runImport = async (): Promise<void> => {
    // ToolsMenu tự đóng trước khi chạy action — không cần setMenuOpen ở đây nữa.
    const result = await window.infra.importer.sshConfig()
    if (!result) return
    await refreshAll()
    const push = useToastsStore.getState().push
    push(`Đã import ${result.hostsImported} hosts, ${result.keysImported} keys vào group "${result.groupName}"`, 'info')
    for (const warning of result.warnings.slice(0, 3)) push(warning)
  }

  // Thu gọn: chỉ còn thanh hẹp với nút mở lại — vùng làm việc chiếm phần còn lại.
  if (sidebarCollapsed) {
    return (
      <div className="border-edge bg-panel flex w-8 shrink-0 flex-col items-center border-r py-1.5 select-none">
        <button
          className="text-muted hover:bg-hover hover:text-content rounded px-1.5 py-1 text-sm leading-none"
          title={`${t('sidebar.expand')} (Ctrl+Shift+H)`}
          aria-label={t('sidebar.expand')}
          onClick={toggleSidebar}
        >
          »
        </button>
        <div className="flex-1" />
        {/* Thu gọn là mất luôn hàng nút đáy sidebar (⋯, ⓘ) — Cài đặt phải còn một đường
            vào nhìn thấy được, neo ở góc dưới đúng vị trí quen của nó lúc chưa thu gọn. */}
        <button
          className="text-muted hover:bg-hover hover:text-content rounded px-1.5 py-1 text-sm leading-none"
          title={t('settings.title')}
          aria-label={t('settings.title')}
          onClick={() => openAppModal('settings')}
        >
          ⚙
        </button>
      </div>
    )
  }

  return (
    <div
      className={
        fluid
          ? 'flex w-full min-w-0 flex-col select-none'
          : 'border-edge bg-panel flex w-60 shrink-0 flex-col border-r select-none'
      }
    >
      <div className="p-2">
        <div className="flex items-center gap-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (isQuick) connectQuick()
                else if (filtered.length === 1) void openSsh(filtered[0]!.id)
              }
            }}
            placeholder={t('sidebar.searchPlaceholder')}
            className="border-edge bg-input text-content placeholder-subtle focus:border-accent w-full min-w-0 flex-1 rounded border px-2.5 py-1.5 text-xs outline-none"
          />
          {/* Gập/mở TẤT CẢ nhóm — nằm cạnh ô tìm chứ không chen giữa danh sách: hàng đầu là
              nơi đặt điều khiển của cả cột, còn khu dưới thuộc về host. Chỉ hiện khi thật sự
              có nhiều nhóm (dưới 3 thì gập tay nhanh hơn đi tìm nút), và ẩn khi đang tìm kiếm
              vì lúc đó mọi nhóm mở hết bất chấp trạng thái gập → nút sẽ không có tác dụng thấy được. */}
          {!searching && groupsWithHosts.length >= 3 && (
            <button
              className="text-subtle hover:bg-hover hover:text-content shrink-0 rounded px-1 py-1 leading-none"
              title={allCollapsed ? t('sidebar.expandAll') : t('sidebar.collapseAll')}
              aria-label={allCollapsed ? t('sidebar.expandAll') : t('sidebar.collapseAll')}
              onClick={() => setAllCollapsed(groupsWithHosts.map((g) => g.id), !allCollapsed)}
            >
              <ChevronsIcon collapsed={allCollapsed} />
            </button>
          )}
          {/* Cấu hình BỐ CỤC cột (khối nào hiện, thứ tự ra sao) — cùng hàng với các điều khiển
              khác của cả cột, không chen vào khu danh sách bên dưới. */}
          <button
            className={`hover:bg-hover shrink-0 rounded px-1 py-1 leading-none ${
              layoutOpen ? 'text-accent' : 'text-subtle hover:text-content'
            }`}
            title={t('sidebar.layoutTitle')}
            aria-label={t('sidebar.layoutTitle')}
            aria-expanded={layoutOpen}
            onClick={() => setLayoutOpen((v) => !v)}
          >
            <GearIcon />
          </button>
          <button
            className="text-subtle hover:bg-hover hover:text-content shrink-0 rounded px-1 py-1 text-sm leading-none"
            title={`${t('sidebar.collapse')} (Ctrl+Shift+H)`}
            aria-label={t('sidebar.collapse')}
            onClick={toggleSidebar}
          >
            «
          </button>
        </div>
        {layoutOpen && <SidebarLayoutPanel onClose={() => setLayoutOpen(false)} />}
        {isQuick && (
          <button
            className="border-accent/40 bg-accent-soft/40 text-accent-fg hover:bg-accent-soft/60 mt-1.5 flex w-full items-center gap-1.5 rounded border px-2.5 py-1.5 text-left text-xs"
            onClick={connectQuick}
          >
            <span className="text-accent">→</span> {t('sidebar.connectTo', { target: query.trim() })}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {/* Bố cục theo KHỐI: thứ tự và bật/tắt do user đặt (hộp ⚙ ở hàng ô tìm). Mặc định đúng
            bằng bố cục cũ — Yêu thích → nhóm host → Gần đây — nên ai không đụng gì thì không
            thấy khác gì. Khối "nhóm host" là khối đặc biệt duy nhất: nó tự chứa nhiều section
            (mỗi group một cái) nên không bọc trong một header gập chung. */}
        {blocks.map((blockId) => {
          if (blockId === 'groups') return <div key="groups">{renderGroups()}</div>
          const collapsed = blockCollapsed.includes(blockId)
          return (
            <SidebarBlock
              key={blockId}
              id={blockId}
              collapsed={collapsed}
              onToggle={() => toggleBlockCollapsed(blockId)}
              count={blockCounts[blockId]}
            >
              {blockId === 'favorites' &&
                (favHosts.length === 0 ? (
                  <p className="text-subtle px-2 py-1 text-[10px] italic">{t('sidebar.blockNoFavorites')}</p>
                ) : (
                  favHosts.map((host) => (
                    <HostRow
                      key={`fav-${host.id}`}
                      host={host}
                      color={groups.find((g) => g.id === host.groupId)?.color ?? null}
                      onEdit={openHostEditor}
                      onNotes={openNotes}
                    />
                  ))
                ))}
              {blockId === 'tunnels' && <TunnelsBlock />}
              {blockId === 'snippets' && <SnippetsBlock />}
              {blockId === 'workspaces' && <WorkspacesBlock />}
              {blockId === 'recent' && renderRecent()}
            </SidebarBlock>
          )
        })}

        {blocks.length === 0 && (
          <p className="text-subtle px-2 py-6 text-center text-[11px] leading-relaxed">
            {t('sidebar.blockAllOff')}
          </p>
        )}
      </div>

      <div className="border-edge relative flex gap-1.5 border-t p-2" ref={menuRef}>
        <Button className="flex-1 !py-1 !text-xs" variant="primary" onClick={() => setModal({ kind: 'host', host: null })}>
          {t('sidebar.addHost')}
        </Button>
        <Button className="flex-1 !py-1 !text-xs" onClick={() => openAppModal('keys')}>
          {t('sidebar.keys')}
        </Button>
        {/* Trợ giúp có nút riêng chứ không chỉ nằm trong ⋯: nó là thứ người ta tìm khi đang bí,
            lúc đó bắt mở thêm một menu để tìm là sai. */}
        <Button className="!px-2 !py-1 !text-xs" onClick={() => openAppModal('help')} title={t('help.title')}>
          ⓘ
        </Button>
        <Button className="!px-2 !py-1 !text-xs" onClick={() => setMenuOpen((v) => !v)} title={t('sidebar.moreTools')}>
          ⋯
        </Button>
        {/* Menu chia nhóm + có ô tìm — xem ToolsMenu. Nó neo theo HÀNG NÚT này (`relative` ở
            div cha, không phải quanh riêng nút `⋯`): neo quanh nút thì menu rộng 240px sẽ thò
            ra ngoài mép trái cửa sổ, vì nút nằm sát mép phải một cột cũng chỉ rộng 240px.
            Local dev KHÔNG ở menu: nó là "khu vực sản phẩm khác" (môi trường dev local, không
            phải SSH) → sống ở tab "Tất cả tính năng" và lưới công cụ Dashboard. */}
        <ToolsMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          actions={[
            { id: 'create-group', labelKey: 'menu.createGroup', run: () => setModal({ kind: 'group', group: null }) },
            { id: 'import-ssh-config', labelKey: 'menu.import', run: () => void runImport() },
            { id: 'import-clients', labelKey: 'menu.clientImport', run: () => useUiStore.getState().setModal('client-import') }
          ]}
        />
      </div>

      {modal?.kind === 'host' && (
        <HostEditorModal host={modal.host} duplicate={modal.duplicate} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'group' && <GroupEditorModal group={modal.group} onClose={() => setModal(null)} />}
      {modal?.kind === 'notes' && (
        <NotesModal
          host={modal.host}
          onEdit={() => setModal({ kind: 'host', host: modal.host })}
          onClose={() => setModal(null)}
        />
      )}
      {deletingGroup && (
        <ConfirmModal
          title={t('group.delete')}
          message={
            <>
              {t('group.deleteMsg', { name: deletingGroup.name })}
              {hosts.some((h) => h.groupId === deletingGroup.id) && (
                <span className="text-warning mt-2 block text-xs">{t('group.deleteHostsNote')}</span>
              )}
            </>
          }
          onConfirm={() => {
            const g = deletingGroup
            setDeletingGroup(null)
            void deleteGroup(g.id)
          }}
          onCancel={() => setDeletingGroup(null)}
        />
      )}
    </div>
  )

  function renderGroups(): ReactNode {
    return (
      <>
        {sections.map((section) => {
          // Đang tìm kiếm thì mở hết, bất kể trạng thái gập đã lưu
          const collapsed = !searching && isGroupCollapsed(collapsedIds, section.group?.id ?? null)
          const canCollapse = section.group !== null && !searching
          return (
          <div key={section.group?.id ?? '__ungrouped__'} className="mb-2">
            {/* ⚠️ Header là <div> chứ KHÔNG phải <button>: nó đã chứa 3 nút con (mở nhóm/sửa/xoá)
                và <button> lồng <button> là HTML không hợp lệ — trình duyệt tự gỡ lồng, mất nút
                con. Phần bấm-để-gập là nút riêng chiếm khoảng tên. */}
            <div className="group/header flex items-center px-1 py-1">
              {canCollapse ? (
                <button
                  className="hover:text-content flex min-w-0 flex-1 items-center gap-1 text-left"
                  onClick={() => toggleGroup(section.group!.id)}
                  title={collapsed ? t('sidebar.expandSection') : t('sidebar.collapseSection')}
                  aria-expanded={!collapsed}
                >
                  <Chevron open={!collapsed} />
                  {/* Chấm màu nhận diện group (đặt trong group editor) */}
                  {section.group?.color && (
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: section.group.color }}
                    />
                  )}
                  <span className="text-subtle min-w-0 flex-1 truncate text-[10px] font-semibold tracking-wider uppercase">
                    {section.group?.name}
                  </span>
                  {/* Gập rồi thì số host là thứ duy nhất còn nói được "trong đây có gì" */}
                  {collapsed && <span className="text-subtle shrink-0 text-[10px]">{section.hosts.length}</span>}
                </button>
              ) : (
                <>
                  {section.group?.color && (
                    <span
                      className="mr-1.5 size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: section.group.color }}
                    />
                  )}
                  <span className="text-subtle flex-1 truncate text-[10px] font-semibold tracking-wider uppercase">
                    {section.group?.name ?? (groups.length > 0 ? t('sidebar.other') : t('sidebar.global'))}
                  </span>
                </>
              )}
              {/* Ba việc của group (mở cả nhóm / sửa / xoá) gom vào MỘT dấu `⋯`: ba icon hiện
                  lúc hover vừa chen với số host vừa bắt phải nhắm đúng một ô 11px, và cái nút
                  xoá thì nằm ngay cạnh hai nút vô hại. */}
              {(section.group !== null || section.hosts.length > 1) && (
                <GroupMenuButton
                  open={groupMenuId === (section.group?.id ?? '__ungrouped__')}
                  onToggle={() =>
                    setGroupMenuId((cur) => {
                      const id = section.group?.id ?? '__ungrouped__'
                      return cur === id ? null : id
                    })
                  }
                  onOpenAll={
                    section.hosts.length > 1 ? () => void openSshGroup(section.hosts.map((h) => h.id)) : undefined
                  }
                  hostCount={section.hosts.length}
                  onEdit={section.group ? () => setModal({ kind: 'group', group: section.group }) : undefined}
                  onDelete={section.group ? () => setDeletingGroup(section.group) : undefined}
                />
              )}
            </div>
            {collapsed ? null : section.group && section.hosts.length === 0 ? (
              <p className="text-subtle px-2 py-1 text-[10px] italic">{t('sidebar.groupEmpty')}</p>
            ) : (
              section.hosts.map((host) => (
                <HostRow
                  key={host.id}
                  host={host}
                  color={section.group?.color ?? null}
                  onEdit={openHostEditor}
                  onNotes={openNotes}
                />
              ))
            )}
          </div>
          )
        })}

        {hosts.length === 0 && (
          <p className="text-subtle px-2 py-6 text-center text-[11px] leading-relaxed">
            {t('sidebar.empty')}
          </p>
        )}
      </>
    )
  }

  /** Khối "Gần đây" — chỉ target chưa lưu thành host (xem `unseenHistory`). */
  function renderRecent(): ReactNode {
    if (recent.length === 0) return <p className="text-subtle px-2 py-1 text-[10px] italic">{t('sidebar.blockNoRecent')}</p>
    return (
      <>
        {recent.map((entry) => (
          <button
            key={entry.id}
            className="text-muted hover:bg-hover hover:text-content block w-full truncate rounded px-2 py-1 text-left text-[11px]"
            onClick={() => {
              if (entry.hostId) void openSsh(entry.hostId)
              else void openQuick(entry.target.replace(/:22$/, ''))
            }}
          >
            {entry.target}
          </button>
        ))}
      </>
    )
  }
}

/**
 * Nhãn + màu của từng khối. Khối "Yêu thích" giữ nguyên bộ màu vàng có viền đã quen; các khối
 * khác dùng header phẳng giống group để không có bốn hộp màu chồng nhau trong một cột 240px.
 */
const BLOCK_META: Record<
  SidebarBlockId,
  { titleKey: I18nKey; icon: string; tinted?: boolean }
> = {
  favorites: { titleKey: 'sidebar.favorites', icon: '★', tinted: true },
  groups: { titleKey: 'sidebar.blockGroups', icon: '🗂' },
  tunnels: { titleKey: 'sidebar.blockTunnels', icon: '🔀' },
  snippets: { titleKey: 'sidebar.blockSnippets', icon: '📝' },
  workspaces: { titleKey: 'sidebar.blockWorkspaces', icon: '🗂' },
  recent: { titleKey: 'sidebar.recentUnsaved', icon: '🕒' }
}

/** Vỏ chung của một khối sidebar: header bấm-để-gập + nội dung. */
function SidebarBlock({
  id,
  collapsed,
  onToggle,
  count,
  children
}: {
  readonly id: SidebarBlockId
  readonly collapsed: boolean
  readonly onToggle: () => void
  /** Số hiện cạnh tên khi GẬP — gập rồi thì nó là thứ duy nhất còn nói "trong đây có gì". */
  readonly count?: number
  readonly children: ReactNode
}) {
  const t = useT()
  const meta = BLOCK_META[id]
  return (
    <div
      className={
        meta.tinted ? 'border-warning/25 bg-warning/5 mb-2 rounded-md border p-1' : 'mb-2'
      }
    >
      <button
        className={`flex w-full items-center gap-1 rounded px-1 py-1 text-left ${
          meta.tinted ? 'hover:bg-warning/10' : 'hover:bg-hover'
        }`}
        onClick={onToggle}
        title={collapsed ? t('sidebar.expandSection') : t('sidebar.collapseSection')}
        aria-expanded={!collapsed}
      >
        <Chevron open={!collapsed} />
        <span
          className={`min-w-0 flex-1 truncate text-[10px] font-semibold tracking-wider uppercase ${
            meta.tinted ? 'text-warning' : 'text-subtle'
          }`}
        >
          {meta.icon} {t(meta.titleKey)}
        </span>
        {collapsed && count !== undefined && (
          <span className={`shrink-0 text-[10px] ${meta.tinted ? 'text-warning/70' : 'text-subtle'}`}>{count}</span>
        )}
      </button>
      {!collapsed && children}
    </div>
  )
}

function openAppModal(kind: AppModal): void {
  useUiStore.getState().setModal(kind)
}

/** Một dòng host trong sidebar (dùng chung cho mục Yêu thích lẫn các group). */
function HostRow({
  host,
  color,
  onEdit,
  onNotes
}: {
  host: HostDto
  /** Màu nhận diện group (viền trái) — null = không tô. */
  color?: string | null
  onEdit: (host: HostDto, duplicate?: boolean) => void
  onNotes: (host: HostDto) => void
}) {
  const t = useT()
  const openSsh = useTabsStore((s) => s.openSsh)
  const splitSsh = useTabsStore((s) => s.splitSsh)
  const openSftp = useTabsStore((s) => s.openSftp)
  const openVnc = useTabsStore((s) => s.openVnc)
  const openRdp = useRdpStore((s) => s.open)
  const favorite = useFavoritesStore((s) => s.ids.includes(host.id))
  const toggleFav = useFavoritesStore((s) => s.toggle)
  // F39: trạng thái watcher nền (chấm xanh/đỏ) — undefined khi watcher tắt/chưa check
  const watch = useWatcherStore((s) => s.statuses[host.id])
  const isRemoteDesktop = host.protocol === 'vnc' || host.protocol === 'rdp'
  const openHost = (): void => {
    if (host.protocol === 'vnc') void openVnc(host.id)
    else if (host.protocol === 'rdp') void openRdp(host.id)
    else void openSsh(host.id)
  }
  const dotClass =
    watch === undefined
      ? 'bg-subtle group-hover:bg-success'
      : watch.ok
        ? 'bg-success'
        : 'bg-danger'
  return (
    <div
      className="group hover:bg-hover flex cursor-pointer items-center gap-2 rounded px-2 py-1.5"
      style={color ? { boxShadow: `inset 2px 0 0 ${color}` } : undefined}
      onClick={openHost}
      title={`${host.username ?? '(group)'}@${host.hostname}:${host.port}${host.jumpChain?.length ? ` (qua ${host.jumpChain.length} jump)` : ''}${
        watch ? `\n${watch.ok ? `✓ ${t('watcher.up', { ms: watch.latencyMs ?? 0 })}` : `✗ ${t('watcher.down')}`}` : ''
      }`}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${dotClass}`} />
      <div className="min-w-0 flex-1">
        <div className="text-content truncate text-xs">
          {host.label}
          {host.jumpChain?.length ? <span className="text-warning/80 ml-1 text-[9px]">⛓{host.jumpChain.length}</span> : null}
        </div>
        <div className="text-subtle truncate text-[10px]">
          {host.username ? `${host.username}@` : ''}
          {host.hostname}
        </div>
      </div>
      {/* Host được ghim: sao vàng hiện thường trực (chỉ báo), không chiếm chỗ nhóm hover */}
      {favorite && (
        <button
          className="text-warning hover:bg-edge-strong shrink-0 rounded p-1"
          title={t('sidebar.unfavorite')}
          onClick={(e) => {
            e.stopPropagation()
            toggleFav(host.id)
          }}
        >
          <StarIcon filled />
        </button>
      )}
      {/* Nhóm nút hành động: ẩn HẲN khi không hover (hidden) → tên host có đủ chỗ hiện full;
          chỉ hiện (flex) khi hover. Ghi chú cũng nằm trong đây → chỉ lộ khi hover. */}
      <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
        {!favorite && (
          <button
            className="text-subtle hover:bg-edge-strong hover:text-warning rounded p-1"
            title={t('sidebar.favorite')}
            onClick={(e) => {
              e.stopPropagation()
              toggleFav(host.id)
            }}
          >
            <StarIcon filled={false} />
          </button>
        )}
        {host.notes && (
          <button
            className="text-muted hover:bg-edge-strong hover:text-content rounded p-1"
            title={t('sidebar.viewNotes')}
            onClick={(e) => {
              e.stopPropagation()
              onNotes(host)
            }}
          >
            <NoteIcon />
          </button>
        )}
        {isRemoteDesktop ? (
          <button
            className="text-subtle hover:bg-edge-strong hover:text-content rounded p-1 text-xs"
            title={host.protocol === 'vnc' ? t('sidebar.openVnc') : t('sidebar.openRdp')}
            onClick={(e) => {
              e.stopPropagation()
              openHost()
            }}
          >
            🖥️
          </button>
        ) : (
          <>
            <button
              className="text-subtle hover:bg-edge-strong hover:text-warning rounded p-1"
              title={t('sidebar.splitHost')}
              onClick={(e) => {
                e.stopPropagation()
                void splitSsh(host.id)
              }}
            >
              <SplitIcon />
            </button>
            <button
              className="text-subtle hover:bg-edge-strong hover:text-content rounded p-1"
              title={t('sidebar.openSftp')}
              onClick={(e) => {
                e.stopPropagation()
                void openSftp(host.id)
              }}
            >
              <FolderIcon />
            </button>
          </>
        )}
        <button
          className="text-subtle hover:bg-edge-strong hover:text-content rounded p-1"
          title={t('sidebar.duplicateHost')}
          onClick={(e) => {
            e.stopPropagation()
            onEdit(host, true)
          }}
        >
          <CopyIcon />
        </button>
        <button
          className="text-subtle hover:bg-edge-strong hover:text-content rounded p-1"
          title={t('sidebar.editHost')}
          onClick={(e) => {
            e.stopPropagation()
            onEdit(host)
          }}
        >
          <PencilIcon />
        </button>
      </div>
    </div>
  )
}
