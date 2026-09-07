import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  collectAttention,
  type AttentionKind,
  type GroupDto,
  type HostDto,
  type MetricHistoryHostDto,
  type MetricHistoryPointDto
} from '@infra/shared'
import type { WorkspaceTab } from '../../stores/tabs'
import { useDataStore } from '../../stores/data'
import { pinnedFirst, useFavoritesStore, useTunnelFavoritesStore } from '../../stores/favorites'
import { useMonitorStore } from '../../stores/monitor'
import { useSettingsStore } from '../../stores/settings'
import { useTabsStore } from '../../stores/tabs'
import { useUiStore } from '../../stores/ui'
import { useReplicationStore } from '../../stores/replication'
import { useWatcherStore } from '../../stores/watcher'
import { useWorkspacesStore } from '../../stores/workspaces'
import { Button } from '../../components/ui'
import { MetricChart } from '../../components/MetricsHistoryModal'
import { ToolGrid } from './ToolGrid'
import { GroupHostsPanel } from './GroupHostsPanel'
import { APP_SHORTCUTS, terminalShortcuts } from '../../lib/shortcutList'
import { useHttpChecksStore } from '../../stores/httpChecks'
import { useT } from '../../i18n'

const LOCALES = { vi: 'vi-VN', en: 'en-US', ja: 'ja-JP' } as const

/** Nhãn cho từng loại vấn đề trên dải "Cần chú ý". */
const ATTENTION_LABEL: Record<AttentionKind, 'dashboard.attHostDown' | 'dashboard.attTunnel' | 'dashboard.attRepl' | 'dashboard.attHttp'> = {
  'host-down': 'dashboard.attHostDown',
  'tunnel-error': 'dashboard.attTunnel',
  replication: 'dashboard.attRepl',
  'http-down': 'dashboard.attHttp'
}

// Giống Sidebar: user@host hoặc user@host:port thì coi là quick-connect target
const QUICK_PATTERN = /^[^@\s]+@[^@\s]+$/
const QUICK_PORT_PATTERN = /^[^@\s]+@.+:\d+$/

/** Thời điểm kết nối: hôm nay → giờ:phút, cũ hơn → ngày/tháng. */
function formatWhen(ts: number, locale: string): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (sameDay) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })
}

/** Tóm tắt workspace "n tab · n pane" — cùng cách tính với WorkspacesModal. */
function summarize(tabs: WorkspaceTab[], t: ReturnType<typeof useT>): string {
  const panes = tabs.reduce((n, tab) => n + (tab.kind === 'terminal' ? tab.panes.length : 0), 0)
  const sftp = tabs.filter((tab) => tab.kind === 'sftp').length
  const parts = [t('ws.summaryTabs', { n: tabs.length }), t('ws.summaryPanes', { n: panes })]
  if (sftp > 0) parts.push(t('ws.summarySftp', { n: sftp }))
  return parts.join(' · ')
}

/**
 * Trang Dashboard — màn hình home nằm dưới các tab (activeId=null), mở qua nút 🏠.
 * Đọc dữ liệu có sẵn ở renderer (hosts/history/favorites/tunnels/workspaces); riêng mục
 * "Lịch sử monitoring" query metrics.db qua IPC (chỉ khi Dashboard đang hiện).
 * Card dùng bg-panel: khi bật ảnh nền, --c-panel đã bán trong suốt.
 * Trạng thái realtime vẫn là việc của MonitorDock góc phải — ở đây chỉ có LỊCH SỬ.
 */
