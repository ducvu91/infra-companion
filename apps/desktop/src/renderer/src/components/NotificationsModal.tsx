import { useEffect, useMemo, useState } from 'react'
import { EVENT_SOURCES, dayKey, groupEventsByDay, type AppEventDto, type AppEventSource } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { useEventsStore } from '../stores/events'
import { useSettingsStore } from '../stores/settings'
import { Button, ModalOrPanel, Select, TextInput } from './ui'
import { OpenInTabButton } from './OpenInTabButton'
import { useT, type I18nKey } from '../i18n'

const LOCALES = { vi: 'vi-VN', en: 'en-US', ja: 'ja-JP' } as const

const SOURCE_ICON: Record<AppEventSource, string> = {
  monitor: '📊',
  replication: '🔁',
  watcher: '📡',
  tunnel: '🔀',
  http: '🌐',
  user: '📌',
  app: 'ℹ️'
}

const SOURCE_KEY: Record<AppEventSource, I18nKey> = {
  monitor: 'events.src.monitor',
  replication: 'events.src.replication',
  watcher: 'events.src.watcher',
  tunnel: 'events.src.tunnel',
  http: 'events.src.http',
  user: 'events.src.user',
  app: 'events.src.app'
}

/**
 * Trung tâm thông báo — lịch sử cảnh báo của MỌI hệ theo dõi (monitoring, replication, uptime
 * watcher, tunnel, theo dõi URL) ở một chỗ, có xác nhận từng cái / đọc hết, cộng thêm **đánh dấu
 * sự kiện** (deploy, restart…) do user tự ghi để đối chiếu trên biểu đồ metrics.
 *
 * Trước đây mỗi cảnh báo là một toast trôi mất; mở app sáng hôm sau không biết đêm qua có gì.
 * Mở dạng popup hoặc `embedded` trong tab (ToolTabView) như các công cụ khác.
 */
