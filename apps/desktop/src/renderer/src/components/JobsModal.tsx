import { useEffect, useMemo, useState } from 'react'
import {
  JOB_TIMEOUT_LIMITS,
  isValidCronExpression,
  nextCronRun,
  summarizeRun,
  type JobFailMode,
  type JobKind,
  type JobRunDto,
  type ScheduledJobDto
} from '@infra/shared'
import { useDataStore } from '../stores/data'
import { useJobsStore } from '../stores/jobs'
import { useSettingsStore } from '../stores/settings'
import { Button, ConfirmModal, Field, ModalOrPanel, Select, TextArea, TextInput } from './ui'
import { OpenInTabButton } from './OpenInTabButton'
import { useT, type I18nKey } from '../i18n'

const LOCALES = { vi: 'vi-VN', en: 'en-US', ja: 'ja-JP' } as const

const KIND_KEY: Record<JobKind, I18nKey> = {
  command: 'jobs.kind.command',
  snippet: 'jobs.kind.snippet',
  inventory: 'jobs.kind.inventory'
}
const KIND_ICON: Record<JobKind, string> = { command: '⌨', snippet: '📝', inventory: '📇' }

const FAIL_KEY: Record<JobFailMode, I18nKey> = {
  'any-host': 'jobs.fail.anyHost',
  'all-hosts': 'jobs.fail.allHosts',
  never: 'jobs.fail.never'
}

/** Lịch gợi ý sẵn — người ta hầu như luôn muốn một trong mấy cái này. */
const PRESETS: Array<{ expr: string; key: I18nKey }> = [
  { expr: '*/15 * * * *', key: 'jobs.preset.q15' },
  { expr: '0 * * * *', key: 'jobs.preset.hourly' },
  { expr: '15 3 * * *', key: 'jobs.preset.daily315' },
  { expr: '0 2 * * *', key: 'jobs.preset.daily2' },
  { expr: '0 8 * * 1', key: 'jobs.preset.weeklyMon8' },
  { expr: '0 0 1 * *', key: 'jobs.preset.monthly' }
]

/**
 * F40 — Lịch chạy tự động: chạy một lệnh, một snippet, hay thu kiểm kê fleet theo lịch cron, giữ
 * lịch sử từng lượt và báo khi thất bại.
 *
 * Đi cùng khay hệ thống (v0.2.22): app đóng cửa sổ vẫn sống nên lịch mới có ý nghĩa. Lịch nằm
 * ngoài vault để đọc được lúc khoá, nhưng lượt chạy cần vault mở — lượt gặp vault khoá được ghi
 * là "bỏ lượt" kèm lý do, không im lặng.
 */
