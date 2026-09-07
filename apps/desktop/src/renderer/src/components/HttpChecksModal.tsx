import { useEffect, useMemo, useState } from 'react'
import type { HttpCheckDto, HttpCheckMethod, HttpCheckResultDto, HttpCheckSummaryDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { useHttpChecksStore } from '../stores/httpChecks'
import { useSettingsStore } from '../stores/settings'
import { Button, ConfirmModal, Field, ModalOrPanel, Select, TextInput } from './ui'
import { OpenInTabButton } from './OpenInTabButton'
import { useT } from '../i18n'

const LOCALES = { vi: 'vi-VN', en: 'en-US', ja: 'ja-JP' } as const
const DAY_MS = 24 * 3_600_000

/** Cùng lệ với `packages/core/httpcheck`: khoảng chấp nhận của các ô số (form kẹp trước, main kẹp lại). */
const LIMITS = { intervalSec: [30, 86_400], timeoutMs: [1000, 60_000], failsBeforeAlert: [1, 10] } as const

/** Spec mã trạng thái hợp lệ — bản nhỏ của `isValidStatusSpec` (renderer không import core). */
const STATUS_SPEC_RE = /^\s*(\dxx|\d{3}-\d{3}|\d{3})(\s*,\s*(\dxx|\d{3}-\d{3}|\d{3}))*\s*$/i

/**
 * Theo dõi URL — danh sách check với trạng thái sống, form thêm/sửa, biểu đồ độ trễ 24h của check
 * đang chọn. Popup hoặc `embedded` trong tab.
 *
 * Khác uptime watcher (chỉ TCP): ở đây nhìn vào mã HTTP, từ khoá trong trang, cert TLS còn bao
 * ngày, và `resolveIp` để hỏi thẳng từng backend sau load balancer.
 */
export function HttpChecksModal({ onClose, embedded }: { onClose?: () => void; embedded?: boolean }) {
  const t = useT()
  const locale = LOCALES[useSettingsStore((s) => s.language)]
  const hosts = useDataStore((s) => s.hosts)
  const checks = useHttpChecksStore((s) => s.checks)
  const summaries = useHttpChecksStore((s) => s.summaries)
  const loaded = useHttpChecksStore((s) => s.loaded)
  const load = useHttpChecksStore((s) => s.load)
  const save = useHttpChecksStore((s) => s.save)
  const remove = useHttpChecksStore((s) => s.remove)
  const runNow = useHttpChecksStore((s) => s.runNow)

  const [mode, setMode] = useState<'list' | 'form'>('list')
  const [editing, setEditing] = useState<HttpCheckDto | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<HttpCheckDto | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const hostLabel = useMemo(() => new Map(hosts.map((h) => [h.id, h.label])), [hosts])
  const ordered = useMemo(() => [...checks].sort((a, b) => a.label.localeCompare(b.label)), [checks])
  const selected = ordered.find((c) => c.id === selectedId) ?? null

  const openAdd = (): void => {
    setEditing(null)
    setMode('form')
  }
  const openEdit = (check: HttpCheckDto): void => {
    setEditing(check)
    setMode('form')
  }

  return (
    <ModalOrPanel
      embedded={embedded}
      title={`🌐 ${t('http.title')}`}
      onClose={onClose}
      headerExtra={embedded ? undefined : <OpenInTabButton kind="http-checks" onDone={onClose} />}
    >
      <div className={embedded ? 'w-full' : 'w-[820px] max-w-full'}>
        {mode === 'list' && (
          <>
            <p className="text-subtle mb-3 text-[11px] leading-relaxed">{t('http.hint')}</p>
            {ordered.length === 0 ? (
              <p className="text-subtle py-8 text-center text-xs leading-relaxed">{t('http.empty')}</p>
            ) : (
              <div className={`grid content-start gap-1.5 ${embedded ? '@3xl:grid-cols-2' : ''}`}>
                {ordered.map((check) => (
                  <CheckRow
                    key={check.id}
                    check={check}
                    summary={summaries[check.id]}
                    hostLabel={check.hostId ? hostLabel.get(check.hostId) : undefined}
                    selected={check.id === selectedId}
                    busy={busyId === check.id}
                    locale={locale}
                    onSelect={() => setSelectedId(check.id === selectedId ? null : check.id)}
                    onRun={async () => {
                      setBusyId(check.id)
                      try {
                        await runNow(check.id)
                      } finally {
                        setBusyId(null)
                      }
                    }}
                    onEdit={() => openEdit(check)}
                    onDelete={() => setConfirmDelete(check)}
                  />
                ))}
              </div>
            )}
            <div className="mt-3 flex justify-end">
              <Button variant="primary" onClick={openAdd}>
                {t('http.new')}
              </Button>
            </div>
            {selected && <CheckDetail check={selected} locale={locale} />}
            {confirmDelete && (
              <ConfirmModal
                title={t('http.deleteTitle')}
                message={t('http.deleteMsg', { label: confirmDelete.label })}
                onConfirm={() => {
                  void remove(confirmDelete.id)
                  if (selectedId === confirmDelete.id) setSelectedId(null)
                  setConfirmDelete(null)
                }}
                onCancel={() => setConfirmDelete(null)}
              />
            )}
          </>
        )}

        {mode === 'form' && (
          <CheckForm
            initial={editing}
            hosts={hosts}
            onCancel={() => setMode('list')}
            onSave={async (input) => {
              await save(input)
              setMode('list')
            }}
          />
        )}
      </div>
    </ModalOrPanel>
  )
}

function CheckRow({
  check,
  summary,
  hostLabel,
  selected,
  busy,
  locale,
  onSelect,
  onRun,
  onEdit,
  onDelete
}: {
  readonly check: HttpCheckDto
  readonly summary: HttpCheckSummaryDto | undefined
  readonly hostLabel?: string
  readonly selected: boolean
  readonly busy: boolean
  readonly locale: string
  readonly onSelect: () => void
  readonly onRun: () => Promise<void>
  readonly onEdit: () => void
  readonly onDelete: () => void
}) {
  const t = useT()
  const last = summary?.last ?? null
  const dot = !check.enabled
    ? 'bg-edge-strong'
    : summary?.alerting
      ? 'bg-danger'
      : last === null
        ? 'bg-warning animate-pulse'
        : last.ok
          ? 'bg-success'
          : 'bg-warning'
  const cert = last?.certDaysLeft ?? null
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect()
      }}
      className={`flex min-w-0 cursor-pointer items-center gap-2 rounded border px-3 py-2 ${
        selected ? 'border-accent bg-accent-soft/20' : 'border-edge bg-input hover:bg-hover'
      }`}
    >
      <span className={`size-2 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <div className="text-content flex min-w-0 items-center gap-1.5 text-xs">
          <span className="truncate">{check.label}</span>
          {!check.enabled && <span className="text-subtle shrink-0 text-[10px]">· {t('http.disabled')}</span>}
          {summary?.alerting && <span className="text-danger shrink-0 text-[10px] font-semibold">{t('http.alerting')}</span>}
        </div>
        <div className="text-subtle truncate font-mono text-[10px]" title={check.url}>
          {check.method} {check.url}
          {check.resolveIp && ` → ${check.resolveIp}`}
        </div>
        <div className={`flex flex-wrap gap-x-2 text-[10px] ${last && !last.ok ? 'text-danger' : 'text-subtle'}`}>
          {last === null ? (
            <span>{t('http.never')}</span>
          ) : (
            <>
              <span title={t('http.lastCheck')}>
                {new Date(last.ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
                {last.status !== null && ` · HTTP ${last.status}`}
                {last.latencyMs !== null && ` · ${last.latencyMs}ms`}
              </span>
              {last.error && <span className="truncate">— {last.error}</span>}
            </>
          )}
          {summary && summary.uptimePct !== null && (
            <span className="text-subtle" title={t('http.uptime24h')}>
              ↑ {summary.uptimePct}%
            </span>
          )}
          {summary?.avgLatencyMs !== null && summary?.avgLatencyMs !== undefined && (
            <span className="text-subtle" title={t('http.avgLatency')}>
              ~{summary.avgLatencyMs}ms
            </span>
          )}
          {cert !== null && (
            <span className={cert < 30 ? 'text-warning' : 'text-subtle'} title={t('http.cert')}>
              🔒 {t('http.certDays', { n: cert })}
            </span>
          )}
          {hostLabel && <span className="text-subtle">🖥 {hostLabel}</span>}
        </div>
      </div>
      <Button
        type="button"
        className="!px-2 !py-1 !text-xs"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation()
          void onRun()
        }}
      >
        {busy ? '…' : `▶ ${t('http.runNow')}`}
      </Button>
      <Button
        type="button"
        className="!px-2 !py-1 !text-xs"
        onClick={(e) => {
          e.stopPropagation()
          onEdit()
        }}
      >
        {t('http.edit')}
      </Button>
      <Button
        type="button"
        variant="danger"
        className="!px-2 !py-1 !text-xs"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
      >
        {t('common.delete')}
      </Button>
    </div>
  )
}

/** Biểu đồ độ trễ 24h của một check: chấm xanh = ok (y theo ms), chấm đỏ ở đáy = fail. */
function CheckDetail({ check, locale }: { readonly check: HttpCheckDto; readonly locale: string }) {
  const t = useT()
  const [results, setResults] = useState<HttpCheckResultDto[] | null>(null)
  const summaries = useHttpChecksStore((s) => s.summaries)
  const last = summaries[check.id]?.last?.ts

  useEffect(() => {
    let alive = true
    void window.infra.httpChecks.results(check.id, Date.now() - DAY_MS).then((rows) => {
      if (alive) setResults(rows)
    })
    return () => {
      alive = false
    }
  }, [check.id, last])

  const points = results ?? []
  const from = points.length > 0 ? points[0]!.ts : Date.now() - DAY_MS
  const to = Math.max(points.length > 0 ? points[points.length - 1]!.ts : Date.now(), from + 1)
  const maxLatency = Math.max(50, ...points.map((p) => p.latencyMs ?? 0))

  return (
    <div className="border-edge bg-input mt-3 rounded border p-3">
      <div className="mb-1.5 flex items-center justify-between text-[11px]">
        <span className="text-subtle">
          {t('http.chartTitle')} · {check.label}
        </span>
        <span className="text-muted">
          {points.length} {t('http.samples')}
        </span>
      </div>
      {points.length === 0 ? (
        <p className="text-subtle py-4 text-center text-[11px]">{t('http.noResults')}</p>
      ) : (
        <>
          <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-20 w-full">
            {[1, 15, 29].map((y) => (
              <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="currentColor" strokeOpacity="0.12" strokeWidth="0.3" />
            ))}
            {points.map((p) => {
              const x = ((p.ts - from) / (to - from)) * 100
              if (!p.ok) return <circle key={p.ts} cx={x} cy="28.5" r="1" fill="var(--c-danger)" />
              const y = 29 - ((p.latencyMs ?? 0) / maxLatency) * 27
              return <circle key={p.ts} cx={x} cy={y} r="0.7" fill="#7aa2f7" />
            })}
          </svg>
          <div className="text-subtle mt-1 flex justify-between text-[10px]">
            <span>{new Date(from).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
            <span>0–{maxLatency}ms</span>
            <span>{new Date(to).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </>
      )}
    </div>
  )
}

function CheckForm({
  initial,
  hosts,
  onCancel,
  onSave
}: {
  readonly initial: HttpCheckDto | null
  readonly hosts: ReadonlyArray<{ id: string; label: string }>
  readonly onCancel: () => void
  readonly onSave: (input: Parameters<HttpChecksState['save']>[0]) => Promise<void>
}) {
  const t = useT()
  const [label, setLabel] = useState(initial?.label ?? '')
  const [url, setUrl] = useState(initial?.url ?? 'https://')
  const [method, setMethod] = useState<HttpCheckMethod>(initial?.method ?? 'GET')
  const [expectStatus, setExpectStatus] = useState(initial?.expectStatus ?? '200-399')
  const [keyword, setKeyword] = useState(initial?.keyword ?? '')
  const [intervalSec, setIntervalSec] = useState(String(initial?.intervalSec ?? 60))
  const [timeoutMs, setTimeoutMs] = useState(String(initial?.timeoutMs ?? 10_000))
  const [resolveIp, setResolveIp] = useState(initial?.resolveIp ?? '')
  const [failsBeforeAlert, setFails] = useState(String(initial?.failsBeforeAlert ?? 2))
  const [hostId, setHostId] = useState(initial?.hostId ?? '')
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setError(null)
    let parsed: URL
    try {
      parsed = new URL(url.trim())
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('proto')
    } catch {
      return setError(t('http.errUrl'))
    }
    if (!STATUS_SPEC_RE.test(expectStatus)) return setError(t('http.errExpect'))
    const num = (raw: string, [min, max]: readonly [number, number], fallback: number): number => {
      const n = Number(raw)
      return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
    }
    setBusy(true)
    try {
      await onSave({
        id: initial?.id,
        label: label.trim(),
        url: url.trim(),
        method,
        expectStatus: expectStatus.trim(),
        keyword: method === 'GET' ? keyword : '',
        intervalSec: num(intervalSec, LIMITS.intervalSec, 60),
        timeoutMs: num(timeoutMs, LIMITS.timeoutMs, 10_000),
        resolveIp: resolveIp.trim(),
        failsBeforeAlert: num(failsBeforeAlert, LIMITS.failsBeforeAlert, 2),
        hostId: hostId || null,
        enabled
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="text-content mb-2 text-xs font-semibold">{initial ? t('http.editTitle') : t('http.new')}</div>
      <Field label={t('http.url')}>
        <TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/health" autoFocus className="!font-mono" />
      </Field>
      <Field label={t('http.label')}>
        <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('http.labelPh')} />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label={t('http.method')}>
          <Select value={method} onChange={(e) => setMethod(e.target.value as HttpCheckMethod)}>
            <option value="GET">GET</option>
            <option value="HEAD">HEAD</option>
          </Select>
        </Field>
        <Field label={t('http.expect')}>
          <TextInput value={expectStatus} onChange={(e) => setExpectStatus(e.target.value)} placeholder="200-399" className="!font-mono" />
        </Field>
        <Field label={t('http.failsBefore')}>
          <TextInput value={failsBeforeAlert} onChange={(e) => setFails(e.target.value)} placeholder="2" />
        </Field>
      </div>
      <p className="text-subtle -mt-1 mb-2 text-[10px] leading-relaxed">{t('http.expectHint')}</p>
      {method === 'GET' && (
        <Field label={t('http.keyword')}>
          <TextInput value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder={t('http.keywordPh')} />
        </Field>
      )}
      <div className="grid grid-cols-3 gap-2">
        <Field label={t('http.interval')}>
          <TextInput value={intervalSec} onChange={(e) => setIntervalSec(e.target.value)} placeholder="60" />
        </Field>
        <Field label={t('http.timeout')}>
          <TextInput value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} placeholder="10000" />
        </Field>
        <Field label={t('http.resolveIp')}>
          <TextInput value={resolveIp} onChange={(e) => setResolveIp(e.target.value)} placeholder="203.0.113.10" className="!font-mono" />
        </Field>
      </div>
      <p className="text-subtle -mt-1 mb-2 text-[10px] leading-relaxed">{t('http.resolveIpHint')}</p>
      <Field label={t('http.host')}>
        <Select value={hostId} onChange={(e) => setHostId(e.target.value)}>
          <option value="">{t('http.hostNone')}</option>
          {hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.label}
            </option>
          ))}
        </Select>
      </Field>
      <label className="mb-3 flex cursor-pointer items-center gap-2 text-xs">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-accent" />
        <span className="text-content">{t('http.enabled')}</span>
      </label>
      {error && <p className="text-danger mb-3 text-xs">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onCancel}>
          {t('http.back')}
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {t('http.save')}
        </Button>
      </div>
    </form>
  )
}

type HttpChecksState = ReturnType<typeof useHttpChecksStore.getState>
