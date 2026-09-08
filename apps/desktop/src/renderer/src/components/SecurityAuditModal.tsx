import { useEffect, useMemo, useState } from 'react'
import { RUNBOOK_LIBRARY, type SecurityFindingLevel, type SecurityScanDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { Button, ModalOrPanel } from './ui'
import { OpenInTabButton } from './OpenInTabButton'
import { useT, type I18nKey } from '../i18n'

const LOCALES = { vi: 'vi-VN', en: 'en-US', ja: 'ja-JP' } as const

const LEVEL_KEY: Record<SecurityFindingLevel, I18nKey> = {
  high: 'sec.level.high',
  medium: 'sec.level.medium',
  low: 'sec.level.low',
  info: 'sec.level.info'
}
const LEVEL_TINT: Record<SecurityFindingLevel, string> = {
  high: 'border-danger/50 bg-danger/10 text-danger',
  medium: 'border-warning/50 bg-warning/10 text-warning',
  low: 'border-edge bg-hover text-content',
  info: 'border-edge bg-hover text-subtle'
}

/** Điểm → màu: 90+ xanh, 70+ vàng, dưới nữa đỏ. */
function scoreTone(score: number): string {
  return score >= 90 ? 'text-success' : score >= 70 ? 'text-warning' : 'text-danger'
}

/**
 * F38 — Kiểm an ninh nhanh cả fleet: tick host, quét bằng MỘT lệnh chỉ-đọc mỗi máy, mỗi máy một
 * điểm và danh sách việc cần làm; mỗi việc có nút mở **Sổ tay vận hành** tương ứng.
 *
 * Không có lệnh sửa nào chạy tự động — app chỉ đọc và chỉ đường, người làm là user (cùng lệ với
 * chẩn đoán replication và AI chẩn đoán).
 */
export function SecurityAuditModal({ onClose, embedded }: { onClose?: () => void; embedded?: boolean }) {
  const t = useT()
  const locale = LOCALES[useSettingsStore((s) => s.language)]
  const setModal = useUiStore((s) => s.setModal)
  const allHosts = useDataStore((s) => s.hosts)
  const hosts = useMemo(() => allHosts.filter((h) => h.protocol === 'ssh'), [allHosts])
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [seeded, setSeeded] = useState(false)
  const [scans, setScans] = useState<SecurityScanDto[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [openHost, setOpenHost] = useState<string | null>(null)
  const [hideInfo, setHideInfo] = useState(true)

  // Lần đầu mở: tick sẵn mọi host SSH. Sau đó KHÔNG tự tick lại (user bỏ chọn là ý của user).
  useEffect(() => {
    if (seeded || hosts.length === 0) return
    setSeeded(true)
    setPicked(new Set(hosts.map((h) => h.id)))
  }, [seeded, hosts])

  useEffect(() => {
    const off = window.infra.security.onProgress((p) => setProgress({ done: p.done, total: p.total }))
    return off
  }, [])

  const hostLabel = useMemo(() => new Map(hosts.map((h) => [h.id, h.label])), [hosts])
  const pickedIds = hosts.filter((h) => picked.has(h.id)).map((h) => h.id)
  const ordered = useMemo(
    () =>
      [...scans].sort((a, b) => {
        if (a.ok !== b.ok) return a.ok ? 1 : -1 // host lỗi lên đầu: cần biết là chưa quét được
        if (a.score !== b.score) return a.score - b.score // điểm thấp trước
        return (hostLabel.get(a.hostId) ?? a.hostId).localeCompare(hostLabel.get(b.hostId) ?? b.hostId)
      }),
    [scans, hostLabel]
  )

  const scan = async (): Promise<void> => {
    if (pickedIds.length === 0) return
    setProgress({ done: 0, total: pickedIds.length })
    setScans([])
    try {
      setScans(await window.infra.security.scan(pickedIds))
    } finally {
      setProgress(null)
    }
  }

  /** Tổng theo mức để có một dòng kết luận: "3 nghiêm trọng, 5 nên xem". */
  const totals = useMemo(() => {
    const out: Record<SecurityFindingLevel, number> = { high: 0, medium: 0, low: 0, info: 0 }
    for (const s of scans) for (const f of s.findings) out[f.level] += 1
    return out
  }, [scans])

  const openRunbook = (): void => setModal('runbooks')

  return (
    <ModalOrPanel
      embedded={embedded}
      title={`🛡️ ${t('sec.title')}`}
      onClose={onClose}
      headerExtra={embedded ? undefined : <OpenInTabButton kind="security" onDone={onClose} />}
    >
      <div className={embedded ? 'w-full' : 'w-[860px] max-w-full'}>
        <p className="text-subtle mb-3 text-[11px] leading-relaxed">{t('sec.hint')}</p>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="border-edge bg-input max-h-28 min-w-56 flex-1 overflow-y-auto rounded border p-1">
            {hosts.length === 0 && <p className="text-subtle px-2 py-1 text-[10px] italic">{t('sec.noHosts')}</p>}
            {hosts.map((h) => (
              <label key={h.id} className="text-muted hover:bg-hover flex cursor-pointer items-center gap-2 rounded px-2 py-0.5 text-xs">
                <input
                  type="checkbox"
                  checked={picked.has(h.id)}
                  onChange={() =>
                    setPicked((prev) => {
                      const next = new Set(prev)
                      if (next.has(h.id)) next.delete(h.id)
                      else next.add(h.id)
                      return next
                    })
                  }
                  className="accent-accent"
                />
                <span className="min-w-0 flex-1 truncate">{h.label}</span>
              </label>
            ))}
          </div>
          <Button variant="primary" disabled={progress !== null || pickedIds.length === 0} onClick={() => void scan()}>
            {progress ? t('sec.scanning', { done: progress.done, total: progress.total }) : `▶ ${t('sec.scan', { n: pickedIds.length })}`}
          </Button>
        </div>

        {scans.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
            {(['high', 'medium', 'low'] as const).map((lvl) =>
              totals[lvl] > 0 ? (
                <span key={lvl} className={`rounded border px-2 py-0.5 ${LEVEL_TINT[lvl]}`}>
                  {totals[lvl]} {t(LEVEL_KEY[lvl])}
                </span>
              ) : null
            )}
            {totals.high === 0 && totals.medium === 0 && <span className="text-success">{t('sec.allClear')}</span>}
            <div className="flex-1" />
            <label className="text-muted flex cursor-pointer items-center gap-1">
              <input type="checkbox" checked={hideInfo} onChange={(e) => setHideInfo(e.target.checked)} className="accent-accent" />
              {t('sec.hideInfo')}
            </label>
          </div>
        )}

        {scans.length === 0 ? (
          <p className="text-subtle py-8 text-center text-xs leading-relaxed">{progress ? '…' : t('sec.empty')}</p>
        ) : (
          <div className="space-y-1.5">
            {ordered.map((s) => {
              const findings = hideInfo ? s.findings.filter((f) => f.level !== 'info') : s.findings
              const open = openHost === s.hostId
              return (
                <div key={s.hostId} className="border-edge bg-input rounded border">
                  <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpenHost(open ? null : s.hostId)}>
                    {s.ok ? (
                      <span className={`shrink-0 text-sm font-semibold tabular-nums ${scoreTone(s.score)}`}>{s.score}</span>
                    ) : (
                      <span className="text-danger shrink-0 text-sm">✕</span>
                    )}
                    <span className="text-content min-w-0 flex-1 truncate text-xs">{hostLabel.get(s.hostId) ?? s.hostId}</span>
                    {s.ok ? (
                      <span className="text-subtle shrink-0 text-[11px]">
                        {findings.length > 0 ? t('sec.nFindings', { n: findings.length }) : t('sec.clean')}
                      </span>
                    ) : (
                      <span className="text-danger min-w-0 max-w-64 shrink-0 truncate text-[11px]">{s.error}</span>
                    )}
                    <span className="text-subtle shrink-0 text-[10px]">
                      {new Date(s.collectedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {s.ok && findings.length > 0 && <span className="text-subtle shrink-0">{open ? '▾' : '▸'}</span>}
                  </button>
                  {open && findings.length > 0 && (
                    <div className="border-edge space-y-1 border-t px-3 py-2">
                      {findings.map((f) => {
                        const runbook = f.runbookId ? RUNBOOK_LIBRARY.find((r) => r.id === f.runbookId) : undefined
                        return (
                          <div key={f.id} className="flex items-start gap-2">
                            <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] uppercase ${LEVEL_TINT[f.level]}`}>{t(LEVEL_KEY[f.level])}</span>
                            <div className="min-w-0 flex-1">
                              <div className="text-content text-[11px] leading-relaxed">{f.title}</div>
                              {f.detail && <div className="text-subtle font-mono text-[10px] leading-relaxed">{f.detail}</div>}
                            </div>
                            {runbook && (
                              <button
                                type="button"
                                className="text-accent hover:text-content shrink-0 text-[10px] whitespace-nowrap"
                                title={t('sec.openRunbook', { title: runbook.title })}
                                onClick={openRunbook}
                              >
                                📖 {t('sec.howTo')}
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </ModalOrPanel>
  )
}
