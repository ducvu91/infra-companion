import { useMemo, useState } from 'react'
import type { ClientImportDraftDto, ClientImportPreviewDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { useToastsStore } from '../stores/toasts'
import { Button, Modal } from './ui'
import { useT } from '../i18n'

const FORMAT_LABEL: Record<ClientImportPreviewDto['format'], string> = {
  putty: 'PuTTY',
  mobaxterm: 'MobaXterm',
  winscp: 'WinSCP',
  termius: 'Termius / CSV'
}

/**
 * Nhập host từ client SSH khác — hai bước: chọn nguồn (file, hoặc PuTTY Registry trên Windows)
 * → bảng xem trước tick chọn → Nhập. Không ghi gì cho tới khi bấm Nhập; mật khẩu trong client
 * gốc không được đọc; key chỉ hiện đường dẫn để user tự import.
 */
export function ClientImportModal({ onClose }: { onClose: () => void }) {
  const t = useT()
  const refreshAll = useDataStore((s) => s.refreshAll)
  const push = useToastsStore((s) => s.push)
  const [preview, setPreview] = useState<ClientImportPreviewDto | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isWindows = window.infra.versions.platform === 'win32'

  const load = async (run: () => Promise<ClientImportPreviewDto | null>, emptyMessage: string): Promise<void> => {
    setError(null)
    setBusy(true)
    try {
      const p = await run()
      if (p === null) {
        setError(emptyMessage)
        return
      }
      setPreview(p)
      setPicked(new Set(p.drafts.map((_, i) => i)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const groups = useMemo(() => {
    if (!preview) return []
    const byGroup = new Map<string, number[]>()
    preview.drafts.forEach((d, i) => {
      const key = d.groupPath ?? ''
      const list = byGroup.get(key)
      if (list) list.push(i)
      else byGroup.set(key, [i])
    })
    return [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [preview])

  const toggle = (i: number): void =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  const commit = async (): Promise<void> => {
    if (!preview) return
    const drafts: ClientImportDraftDto[] = preview.drafts.filter((_, i) => picked.has(i))
    setBusy(true)
    setError(null)
    try {
      const result = await window.infra.importer.clientCommit(drafts, FORMAT_LABEL[preview.format])
      await refreshAll()
      push(t('clientImport.done', { n: result.hostsImported, skipped: result.skipped, groups: result.groupNames.length }), 'info')
      for (const w of result.warnings.slice(0, 3)) push(w)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={t('clientImport.title')} onClose={onClose}>
      <div className="w-[720px] max-w-full">
        <p className="text-muted mb-3 text-xs leading-relaxed">{t('clientImport.desc')}</p>
        <div className="mb-3 flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy} onClick={() => void load(() => window.infra.importer.clientPick(), t('clientImport.notRecognized'))}>
            📂 {t('clientImport.pickFile')}
          </Button>
          {isWindows && (
            <Button disabled={busy} onClick={() => void load(() => window.infra.importer.clientPuttyRegistry(), t('clientImport.noPutty'))}>
              🪟 {t('clientImport.puttyRegistry')}
            </Button>
          )}
        </div>
        <p className="text-subtle mb-3 text-[10px] leading-relaxed">{t('clientImport.formats')}</p>

        {error && <p className="text-danger mb-3 text-xs">{error}</p>}

        {preview && (
          <>
            <div className="mb-2 flex items-center gap-2 text-[11px]">
              <span className="text-content font-medium">
                {FORMAT_LABEL[preview.format]} · {preview.source}
              </span>
              <span className="text-subtle">{t('clientImport.found', { n: preview.drafts.length })}</span>
              <div className="flex-1" />
              <button type="button" className="text-accent hover:text-content" onClick={() => setPicked(new Set(preview.drafts.map((_, i) => i)))}>
                {t('clientImport.selectAll')}
              </button>
              <button type="button" className="text-subtle hover:text-content" onClick={() => setPicked(new Set())}>
                {t('clientImport.selectNone')}
              </button>
            </div>
            {preview.drafts.length === 0 ? (
              <p className="text-subtle py-6 text-center text-xs">{t('clientImport.empty')}</p>
            ) : (
              <div className="border-edge bg-panel max-h-80 overflow-y-auto rounded border">
                {groups.map(([groupPath, indexes]) => (
                  <div key={groupPath || '__root'}>
                    <div className="text-subtle bg-input sticky top-0 px-3 py-1 text-[10px] font-semibold tracking-wider uppercase">
                      {groupPath || t('clientImport.noGroup')} · {indexes.length}
                    </div>
                    {indexes.map((i) => {
                      const d = preview.drafts[i]!
                      return (
                        <label key={i} className="hover:bg-hover flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-xs">
                          <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} className="accent-accent" />
                          <span className="text-content min-w-0 flex-1 truncate">{d.label}</span>
                          <span className="text-subtle truncate font-mono text-[10px]">
                            {d.username ? `${d.username}@` : ''}
                            {d.hostname}:{d.port}
                          </span>
                          {d.protocol !== 'ssh' && <span className="border-edge text-subtle rounded border px-1 text-[9px] uppercase">{d.protocol}</span>}
                          {d.keyPath && (
                            <span className="text-warning shrink-0 text-[10px]" title={d.keyPath}>
                              🔑
                            </span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}
            {preview.warnings.length > 0 && (
              <div className="text-warning mt-2 space-y-0.5 text-[10px] leading-relaxed">
                {preview.warnings.slice(0, 6).map((w, i) => (
                  <div key={i}>⚠ {w}</div>
                ))}
                {preview.warnings.length > 6 && <div>… +{preview.warnings.length - 6}</div>}
              </div>
            )}
            <div className="mt-3 flex items-center justify-end gap-2">
              <span className="text-subtle text-[11px]">{t('clientImport.keyNote')}</span>
              <Button variant="primary" disabled={busy || picked.size === 0} onClick={() => void commit()}>
                {t('clientImport.commit', { n: picked.size })}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
