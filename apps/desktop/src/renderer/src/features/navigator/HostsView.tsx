import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { filterHosts, groupHostSections, type GroupDto, type HostDto } from '@infra/shared'
import { useDataStore } from '../../stores/data'
import { useFavoritesStore } from '../../stores/favorites'
import { useRdpStore } from '../../stores/rdp'
import { useTabsStore } from '../../stores/tabs'
import { useToastsStore } from '../../stores/toasts'
import { useUiStore } from '../../stores/ui'
import { useWatcherStore } from '../../stores/watcher'
import { Button, ConfirmModal } from '../../components/ui'
import { GroupMenuButton } from '../../components/GroupMenuButton'
import { CopyIcon, FolderIcon, NoteIcon, PencilIcon, SplitIcon, StarIcon } from '../../components/icons'
import { GroupEditorModal } from '../../components/GroupEditorModal'
import { HostEditorModal } from '../../components/HostEditorModal'
import { NotesModal } from '../../components/NotesModal'
import { useT } from '../../i18n'

// Giống Sidebar/Dashboard: user@host hoặc user@host:port thì coi là quick-connect target
const QUICK_PATTERN = /^[^@\s]+@[^@\s]+$/
const QUICK_PORT_PATTERN = /^[^@\s]+@.+:\d+$/

/** Editor mở từ trang này — cùng bộ với Sidebar (host / group / ghi chú), vì đây là "danh bạ" thứ hai. */
type Editor =
  | { kind: 'host'; host: HostDto | null; duplicate?: boolean; groupId?: string | null }
  | { kind: 'group'; group: GroupDto | null }
  | { kind: 'notes'; host: HostDto }
  | null

/**
 * Trang **Hosts** của theme Navigator — danh bạ host hiện ở VÙNG CHÍNH thay cho cột trái.
 *
 * Đây là điều user yêu cầu cụ thể: "bên left menu có mục Hosts, bấm vô sẽ hiện list group host
 * và list host bên giao diện chính". Bố cục theo Termius:
 *
 *  · **gốc** — ★ Yêu thích (hàng host) → **Nhóm** (card kiểu thư mục, bấm là vào trong) →
 *    **Tất cả host** (mọi host, phẳng, xếp theo tên, mỗi hàng ghi tên nhóm);
 *  · **trong một nhóm** — breadcrumb ← quay lại, header nhóm (màu, tên, số host, user mặc định,
 *    mở cả nhóm, `⋯` sửa/xoá) và danh sách host của nó;
 *  · **đang tìm** — bỏ card, liệt kê PHẲNG mọi host khớp, chia theo tên nhóm, để một kết quả
 *    không bao giờ nằm khuất trong một thư mục.
 *
 * Việc lọc/gom là hàm thuần `filterHosts` / `groupHostSections` dùng chung với Sidebar của theme
 * Infra — hai theme không bao giờ lệch nhau về "host này thuộc nhóm nào".
 *
 * Giữ mounted (ẩn bằng `hidden`) như các view khác: đang xem một nhóm rồi mở host, quay về vẫn
 * đứng đúng nhóm đó — người mở lần lượt nhiều máy không phải đi lại từ gốc mỗi lần.
 */
