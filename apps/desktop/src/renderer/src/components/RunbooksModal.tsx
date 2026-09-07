import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_VARIANT_ID,
  RUNBOOK_CATEGORIES,
  RUNBOOK_CATEGORY_ICON,
  RUNBOOK_LIBRARY,
  fillVars,
  hasUnfilledVars,
  parseRunbookText,
  renderRunbookText,
  searchRunbooks,
  variantVars,
  type Runbook,
  type RunbookCategory,
  type RunbookStep
} from '@infra/shared'
import { useRunbooksStore } from '../stores/runbooks'
import { useTabsStore } from '../stores/tabs'
import { useToastsStore } from '../stores/toasts'
import { useVaultStore } from '../stores/vault'
import { Button, ConfirmModal, Field, ModalOrPanel, Select, TextArea, TextInput } from './ui'
import { OpenInTabButton } from './OpenInTabButton'
import { useT, type I18nKey } from '../i18n'

const CATEGORY_KEY: Record<RunbookCategory, I18nKey> = {
  firewall: 'runbooks.cat.firewall',
  web: 'runbooks.cat.web',
  ssl: 'runbooks.cat.ssl',
  ssh: 'runbooks.cat.ssh',
  users: 'runbooks.cat.users',
  cron: 'runbooks.cat.cron',
  disk: 'runbooks.cat.disk',
  services: 'runbooks.cat.services',
  database: 'runbooks.cat.database',
  logs: 'runbooks.cat.logs',
  network: 'runbooks.cat.network',
  docker: 'runbooks.cat.docker',
  other: 'runbooks.cat.other'
}

type Mode = { kind: 'view' } | { kind: 'edit'; draft: Runbook }

/**
 * Sổ tay vận hành — các bước làm một việc hay gặp (whitelist IP theo iptables/firewalld/ufw,
 * cron, allow/deny IP ở nginx/Apache, vhost, SSL, siết SSH…) với lệnh chép được, biến `{{ip}}`
 * điền một lần cho cả sổ, chỗ nguy hiểm phải xác nhận, và **sổ tay riêng** user tự viết (lưu
 * trong vault). Mục đích: việc vài tháng làm một lần không phải tra lại từ đầu.
 */