export function DashboardView({ active }: { active: boolean }) {
  const t = useT()
  const locale = LOCALES[useSettingsStore((s) => s.language)]
  const hosts = useDataStore((s) => s.hosts)
  const groups = useDataStore((s) => s.groups)
  const history = useDataStore((s) => s.history)
  const tunnels = useDataStore((s) => s.tunnels)
  const tunnelStates = useDataStore((s) => s.tunnelStates)
  const startTunnel = useDataStore((s) => s.startTunnel)
  const stopTunnel = useDataStore((s) => s.stopTunnel)
  const favIds = useFavoritesStore((s) => s.ids)
  const tunnelFavIds = useTunnelFavoritesStore((s) => s.ids)
  const workspaces = useWorkspacesStore((s) => s.workspaces)
  const openWorkspace = useWorkspacesStore((s) => s.open)
  const { openLocal, openSsh, openSshGroup, openQuick } = useTabsStore()
  const setModal = useUiStore((s) => s.setModal)
  const termShortcuts = useSettingsStore((s) => s.shortcuts)
  const [quick, setQuick] = useState('')
  /**
   * Nhóm đang xem danh sách host đầy đủ — hiện INLINE thay lưới card (không popup), có nút
   * quay lại. Lưu id chứ không lưu DTO: nhóm bị xoá/đổi trong lúc xem thì tự rơi về lưới card
   * thay vì hiện bản đã cũ.
   */
  const [viewGroupId, setViewGroupId] = useState<string | null>(null)

  const watcherEnabled = useWatcherStore((s) => s.enabled)
  const hostStatuses = useWatcherStore((s) => s.statuses)
  const replRuntime = useReplicationStore((s) => s.runtime)

  /**
   * Chỉ những slave có chẩn đoán mức `critical` mới lên dải: `warn` xuất hiện thường xuyên
   * (trễ nhấp nhô) và đưa hết vào thì dải lúc nào cũng đỏ, tức là hết tác dụng.
   */
  const replicaIssues = useMemo(
    () =>
      Object.values(replRuntime).flatMap((pair) =>
        Object.entries(pair.replicas).flatMap(([replicaId, entry]) => {
          const worst = entry.snapshot.diagnoses.find((d) => d.severity === 'critical')
          return worst ? [{ id: replicaId, label: entry.snapshot.sample.replicaLabel, detail: worst.title }] : []
        })
      ),
    [replRuntime]
  )

  // Theo dõi URL: check đang BÁO (fail liên tiếp đủ số lần) cũng lên dải "Cần chú ý"
  const httpChecks = useHttpChecksStore((s) => s.checks)
  const httpSummaries = useHttpChecksStore((s) => s.summaries)
  const attention = useMemo(
    () =>
      collectAttention({
        watcherEnabled,
        hosts,
        hostStatus: hostStatuses,
        tunnels,
        tunnelState: tunnelStates,
        replicaIssues,
        httpChecks,
        httpState: httpSummaries
      }),
    [watcherEnabled, hosts, hostStatuses, tunnels, tunnelStates, replicaIssues, httpChecks, httpSummaries]
  )

  // Cheat sheet: phím app (cố định) + 4 phím terminal theo đúng giá trị user đang đặt
  const shortcuts = useMemo(
    () => [...APP_SHORTCUTS, ...terminalShortcuts(termShortcuts)],
    [termShortcuts]
  )

  // History bị vault dedup theo target → số đếm = "số target khác nhau", đủ dùng cho tổng quan
  const stats = useMemo(() => {
    const now = Date.now()
    const midnight = new Date().setHours(0, 0, 0, 0)
    return {
      today: history.filter((h) => h.connectedAt >= midnight).length,
      week: history.filter((h) => h.connectedAt >= now - 7 * 86_400_000).length
    }
  }, [history])

  const favHosts = useMemo(() => hosts.filter((h) => favIds.includes(h.id)), [hosts, favIds])

  // Tunnel được ghim nổi lên đầu — cùng thứ tự với modal/tab Tunnels và cửa sổ tách rời
  const orderedTunnels = useMemo(() => pinnedFirst(tunnels, tunnelFavIds), [tunnels, tunnelFavIds])

  // Chip nhóm: chỉ nhóm có host; bấm mở cả nhóm thành các pane split trong 1 tab
  const groupChips = useMemo(
    () =>
      groups
        .map((g) => ({ group: g, hostIds: hosts.filter((h) => h.groupId === g.id).map((h) => h.id) }))
        .filter((x) => x.hostIds.length > 0),
    [groups, hosts]
  )

  const viewGroup = viewGroupId ? (groups.find((g) => g.id === viewGroupId) ?? null) : null

  const isQuick = QUICK_PATTERN.test(quick.trim()) || QUICK_PORT_PATTERN.test(quick.trim())

  const connectQuick = (): void => {
    if (!isQuick) return
    void openQuick(quick.trim())
    setQuick('')
  }

  return (
    <div className={`absolute inset-0 overflow-y-auto ${active ? '' : 'hidden'}`}>
      {/* Dashboard giờ chứa nhiều mục hơn (lưới công cụ, lịch sử monitoring, workspaces,
          tunnels) nên nới rộng hẳn khung; max-w vẫn có để trên màn siêu rộng không bị
          kéo thành những hàng dài quá tầm mắt. */}
      <div className="mx-auto w-full max-w-[1600px] space-y-5 p-6">
        {/* flex-wrap: cửa sổ hẹp thì khối phải xuống dòng chứ không tràn ra ngoài */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-content text-lg font-semibold">{t('dashboard.title')}</h1>
            <p className="text-subtle text-xs">
              {new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          {/* Kết nối nhanh nằm cùng hàng với "+ Terminal mới": cả hai đều là "mở một phiên
              mới", để chung một chỗ thì khỏi phải đi tìm. Gợi ý xác nhận thả xuống dạng
              absolute vì hàng header không còn chỗ cho một dòng nữa bên dưới. */}
          <div className="flex shrink-0 items-center gap-2">
            <div className="relative">
              <input
                value={quick}
                onChange={(e) => setQuick(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') connectQuick()
                }}
                placeholder={t('dashboard.quickPlaceholder')}
                aria-label={t('dashboard.quickConnect')}
                title={t('dashboard.quickConnect')}
                className="border-edge bg-input text-content placeholder-subtle focus:border-accent w-64 rounded border px-2.5 py-1.5 text-xs outline-none sm:w-80"
              />
              {isQuick && (
                <button
                  className="border-accent/40 bg-elevated text-accent-fg hover:bg-accent-soft/60 absolute top-full right-0 left-0 z-20 mt-1 flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-left text-xs shadow-lg"
                  onClick={connectQuick}
                >
                  <span className="text-accent">→</span>
                  <span className="truncate">{t('sidebar.connectTo', { target: quick.trim() })}</span>
                </button>
              )}
            </div>
            <button
              className="border-edge-strong text-content hover:bg-hover shrink-0 rounded border px-3 py-1.5 text-xs"
              onClick={() => void openLocal()}
            >
              {t('dashboard.newTerminal')}
            </button>
          </div>
        </div>

        {/* Dải "Cần chú ý" — CHỈ hiện khi thật sự có vấn đề, và khi đó phải là thứ đầu tiên
            đập vào mắt nên nằm TRÊN cả lưới công cụ. Luôn hiện một khối kể cả khi trống thì
            mắt sẽ học cách bỏ qua nó, và lúc có chuyện thật cũng không ai nhìn. */}
        {attention.length > 0 && (
          <section className="border-danger/50 bg-danger/10 rounded-md border px-3 py-2.5">
            <h2 className="text-danger mb-2 text-[10px] font-semibold tracking-wider uppercase">
              ⚠ {t('dashboard.attention', { n: attention.length })}
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {attention.map((item) => (
                <span
                  key={item.id}
                  className="border-danger/40 bg-app text-content rounded border px-2 py-1 text-[11px]"
                  title={item.detail}
                >
                  {t(ATTENTION_LABEL[item.kind])} <span className="font-medium">{item.label}</span>
                  {item.detail && <span className="text-subtle"> · {item.detail}</span>}
                </span>
              ))}
            </div>
          </section>
        )}

        <ToolGrid />

        {/* Nhóm host nằm NGAY DƯỚI lưới công cụ (user yêu cầu): đây là khu bấm-để-làm-việc,
            còn mấy ô số đếm chỉ là trang trí — không được chen vào giữa. Bấm "xem tất cả host"
            thì danh sách đầy đủ hiện INLINE ngay tại khu này (không popup), có nút quay lại. */}
        {groupChips.length > 0 && (
          <section>
            <h2 className="text-subtle mb-2 text-[10px] font-semibold tracking-wider uppercase">
              {t('dashboard.groups')}
            </h2>
            {viewGroup ? (
              <GroupHostsPanel
                group={viewGroup}
                hosts={hosts.filter((h) => h.groupId === viewGroup.id)}
                onBack={() => setViewGroupId(null)}
              />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {groupChips.map(({ group, hostIds }) => (
                  <GroupCard
                    key={group.id}
                    group={group}
                    hosts={hosts.filter((h) => h.groupId === group.id)}
                    onOpenAll={() => void openSshGroup(hostIds)}
                    onOpenHost={(hostId) => void openSsh(hostId)}
                    onShowHosts={() => setViewGroupId(group.id)}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* 4 ô số đếm giãn full chiều rộng cùng nhịp với lưới công cụ ở trên */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label={t('dashboard.stats.hosts')} value={hosts.length} />
          <StatTile label={t('dashboard.stats.groups')} value={groups.length} />
          <StatTile label={t('dashboard.stats.today')} value={stats.today} />
          <StatTile label={t('dashboard.stats.week')} value={stats.week} />
        </div>

        <section>
          <h2 className="text-subtle mb-2 text-[10px] font-semibold tracking-wider uppercase">
            ★ {t('dashboard.favorites')}
          </h2>
          {favHosts.length === 0 ? (
            <p className="text-subtle text-[11px]">{t('dashboard.noFavorites')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
              {favHosts.map((host) => (
                <button
                  key={host.id}
                  className="border-edge bg-panel hover:bg-hover rounded border p-3 text-left"
                  title={t('sidebar.connectTo', { target: host.label })}
                  onClick={() => void openSsh(host.id)}
                >
                  <div className="text-content truncate text-xs font-medium">
                    <span className="text-warning">★</span> {host.label}
                  </div>
                  <div className="text-subtle truncate text-[11px]">
                    {host.username ? `${host.username}@` : ''}
                    {host.hostname}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <MonitorHistorySection active={active} locale={locale} />

        {/* 4 mục dạng DANH SÁCH ở dưới: mỗi mục vẫn chiếm HẾT chiều rộng, nhưng danh sách
            BÊN TRONG tự chia 2 cột (xem TwoColumnList) — mỗi dòng chỉ dài vài chục ký tự
            nên một cột đơn kéo hết 1600px là bỏ trắng nửa phải. */}
        <section>
          <h2 className="text-subtle mb-2 text-[10px] font-semibold tracking-wider uppercase">
            {t('dashboard.recent')}
          </h2>
          {history.length === 0 ? (
            <p className="text-subtle text-[11px]">{t('dashboard.noRecent')}</p>
          ) : (
            <TwoColumnList items={history.slice(0, 10)}>
              {(entry) => (
                <button
                  key={entry.id}
                  className="text-muted hover:bg-hover hover:text-content flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px]"
                  onClick={() => {
                    if (entry.hostId) void openSsh(entry.hostId)
                    else void openQuick(entry.target.replace(/:22$/, ''))
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{entry.target}</span>
                  <span className="text-subtle shrink-0">{formatWhen(entry.connectedAt, locale)}</span>
                </button>
              )}
            </TwoColumnList>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-subtle text-[10px] font-semibold tracking-wider uppercase">
              🗂 {t('dashboard.workspaces')}
            </h2>
            <button className="text-accent text-[11px] hover:underline" onClick={() => setModal('workspaces')}>
              {t('dashboard.manage')}
            </button>
          </div>
          {workspaces.length === 0 ? (
            <p className="text-subtle text-[11px]">{t('dashboard.noWorkspaces')}</p>
          ) : (
            <TwoColumnList items={workspaces}>
              {(ws) => (
                <button
                  key={ws.id}
                  className="hover:bg-hover flex w-full items-center gap-2 px-3 py-1.5 text-left"
                  title={t('ws.open')}
                  onClick={() => openWorkspace(ws.id)}
                >
                  <span className="text-content min-w-0 flex-1 truncate text-xs">{ws.name}</span>
                  <span className="text-subtle shrink-0 text-[10px]">{summarize(ws.tabs, t)}</span>
                </button>
              )}
            </TwoColumnList>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-subtle text-[10px] font-semibold tracking-wider uppercase">
              🔀 {t('dashboard.tunnels')}
            </h2>
            <button className="text-accent text-[11px] hover:underline" onClick={() => setModal('tunnels')}>
              {t('dashboard.manage')}
            </button>
          </div>
          {tunnels.length === 0 ? (
            <p className="text-subtle text-[11px]">{t('dashboard.noTunnels')}</p>
          ) : (
            <TwoColumnList items={orderedTunnels}>
              {(rule) => {
                const state = tunnelStates[rule.id]?.status ?? 'stopped'
                const detail = tunnelStates[rule.id]?.detail
                const running = state === 'active' || state === 'starting'
                return (
                  <div
                    key={rule.id}
                    className="flex items-center gap-2 px-3 py-1.5"
                    title={state === 'error' && detail ? detail : undefined}
                  >
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${
                        state === 'active'
                          ? 'bg-success'
                          : state === 'starting'
                            ? 'bg-warning animate-pulse'
                            : state === 'error'
                              ? 'bg-danger'
                              : 'bg-edge-strong'
                      }`}
                    />
                    <span className="text-content min-w-0 flex-1 truncate text-xs">
                      {tunnelFavIds.includes(rule.id) && <span className="text-warning">★ </span>}
                      [{rule.type}] {rule.label || `:${rule.bindPort}`}
                    </span>
                    <Button
                      type="button"
                      variant={running ? 'default' : 'primary'}
                      className="!px-2 !py-0.5 !text-[11px]"
                      onClick={() => void (running ? stopTunnel(rule.id) : startTunnel(rule.id))}
                    >
                      {running ? t('tunnel.stop') : t('tunnel.start')}
                    </Button>
                  </div>
                )
              }}
            </TwoColumnList>
          )}
        </section>

        <section>
          <h2 className="text-subtle mb-2 text-[10px] font-semibold tracking-wider uppercase">
            ⌨ {t('dashboard.shortcuts')}
          </h2>
          <TwoColumnList items={shortcuts}>
            {(sc) => <ShortcutRow key={sc.key} label={t(sc.key)} keys={sc.combo} />}
          </TwoColumnList>
          <p className="text-subtle mt-1.5 text-[10px]">{t('dashboard.sc.mouseTip')}</p>
        </section>
      </div>
    </div>
  )
}

const MON_HISTORY_LIMIT = 6
const MON_REFRESH_MS = 60_000

/** Mục "Lịch sử monitoring": các host từng được monitor (dữ liệu metrics.db còn trong
 *  hạn giữ 30 ngày) + chart Load 24h thu gọn; bấm card mở modal lịch sử đầy đủ.
 *  Chỉ fetch khi Dashboard đang hiện (active) — tránh query nền vô ích. */
function MonitorHistorySection({ active, locale }: { active: boolean; locale: string }) {
  const t = useT()
  const hosts = useDataStore((s) => s.hosts)
  const [monHosts, setMonHosts] = useState<MetricHistoryHostDto[] | null>(null)
  const [charts, setCharts] = useState<Record<string, MetricHistoryPointDto[]>>({})

  useEffect(() => {
    if (!active) return
    let alive = true
    const load = async (): Promise<void> => {
      const list = (await window.infra.monitor.historyHosts()).slice(0, MON_HISTORY_LIMIT)
      if (!alive) return
      setMonHosts(list)
      const now = Date.now()
      // Chart Load 24h (bucket 10') từng host — tuần tự cho nhẹ (tối đa 6 query SQLite local)
      for (const h of list) {
        const points = await window.infra.monitor.queryHistory(h.hostId, now - 24 * 3_600_000, now, 10)
        if (!alive) return
        setCharts((prev) => ({ ...prev, [h.hostId]: points }))
      }
    }
    void load()
    const timer = setInterval(() => void load(), MON_REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [active])

  // Chưa từng monitor host nào → không chiếm chỗ trên Dashboard (khác danh sách rỗng do đang load)
  if (monHosts !== null && monHosts.length === 0) {
    return (
      <section>
        <h2 className="text-subtle mb-2 text-[10px] font-semibold tracking-wider uppercase">
          📈 {t('dashboard.monHistory')}
        </h2>
        <p className="text-subtle text-[11px]">{t('dashboard.noMonHistory')}</p>
      </section>
    )
  }

  return (
    <section>
      <h2 className="text-subtle mb-2 text-[10px] font-semibold tracking-wider uppercase">
        📈 {t('dashboard.monHistory')}
      </h2>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {(monHosts ?? []).map((mh) => {
          const label = hosts.find((h) => h.id === mh.hostId)?.label ?? `${mh.hostId.slice(0, 8)}…`
          const points = charts[mh.hostId]
          return (
            <button
              key={mh.hostId}
              className="border-edge bg-panel hover:bg-hover rounded border p-3 text-left"
              title={t('dashboard.monOpen')}
              onClick={() => useMonitorStore.getState().setHistoryHost(mh.hostId)}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-content min-w-0 truncate text-xs font-medium">{label}</span>
                <span className="text-subtle shrink-0 text-[10px]">
                  {t('dashboard.monLast', { when: formatWhen(mh.lastTs, locale) })}
                </span>
              </div>
              {points && points.length > 0 ? (
                <MetricChart
                  label={`Load 24h (${t('monitor.loadNorm')})`}
                  points={points}
                  field="loadPct"
                  resMs={600_000}
                  autoScale
                  compact
                />
              ) : (
                <div className="h-10" />
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** Một dòng cheat sheet — export để thẻ "Phím tắt" trong Trợ giúp dùng đúng cách trình bày này. */
export function ShortcutRow({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-1.5">
      <span className="text-muted min-w-0 truncate text-[11px]">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        {keys.map((k) => (
          <kbd
            key={k}
            className="border-edge-strong bg-input text-muted rounded border px-1 py-0.5 font-mono text-[10px] leading-none"
          >
            {k}
          </kbd>
        ))}
      </span>
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-edge bg-panel rounded border p-3">
      <div className="text-content text-lg font-semibold">{value}</div>
      <div className="text-subtle truncate text-[10px] tracking-wider uppercase">{label}</div>
    </div>
  )
}

/**
 * Khung danh sách chia 2 cột BÊN TRONG một mục.
 *
 * Cố ý là MỘT hộp có viền duy nhất với đường kẻ dọc ở giữa, không phải 2 hộp rời: 2 hộp
 * rời trông như 2 danh sách khác nhau, mà đây vẫn là một danh sách. Dưới `xl` thì về 1 cột
 * và `divide-y` nối 2 nửa lại thành một dải liên tục (đổi sang `divide-x` khi đủ rộng).
 */
function TwoColumnList<T>({ items, children }: { readonly items: readonly T[]; readonly children: (item: T) => ReactNode }) {
  // Nửa đầu nhận phần dư khi lẻ → đọc theo cột trái rồi sang cột phải
  const half = Math.ceil(items.length / 2)
  const chunks = items.length <= 1 ? [items] : [items.slice(0, half), items.slice(half)]
  return (
    <div className="border-edge bg-panel divide-edge/70 grid divide-y rounded border xl:grid-cols-2 xl:divide-x xl:divide-y-0">
      {chunks.map((chunk, i) => (
        <div key={i} className="divide-edge/70 min-w-0 divide-y">
          {chunk.map(children)}
        </div>
      ))}
    </div>
  )
}

/**
 * Số chip host tối đa trong card; dư ra thì gộp thành "+N" bấm được để mở danh sách đầy đủ.
 * Chip có tên nên rộng hơn chấm trạng thái cũ — 6 là mức card còn cao đều trong lưới 4 cột.
 */
const GROUP_PREVIEW_HOSTS = 6

/**
 * Card một nhóm host — BA vùng bấm riêng, mỗi vùng một việc:
 *  · tên nhóm + dòng chân "Xem tất cả host" → danh sách đầy đủ hiện INLINE tại khu nhóm
 *    ({@link GroupHostsPanel}), chỗ duy nhất xem được hết host khi nhóm đông hơn số chip vừa card;
 *  · từng chip host → mở LẺ đúng host đó;
 *  · chip `⊞ N` góc phải → mở CẢ nhóm thành các pane trong 1 tab.
 * (User đảo hai vùng cuối sau khi dùng thử: hành động "mở cả nhóm" xứng đáng nút gọn góc trên,
 * còn "xem danh sách" là dòng chữ đọc được ở chân card.)
 *
 * ⚠️ Vì thế card KHÔNG còn là một `<button>` bọc ngoài như trước: `<button>` lồng `<button>`
 * là HTML không hợp lệ và trình duyệt sẽ tự gỡ lồng, mất luôn nút con.
 */
function GroupCard({
  group,
  hosts,
  onOpenAll,
  onOpenHost,
  onShowHosts
}: {
  readonly group: GroupDto
  readonly hosts: HostDto[]
  readonly onOpenAll: () => void
  readonly onOpenHost: (hostId: string) => void
  readonly onShowHosts: () => void
}) {
  const t = useT()
  const watcherEnabled = useWatcherStore((s) => s.enabled)
  const statuses = useWatcherStore((s) => s.statuses)

  // Chỉ tính trên những host ĐÃ có kết quả check: watcher mới bật thì chưa ai có kết quả,
  // hiện "0/5 sống" lúc đó là nói sai.
  const checked = hosts.filter((h) => statuses[h.id] !== undefined)
  const up = checked.filter((h) => statuses[h.id]?.ok).length
  const showUptime = watcherEnabled && checked.length > 0
  const allUp = up === checked.length

  const preview = hosts.slice(0, GROUP_PREVIEW_HOSTS)
  const rest = hosts.length - preview.length

  return (
    <div className="border-edge-strong bg-elevated hover:border-accent/60 group relative flex w-full flex-col gap-1.5 overflow-hidden rounded-md border py-3 pr-3 pl-4 text-left">
      {/* Dải màu CHẠY HẾT chiều cao (không phải vạch nhỏ cạnh tên): đây là tín hiệu chính
          phân biệt "một nhóm" với card một host ở mục Yêu thích. Không đặt màu thì dùng
          màu viền cho vẫn thấy dải. */}
      <span
        className="absolute inset-y-0 left-0 w-1.5"
        style={{ background: group.color ?? 'var(--c-edge-strong)' }}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onShowHosts}
          title={t('dashboard.groupShowHosts', { name: group.name })}
          className="text-content hover:text-accent min-w-0 flex-1 truncate text-left text-sm font-semibold hover:underline"
        >
          {group.name}
        </button>
        {/* Số host thành CHIP: nói ngay "nhiều máy", thay vì lẫn trong dòng chữ nhỏ.
            Bấm là MỞ CẢ NHÓM thành các pane trong 1 tab — hành động chính của card. */}
        <button
          type="button"
          onClick={onOpenAll}
          title={t('sidebar.openGroup', { n: hosts.length })}
          className="border-edge bg-app text-muted hover:border-accent/60 hover:text-content shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-medium"
        >
          ⊞ {hosts.length}
        </button>
      </div>

      {(showUptime || group.username) && (
        <div className="flex items-center gap-2">
          {showUptime && (
            <span className={`text-[11px] ${allUp ? 'text-subtle' : 'text-warning'}`}>
              {t('dashboard.groupUp', { up, n: checked.length })}
            </span>
          )}
          {group.username && <span className="text-subtle truncate text-[11px]">{group.username}</span>}
        </div>
      )}

      {/* MỖI host một chip bấm được, kèm chấm trạng thái của CHÍNH nó. Trước đây là một dãy
          chấm vô danh + một chuỗi tên ghép bằng "·": nhìn thấy "có máy chết" nhưng không biết
          máy nào, và không mở lẻ được con nào. Chấm xám = chưa có kết quả check, KHÔNG phải chết. */}
      <div className="flex flex-wrap items-center gap-1">
        {preview.map((h) => {
          const st = statuses[h.id]
          const tone = !watcherEnabled || st === undefined ? 'bg-edge-strong' : st.ok ? 'bg-success' : 'bg-danger'
          return (
            <button
              key={h.id}
              type="button"
              onClick={() => onOpenHost(h.id)}
              title={t('sidebar.connectTo', { target: h.label })}
              className="border-edge bg-app text-muted hover:border-accent/60 hover:text-content flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]"
            >
              <span className={`size-1.5 shrink-0 rounded-full ${tone}`} />
              <span className="truncate">{h.label}</span>
            </button>
          )
        })}
        {rest > 0 && (
          <button
            type="button"
            onClick={onShowHosts}
            title={t('dashboard.groupShowHosts', { name: group.name })}
            className="text-subtle hover:text-accent px-1 text-[11px] hover:underline"
          >
            +{rest}
          </button>
        )}
      </div>

      {/* Dòng chân = XEM danh sách đầy đủ (inline, có nút quay lại) — hành động "đọc" nằm ở
          dòng chữ đọc được. `mt-auto` NEO XUỐNG ĐÁY: card trong cùng hàng lưới bị kéo cao
          bằng nhau, không neo thì dòng này lửng lơ giữa card và mỗi card một chỗ. */}
      <button
        type="button"
        onClick={onShowHosts}
        title={t('dashboard.groupShowHosts', { name: group.name })}
        className="border-edge/70 text-subtle hover:text-accent mt-auto border-t pt-1.5 text-left text-[10px]"
      >
        ☰ {t('dashboard.groupShowAll')}
      </button>
    </div>
  )
}