export function NotificationsModal({ onClose, embedded }: { onClose?: () => void; embedded?: boolean }) {
  const t = useT()
  const locale = LOCALES[useSettingsStore((s) => s.language)]
  const hosts = useDataStore((s) => s.hosts)
  const events = useEventsStore((s) => s.events)
  const unread = useEventsStore((s) => s.unread)
  const load = useEventsStore((s) => s.load)
  const ack = useEventsStore((s) => s.ack)
  const ackAll = useEventsStore((s) => s.ackAll)
  const remove = useEventsStore((s) => s.remove)
  const addMarker = useEventsStore((s) => s.addMarker)
  const [source, setSource] = useState<AppEventSource | 'all'>('all')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [markerTitle, setMarkerTitle] = useState('')
  const [markerHost, setMarkerHost] = useState('')

  useEffect(() => {
    void load({ sources: source === 'all' ? undefined : [source], unackedOnly: unreadOnly })
  }, [load, source, unreadOnly])

  const hostLabel = useMemo(() => new Map(hosts.map((h) => [h.id, h.label])), [hosts])
  const groups = useMemo(() => groupEventsByDay(events), [events])
  const todayKey = dayKey(Date.now())
  const yesterdayKey = dayKey(Date.now() - 86_400_000)

  const dayTitle = (day: string): string => {
    if (day === todayKey) return t('events.today')
    if (day === yesterdayKey) return t('events.yesterday')
    const [y, m, d] = day.split('-').map(Number)
    return new Date(y!, m! - 1, d!).toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  const submitMarker = async (): Promise<void> => {
    const title = markerTitle.trim()
    if (!title) return
    await addMarker({ hostId: markerHost || null, title })
    setMarkerTitle('')
  }

  return (
    <ModalOrPanel
      embedded={embedded}
      title={`🔔 ${t('events.title')}`}
      onClose={onClose}
      headerExtra={embedded ? undefined : <OpenInTabButton kind="notifications" onDone={onClose} />}
    >
      <div className={embedded ? 'w-full' : 'w-[760px] max-w-full'}>
        {/* Đánh dấu sự kiện: một dòng nhập + host (tuỳ chọn) — thứ user chủ động ghi, nằm trên cùng cho dễ với */}
        <form
          className="mb-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void submitMarker()
          }}
        >
          <span className="shrink-0 text-sm">📌</span>
          <TextInput
            value={markerTitle}
            onChange={(e) => setMarkerTitle(e.target.value)}
            placeholder={t('events.markerPh')}
            className="min-w-48 flex-1"
          />
          <Select value={markerHost} onChange={(e) => setMarkerHost(e.target.value)} className="max-w-48">
            <option value="">{t('events.markerFleet')}</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="primary" disabled={!markerTitle.trim()}>
            {t('events.addMarker')}
          </Button>
          <p className="text-subtle w-full text-[10px] leading-relaxed">{t('events.markerHint')}</p>
        </form>

        {/* Bộ lọc nguồn + chỉ chưa đọc + đọc hết */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {(['all', ...EVENT_SOURCES] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSource(s)}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${
                source === s ? 'border-accent text-content bg-accent-soft/40' : 'border-edge text-muted hover:bg-hover'
              }`}
            >
              {s === 'all' ? t('events.filterAll') : `${SOURCE_ICON[s]} ${t(SOURCE_KEY[s])}`}
            </button>
          ))}
          <div className="flex-1" />
          <label className="text-muted flex cursor-pointer items-center gap-1 text-[11px]">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} className="accent-accent" />
            {t('events.unreadOnly')}
          </label>
          <Button type="button" className="!px-2 !py-1 !text-xs" disabled={unread === 0} onClick={() => void ackAll()}>
            ✓ {t('events.ackAll')}
            {unread > 0 && <span className="text-subtle ml-1">({unread})</span>}
          </Button>
        </div>

        {events.length === 0 ? (
          <p className="text-subtle py-10 text-center text-xs leading-relaxed">{t('events.empty')}</p>
        ) : (
          <div className={`space-y-3 ${embedded ? '' : 'max-h-[60vh] overflow-y-auto pr-1'}`}>
            {groups.map((group) => (
              <div key={group.day}>
                <div className="text-subtle mb-1 text-[10px] font-semibold tracking-wider uppercase">{dayTitle(group.day)}</div>
                <div className="border-edge bg-panel divide-edge/70 divide-y rounded border">
                  {group.items.map((ev) => (
                    <EventRow
                      key={ev.id}
                      event={ev}
                      hostLabel={ev.hostId ? hostLabel.get(ev.hostId) : undefined}
                      time={new Date(ev.ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                      onAck={() => void ack(ev.id)}
                      onRemove={() => void remove(ev.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ModalOrPanel>
  )
}

function EventRow({
  event,
  hostLabel,
  time,
  onAck,
  onRemove
}: {
  readonly event: AppEventDto
  readonly hostLabel?: string
  readonly time: string
  readonly onAck: () => void
  readonly onRemove: () => void
}) {
  const t = useT()
  const unread = event.kind !== 'marker' && event.ackedAt === null
  const dot =
    event.kind === 'marker'
      ? 'bg-accent'
      : event.kind === 'recover'
        ? 'bg-success'
        : event.severity === 'critical'
          ? 'bg-danger'
          : event.severity === 'warning'
            ? 'bg-warning'
            : 'bg-edge-strong'
  return (
    <div className={`group flex items-start gap-2.5 px-3 py-2 ${unread ? '' : 'opacity-70'}`}>
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${dot}`} />
      <span className="mt-0.5 shrink-0 text-sm leading-none">{SOURCE_ICON[event.source]}</span>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-xs ${unread ? 'text-content font-medium' : 'text-muted'}`}>{event.title}</div>
        {(event.detail || hostLabel) && (
          <div className="text-subtle truncate text-[10px]">
            {hostLabel && <span className="mr-2">🖥 {hostLabel}</span>}
            {event.detail}
          </div>
        )}
      </div>
      <span className="text-subtle shrink-0 text-[11px] tabular-nums">{time}</span>
      {unread && (
        <button
          type="button"
          className="text-subtle hover:bg-hover hover:text-success shrink-0 rounded px-1 text-xs"
          title={t('events.ack')}
          aria-label={t('events.ack')}
          onClick={onAck}
        >
          ✓
        </button>
      )}
      <button
        type="button"
        className="text-subtle hover:bg-hover hover:text-danger shrink-0 rounded px-1 text-xs opacity-0 group-hover:opacity-100"
        title={t('common.delete')}
        aria-label={t('common.delete')}
        onClick={onRemove}
      >
        ✕
      </button>
    </div>
  )
}