export function RunbooksModal({ onClose, embedded }: { onClose?: () => void; embedded?: boolean }) {
  const t = useT()
  const vaultState = useVaultStore((s) => s.state)
  const custom = useRunbooksStore((s) => s.custom)
  const loaded = useRunbooksStore((s) => s.loaded)
  const loadError = useRunbooksStore((s) => s.error)
  const load = useRunbooksStore((s) => s.load)
  const save = useRunbooksStore((s) => s.save)
  const remove = useRunbooksStore((s) => s.remove)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(RUNBOOK_LIBRARY[0]?.id ?? null)
  const [mode, setMode] = useState<Mode>({ kind: 'view' })
  const [confirmDelete, setConfirmDelete] = useState<Runbook | null>(null)

  useEffect(() => {
    if (!loaded || vaultState === 'unlocked') void load()
  }, [loaded, load, vaultState])

  const all = useMemo(() => [...custom, ...RUNBOOK_LIBRARY], [custom])
  const shown = useMemo(() => searchRunbooks(all, query), [all, query])
  const selected = all.find((r) => r.id === selectedId) ?? null

  const byCategory = useMemo(() => {
    const groups = new Map<RunbookCategory, Runbook[]>()
    for (const rb of shown.filter((r) => r.builtin)) {
      const list = groups.get(rb.category)
      if (list) list.push(rb)
      else groups.set(rb.category, [rb])
    }
    return RUNBOOK_CATEGORIES.filter((c) => groups.has(c)).map((c) => ({ category: c, items: groups.get(c)! }))
  }, [shown])
  const mine = shown.filter((r) => !r.builtin)

  const startNew = (): void =>
    setMode({
      kind: 'edit',
      draft: {
        id: crypto.randomUUID(),
        title: '',
        category: 'other',
        tags: [],
        summary: '',
        warnings: [],
        variants: [{ id: DEFAULT_VARIANT_ID, label: '', steps: [] }],
        builtin: false
      }
    })

  /** Sao chép sổ tay có sẵn (variant đang xem) thành bản của mình để sửa theo hạ tầng thật. */
  const cloneToMine = (rb: Runbook, variantId: string): void => {
    const variant = rb.variants.find((v) => v.id === variantId) ?? rb.variants[0]!
    setMode({
      kind: 'edit',
      draft: {
        ...rb,
        id: crypto.randomUUID(),
        title: `${rb.title}${variant.label ? ` (${variant.label})` : ''}`,
        variants: [{ id: DEFAULT_VARIANT_ID, label: '', steps: variant.steps }],
        builtin: false
      }
    })
  }

  return (
    <ModalOrPanel
      embedded={embedded}
      title={`📖 ${t('runbooks.title')}`}
      onClose={onClose}
      headerExtra={embedded ? undefined : <OpenInTabButton kind="runbooks" onDone={onClose} />}
    >
      <div className={`flex gap-4 ${embedded ? 'h-full w-full' : 'h-[70vh] w-[1000px] max-w-full'}`}>
        {/* Cột trái: tìm + danh sách */}
        <div className="border-edge flex w-72 shrink-0 flex-col border-r pr-3">
          <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('runbooks.search')} className="mb-2" />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-subtle text-[10px] font-semibold tracking-wider uppercase">{t('runbooks.mine')}</span>
              <button type="button" className="text-accent hover:text-content text-[11px]" onClick={startNew}>
                {t('runbooks.new')}
              </button>
            </div>
            {loadError && <p className="text-subtle mb-2 px-1 text-[10px] leading-relaxed">{t('runbooks.locked')}</p>}
            {!loadError && mine.length === 0 && <p className="text-subtle mb-2 px-1 text-[10px] italic">{t('runbooks.mineEmpty')}</p>}
            {mine.map((rb) => (
              <ListItem key={rb.id} rb={rb} selected={rb.id === selectedId} onClick={() => { setSelectedId(rb.id); setMode({ kind: 'view' }) }} />
            ))}
            {byCategory.map(({ category, items }) => (
              <div key={category} className="mt-2">
                <div className="text-subtle mb-0.5 text-[10px] font-semibold tracking-wider uppercase">
                  {RUNBOOK_CATEGORY_ICON[category]} {t(CATEGORY_KEY[category])}
                </div>
                {items.map((rb) => (
                  <ListItem key={rb.id} rb={rb} selected={rb.id === selectedId} onClick={() => { setSelectedId(rb.id); setMode({ kind: 'view' }) }} />
                ))}
              </div>
            ))}
            {shown.length === 0 && <p className="text-subtle py-6 text-center text-xs">{t('runbooks.empty')}</p>}
          </div>
        </div>

        {/* Cột phải: chi tiết hoặc soạn */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1">
          {mode.kind === 'edit' ? (
            <RunbookEditor
              draft={mode.draft}
              onCancel={() => setMode({ kind: 'view' })}
              onSave={async (rb) => {
                await save(rb)
                setSelectedId(rb.id)
                setMode({ kind: 'view' })
              }}
            />
          ) : selected ? (
            <RunbookDetail
              rb={selected}
              onEdit={() => setMode({ kind: 'edit', draft: selected })}
              onDelete={() => setConfirmDelete(selected)}
              onClone={(variantId) => cloneToMine(selected, variantId)}
            />
          ) : (
            <p className="text-subtle py-10 text-center text-xs">{t('runbooks.pick')}</p>
          )}
        </div>
      </div>
      {confirmDelete && (
        <ConfirmModal
          title={t('runbooks.deleteTitle')}
          message={t('runbooks.deleteMsg', { title: confirmDelete.title })}
          onConfirm={() => {
            void remove(confirmDelete.id)
            if (selectedId === confirmDelete.id) setSelectedId(RUNBOOK_LIBRARY[0]?.id ?? null)
            setConfirmDelete(null)
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </ModalOrPanel>
  )
}

function ListItem({ rb, selected, onClick }: { readonly rb: Runbook; readonly selected: boolean; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full rounded px-2 py-1.5 text-left ${selected ? 'bg-accent-soft/40 text-content' : 'text-muted hover:bg-hover hover:text-content'}`}
      style={selected ? { boxShadow: 'inset 2px 0 0 var(--c-accent)' } : undefined}
    >
      <div className="truncate text-xs">
        {!rb.builtin && <span className="mr-1">📌</span>}
        {rb.title}
      </div>
      {rb.tags.length > 0 && <div className="text-subtle truncate text-[10px]">{rb.tags.slice(0, 5).join(' · ')}</div>}
    </button>
  )
}

/** Chi tiết một sổ tay: cảnh báo → chọn hệ → điền biến → từng bước với Chép / Gửi vào terminal. */
function RunbookDetail({
  rb,
  onEdit,
  onDelete,
  onClone
}: {
  readonly rb: Runbook
  readonly onEdit: () => void
  readonly onDelete: () => void
  readonly onClone: (variantId: string) => void
}) {
  const t = useT()
  const push = useToastsStore((s) => s.push)
  const { tabs, activeId } = useTabsStore()
  const [variantId, setVariantId] = useState(rb.variants[0]!.id)
  const [values, setValues] = useState<Record<string, string>>({})
  const [pendingDanger, setPendingDanger] = useState<(() => void) | null>(null)

  // Đổi sổ tay → về variant đầu, giữ biến đã điền (ip/port dùng lại được giữa các sổ)
  useEffect(() => {
    setVariantId(rb.variants[0]!.id)
  }, [rb.id, rb.variants])

  const variant = rb.variants.find((v) => v.id === variantId) ?? rb.variants[0]!
  const vars = variantVars(variant)

  /** Pane terminal đang kết nối ở tab active — đích của nút Gửi. */
  const targetPane = (() => {
    const tab = tabs.find((x) => x.id === activeId)
    if (!tab || tab.kind !== 'terminal') return null
    const pane = tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0]
    return pane && pane.status === 'connected' ? pane : null
  })()

  const guard = (step: RunbookStep, action: () => void): void => {
    if (step.danger) setPendingDanger(() => action)
    else action()
  }

  const copy = (step: RunbookStep): void =>
    guard(step, () => {
      void navigator.clipboard.writeText(fillVars(step.command ?? '', values)).then(() => push(t('runbooks.copied'), 'info'))
    })

  const send = (step: RunbookStep): void => {
    const cmd = fillVars(step.command ?? '', values)
    if (hasUnfilledVars(cmd, values)) return push(t('runbooks.unfilled'))
    if (!targetPane) return push(t('runbooks.noPane'))
    guard(step, () => {
      window.infra.terminal.write(targetPane.sessionId, cmd.endsWith('\n') ? cmd : cmd + '\n')
      push(t('runbooks.sent', { label: targetPane.title }), 'info')
    })
  }

  return (
    <div>
      <div className="mb-1 flex items-start gap-2">
        <h3 className="text-content min-w-0 flex-1 text-base font-semibold">
          {RUNBOOK_CATEGORY_ICON[rb.category]} {rb.title}
        </h3>
        {rb.builtin ? (
          <Button className="!px-2 !py-1 !text-xs" onClick={() => onClone(variant.id)}>
            {t('runbooks.clone')}
          </Button>
        ) : (
          <>
            <Button className="!px-2 !py-1 !text-xs" onClick={onEdit}>
              {t('runbooks.edit')}
            </Button>
            <Button variant="danger" className="!px-2 !py-1 !text-xs" onClick={onDelete}>
              {t('common.delete')}
            </Button>
          </>
        )}
      </div>
      {rb.summary && <p className="text-muted mb-3 text-xs leading-relaxed">{rb.summary}</p>}
      {rb.tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {rb.tags.map((tag) => (
            <span key={tag} className="border-edge text-subtle rounded-full border px-2 py-0.5 text-[10px]">
              {tag}
            </span>
          ))}
        </div>
      )}
      {rb.warnings.length > 0 && (
        <div className="border-danger/40 bg-danger/10 mb-3 rounded border px-3 py-2 text-[11px] leading-relaxed">
          <div className="text-danger mb-1 font-medium">⚠ {t('runbooks.warnings')}</div>
          <ul className="text-muted list-disc space-y-0.5 pl-4">
            {rb.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {(rb.variants.length > 1 || rb.variants[0]!.label) && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {rb.variants.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setVariantId(v.id)}
              className={`rounded border px-2.5 py-1 text-xs ${v.id === variant.id ? 'border-accent text-content bg-accent-soft/40' : 'border-edge text-muted hover:bg-hover'}`}
            >
              {v.label || v.id}
            </button>
          ))}
        </div>
      )}

      {vars.length > 0 && (
        <div className="border-edge bg-input mb-3 rounded border p-3">
          <div className="text-subtle mb-1.5 text-[10px] font-semibold tracking-wider uppercase">{t('runbooks.vars')}</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {vars.map((name) => (
              <label key={name} className="block">
                <span className="text-subtle block font-mono text-[10px]">{`{{${name}}}`}</span>
                <TextInput value={values[name] ?? ''} onChange={(e) => setValues((prev) => ({ ...prev, [name]: e.target.value }))} className="!font-mono !text-xs" />
              </label>
            ))}
          </div>
          <p className="text-subtle mt-1.5 text-[10px]">{t('runbooks.varHint')}</p>
        </div>
      )}

      <ol className="space-y-2.5">
        {variant.steps.map((step, i) => (
          <li key={i} className={`border-edge bg-panel rounded border ${step.danger ? 'border-l-2 border-l-danger' : ''}`}>
            <div className="flex items-center gap-2 px-3 pt-2">
              <span className="bg-hover text-muted flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold">{i + 1}</span>
              <span className="text-content min-w-0 flex-1 text-xs font-medium">{step.title}</span>
              {step.danger && <span className="text-danger shrink-0 text-[10px] font-semibold">⚠ {t('runbooks.dangerTitle')}</span>}
            </div>
            {step.command && (
              <div className="group relative mx-3 mt-1.5">
                <pre className="bg-app border-edge text-content overflow-x-auto rounded border px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre">
                  {fillVars(step.command, values)}
                </pre>
                <div className="absolute top-1 right-1 flex gap-1">
                  <button type="button" className="bg-elevated border-edge text-muted hover:text-content rounded border px-1.5 py-0.5 text-[10px]" title={t('runbooks.copy')} onClick={() => copy(step)}>
                    ⧉ {t('runbooks.copy')}
                  </button>
                  <button
                    type="button"
                    className={`bg-elevated border-edge rounded border px-1.5 py-0.5 text-[10px] ${targetPane ? 'text-muted hover:text-content' : 'text-subtle/60'}`}
                    title={targetPane ? t('runbooks.send') : t('runbooks.noPane')}
                    onClick={() => send(step)}
                  >
                    ▶ {t('runbooks.send')}
                  </button>
                </div>
              </div>
            )}
            {step.note && <p className="text-subtle px-3 pt-1.5 pb-2 text-[11px] leading-relaxed whitespace-pre-line">{step.note}</p>}
            {!step.note && <div className="pb-2" />}
          </li>
        ))}
      </ol>
      {pendingDanger && (
        <ConfirmModal
          title={t('runbooks.dangerTitle')}
          message={t('runbooks.dangerMsg')}
          onConfirm={() => {
            pendingDanger()
            setPendingDanger(null)
          }}
          onCancel={() => setPendingDanger(null)}
        />
      )}
    </div>
  )
}

/** Soạn sổ tay riêng: các trường đơn giản + các bước viết theo định dạng `##` / `$` / `!!`. */
function RunbookEditor({ draft, onCancel, onSave }: { readonly draft: Runbook; readonly onCancel: () => void; readonly onSave: (rb: Runbook) => Promise<void> }) {
  const t = useT()
  const [title, setTitle] = useState(draft.title)
  const [category, setCategory] = useState<RunbookCategory>(draft.category)
  const [tags, setTags] = useState(draft.tags.join(', '))
  const [summary, setSummary] = useState(draft.summary)
  const [warnings, setWarnings] = useState(draft.warnings.join('\n'))
  const [stepsText, setStepsText] = useState(renderRunbookText(draft.variants[0]?.steps ?? []))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const parsed = useMemo(() => parseRunbookText(stepsText), [stepsText])

  const submit = async (): Promise<void> => {
    setError(null)
    if (!title.trim()) return setError(t('runbooks.form.errTitle'))
    if (parsed.length === 0) return setError(t('runbooks.form.errSteps'))
    setBusy(true)
    try {
      await onSave({
        id: draft.id,
        title: title.trim(),
        category,
        tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
        summary: summary.trim(),
        warnings: warnings.split('\n').map((s) => s.trim()).filter(Boolean),
        variants: [{ id: DEFAULT_VARIANT_ID, label: '', steps: parsed }],
        builtin: false
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
      <div className="text-content mb-2 text-xs font-semibold">{t('runbooks.form.heading')}</div>
      <Field label={t('runbooks.form.title')}>
        <TextInput value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder={t('runbooks.form.titlePh')} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('runbooks.form.category')}>
          <Select value={category} onChange={(e) => setCategory(e.target.value as RunbookCategory)}>
            {RUNBOOK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {RUNBOOK_CATEGORY_ICON[c]} {t(CATEGORY_KEY[c])}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('runbooks.form.tags')}>
          <TextInput value={tags} onChange={(e) => setTags(e.target.value)} placeholder={t('runbooks.form.tagsPh')} />
        </Field>
      </div>
      <Field label={t('runbooks.form.summary')}>
        <TextArea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} />
      </Field>
      <Field label={t('runbooks.form.warnings')}>
        <TextArea value={warnings} onChange={(e) => setWarnings(e.target.value)} rows={2} placeholder={t('runbooks.form.warningsPh')} />
      </Field>
      <Field label={`${t('runbooks.form.steps')} · ${t('runbooks.steps', { n: parsed.length })}`}>
        <TextArea value={stepsText} onChange={(e) => setStepsText(e.target.value)} rows={14} className="!font-mono !text-xs" placeholder={t('runbooks.form.stepsPh')} />
      </Field>
      <p className="text-subtle -mt-1 mb-3 text-[10px] leading-relaxed whitespace-pre-line">{t('runbooks.form.stepsHint')}</p>
      {error && <p className="text-danger mb-3 text-xs">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onCancel}>
          {t('runbooks.form.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {t('runbooks.form.save')}
        </Button>
      </div>
    </form>
  )
}