export function JobsModal({ onClose, embedded }: { onClose?: () => void; embedded?: boolean }) {
  const t = useT()
  const locale = LOCALES[useSettingsStore((s) => s.language)]
  const allHosts = useDataStore((s) => s.hosts)
  const hosts = useMemo(() => allHosts.filter((h) => h.protocol === 'ssh'), [allHosts])
  const snippets = useDataStore((s) => s.snippets)
  const jobs = useJobsStore((s) => s.jobs)
  const latest = useJobsStore((s) => s.latest)
  const running = useJobsStore((s) => s.running)
  const loaded = useJobsStore((s) => s.loaded)
  const load = useJobsStore((s) => s.load)
  const save = useJobsStore((s) => s.save)
  const remove = useJobsStore((s) => s.remove)
  const runNow = useJobsStore((s) => s.runNow)
  const [mode, setMode] = useState<'list' | 'form'>('list')
  const [editing, setEditing] = useState<ScheduledJobDto | null>(null)
  const [openRuns, setOpenRuns] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ScheduledJobDto | null>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const hostLabel = useMemo(() => new Map(hosts.map((h) => [h.id, h.label])), [hosts])
  const ordered = useMemo(() => [...jobs].sort((a, b) => a.label.localeCompare(b.label)), [jobs])

  return (
    <ModalOrPanel
      embedded={embedded}
      title={`⏰ ${t('jobs.title')}`}
      onClose={onClose}
      headerExtra={embedded ? undefined : <OpenInTabButton kind="jobs" onDone={onClose} />}
    >
      <div className={embedded ? 'w-full' : 'w-[860px] max-w-full'}>
        {mode === 'list' ? (
          <>
            <p className="text-subtle mb-3 text-[11px] leading-relaxed">{t('jobs.hint')}</p>
            {ordered.length === 0 ? (
              <p className="text-subtle py-8 text-center text-xs leading-relaxed">{t('jobs.empty')}</p>
            ) : (
              <div className="space-y-1.5">
                {ordered.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    last={latest[job.id]}
                    busy={running.has(job.id)}
                    locale={locale}
                    hostLabel={hostLabel}
                    snippetLabel={snippets.find((s) => s.id === job.snippetId)?.label}
                    runsOpen={openRuns === job.id}
                    onToggleRuns={() => setOpenRuns(openRuns === job.id ? null : job.id)}
                    onRun={() => void runNow(job.id)}
                    onToggleEnabled={() =>
                      void save({
                        id: job.id,
                        label: job.label,
                        kind: job.kind,
                        schedule: job.schedule,
                        hostIds: job.hostIds,
                        command: job.command,
                        snippetId: job.snippetId,
                        enabled: !job.enabled,
                        failMode: job.failMode,
                        timeoutMs: job.timeoutMs
                      })
                    }
                    onEdit={() => {
                      setEditing(job)
                      setMode('form')
                    }}
                    onDelete={() => setConfirmDelete(job)}
                  />
                ))}
              </div>
            )}
            <div className="mt-3 flex justify-end">
              <Button
                variant="primary"
                onClick={() => {
                  setEditing(null)
                  setMode('form')
                }}
              >
                {t('jobs.new')}
              </Button>
            </div>
            {confirmDelete && (
              <ConfirmModal
                title={t('jobs.deleteTitle')}
                message={t('jobs.deleteMsg', { label: confirmDelete.label })}
                onConfirm={() => {
                  void remove(confirmDelete.id)
                  setConfirmDelete(null)
                }}
                onCancel={() => setConfirmDelete(null)}
              />
            )}
          </>
        ) : (
          <JobForm
            initial={editing}
            hosts={hosts}
            snippets={snippets}
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

function JobRow({
  job,
  last,
  busy,
  locale,
  hostLabel,
  snippetLabel,
  runsOpen,
  onToggleRuns,
  onRun,
  onToggleEnabled,
  onEdit,
  onDelete
}: {
  readonly job: ScheduledJobDto
  readonly last: JobRunDto | undefined
  readonly busy: boolean
  readonly locale: string
  readonly hostLabel: Map<string, string>
  readonly snippetLabel: string | undefined
  readonly runsOpen: boolean
  readonly onToggleRuns: () => void
  readonly onRun: () => void
  readonly onToggleEnabled: () => void
  readonly onEdit: () => void
  readonly onDelete: () => void
}) {
  const t = useT()
  const next = job.enabled ? nextCronRun(job.schedule, job.lastRunAt ?? Date.now()) : null
  const dot = !job.enabled
    ? 'bg-edge-strong'
    : busy
      ? 'bg-warning animate-pulse'
      : last?.status === 'failed'
        ? 'bg-danger'
        : last?.status === 'skipped'
          ? 'bg-warning'
          : last
            ? 'bg-success'
            : 'bg-edge-strong'
  const fmt = (ts: number): string => new Date(ts).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const targets =
    job.kind === 'inventory' && job.hostIds.length === 0
      ? t('jobs.allSshHosts')
      : job.hostIds.length <= 2
        ? job.hostIds.map((id) => hostLabel.get(id) ?? id).join(', ')
        : t('jobs.nHosts', { n: job.hostIds.length })

  return (
    <div className="border-edge bg-input rounded border">
      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
        <span className={`size-2 shrink-0 rounded-full ${dot}`} />
        <span className="shrink-0 text-sm leading-none">{KIND_ICON[job.kind]}</span>
        <div className="min-w-0 flex-1">
          <div className="text-content flex min-w-0 items-center gap-1.5 text-xs">
            <span className="truncate">{job.label}</span>
            {!job.enabled && <span className="text-subtle shrink-0 text-[10px]">· {t('jobs.paused')}</span>}
          </div>
          <div className="text-subtle truncate font-mono text-[10px]">
            {job.schedule} · {targets}
            {snippetLabel && ` · ${snippetLabel}`}
          </div>
          <div className={`flex flex-wrap gap-x-2 text-[10px] ${last?.status === 'failed' ? 'text-danger' : 'text-subtle'}`}>
            {last ? (
              <span>
                {t('jobs.lastRun')}: {fmt(last.startedAt)} — {summarizeRun(last)}
              </span>
            ) : (
              <span>{t('jobs.neverRan')}</span>
            )}
            {next !== null && (
              <span>
                {t('jobs.nextRun')}: {fmt(next)}
              </span>
            )}
          </div>
        </div>
        <button type="button" className="text-subtle hover:text-content shrink-0 text-[11px]" onClick={onToggleRuns}>
          {runsOpen ? t('jobs.hideRuns') : t('jobs.showRuns')}
        </button>
        <Button type="button" className="!px-2 !py-1 !text-xs" disabled={busy} onClick={onRun}>
          {busy ? '…' : `▶ ${t('jobs.runNow')}`}
        </Button>
        <Button type="button" className="!px-2 !py-1 !text-xs" onClick={onToggleEnabled}>
          {job.enabled ? t('jobs.pause') : t('jobs.resume')}
        </Button>
        <Button type="button" className="!px-2 !py-1 !text-xs" onClick={onEdit}>
          {t('jobs.edit')}
        </Button>
        <Button type="button" variant="danger" className="!px-2 !py-1 !text-xs" onClick={onDelete}>
          {t('common.delete')}
        </Button>
      </div>
      {runsOpen && <JobRuns jobId={job.id} locale={locale} hostLabel={hostLabel} lastSeen={last?.id} />}
    </div>
  )
}

/** Lịch sử các lượt của một job — mở ra mới hỏi main (job nào cũng giữ 50 lượt). */
function JobRuns({ jobId, locale, hostLabel, lastSeen }: { readonly jobId: string; readonly locale: string; readonly hostLabel: Map<string, string>; readonly lastSeen: number | undefined }) {
  const t = useT()
  const [runs, setRuns] = useState<JobRunDto[] | null>(null)
  const [openRun, setOpenRun] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    void window.infra.jobs.runs(jobId).then((rows) => {
      if (alive) setRuns(rows)
    })
    return () => {
      alive = false
    }
  }, [jobId, lastSeen])

  if (runs === null) return <div className="text-subtle px-3 pb-2 text-[11px]">…</div>
  if (runs.length === 0) return <div className="text-subtle px-3 pb-2 text-[11px]">{t('jobs.noRuns')}</div>

  return (
    <div className="border-edge divide-edge/60 divide-y border-t">
      {runs.map((run) => {
        const bad = run.hosts.filter((h) => !h.ok)
        const tone = run.status === 'failed' ? 'text-danger' : run.status === 'skipped' ? 'text-warning' : 'text-muted'
        return (
          <div key={run.id} className="px-3 py-1.5">
            <button type="button" className="flex w-full items-center gap-2 text-left text-[11px]" onClick={() => setOpenRun(openRun === run.id ? null : run.id)}>
              <span className="text-subtle shrink-0 tabular-nums">
                {new Date(run.startedAt).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className={`min-w-0 flex-1 truncate ${tone}`}>{summarizeRun(run)}</span>
              <span className="text-subtle shrink-0">{(run.durationMs / 1000).toFixed(1)}s</span>
              {run.hosts.length > 0 && <span className="text-subtle shrink-0">{openRun === run.id ? '▾' : '▸'}</span>}
            </button>
            {openRun === run.id && run.hosts.length > 0 && (
              <div className="mt-1 space-y-1">
                {[...bad, ...run.hosts.filter((h) => h.ok)].map((h) => (
                  <div key={h.hostId} className="border-edge bg-app rounded border px-2 py-1">
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className={`size-1.5 shrink-0 rounded-full ${h.ok ? 'bg-success' : 'bg-danger'}`} />
                      <span className="text-content min-w-0 flex-1 truncate">{hostLabel.get(h.hostId) ?? h.hostId}</span>
                      <span className="text-subtle shrink-0">
                        {h.code !== null ? `exit ${h.code}` : ''} {h.durationMs > 0 ? `· ${(h.durationMs / 1000).toFixed(1)}s` : ''}
                      </span>
                    </div>
                    {h.error && <div className="text-danger text-[10px] leading-relaxed">{h.error}</div>}
                    {(h.stdout || h.stderr) && (
                      <pre className="text-subtle max-h-32 overflow-auto font-mono text-[10px] leading-relaxed whitespace-pre-wrap">
                        {[h.stdout, h.stderr].filter(Boolean).join('\n')}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function JobForm({
  initial,
  hosts,
  snippets,
  onCancel,
  onSave
}: {
  readonly initial: ScheduledJobDto | null
  readonly hosts: ReadonlyArray<{ id: string; label: string }>
  readonly snippets: ReadonlyArray<{ id: string; label: string; script: string }>
  readonly onCancel: () => void
  readonly onSave: (input: Parameters<ReturnType<typeof useJobsStore.getState>['save']>[0]) => Promise<void>
}) {
  const t = useT()
  const [label, setLabel] = useState(initial?.label ?? '')
  const [kind, setKind] = useState<JobKind>(initial?.kind ?? 'command')
  const [schedule, setSchedule] = useState(initial?.schedule ?? '15 3 * * *')
  const [command, setCommand] = useState(initial?.command ?? '')
  const [snippetId, setSnippetId] = useState(initial?.snippetId ?? '')
  const [hostIds, setHostIds] = useState<Set<string>>(() => new Set(initial?.hostIds ?? []))
  const [failMode, setFailMode] = useState<JobFailMode>(initial?.failMode ?? 'any-host')
  const [timeoutMs, setTimeoutMs] = useState(String(initial?.timeoutMs ?? JOB_TIMEOUT_LIMITS.default))
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const scheduleOk = isValidCronExpression(schedule)
  const next = scheduleOk ? nextCronRun(schedule, Date.now()) : null
  const needHosts = kind !== 'inventory'

  const toggleHost = (id: string): void =>
    setHostIds((prev) => {
      const nextSet = new Set(prev)
      if (nextSet.has(id)) nextSet.delete(id)
      else nextSet.add(id)
      return nextSet
    })

  const submit = async (): Promise<void> => {
    setError(null)
    if (!scheduleOk) return setError(t('jobs.errSchedule'))
    if (kind === 'command' && !command.trim()) return setError(t('jobs.errCommand'))
    if (kind === 'snippet' && !snippetId) return setError(t('jobs.errSnippet'))
    if (needHosts && hostIds.size === 0) return setError(t('jobs.errHosts'))
    const n = Number(timeoutMs)
    setBusy(true)
    try {
      await onSave({
        id: initial?.id,
        label: label.trim(),
        kind,
        schedule: schedule.trim(),
        hostIds: [...hostIds],
        command: kind === 'command' ? command : '',
        snippetId: kind === 'snippet' ? snippetId : null,
        enabled,
        failMode,
        timeoutMs: Number.isFinite(n) ? n : JOB_TIMEOUT_LIMITS.default
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
      <div className="text-content mb-2 text-xs font-semibold">{initial ? t('jobs.editTitle') : t('jobs.new')}</div>

      <Field label={t('jobs.kind')}>
        <div className="grid grid-cols-3 gap-2">
          {(['command', 'snippet', 'inventory'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded border px-2 py-2 text-xs ${kind === k ? 'border-accent text-content bg-accent-soft/40' : 'border-edge text-muted hover:bg-hover'}`}
            >
              {KIND_ICON[k]} {t(KIND_KEY[k])}
            </button>
          ))}
        </div>
      </Field>

      {kind === 'command' && (
        <Field label={t('jobs.command')}>
          <TextArea value={command} onChange={(e) => setCommand(e.target.value)} rows={3} className="!font-mono !text-xs" placeholder={t('jobs.commandPh')} />
        </Field>
      )}
      {kind === 'snippet' && (
        <Field label={t('jobs.snippet')}>
          <Select value={snippetId} onChange={(e) => setSnippetId(e.target.value)}>
            <option value="">{t('jobs.pickSnippet')}</option>
            {snippets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field label={t('jobs.schedule')}>
        <TextInput value={schedule} onChange={(e) => setSchedule(e.target.value)} className="!font-mono" placeholder="15 3 * * *" />
      </Field>
      <div className="-mt-1 mb-2 flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.expr}
            type="button"
            onClick={() => setSchedule(p.expr)}
            className={`rounded-full border px-2 py-0.5 text-[10px] ${schedule === p.expr ? 'border-accent text-content bg-accent-soft/40' : 'border-edge text-muted hover:bg-hover'}`}
          >
            {t(p.key)}
          </button>
        ))}
      </div>
      <p className={`-mt-1 mb-2 text-[10px] leading-relaxed ${scheduleOk ? 'text-subtle' : 'text-danger'}`}>
        {scheduleOk
          ? next !== null
            ? t('jobs.nextIs', { time: new Date(next).toLocaleString() })
            : t('jobs.neverMatches')
          : t('jobs.errSchedule')}
      </p>

      <Field label={needHosts ? t('jobs.hosts', { n: hostIds.size }) : t('jobs.hostsOptional', { n: hostIds.size })}>
        <div className="border-edge bg-input max-h-40 overflow-y-auto rounded border p-1">
          {kind === 'inventory' && hostIds.size === 0 && <p className="text-subtle px-2 py-1 text-[10px] italic">{t('jobs.allSshHostsHint')}</p>}
          {hosts.map((h) => (
            <label key={h.id} className="text-muted hover:bg-hover flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs">
              <input type="checkbox" checked={hostIds.has(h.id)} onChange={() => toggleHost(h.id)} className="accent-accent" />
              <span className="min-w-0 flex-1 truncate">{h.label}</span>
            </label>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label={t('jobs.failMode')}>
          <Select value={failMode} onChange={(e) => setFailMode(e.target.value as JobFailMode)}>
            {(['any-host', 'all-hosts', 'never'] as const).map((m) => (
              <option key={m} value={m}>
                {t(FAIL_KEY[m])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('jobs.timeout')}>
          <TextInput value={timeoutMs} onChange={(e) => setTimeoutMs(e.target.value)} placeholder="120000" />
        </Field>
      </div>

      <Field label={t('jobs.label')}>
        <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('jobs.labelPh')} />
      </Field>

      <label className="mb-3 flex cursor-pointer items-center gap-2 text-xs">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-accent" />
        <span className="text-content">{t('jobs.enabled')}</span>
      </label>

      <p className="text-subtle mb-3 text-[10px] leading-relaxed">{t('jobs.vaultNote')}</p>
      {error && <p className="text-danger mb-3 text-xs">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onCancel}>
          {t('jobs.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {t('jobs.save')}
        </Button>
      </div>
    </form>
  )
}
