import { useEffect, useState } from 'react'
import { markerX, toChartMarkers, type AppEventDto, type ChartMarker, type MetricHistoryPointDto } from '@infra/shared'
import { useSettingsStore } from '../stores/settings'
import { Button, Modal, TextInput } from './ui'
import { useT } from '../i18n'

const LOCALES = { vi: 'vi-VN', en: 'en-US', ja: 'ja-JP' } as const

/** Màu vạch sự kiện theo tone — biến CSS của theme để đổi màu cùng bảng màu tuỳ chỉnh. */
const TONE_COLOR: Record<ChartMarker['tone'], string> = {
  accent: 'var(--c-accent)',
  warning: 'var(--c-warning)',
  danger: 'var(--c-danger)',
  success: 'var(--c-success)'
}

type Range = '1h' | '24h'

/** 1h → bucket phút (res 1), 24h → bucket 10 phút (res 10). */
const RANGE_CFG: Record<Range, { ms: number; res: 1 | 10 }> = {
  '1h': { ms: 3_600_000, res: 1 },
  '24h': { ms: 24 * 3_600_000, res: 10 }
}

const REFRESH_MS = 60_000

/** F32 — Lịch sử metrics 1 host: 3 chart Load/RAM/Disk (SVG tự vẽ, thang 0-100%). */
export function MetricsHistoryModal({ hostId, label, onClose }: { hostId: string; label: string; onClose: () => void }) {
  const t = useT()
  const locale = LOCALES[useSettingsStore((s) => s.language)]
  const [range, setRange] = useState<Range>('1h')
  const [points, setPoints] = useState<MetricHistoryPointDto[] | null>(null)
  // Sự kiện trong khoảng (marker của user + alert/recover của host) → vạch trên biểu đồ + danh sách dưới
  const [events, setEvents] = useState<AppEventDto[]>([])
  const [markerTitle, setMarkerTitle] = useState('')
  const [reloadTick, setReloadTick] = useState(0)
  // Khoảng đang hỏi (now - range → now) — trục X của chart theo đúng khoảng này, không theo dữ liệu
  const [window_, setWindow] = useState<{ from: number; to: number } | null>(null)

  useEffect(() => {
    let alive = true
    const load = (): void => {
      const now = Date.now()
      const cfg = RANGE_CFG[range]
      setWindow({ from: now - cfg.ms, to: now })
      void window.infra.monitor.queryHistory(hostId, now - cfg.ms, now, cfg.res).then((rows) => {
        if (alive) setPoints(rows)
      })
      void window.infra.events.timeline(hostId, now - cfg.ms, now).then((rows) => {
        if (alive) setEvents(rows)
      })
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [hostId, range, reloadTick])

  const cfg = RANGE_CFG[range]
  const hasData = points !== null && points.length > 0
  const markers = toChartMarkers(events)

  const addMarker = async (): Promise<void> => {
    const title = markerTitle.trim()
    if (!title) return
    await window.infra.events.addMarker({ hostId, title })
    setMarkerTitle('')
    setReloadTick((n) => n + 1)
  }

  const removeEvent = async (id: number): Promise<void> => {
    await window.infra.events.remove(id)
    setReloadTick((n) => n + 1)
  }

  return (
    <Modal title={`📈 ${t('monitor.historyTitle', { host: label })}`} onClose={onClose}>
      <div className="w-[640px] max-w-full">
        <div className="mb-3 flex gap-2">
          {(['1h', '24h'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded border px-3 py-1 text-xs ${
                range === r ? 'border-accent text-content bg-accent-soft/40' : 'border-edge text-muted hover:bg-hover'
              }`}
            >
              {r === '1h' ? t('monitor.range1h') : t('monitor.range24h')}
            </button>
          ))}
        </div>

        {points === null && <p className="text-subtle py-6 text-center text-xs">…</p>}
        {points !== null && !hasData && (
          <p className="text-subtle py-6 text-center text-xs leading-relaxed">{t('monitor.historyEmpty')}</p>
        )}
        {hasData && (
          <div className="space-y-3">
            {/* Load %/CPU vượt được 100% (server bận 300-400%+) → thang tự giãn theo dữ liệu */}
            <MetricChart label={`Load (${t('monitor.loadNorm')})`} points={points} field="loadPct" resMs={cfg.res * 60_000} autoScale markers={markers} rangeFrom={window_?.from} rangeTo={window_?.to} />
            <MetricChart label="CPU" points={points} field="cpuPct" resMs={cfg.res * 60_000} markers={markers} rangeFrom={window_?.from} rangeTo={window_?.to} />
            <MetricChart label="CPU steal" points={points} field="stealPct" resMs={cfg.res * 60_000} markers={markers} rangeFrom={window_?.from} rangeTo={window_?.to} />
            <MetricChart label="RAM" points={points} field="memPct" resMs={cfg.res * 60_000} markers={markers} rangeFrom={window_?.from} rangeTo={window_?.to} />
            <MetricChart label="Disk" points={points} field="diskPct" resMs={cfg.res * 60_000} markers={markers} rangeFrom={window_?.from} rangeTo={window_?.to} />
            <MetricChart label={t('monitor.metricConn')} points={points} field="conns" resMs={cfg.res * 60_000} autoScale unit="" markers={markers} rangeFrom={window_?.from} rangeTo={window_?.to} />
          </div>
        )}

        {/* Đánh dấu sự kiện ngay tại đây (deploy, restart…) + danh sách sự kiện trong khoảng đang xem */}
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void addMarker()
          }}
        >
          <TextInput value={markerTitle} onChange={(e) => setMarkerTitle(e.target.value)} placeholder={t('events.markerPh')} className="flex-1" />
          <Button type="submit" variant="primary" className="shrink-0" disabled={!markerTitle.trim()}>
            {t('monitor.markNow')}
          </Button>
        </form>
        {events.length > 0 && (
          <div className="mt-2">
            <div className="text-subtle mb-1 text-[10px] font-semibold tracking-wider uppercase">{t('monitor.timeline')}</div>
            <div className="max-h-32 space-y-0.5 overflow-y-auto">
              {[...events].reverse().map((ev) => {
                const tone = toChartMarkers([ev])[0]?.tone ?? 'accent'
                return (
                  <div key={ev.id} className="group flex items-center gap-2 text-[11px]">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: TONE_COLOR[tone] }} />
                    <span className="text-subtle shrink-0 tabular-nums">
                      {new Date(ev.ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-muted min-w-0 flex-1 truncate">{ev.title}</span>
                    {ev.kind === 'marker' && (
                      <button
                        type="button"
                        className="text-subtle hover:text-danger shrink-0 opacity-0 group-hover:opacity-100"
                        title={t('common.delete')}
                        onClick={() => void removeEvent(ev.id)}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

type ChartField = 'loadPct' | 'cpuPct' | 'stealPct' | 'memPct' | 'diskPct' | 'conns'

/** 1 chart đường: thang Y 0-100% (autoScale: giãn theo max dữ liệu — cho Load/Kết nối),
 *  tách đoạn tại khoảng trống dữ liệu (offline/app tắt). Metric không có dữ liệu
 *  (bản ghi cũ trước v2, server thiếu lệnh) → ẩn chart.
 *  compact: bản thu gọn nhúng trong card MonitorDock (padding/chiều cao nhỏ). */
export function MetricChart({
  label,
  points,
  field,
  resMs,
  autoScale = false,
  unit = '%',
  compact = false,
  markers = [],
  rangeFrom,
  rangeTo
}: {
  label: string
  points: MetricHistoryPointDto[]
  field: ChartField
  resMs: number
  autoScale?: boolean
  unit?: string
  compact?: boolean
  /** Vạch sự kiện (marker deploy của user, alert/recover) — hover vào vạch để đọc nhãn. */
  markers?: ChartMarker[]
  /**
   * Khoảng thời gian của TRỤC X. Không truyền thì lấy theo dữ liệu (điểm đầu → điểm cuối) — như
   * vậy nếu monitoring dừng lúc 10:10 thì trục kết thúc ở 10:10 và marker đặt lúc 10:52 rơi ra
   * ngoài, không vẽ được (bug đã dính). Nơi gọi biết mình đang hỏi "1 giờ qua" thì truyền vào để
   * trục đúng là 1 giờ qua, phần không có dữ liệu để trống — đó mới là sự thật.
   */
  rangeFrom?: number
  rangeTo?: number
}) {
  if (!points.some((p) => p[field] !== null)) return null
  const from = rangeFrom ?? points[0]!.ts
  const to = rangeTo ?? points[points.length - 1]!.ts
  const span = Math.max(to - from, 1)
  // Trần thang Y: 100 hoặc max dữ liệu làm tròn lên bậc 50 (vd 368% → 400)
  const dataMax = autoScale ? points.reduce((m, p) => Math.max(m, p[field] ?? 0), 0) : 0
  const yMax = autoScale ? Math.max(100, Math.ceil(dataMax / 50) * 50) : 100

  // Tách polyline thành các đoạn liên tục: gap > 2 bucket hoặc giá trị null = ngắt đoạn
  const segments: string[] = []
  let current: string[] = []
  let prevTs: number | null = null
  for (const p of points) {
    const v = p[field]
    const gap = prevTs !== null && p.ts - prevTs > 2 * resMs
    if (v === null || gap) {
      if (current.length > 1) segments.push(current.join(' '))
      current = []
      if (v === null) {
        prevTs = p.ts
        continue
      }
    }
    const x = ((p.ts - from) / span) * 100
    const y = 30 - (Math.min(yMax, Math.max(0, v!)) / yMax) * 28 - 1
    current.push(`${x.toFixed(2)},${y.toFixed(2)}`)
    prevTs = p.ts
  }
  if (current.length > 1) segments.push(current.join(' '))

  const last = [...points].reverse().find((p) => p[field] !== null)?.[field]
  const fmt = (ts: number): string => {
    const d = new Date(ts)
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    return span > 3_700_000 ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${hm}` : hm
  }

  return (
    <div className={compact ? '' : 'border-edge bg-input rounded border p-3'}>
      <div className={`flex items-center justify-between ${compact ? 'mb-0.5 text-[10px]' : 'mb-1.5 text-[11px]'}`}>
        <span className="text-subtle">
          {label}
          {yMax !== 100 && (
            <span className="text-subtle/70">
              {' '}
              · 0–{yMax}
              {unit}
            </span>
          )}
        </span>
        <span className="text-muted">{last === null || last === undefined ? '—' : `${last}${unit}`}</span>
      </div>
      <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={`w-full ${compact ? 'h-10' : 'h-20'}`}>
        {/* gridline 0/50/100% */}
        {[1, 15, 29].map((y) => (
          <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="currentColor" strokeOpacity="0.12" strokeWidth="0.3" />
        ))}
        {segments.map((pts, i) => (
          <polyline key={i} points={pts} fill="none" stroke="#7aa2f7" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        ))}
        {/* Vạch sự kiện: đứt nét dọc suốt chiều cao + chấm ở đỉnh; <title> là tooltip gốc của SVG */}
        {markers.map((m, i) => {
          const x = markerX(m.ts, from, to)
          if (x === null) return null
          return (
            <g key={`m${i}`} style={{ color: TONE_COLOR[m.tone] }}>
              <title>{`${fmt(m.ts)} — ${m.label}`}</title>
              <line x1={x} y1="0" x2={x} y2="30" stroke="currentColor" strokeWidth="1" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
              <circle cx={x} cy="1.5" r="1.1" fill="currentColor" />
            </g>
          )
        })}
        {segments.length === 0 && points.length === 1 && (
          // 1 điểm duy nhất → chấm thay vì đường
          <circle cx="50" cy="15" r="1" fill="#7aa2f7" />
        )}
      </svg>
      {!compact && (
        <div className="text-subtle mt-1 flex justify-between text-[10px]">
          <span>{fmt(from)}</span>
          <span>{fmt(to)}</span>
        </div>
      )}
    </div>
  )
}