export function HostsView({ active }: { active: boolean }) {
  const t = useT()
  const { hosts, groups, deleteGroup, refreshAll } = useDataStore()
  const { openSsh, openQuick, openSshGroup } = useTabsStore()
  const favIds = useFavoritesStore((s) => s.ids)
  const setModal = useUiStore((s) => s.setModal)
  const [query, setQuery] = useState('')
  /** Nhóm đang xem (null = gốc). Lưu id: nhóm bị xoá trong lúc xem thì tự về gốc. */
  const [viewGroupId, setViewGroupId] = useState<string | null>(null)
  const [editor, setEditor] = useState<Editor>(null)
  const [deletingGroup, setDeletingGroup] = useState<GroupDto | null>(null)
  /** Card/header nhóm đang mở menu `⋯` — chỉ MỘT tại một thời điểm. */
  const [menuGroupId, setMenuGroupId] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)

  const searching = query.trim() !== ''
  const isQuick = QUICK_PATTERN.test(query.trim()) || QUICK_PORT_PATTERN.test(query.trim())
  const filtered = useMemo(() => filterHosts(hosts, query), [hosts, query])
  // Không tìm → hiện cả nhóm rỗng (để sửa/xoá được); đang tìm → chỉ nhóm có host khớp
  const sections = useMemo(() => groupHostSections(groups, filtered, !searching), [groups, filtered, searching])
  const favHosts = useMemo(() => filtered.filter((h) => favIds.includes(h.id)), [filtered, favIds])
  /**
   * MỌI host, một danh sách phẳng xếp theo tên (numeric: `app-2` trước `app-10`) — user yêu cầu sau
   * khi dùng thử: dưới card nhóm chỉ có vài host chưa phân nhóm nên nửa dưới trang bỏ trống, trong
   * khi "một danh sách đủ mọi máy" là thứ hay cần đúng lúc không nhớ máy nằm nhóm nào. Mỗi hàng vẫn
   * mang màu + tên nhóm nên không mất thông tin nhóm, chỉ bỏ việc phải đi vào từng thư mục.
   */
  const allHosts = useMemo(
    () => [...hosts].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })),
    [hosts]
  )
  const viewGroup = viewGroupId ? (groups.find((g) => g.id === viewGroupId) ?? null) : null
  const groupName = (id: string | null): string | undefined => groups.find((g) => g.id === id)?.name
  const groupColor = (id: string | null): string | null => groups.find((g) => g.id === id)?.color ?? null

  // Nhóm đang xem vừa bị xoá (ở đây hoặc qua sync) → về gốc, đừng đứng trên một trang trống
  useEffect(() => {
    if (viewGroupId && !viewGroup) setViewGroupId(null)
  }, [viewGroupId, viewGroup])

  useEffect(() => {
    if (!moreOpen) return
    const onClickOutside = (event: MouseEvent): void => {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) setMoreOpen(false)
    }
    window.addEventListener('mousedown', onClickOutside)
    return () => window.removeEventListener('mousedown', onClickOutside)
  }, [moreOpen])

  const connectQuick = (): void => {
    if (!isQuick) return
    void openQuick(query.trim())
    setQuery('')
  }

  const runImport = async (): Promise<void> => {
    const result = await window.infra.importer.sshConfig()
    if (!result) return
    await refreshAll()
    const push = useToastsStore.getState().push
    push(`Đã import ${result.hostsImported} hosts, ${result.keysImported} keys vào group "${result.groupName}"`, 'info')
    for (const warning of result.warnings.slice(0, 3)) push(warning)
  }

  const openHostEditor = (host: HostDto, duplicate = false): void => setEditor({ kind: 'host', host, duplicate })
  const openNotes = (host: HostDto): void => setEditor({ kind: 'notes', host })
  const addHost = (groupId: string | null = viewGroupId): void => setEditor({ kind: 'host', host: null, groupId })

  const nothingAtAll = hosts.length === 0 && groups.length === 0

  return (
    <div className={`absolute inset-0 flex flex-col ${active ? '' : 'hidden'}`}>
      {/* Header: tên trang + số host, ô tìm/kết nối nhanh, + Host, + Nhóm, ⋯ nhập/xuất */}
      <div className="border-edge bg-panel flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
        <span className="text-content text-sm font-medium">🖥 {t('hosts.title')}</span>
        <span className="text-subtle text-[11px]">{t('dashboard.groupHosts', { n: hosts.length })}</span>
        <div className="relative ml-auto">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              if (isQuick) connectQuick()
              else if (filtered.length === 1) void openSsh(filtered[0]!.id)
            }}
            placeholder={t('sidebar.searchPlaceholder')}
            aria-label={t('sidebar.searchPlaceholder')}
            className="border-edge bg-input text-content placeholder-subtle focus:border-accent w-56 rounded border px-2.5 py-1.5 text-xs outline-none sm:w-80"
          />
          {isQuick && (
            <button
              className="border-accent/40 bg-elevated text-accent-fg hover:bg-accent-soft/60 absolute top-full right-0 left-0 z-20 mt-1 flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-left text-xs shadow-lg"
              onClick={connectQuick}
            >
              <span className="text-accent">→</span>
              <span className="truncate">{t('sidebar.connectTo', { target: query.trim() })}</span>
            </button>
          )}
        </div>
        <Button variant="primary" className="!py-1 !text-xs" onClick={() => addHost()}>
          {t('sidebar.addHost')}
        </Button>
        <Button className="!py-1 !text-xs" onClick={() => setEditor({ kind: 'group', group: null })}>
          {t('hosts.newGroup')}
        </Button>
        <div className="relative" ref={moreRef}>
          <Button className="!px-2 !py-1 !text-xs" title={t('hosts.moreActions')} onClick={() => setMoreOpen((v) => !v)}>
            ⋯
          </Button>
          {moreOpen && (
            <div className="border-edge-strong bg-elevated absolute top-full right-0 z-50 mt-1 min-w-52 rounded-md border py-1 shadow-xl">
              <MoreItem label={t('menu.import')} onClick={() => void runImport()} close={() => setMoreOpen(false)} />
              <MoreItem label={t('menu.doImport')} onClick={() => setModal('do-import')} close={() => setMoreOpen(false)} />
              <MoreItem label={t('menu.clientImport')} onClick={() => setModal('client-import')} close={() => setMoreOpen(false)} />
              <MoreItem label={t('menu.export')} onClick={() => setModal('export-hosts')} close={() => setMoreOpen(false)} />
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-[1400px] space-y-5">
          {nothingAtAll ? (
            <div className="border-edge bg-panel rounded-md border px-6 py-12 text-center">
              <div className="text-4xl">🖥</div>
              <p className="text-content mt-2 text-sm font-medium">{t('sidebar.empty')}</p>
              <p className="text-subtle mt-1 text-xs">{t('hosts.emptyHint')}</p>
              <div className="mt-4 flex justify-center gap-2">
                <Button variant="primary" className="!text-xs" onClick={() => addHost(null)}>
                  {t('sidebar.addHost')}
                </Button>
                <Button className="!text-xs" onClick={() => void runImport()}>
                  {t('menu.import')}
                </Button>
              </div>
            </div>
          ) : searching ? (
            /* ── Đang tìm: liệt kê phẳng, chia theo nhóm ── */
            sections.length === 0 ? (
              <p className="text-subtle py-10 text-center text-xs">{t('hosts.noMatch', { q: query.trim() })}</p>
            ) : (
              sections.map((section) => (
                <section key={section.group?.id ?? '__ungrouped__'}>
                  <SectionTitle color={section.group?.color ?? null}>
                    {section.group?.name ?? t('hosts.ungrouped')}
                    <span className="text-subtle ml-1.5 font-normal normal-case">
                      {t('dashboard.groupHosts', { n: section.hosts.length })}
                    </span>
                  </SectionTitle>
                  <HostList
                    hosts={section.hosts}
                    color={section.group?.color ?? null}
                    onEdit={openHostEditor}
                    onNotes={openNotes}
                  />
                </section>
              ))
            )
          ) : viewGroup ? (
            /* ── Trong một nhóm ── */
            <GroupDetail
              group={viewGroup}
              hosts={hosts.filter((h) => h.groupId === viewGroup.id)}
              menuOpen={menuGroupId === viewGroup.id}
              onToggleMenu={() => setMenuGroupId((cur) => (cur === viewGroup.id ? null : viewGroup.id))}
              onBack={() => setViewGroupId(null)}
              onAddHost={() => addHost(viewGroup.id)}
              onEdit={() => setEditor({ kind: 'group', group: viewGroup })}
              onDelete={() => setDeletingGroup(viewGroup)}
              onEditHost={openHostEditor}
              onNotes={openNotes}
            />
          ) : (
            /* ── Gốc: Yêu thích → Nhóm → chưa phân nhóm ── */
            <>
              {favHosts.length > 0 && (
                <section>
                  <SectionTitle tone="text-warning">★ {t('sidebar.favorites')}</SectionTitle>
                  <HostList
                    hosts={favHosts}
                    color={null}
                    colorOf={(h) => groupColor(h.groupId)}
                    groupOf={(h) => groupName(h.groupId)}
                    onEdit={openHostEditor}
                    onNotes={openNotes}
                  />
                </section>
              )}

              {groups.length > 0 && (
                <section>
                  <SectionTitle>
                    {t('hosts.groupsHeading')}
                    <span className="text-subtle ml-1.5 font-normal normal-case">{groups.length}</span>
                  </SectionTitle>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                    {groups.map((group) => {
                      const members = hosts.filter((h) => h.groupId === group.id)
                      return (
                        <GroupCard
                          key={group.id}
                          group={group}
                          hosts={members}
                          menuOpen={menuGroupId === group.id}
                          onToggleMenu={() => setMenuGroupId((cur) => (cur === group.id ? null : group.id))}
                          onOpen={() => setViewGroupId(group.id)}
                          onOpenAll={members.length > 1 ? () => void openSshGroup(members.map((h) => h.id)) : undefined}
                          onEdit={() => setEditor({ kind: 'group', group })}
                          onDelete={() => setDeletingGroup(group)}
                        />
                      )
                    })}
                  </div>
                </section>
              )}

              {hosts.length > 0 && (
                <section>
                  <SectionTitle>
                    {t('hosts.allHosts')}
                    <span className="text-subtle ml-1.5 font-normal normal-case">
                      {t('dashboard.groupHosts', { n: hosts.length })}
                    </span>
                  </SectionTitle>
                  <HostList
                    hosts={allHosts}
                    color={null}
                    colorOf={(h) => groupColor(h.groupId)}
                    groupOf={(h) => groupName(h.groupId)}
                    onEdit={openHostEditor}
                    onNotes={openNotes}
                  />
                </section>
              )}
            </>
          )}
        </div>
      </div>

      {editor?.kind === 'host' && (
        <HostEditorModal
          host={editor.host}
          duplicate={editor.duplicate}
          defaultGroupId={editor.groupId ?? null}
          onClose={() => setEditor(null)}
        />
      )}
      {editor?.kind === 'group' && <GroupEditorModal group={editor.group} onClose={() => setEditor(null)} />}
      {editor?.kind === 'notes' && (
        <NotesModal
          host={editor.host}
          onEdit={() => setEditor({ kind: 'host', host: editor.host })}
          onClose={() => setEditor(null)}
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
}

function MoreItem({ label, onClick, close }: { readonly label: string; readonly onClick: () => void; readonly close: () => void }) {
  return (
    <button
      className="text-muted hover:bg-hover hover:text-content block w-full px-3 py-1.5 text-left text-xs whitespace-nowrap"
      onClick={() => {
        close()
        onClick()
      }}
    >
      {label}
    </button>
  )
}

/** Tiêu đề một mục trên trang — cùng kiểu chữ nhỏ in hoa với các mục Dashboard. */
function SectionTitle({
  children,
  color,
  tone = 'text-subtle'
}: {
  readonly children: ReactNode
  /** Chấm màu nhóm trước tiêu đề (kết quả tìm kiếm) — null/undefined = không có. */
  readonly color?: string | null
  readonly tone?: string
}) {
  return (
    <h2 className={`mb-2 flex items-center gap-1.5 text-[10px] font-semibold tracking-wider uppercase ${tone}`}>
      {color && <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
      <span className="min-w-0 truncate">{children}</span>
    </h2>
  )
}

/**
 * Card một nhóm — kiểu THƯ MỤC: bấm vào là đi vào trong xem host. Khác card nhóm trên Dashboard
 * (bấm chip là mở host ngay): ở trang danh bạ, đi vào rồi mới chọn là cách đọc tự nhiên hơn,
 * và nó giữ được đúng ẩn dụ "menu không sổ ra trong cột, nội dung mở ở vùng chính".
 */
function GroupCard({
  group,
  hosts,
  menuOpen,
  onToggleMenu,
  onOpen,
  onOpenAll,
  onEdit,
  onDelete
}: {
  readonly group: GroupDto
  readonly hosts: HostDto[]
  readonly menuOpen: boolean
  readonly onToggleMenu: () => void
  readonly onOpen: () => void
  readonly onOpenAll?: () => void
  readonly onEdit: () => void
  readonly onDelete: () => void
}) {
  const t = useT()
  const watcherEnabled = useWatcherStore((s) => s.enabled)
  const statuses = useWatcherStore((s) => s.statuses)
  // Chỉ tính trên host ĐÃ có kết quả check — watcher mới bật thì "0/5 sống" là nói sai
  const checked = hosts.filter((h) => statuses[h.id] !== undefined)
  const up = checked.filter((h) => statuses[h.id]?.ok).length
  const showUptime = watcherEnabled && checked.length > 0

  return (
    // <div role=button> chứ KHÔNG phải <button>: bên trong còn nút `⋯` (button lồng button là HTML sai)
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      title={t('dashboard.groupShowHosts', { name: group.name })}
      // ⚠️ KHÔNG `overflow-hidden` ở đây dù card Dashboard có: menu `⋯` neo absolute BÊN TRONG card,
      // overflow-hidden sẽ cắt nó còn đúng một dòng (đã dính — thấy được nhờ chụp màn hình). Dải màu
      // tự bo góc trái (`rounded-l-md` = cùng bán kính với card) nên không cần card cắt cho nó.
      className="group/header border-edge-strong bg-elevated hover:border-accent/60 relative flex cursor-pointer flex-col gap-1.5 rounded-md border py-3 pr-3 pl-4 text-left"
    >
      {/* Dải màu chạy hết chiều cao — tín hiệu "đây là một nhóm" như card trên Dashboard */}
      <span
        className="absolute inset-y-0 left-0 w-1.5 rounded-l-md"
        style={{ background: group.color ?? 'var(--c-edge-strong)' }}
      />
      <div className="flex items-center gap-2">
        <span className="text-subtle shrink-0 text-base leading-none">📁</span>
        <span className="text-content min-w-0 flex-1 truncate text-sm font-semibold">{group.name}</span>
        {group.production && (
          <span className="bg-danger/15 text-danger shrink-0 rounded px-1 py-px text-[9px] font-semibold tracking-wider">
            {t('hosts.production')}
          </span>
        )}
        <GroupMenuButton
          open={menuOpen}
          onToggle={onToggleMenu}
          onOpenAll={onOpenAll}
          hostCount={hosts.length}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
      <div className="text-subtle flex flex-wrap items-center gap-x-2 text-[11px]">
        <span>{t('dashboard.groupHosts', { n: hosts.length })}</span>
        {showUptime && (
          <span className={up === checked.length ? '' : 'text-warning'}>
            · {t('dashboard.groupUp', { up, n: checked.length })}
          </span>
        )}
        {group.username && <span className="truncate">· {group.username}</span>}
      </div>
    </div>
  )
}

/** Trang trong một nhóm: breadcrumb + header nhóm + danh sách host. */
function GroupDetail({
  group,
  hosts,
  menuOpen,
  onToggleMenu,
  onBack,
  onAddHost,
  onEdit,
  onDelete,
  onEditHost,
  onNotes
}: {
  readonly group: GroupDto
  readonly hosts: HostDto[]
  readonly menuOpen: boolean
  readonly onToggleMenu: () => void
  readonly onBack: () => void
  readonly onAddHost: () => void
  readonly onEdit: () => void
  readonly onDelete: () => void
  readonly onEditHost: (host: HostDto, duplicate?: boolean) => void
  readonly onNotes: (host: HostDto) => void
}) {
  const t = useT()
  const openSshGroup = useTabsStore((s) => s.openSshGroup)
  return (
    <section>
      <div className="group/header mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="border-edge text-muted hover:bg-hover hover:text-content shrink-0 rounded border px-2 py-1 text-xs"
        >
          ← {t('hosts.title')}
        </button>
        <span className="size-2.5 shrink-0 rounded-sm" style={{ background: group.color ?? 'var(--c-edge-strong)' }} />
        <span className="text-content min-w-0 truncate text-sm font-semibold">{group.name}</span>
        <span className="text-subtle text-[11px]">{t('dashboard.groupHosts', { n: hosts.length })}</span>
        {group.username && <span className="text-subtle truncate text-[11px]">· {group.username}</span>}
        {group.production && (
          <span className="bg-danger/15 text-danger shrink-0 rounded px-1 py-px text-[9px] font-semibold tracking-wider">
            {t('hosts.production')}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {hosts.length > 1 && (
            <Button
              variant="primary"
              className="!px-2.5 !py-1 !text-xs"
              title={t('sidebar.openGroup', { n: hosts.length })}
              onClick={() => void openSshGroup(hosts.map((h) => h.id))}
            >
              ⊞ {t('dashboard.groupOpenPanes', { n: hosts.length })}
            </Button>
          )}
          <Button className="!py-1 !text-xs" onClick={onAddHost}>
            {t('sidebar.addHost')}
          </Button>
          <GroupMenuButton
            open={menuOpen}
            onToggle={onToggleMenu}
            hostCount={hosts.length}
            onEdit={onEdit}
            onDelete={onDelete}
            alwaysVisible
          />
        </div>
      </div>
      {hosts.length === 0 ? (
        <div className="border-edge bg-panel rounded-md border px-6 py-10 text-center">
          <p className="text-subtle text-xs">{t('group.empty')}</p>
          <Button variant="primary" className="mt-3 !text-xs" onClick={onAddHost}>
            {t('sidebar.addHost')}
          </Button>
        </div>
      ) : (
        <HostList hosts={hosts} color={group.color} onEdit={onEditHost} onNotes={onNotes} />
      )}
    </section>
  )
}

/** Danh sách host dạng hàng rộng — 1 cột hẹp, 2 cột từ `xl`. */
function HostList({
  hosts,
  color,
  colorOf,
  groupOf,
  onEdit,
  onNotes
}: {
  readonly hosts: HostDto[]
  /** Màu viền trái cho MỌI hàng (đang ở trong một nhóm) — null = lấy theo `colorOf`. */
  readonly color: string | null
  /** Màu theo từng host (mục Yêu thích trộn nhiều nhóm). */
  readonly colorOf?: (host: HostDto) => string | null
  /** Tên nhóm hiện bên phải hàng (mục Yêu thích) — undefined = không hiện. */
  readonly groupOf?: (host: HostDto) => string | undefined
  readonly onEdit: (host: HostDto, duplicate?: boolean) => void
  readonly onNotes: (host: HostDto) => void
}) {
  return (
    <div className="grid gap-1.5 xl:grid-cols-2">
      {hosts.map((host) => (
        <HostRow
          key={host.id}
          host={host}
          color={color ?? colorOf?.(host) ?? null}
          groupName={groupOf?.(host)}
          onEdit={onEdit}
          onNotes={onNotes}
        />
      ))}
    </div>
  )
}

/**
 * Một hàng host ở vùng chính — cùng bộ hành động với hàng host trong Sidebar (ghim, ghi chú,
 * split/SFTP hoặc 🖥, nhân bản, sửa) nhưng rộng hơn: một dòng cho tên + nhãn, một dòng địa chỉ.
 * Nút hành động ẩn bằng `opacity` chứ không `hidden` để chiều cao hàng không nhảy khi hover.
 */
function HostRow({
  host,
  color,
  groupName,
  onEdit,
  onNotes
}: {
  readonly host: HostDto
  readonly color: string | null
  readonly groupName?: string
  readonly onEdit: (host: HostDto, duplicate?: boolean) => void
  readonly onNotes: (host: HostDto) => void
}) {
  const t = useT()
  const openSsh = useTabsStore((s) => s.openSsh)
  const splitSsh = useTabsStore((s) => s.splitSsh)
  const openSftp = useTabsStore((s) => s.openSftp)
  const openVnc = useTabsStore((s) => s.openVnc)
  const openRdp = useRdpStore((s) => s.open)
  const favorite = useFavoritesStore((s) => s.ids.includes(host.id))
  const toggleFav = useFavoritesStore((s) => s.toggle)
  const watch = useWatcherStore((s) => s.statuses[host.id])
  const isRemoteDesktop = host.protocol === 'vnc' || host.protocol === 'rdp'

  const openHost = (): void => {
    if (host.protocol === 'vnc') void openVnc(host.id)
    else if (host.protocol === 'rdp') void openRdp(host.id)
    else void openSsh(host.id)
  }
  // Chưa có kết quả check (watcher tắt / mới bật) = CHƯA BIẾT → xám, không tô đỏ
  const dot = watch === undefined ? 'bg-edge-strong group-hover:bg-success' : watch.ok ? 'bg-success' : 'bg-danger'

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    fn()
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className="group border-edge bg-panel hover:bg-hover flex cursor-pointer items-center gap-3 rounded border px-3 py-2"
      style={color ? { boxShadow: `inset 3px 0 0 ${color}` } : undefined}
      onClick={openHost}
      onKeyDown={(e) => {
        if (e.key === 'Enter') openHost()
      }}
      title={`${host.username ?? '(group)'}@${host.hostname}:${host.port}${
        host.jumpChain?.length ? ` (qua ${host.jumpChain.length} jump)` : ''
      }${watch ? `\n${watch.ok ? `✓ ${t('watcher.up', { ms: watch.latencyMs ?? 0 })}` : `✗ ${t('watcher.down')}`}` : ''}`}
    >
      <span className={`size-2 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <div className="text-content flex items-center gap-1.5 text-xs font-medium">
          <span className="truncate">{host.label}</span>
          {favorite && <span className="text-warning shrink-0 text-[10px]">★</span>}
          {host.protocol !== 'ssh' && (
            <span className="border-edge-strong text-subtle shrink-0 rounded border px-1 text-[9px] font-semibold tracking-wider uppercase">
              {host.protocol}
            </span>
          )}
          {host.jumpChain?.length ? (
            <span className="text-warning/80 shrink-0 text-[9px]">⛓{host.jumpChain.length}</span>
          ) : null}
        </div>
        <div className="text-subtle truncate font-mono text-[10px]">
          {host.username ? `${host.username}@` : ''}
          {host.hostname}
          {host.port !== 22 ? `:${host.port}` : ''}
        </div>
      </div>
      {groupName && <span className="text-subtle hidden shrink-0 text-[10px] sm:inline">{groupName}</span>}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <button
          className={`hover:bg-edge-strong rounded p-1 ${favorite ? 'text-warning' : 'text-subtle hover:text-warning'}`}
          title={favorite ? t('sidebar.unfavorite') : t('sidebar.favorite')}
          onClick={stop(() => toggleFav(host.id))}
        >
          <StarIcon filled={favorite} />
        </button>
        {host.notes && (
          <button
            className="text-muted hover:bg-edge-strong hover:text-content rounded p-1"
            title={t('sidebar.viewNotes')}
            onClick={stop(() => onNotes(host))}
          >
            <NoteIcon />
          </button>
        )}
        {isRemoteDesktop ? (
          <button
            className="text-subtle hover:bg-edge-strong hover:text-content rounded p-1 text-xs"
            title={host.protocol === 'vnc' ? t('sidebar.openVnc') : t('sidebar.openRdp')}
            onClick={stop(openHost)}
          >
            🖥️
          </button>
        ) : (
          <>
            <button
              className="text-subtle hover:bg-edge-strong hover:text-warning rounded p-1"
              title={t('sidebar.splitHost')}
              onClick={stop(() => void splitSsh(host.id))}
            >
              <SplitIcon />
            </button>
            <button
              className="text-subtle hover:bg-edge-strong hover:text-content rounded p-1"
              title={t('sidebar.openSftp')}
              onClick={stop(() => void openSftp(host.id))}
            >
              <FolderIcon />
            </button>
          </>
        )}
        <button
          className="text-subtle hover:bg-edge-strong hover:text-content rounded p-1"
          title={t('sidebar.duplicateHost')}
          onClick={stop(() => onEdit(host, true))}
        >
          <CopyIcon />
        </button>
        <button
          className="text-subtle hover:bg-edge-strong hover:text-content rounded p-1"
          title={t('sidebar.editHost')}
          onClick={stop(() => onEdit(host))}
        >
          <PencilIcon />
        </button>
      </div>
    </div>
  )
}
