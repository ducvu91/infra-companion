import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_IGNORES,
  parseIgnores,
  toUpload,
  type DiffEntry,
  type DiffStatus,
  type FolderPairDto,
  type FolderScanDto
} from '@infra/shared'
import { useDataStore } from '../stores/data'
import { useFolderSyncStore, type SyncLogLine } from '../stores/folderSync'
import { useSettingsStore } from '../stores/settings'
import { Button, ConfirmModal, Field, ModalOrPanel, Select, TextArea, TextInput } from './ui'
import { OpenInTabButton } from './OpenInTabButton'
import { useT, type I18nKey } from '../i18n'

const LOCALES = { vi: 'vi-VN', en: 'en-US', ja: 'ja-JP' } as const

const STATUS_KEY: Record<DiffStatus, I18nKey> = {
  same: 'folderSync.status.same',
  'local-newer': 'folderSync.status.localNewer',
  'remote-newer': 'folderSync.status.remoteNewer',
  'local-only': 'folderSync.status.localOnly',
  'remote-only': 'folderSync.status.remoteOnly',
  conflict: 'folderSync.status.conflict'
}

/** Màu nói ngay "việc này đi chiều nào": xanh = đẩy lên, vàng = server mới hơn, đỏ = phải tự xem. */
const STATUS_CLASS: Record<DiffStatus, string> = {
  same: 'text-subtle',
  'local-newer': 'text-success',
  'remote-newer': 'text-warning',
  'local-only': 'text-success',
  'remote-only': 'text-subtle',
  conflict: 'text-danger'
}

const STATUS_ORDER: readonly DiffStatus[] = ['conflict', 'local-newer', 'remote-newer', 'local-only', 'remote-only', 'same']

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * F28/F29 — Cặp thư mục local ↔ remote: bảng so lệch theo mtime + size, nút đẩy các file local
 * mới hơn, và chế độ theo dõi tự đẩy khi lưu file.
 *
 * Chỉ một chiều local → remote. File trên server mới hơn thì bảng hiện màu cảnh báo chứ không tự
 * kéo về: gần như luôn nghĩa là ai đó vừa sửa trực tiếp trên máy đó, ghi đè là mất bản sửa.
 */
