import { useEffect, useState } from 'react'
import { toChartMarkers, type ChartMarker, type MetricHistoryPointDto } from '@infra/shared'
import { useMonitorStore, type HostMonitor } from '../stores/monitor'
import { usePluginStore } from '../stores/plugins'
import { useTabsStore } from '../stores/tabs'
import { useT } from '../i18n'
import { useDraggablePanel } from '../lib/useDraggablePanel'
import { MetricChart } from './MetricsHistoryModal'

/** Dashboard monitoring neo góc phải — mờ khi không rê chuột, KHÔNG backdrop nên
 *  vẫn thao tác terminal bình thường. Chỉ biến mất khi user bấm Dừng.
 *  Nút – thu nhỏ về pill 📊 góc DƯỚI phải (tránh đè pill plugin góc trên);
 *  chấm màu trên pill = trạng thái xấu nhất trong các host đang theo dõi.
 *  Khi có panel plugin (pill 🧩 neo top-14 right-3 z-40) → dock tụt xuống top-24
 *  để pill không che hàng nút – / Dừng của dock. */
export function MonitorDock() {
  const t = useT()
  const data = useMonitorStore((s) => s.data)
  const stop = useMonitorStore((s) => s.stop)
  const hasPluginPanel = usePluginStore((s) => s.panel !== null)
  const [minimized, setMinimized] = useState(false)
  const { panelRef, pos, headerHandlers } = useDraggablePanel()
  const monitors = Object.values(data)

  const detach = (): void => {
    void window.infra.monitor.openDetached(monitors.map((m) => ({ id: m.hostId, label: m.label })))
  }

  const openTab = (): void => useTabsStore.getState().openMonitorTab()

  if (minimized) {
    const anyError = monitors.some((m) => m.sample && !m.sample.ok)
    const anyPending = monitors.some((m) => !m.sample)
    const dot = anyError ? 'bg-danger' : anyPending ? 'bg-warning animate-pulse' : 'bg-success'
    return (
      <div
        // width/height auto: xoá kích thước inline mà CSS `resize` của panel để lại (React tái dùng
        // cùng DOM node khi đổi panel↔pill) → pill không bị phình thành ô tròn to
        style={{ width: 'auto', height: 'auto' }}
        className="bg-elevated/95 border-edge-strong absolute right-3 bottom-8 z-30 flex max-w-[280px] cursor-pointer items-center gap-2 rounded-full border py-1.5 pr-3 pl-3 opacity-75 shadow-2xl transition-opacity duration-150 hover:opacity-100"
        title={t('panel.restore')}
        onClick={() => setMinimized(false)}
      >
        <span className={`size-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="text-content min-w-0 truncate text-xs">
          📊 {t('monitor.watching', { n: monitors.length })}
        </span>
      </div>
    )
  }

  return (
    <div
      ref={panelRef}
      style={pos ? { left: pos.x, top: pos.y } : undefined}
      className={`bg-elevated/95 border-edge-strong absolute z-30 flex w-[320px] max-w-[85vw] min-h-40 min-w-72 resize flex-col overflow-hidden rounded-lg border opacity-75 shadow-2xl transition-opacity duration-150 hover:opacity-100 ${
        hasPluginPanel ? 'max-h-[calc(100%-8.5rem)]' : 'max-h-[calc(100%-6rem)]'
      } ${pos ? '' : `right-3 ${hasPluginPanel ? 'top-24' : 'top-14'}`}`}
    >
      <div
        className="border-edge flex shrink-0 cursor-move items-center justify-between gap-2 border-b px-3 py-2 select-none"
        title={t('panel.dragHint')}
        {...headerHandlers}
      >
        <span className="text-subtle truncate text-[11px]">{t('monitor.watching', { n: monitors.length })}</span>
        <div className="flex shrink-0 items-center gap-1">
          <button
            className="text-subtle hover:text-content px-1 text-sm leading-none"
            aria-label={t('monitor.openInTab')}
            title={t('monitor.openInTab')}
            onClick={openTab}
          >
            ⊞
          </button>
          <button
            className="text-subtle hover:text-content px-1 text-sm leading-none"
            aria-label={t('panel.detach')}
            title={t('panel.detach')}
            onClick={detach}
          >
            ⧉
          </button>
          <button
            className="text-subtle hover:text-content px-1 text-sm leading-none"
            aria-label={t('panel.minimize')}
            title={t('panel.minimize')}
            onClick={() => setMinimized(true)}
          >
            –
          </button>
          <button
            className="border-edge-strong text-muted hover:bg-hover rounded border px-2 py-0.5 text-xs font-medium"
            onClick={stop}
          >
            {t('monitor.stop')}
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {monitors.map((m) => (
          <MonitorCard key={m.hostId} monitor={m} />
        ))}
      </div>
      {/* Gợi ý kéo chỉnh cỡ: grip ◢ góc dưới-phải; pointer-events-none để không chặn grip resize gốc của trình duyệt */}
      <span
        aria-hidden
        className="text-subtle/60 pointer-events-none absolute right-0.5 bottom-0.5 text-[10px] leading-none"
      >
        ◢
      </span>
    </div>
  )
}

export function MonitorCard({ monitor, large }: { monitor: HostMonitor; large?: boolean }) {
  const t = useT()
  const s = monitor.sample
  const [showHistory, setShowHistory] = useState(false)
  // Tab riêng dùng large: card/chart/chữ to hơn cho dễ đọc (dock góc phải giữ cỡ gọn).
  const sub = large ? 'text-[11px]' : 'text-[10px]'
  return (
    <div className={`rounded border border-edge bg-input ${large ? 'p-4' : 'p-3'}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className={`${large ? 'size-2' : 'size-1.5'} rounded-full ${!s ? 'bg-warning animate-pulse' : s.ok ? 'bg-success' : 'bg-danger'}`} />
        <span className={`min-w-0 flex-1 truncate font-medium text-content ${large ? 'text-sm' : 'text-xs'}`}>{monitor.label}</span>
        {s?.uptimeSec != null && <span className={`text-subtle ${large ? 'text-xs' : 'text-[10px]'}`}>up {formatUptime(s.uptimeSec)}</span>}
        <button
          className={`shrink-0 leading-none ${large ? 'text-base' : ''} ${showHistory ? 'text-content' : 'text-subtle hover:text-content'}`}
          title={t('monitor.historyInline')}
          onClick={() => setShowHistory(!showHistory)}
        >
          📈
        </button>
      </div>
      {!s && <p className={`text-subtle ${large ? 'text-sm' : 'text-[11px]'}`}>{t('monitor.connecting')}</p>}
      {s && !s.ok && <p className={`text-danger ${large ? 'text-sm' : 'text-[11px]'}`}>{s.error}</p>}
      {s?.ok && (
        <div className={large ? 'space-y-2' : 'space-y-1.5'}>
          <Sparkline values={monitor.loadHistory} cpuCount={s.cpuCount} big={large} />
          <Bar label={`Load ${s.loadText ?? ''}`} pct={loadPct(s.load1, s.cpuCount)} tip={t('monitor.tip.load')} big={large} />
          {/* CPU thật từ /proc/stat (null ở poll đầu) — phân biệt thiếu CPU / nghẽn I/O / bị steal */}
          {s.cpuPct !== null && <Bar label="CPU" pct={s.cpuPct} tip={t('monitor.tip.cpu')} big={large} />}
          <Bar label="RAM" pct={s.memUsedPct} tip={t('monitor.tip.ram')} big={large} />
          <Bar label={`Disk ${s.diskMount ?? '/'}`} pct={s.diskUsedPct} tip={t('monitor.tip.disk')} big={large} />
          {/* Dòng chẩn đoán CPU: ai đang ăn (us/sy), nghẽn đĩa (wa), bị hypervisor trộm (st).
              Mỗi thông số có tooltip giải thích — hover để đọc. */}
          {s.cpuUserPct !== null && (
            <div className={`text-subtle border-edge/70 mt-1 flex flex-wrap gap-x-2 border-t pt-1.5 ${sub}`}>
              <span className="cursor-help" title={t('monitor.tip.us')}>us {s.cpuUserPct}</span>
              <span className="cursor-help" title={t('monitor.tip.sy')}>sy {s.cpuSystemPct ?? '—'}</span>
              <span
                className={`cursor-help ${(s.cpuIowaitPct ?? 0) >= 20 ? 'text-warning font-semibold' : ''}`}
                title={t('monitor.tip.wa')}
              >
                wa {s.cpuIowaitPct ?? '—'}
              </span>
              <span
                className={`cursor-help ${(s.cpuStealPct ?? 0) >= 10 ? 'text-danger font-semibold' : ''}`}
                title={t('monitor.tip.st')}
              >
                st {s.cpuStealPct ?? '—'}
              </span>
              {s.runQueue !== null && s.runQueue > (s.cpuCount ?? 1) && (
                <span className="text-warning cursor-help" title={t('monitor.tip.r')}>r {s.runQueue}</span>
              )}
              {(s.swapUsedMb ?? 0) > 0 && (
                <span className="cursor-help" title={t('monitor.tip.swap')}>swap {s.swapUsedMb}MB</span>
              )}
            </div>
          )}
          {(s.netRxKbps !== null || s.tcpConns !== null || s.topProc) && (
            <div className={`text-muted flex flex-wrap items-center gap-x-2 ${sub}`}>
              {s.netRxKbps !== null && (
                <span className="cursor-help" title={t('monitor.tip.net')}>
                  ↓{fmtRate(s.netRxKbps)} ↑{fmtRate(s.netTxKbps ?? 0)}
                </span>
              )}
              {s.tcpConns !== null && (
                <span className="cursor-help" title={t('monitor.tip.conn')}>{s.tcpConns} conn</span>
              )}
              {(s.inodeUsedPct ?? 0) >= 70 && (
                <span className="text-warning cursor-help" title={t('monitor.tip.inode')}>inode {s.inodeUsedPct}%</span>
              )}
              {s.topProc && (
                <span className="min-w-0 cursor-help truncate" title={t('monitor.tip.top')}>[{s.topProc}]</span>
              )}
            </div>
          )}
          {/* Uptime service (httpd/java/nginx…) — khác uptime server: service restart là thấy ngay ở đây */}
          {s.services && s.services.length > 0 && (
            <div className={`text-subtle flex cursor-help flex-wrap gap-x-2 ${sub}`} title={t('monitor.tip.svc')}>
              {s.services.map((svc) => (
                <span key={svc.name}>
                  ⟳ {svc.name} {formatUptime(svc.uptimeSec)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {showHistory && <InlineHistory hostId={monitor.hostId} />}
    </div>
  )
}

/** Chart lịch sử 1h nhúng ngay trong card (bấm 📈) — bucket phút từ metrics.db,
 *  tự refresh mỗi 60s; nút ⤢ mở modal đầy đủ (24h + đủ metric). */
function InlineHistory({ hostId }: { hostId: string }) {
  const t = useT()
  const [points, setPoints] = useState<MetricHistoryPointDto[] | null>(null)
  const [markers, setMarkers] = useState<ChartMarker[]>([])
  const [window_, setWindow] = useState<{ from: number; to: number } | null>(null)

  useEffect(() => {
    let alive = true
    const load = (): void => {
      const now = Date.now()
      setWindow({ from: now - 3_600_000, to: now })
      void window.infra.monitor.queryHistory(hostId, now - 3_600_000, now, 1).then((rows) => {
        if (alive) setPoints(rows)
      })
      // Vạch sự kiện (marker deploy, alert) cùng khoảng 1h — để nhìn card là biết đỉnh CPU đến sau việc gì
      void window.infra.events.timeline(hostId, now - 3_600_000, now).then((rows) => {
        if (alive) setMarkers(toChartMarkers(rows))
      })
    }
    load()
    const timer = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [hostId])

  return (
    <div className="border-edge/70 mt-2 space-y-1.5 border-t pt-2">
      {points === null && <p className="text-subtle text-[10px]">…</p>}
      {points !== null && points.length === 0 && (
        <p className="text-subtle text-[10px] leading-relaxed">{t('monitor.historyEmpty')}</p>
      )}
      {points !== null && points.length > 0 && (
        <>
          <MetricChart label={`Load (${t('monitor.loadNorm')})`} points={points} field="loadPct" resMs={60_000} autoScale compact markers={markers} rangeFrom={window_?.from} rangeTo={window_?.to} />
          <MetricChart label="CPU" points={points} field="cpuPct" resMs={60_000} compact markers={markers} rangeFrom={window_?.from} rangeTo={window_?.to} />
          <MetricChart label={t('monitor.metricConn')} points={points} field="conns" resMs={60_000} autoScale unit="" compact markers={markers} rangeFrom={window_?.from} rangeTo={window_?.to} />
        </>
      )}
      <button
        className="text-subtle hover:text-content text-[10px]"
        onClick={() => useMonitorStore.getState().setHistoryHost(hostId)}
      >
        {t('monitor.historyMore')}
      </button>
    </div>
  )
}

/** Kbps → chuỗi gọn: 850 Kb/s, 12.3 Mb/s. */
function fmtRate(kbps: number): string {
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(1)} Mb/s`
  return `${kbps} Kb/s`
}

function Bar({ label, pct, tip, big }: { label: string; pct: number | null; tip?: string; big?: boolean }) {
  const value = pct ?? 0
  const color = value > 90 ? 'bg-danger' : value > 70 ? 'bg-warning' : 'bg-success'
  return (
    <div className={`flex items-center gap-2 ${big ? 'text-xs' : 'text-[10px]'} ${tip ? 'cursor-help' : ''}`} title={tip}>
      <span className={`${big ? 'w-28' : 'w-24'} shrink-0 truncate text-subtle`}>{label}</span>
      <div className={`${big ? 'h-2.5' : 'h-1.5'} flex-1 overflow-hidden rounded bg-hover`}>
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className={`${big ? 'w-10' : 'w-8'} shrink-0 text-right text-muted`}>{pct === null ? '—' : `${value}%`}</span>
    </div>
  )
}

function Sparkline({ values, cpuCount, big }: { values: number[]; cpuCount: number | null; big?: boolean }) {
  const h = big ? 'h-20' : 'h-8'
  if (values.length < 2) return <div className={h} />
  const max = Math.max(...values, cpuCount ?? 1)
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${30 - (v / max) * 28}`)
    .join(' ')
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={`${h} w-full`}>
      <polyline points={points} fill="none" stroke="#7aa2f7" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function loadPct(load: number | null, cpuCount: number | null): number | null {
  if (load === null) return null
  return Math.round((load / (cpuCount ?? 1)) * 100)
}

function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  if (d > 0) return `${d}d ${h}h`
  const m = Math.floor((sec % 3600) / 60)
  return `${h}h ${m}m`
}