export function FolderSyncModal({ onClose, embedded }: { onClose?: () => void; embedded?: boolean }) {
  const t = useT()
  const locale = LOCALES[useSettingsStore((s) => s.language)]
  const allHosts = useDataStore((s) => s.hosts)
  const hosts = useMemo(() => allHosts.filter((h) => h.protocol === 'ssh'), [allHosts])
  const pairs = useFolderSyncStore((s) => s.pairs)
  const scans = useFolderSyncStore((s) => s.scans)
  const busy = useFolderSyncStore((s) => s.busy)
  const watching = useFolderSyncStore((s) => s.watching)
  const log = useFolderSyncStore((s) => s.log)
  const loaded = useFolderSyncStore((s) => s.loaded)
  const load = useFolderSyncStore((s) => s.load)
  const save = useFolderSyncStore((s) => s.save)
  const remove = useFolderSyncStore((s) => s.remove)
  const scan = useFolderSyncStore((s) => s.scan)
  const push = useFolderSyncStore((s) => s.push)
  const setWatch = useFolderSyncStore((s) => s.setWatch)

  const [mode, setMode] = useState<'list' | 'form'>('list')
  const [editing, setEditing] = useState<FolderPairDto | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<FolderPairDto | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const hostLabel = useMemo(() => new Map(hosts.map((h) => [h.id, h.label])), [hosts])
  const ordered = useMemo(() => [...pairs].sort((a, b) => a.name.localeCompare(b.name)), [pairs])

  const doScan = async (id: string): Promise<void> => {
    setMessage(null)
    try {
      await scan(id)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const doPush = async (id: string): Promise<void> => {
    setMessage(null)
    try {
      setMessage(await push(id))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const doWatch = async (id: string, on: boolean): Promise<void> => {
    setMessage(null)
    try {
      await setWatch(id, on)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <ModalOrPanel
      embedded={embedded}
      title={`🔄 ${t('folderSync.title')}`}
      onClose={onClose}
      headerExtra={embedded ? undefined : <OpenInTabButton kind="folder-sync" onDone={onClose} />}
    >
      <div className={embedded ? 'w-full' : 'w-[900px] max-w-full'}>
        {mode === 'form' ? (
          <PairForm
            initial={editing}
            hosts={hosts}
            onCancel={() => setMode('list')}
            onSave={async (input) => {
              const saved = await save(input)
              setSelected(saved.id)
              setMode('list')
            }}
          />
        ) : (
          <>
            <p className="text-subtle mb-3 text-[11px] leading-relaxed">{t('folderSync.hint')}</p>
            {ordered.length === 0 ? (
              <p className="text-subtle py-8 text-center text-xs leading-relaxed">{t('folderSync.empty')}</p>
            ) : (
              <div className="space-y-1.5">
                {ordered.map((pair) => (
                  <PairRow
                    key={pair.id}
                    pair={pair}
                    hostName={hostLabel.get(pair.hostId) ?? pair.hostId}
                    scan={scans[pair.id]}
                    busy={busy.has(pair.id)}
                    watching={watching.has(pair.id)}
                    log={log[pair.id] ?? []}
                    locale={locale}
                    open={selected === pair.id}
                    onToggle={() => setSelected(selected === pair.id ? null : pair.id)}
                    onScan={() => void doScan(pair.id)}
                    onPush={() => void doPush(pair.id)}
                    onWatch={(on) => void doWatch(pair.id, on)}
                    onEdit={() => {
                      setEditing(pair)
                      setMode('form')
                    }}
                    onDelete={() => setConfirmDelete(pair)}
                  />
                ))}
              </div>
            )}
            {message && <p className="text-muted mt-2 text-[11px] leading-relaxed">{message}</p>}
            <div className="mt-3 flex justify-end">
              <Button
                variant="primary"
                onClick={() => {
                  setEditing(null)
                  setMode('form')
                }}
              >
                {t('folderSync.new')}
              </Button>
            </div>
            {confirmDelete && (
              <ConfirmModal
                title={t('folderSync.deleteTitle')}
                message={t('folderSync.deleteMsg', { name: confirmDelete.name })}
                onConfirm={() => {
                  void remove(confirmDelete.id)
                  if (selected === confirmDelete.id) setSelected(null)
                  setConfirmDelete(null)
                }}
                onCancel={() => setConfirmDelete(null)}
              />
            )}
          </>
        )}
      </div>
    </ModalOrPanel>
  )
}

function PairRow({
  pair,
  hostName,
  scan,
  busy,
  watching,
  log,
  locale,
  open,
  onToggle,
  onScan,
  onPush,
  onWatch,
  onEdit,
  onDelete
}: {
  readonly pair: FolderPairDto
  readonly hostName: string
  readonly scan: FolderScanDto | undefined
  readonly busy: boolean
  readonly watching: boolean
  readonly log: readonly SyncLogLine[]
  readonly locale: string
  readonly open: boolean
  readonly onToggle: () => void
  readonly onScan: () => void
  readonly onPush: () => void
  readonly onWatch: (on: boolean) => void
  readonly onEdit: () => void
  readonly onDelete: () => void
}) {
  const t = useT()
  const pending = scan ? toUpload(scan.entries).length : null
  const conflicts = scan?.counts.conflict ?? 0

  return (
    <div className="border-edge bg-input rounded border">
      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
        <span className={`size-2 shrink-0 rounded-full ${watching ? 'bg-success animate-pulse' : 'bg-edge-strong'}`} />
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
          <div className="text-content flex min-w-0 items-center gap-1.5 text-xs">
            <span className="truncate">{pair.name}</span>
            {watching && <span className="text-success shrink-0 text-[10px]">· {t('folderSync.watchingNow')}</span>}
          </div>
          <div className="text-subtle truncate font-mono text-[10px]">
            {pair.localRoot} → {hostName}:{pair.remoteRoot}
          </div>
          <div className="text-subtle flex flex-wrap gap-x-2 text-[10px]">
            {scan ? (
              <>
                <span>
                  {t('folderSync.scannedAt')}: {new Date(scan.scannedAt).toLocaleString(locale, { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className={pending ? 'text-success' : undefined}>{t('folderSync.pendingN', { n: pending ?? 0 })}</span>
                {conflicts > 0 && <span className="text-danger">{t('folderSync.conflictN', { n: conflicts })}</span>}
              </>
            ) : (
              <span>{t('folderSync.notScanned')}</span>
            )}
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Button onClick={onScan} disabled={busy}>
            {busy ? t('folderSync.working') : t('folderSync.scan')}
          </Button>
          <Button variant="primary" onClick={onPush} disabled={busy || pending === 0}>
            {t('folderSync.push')}
          </Button>
          <label className="text-muted hover:bg-hover flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-[10px]">
            <input type="checkbox" checked={watching} onChange={(e) => onWatch(e.target.checked)} className="accent-accent" />
            {t('folderSync.watch')}
          </label>
          <Button onClick={onEdit}>{t('folderSync.edit')}</Button>
          <Button variant="danger" onClick={onDelete}>
            {t('folderSync.delete')}
          </Button>
        </div>
      </div>

      {open && (
        <div className="border-edge border-t px-3 py-2">
          {scan?.warning && <p className="text-warning mb-2 text-[10px] leading-relaxed">⚠ {scan.warning}</p>}
          {scan ? (
            <DiffTable entries={scan.entries} locale={locale} ignored={scan.ignored} />
          ) : (
            <p className="text-subtle py-3 text-center text-[11px]">{t('folderSync.scanFirst')}</p>
          )}
          {log.length > 0 && (
            <div className="border-edge mt-2 border-t pt-2">
              <div className="text-subtle mb-1 text-[10px] font-semibold">{t('folderSync.recent')}</div>
              <div className="max-h-28 space-y-0.5 overflow-y-auto">
                {log.map((line, i) => (
                  <div key={`${line.at}-${i}`} className={`font-mono text-[10px] ${line.ok ? 'text-subtle' : 'text-danger'}`}>
                    {new Date(line.at).toLocaleTimeString(locale)} {line.path ?? ''} — {line.message}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Bảng so lệch. Mặc định ẩn nhóm `same` — chỗ đáng xem là những dòng còn lại. */
function DiffTable({ entries, locale, ignored }: { readonly entries: readonly DiffEntry[]; readonly locale: string; readonly ignored: number }) {
  const t = useT()
  const [showSame, setShowSame] = useState(false)
  const shown = showSame ? entries : entries.filter((e) => e.status !== 'same')
  const sameCount = entries.length - entries.filter((e) => e.status !== 'same').length

  const fmt = (ts: number): string => new Date(ts).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

  return (
    <>
      <div className="text-subtle mb-1 flex flex-wrap items-center gap-2 text-[10px]">
        <span>{t('folderSync.totalN', { n: entries.length })}</span>
        {ignored > 0 && <span>{t('folderSync.ignoredN', { n: ignored })}</span>}
        {sameCount > 0 && (
          <button type="button" onClick={() => setShowSame(!showSame)} className="hover:text-content underline">
            {showSame ? t('folderSync.hideSame') : t('folderSync.showSame', { n: sameCount })}
          </button>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="text-subtle py-3 text-center text-[11px]">{t('folderSync.inSync')}</p>
      ) : (
        <div className="border-edge max-h-64 overflow-auto rounded border">
          <table className="w-full text-[10px]">
            <thead className="bg-app text-subtle sticky top-0">
              <tr>
                <th className="px-2 py-1 text-left font-medium">{t('folderSync.col.file')}</th>
                <th className="px-2 py-1 text-left font-medium">{t('folderSync.col.status')}</th>
                <th className="px-2 py-1 text-right font-medium">{t('folderSync.col.local')}</th>
                <th className="px-2 py-1 text-right font-medium">{t('folderSync.col.remote')}</th>
              </tr>
            </thead>
            <tbody>
              {[...shown]
                .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.path.localeCompare(b.path))
                .map((e) => (
                  <tr key={e.path} className="border-edge border-t">
                    <td className="text-content max-w-[300px] truncate px-2 py-1 font-mono" title={e.path}>
                      {e.path}
                    </td>
                    <td className={`px-2 py-1 ${STATUS_CLASS[e.status]}`}>{t(STATUS_KEY[e.status])}</td>
                    <td className="text-subtle px-2 py-1 text-right whitespace-nowrap">
                      {e.local ? `${formatSize(e.local.size)} · ${fmt(e.local.mtimeMs)}` : '—'}
                    </td>
                    <td className="text-subtle px-2 py-1 text-right whitespace-nowrap">
                      {e.remote ? `${formatSize(e.remote.size)} · ${fmt(e.remote.mtimeMs)}` : '—'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function PairForm({
  initial,
  hosts,
  onCancel,
  onSave
}: {
  readonly initial: FolderPairDto | null
  readonly hosts: ReadonlyArray<{ id: string; label: string }>
  readonly onCancel: () => void
  readonly onSave: (input: Parameters<ReturnType<typeof useFolderSyncStore.getState>['save']>[0]) => Promise<void>
}) {
  const t = useT()
  const [name, setName] = useState(initial?.name ?? '')
  const [hostId, setHostId] = useState(initial?.hostId ?? hosts[0]?.id ?? '')
  const [localRoot, setLocalRoot] = useState(initial?.localRoot ?? '')
  const [remoteRoot, setRemoteRoot] = useState(initial?.remoteRoot ?? '')
  const [ignoreText, setIgnoreText] = useState((initial?.ignores ?? DEFAULT_IGNORES).join('\n'))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const pickLocal = async (): Promise<void> => {
    const picked = await window.infra.folderSync.pickLocal()
    if (picked) setLocalRoot(picked)
  }

  const submit = async (): Promise<void> => {
    setError(null)
    if (!hostId) return setError(t('folderSync.errHost'))
    if (!localRoot.trim()) return setError(t('folderSync.errLocal'))
    if (!remoteRoot.trim().startsWith('/')) return setError(t('folderSync.errRemote'))
    setBusy(true)
    try {
      await onSave({
        id: initial?.id,
        name: name.trim(),
        hostId,
        localRoot: localRoot.trim(),
        remoteRoot: remoteRoot.trim(),
        ignores: parseIgnores(ignoreText),
        watch: initial?.watch ?? false
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
      <div className="text-content mb-2 text-xs font-semibold">{initial ? t('folderSync.editTitle') : t('folderSync.new')}</div>

      <Field label={t('folderSync.name')}>
        <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder={t('folderSync.namePh')} />
      </Field>

      <Field label={t('folderSync.host')}>
        <Select value={hostId} onChange={(e) => setHostId(e.target.value)}>
          <option value="">{t('folderSync.pickHost')}</option>
          {hosts.map((h) => (
            <option key={h.id} value={h.id}>
              {h.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label={t('folderSync.localRoot')}>
        <div className="flex gap-2">
          <TextInput value={localRoot} onChange={(e) => setLocalRoot(e.target.value)} className="!font-mono" placeholder="D:\work\app" />
          <Button onClick={() => void pickLocal()}>{t('folderSync.browse')}</Button>
        </div>
      </Field>

      <Field label={t('folderSync.remoteRoot')}>
        <TextInput value={remoteRoot} onChange={(e) => setRemoteRoot(e.target.value)} className="!font-mono" placeholder="/var/www/app" />
      </Field>

      <Field label={t('folderSync.ignores')}>
        <TextArea value={ignoreText} onChange={(e) => setIgnoreText(e.target.value)} rows={5} className="!font-mono !text-xs" />
      </Field>
      <p className="text-subtle -mt-1 mb-2 text-[10px] leading-relaxed">{t('folderSync.ignoresHint')}</p>

      <p className="text-subtle mb-2 text-[10px] leading-relaxed">{t('folderSync.oneWayHint')}</p>

      {error && <p className="text-danger mb-2 text-[11px] leading-relaxed">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  )
}
