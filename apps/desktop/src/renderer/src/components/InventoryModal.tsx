import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { VERSION_KEYS, diffFacts, filterFactsRows, formatUptime, type HostFactsDto } from '@infra/shared'
import { useDataStore } from '../stores/data'
import { useInventoryStore } from '../stores/inventory'
import { useSettingsStore } from '../stores/settings'
import { useToastsStore } from '../stores/toasts'
import { Button, ModalOrPanel, TextInput } from './ui'
import { OpenInTabButton } from './OpenInTabButton'
import { useT } from '../i18n'

const LOCALES = { vi: 'vi-VN', en: 'en-US', ja: 'ja-JP' } as const

interface TableRow {
  hostId: string
  label: string
  facts: HostFactsDto
  collectedAt: number
  changed: Map<string, { before: string; after: string }>
}

/**
 * Kiểm kê fleet (CMDB nhẹ): bảng facts mỗi host (OS, kernel, CPU/RAM/đĩa, cổng đang mở, phiên
 * bản PHP/nginx/MySQL/…), tìm kiểu "php 7.4" ra máy còn PHP 7.4, ô đổi so với lần thu trước tô
 * vàng kèm giá trị cũ, xuất CSV. Thu bằng một lệnh đọc-thuần qua kênh exec riêng (xuyên
 * login-script), song song tối đa 4 host.
 */
export function InventoryModal({ onClose, embedded }: { onClose?: () => void; embedded?: boolean }) {
  const t = useT()
  const locale = LOCALES[useSettingsStore((s) => s.language)]
  const allHosts = useDataStore((s) => s.hosts)
  // useMemo: lọc lại mỗi render là ra mảng MỚI → effect tick-mặc-định bên dưới chạy lại liên tục
  // và tick lại ngay sau khi user bỏ chọn (bug đã dính: "Bỏ chọn" không có tác dụng)
  const hosts = useMemo(() => allHosts.filter((h) => h.protocol === 'ssh'), [allHosts])
  const rows = useInventoryStore((s) => s.rows)
  const loaded = useInventoryStore((s) => s.loaded)
  const progress = useInventoryStore((s) => s.progress)
  const lastResults = useInventoryStore((s) => s.lastResults)
  const load = useInventoryStore((s) => s.load)
  const collect = useInventoryStore((s) => s.collect)
  const remove = useInventoryStore((s) => s.remove)
  const push = useToastsStore((s) => s.push)
  const [query, setQuery] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  /** Host đã từng đi qua bước tick-mặc-định — chỉ host MỚI xuất hiện mới được tự tick, còn user bỏ tick thì giữ nguyên. */
  const seenRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  // Mặc định tick MỌI host SSH lần đầu thấy; host thêm sau cũng tự vào danh sách. Host user đã
  // bỏ tick KHÔNG bị tick lại — đó là việc của user, không phải của effect.
  useEffect(() => {
    const fresh = hosts.filter((h) => !seenRef.current.has(h.id))
    if (fresh.length === 0) return
    for (const h of fresh) seenRef.current.add(h.id)
    setPicked((prev) => {
      const next = new Set(prev)
      for (const h of fresh) next.add(h.id)
      return next
    })
  }, [hosts])

  const hostLabel = useMemo(() => new Map(hosts.map((h) => [h.id, h.label])), [hosts])
  const table = useMemo<TableRow[]>(() => {
    const built = rows.map((r) => ({
      hostId: r.hostId,
      label: hostLabel.get(r.hostId) ?? r.facts.hostname ?? r.hostId,
      facts: r.facts,
      collectedAt: r.collectedAt,
      changed: new Map(diffFacts(r.previous, r.facts).map((c) => [c.field, { before: c.before, after: c.after }]))
    }))
    return filterFactsRows(built, query).sort((a, b) => a.label.localeCompare(b.label))
  }, [rows, hostLabel, query])

  const failed = lastResults.filter((r) => !r.ok)
  const pickedIds = hosts.filter((h) => picked.has(h.id)).map((h) => h.id)

  const exportCsv = async (): Promise<void> => {
    const r = await window.infra.inventory.exportCsv()
    push(r.message, r.ok ? 'info' : 'error')
  }

  return (
    <ModalOrPanel
      embedded={embedded}
      title={`📇 ${t('inv.title')}`}
      onClose={onClose}
      headerExtra={embedded ? undefined : <OpenInTabButton kind="inventory" onDone={onClose} />}
    >
      <div className={embedded ? 'w-full' : 'w-[960px] max-w-full'}>
        <p className="text-subtle mb-3 text-[11px] leading-relaxed">{t('inv.hint')}</p>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <TextInput className="min-w-56 flex-1" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('inv.search')} />
          <div className="relative">
            <Button type="button" className="!px-2 !py-1.5 !text-xs" onClick={() => setPickerOpen((v) => !v)} disabled={progress !== null}>
              {t('inv.hostsPicked', { n: pickedIds.length })} ▾
            </Button>
            {pickerOpen && (
              <div className="border-edge bg-elevated absolute top-full right-0 z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded border p-1 shadow-xl">
                {hosts.map((h) => (
                  <label key={h.id} className="hover:bg-hover flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs">
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
                    <span className="text-content min-w-0 flex-1 truncate">{h.label}</span>
                  </label>
                ))}
                <div className="border-edge mt-1 flex justify-between border-t px-1 pt-1 text-[11px]">
                  <button type="button" className="text-accent hover:text-content" onClick={() => setPicked(new Set(hosts.map((h) => h.id)))}>
                    {t('clientImport.selectAll')}
                  </button>
                  <button type="button" className="text-subtle hover:text-content" onClick={() => setPicked(new Set())}>
                    {t('clientImport.selectNone')}
                  </button>
                </div>
              </div>
            )}
          </div>
          <Button variant="primary" disabled={progress !== null || pickedIds.length === 0} onClick={() => void collect(pickedIds)}>
            {progress ? t('inv.collecting', { done: progress.done, total: progress.total }) : `▶ ${t('inv.collect')}`}
          </Button>
          <Button disabled={rows.length === 0} onClick={() => void exportCsv()}>
            ⬇ {t('inv.export')}
          </Button>
        </div>

        <div className="text-subtle mb-2 flex flex-wrap gap-x-3 text-[11px]">
          <span>{t('inv.covered', { n: rows.length, total: hosts.length })}</span>
          {failed.length > 0 && (
            <span className="text-danger" title={failed.map((f) => `${hostLabel.get(f.hostId) ?? f.hostId}: ${f.error ?? ''}`).join('\n')}>
              {t('inv.failed', { n: failed.length })}
            </span>
          )}
          {progress && (
            <span className="bg-hover h-1.5 w-40 self-center overflow-hidden rounded">
              <span className="bg-accent block h-full" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
            </span>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="text-subtle py-10 text-center text-xs leading-relaxed">{t('inv.empty')}</p>
        ) : table.length === 0 ? (
          <p className="text-subtle py-10 text-center text-xs">{t('inv.noMatch')}</p>
        ) : (
          <div className="border-edge overflow-x-auto rounded border">
            <table className="w-full min-w-[1100px] border-collapse text-[11px]">
              <thead className="bg-panel text-subtle sticky top-0 text-left text-[10px] tracking-wider uppercase">
                <tr>
                  <Th>{t('inv.col.host')}</Th>
                  <Th>{t('inv.col.os')}</Th>
                  <Th>{t('inv.col.kernel')}</Th>
                  <Th>CPU</Th>
                  <Th>RAM</Th>
                  <Th>{t('inv.col.disk')}</Th>
                  <Th>{t('inv.col.uptime')}</Th>
                  {VERSION_KEYS.map((k) => (
                    <Th key={k}>{k}</Th>
                  ))}
                  <Th>{t('inv.col.ports')}</Th>
                  <Th>{t('inv.col.collected')}</Th>
                  <Th> </Th>
                </tr>
              </thead>
              <tbody className="divide-edge/70 divide-y">
                {table.map((r) => (
                  <tr key={r.hostId} className="hover:bg-hover/50 align-top">
                    <Td changed={r.changed.get('hostname')} t={t}>
                      <div className="text-content font-medium">{r.label}</div>
                      <div className="text-subtle font-mono text-[10px]">
                        {r.facts.ipv4.join(' ')}
                        {r.facts.virt && <span className="ml-1">· {r.facts.virt}</span>}
                      </div>
                    </Td>
                    <Td changed={r.changed.get('os')} t={t}>
                      {r.facts.os}
                      {r.facts.arch && <span className="text-subtle"> · {r.facts.arch}</span>}
                      {r.facts.rebootRequired && (
                        <div className="text-warning text-[10px]" title={t('inv.rebootYes')}>
                          ⟳ {t('inv.rebootYes')}
                        </div>
                      )}
                    </Td>
                    <Td changed={r.changed.get('kernel')} t={t} mono>
                      {r.facts.kernel}
                    </Td>
                    <Td changed={r.changed.get('cpuCount')} t={t}>
                      {r.facts.cpuCount}
                    </Td>
                    <Td changed={r.changed.get('memTotalMb')} t={t}>
                      {r.facts.memTotalMb !== null ? `${(r.facts.memTotalMb / 1024).toFixed(1)} GB` : ''}
                    </Td>
                    <Td changed={r.changed.get('diskRootPct')} t={t}>
                      {r.facts.diskRootPct !== null && (
                        <span className={r.facts.diskRootPct >= 90 ? 'text-danger' : r.facts.diskRootPct >= 75 ? 'text-warning' : ''}>{r.facts.diskRootPct}%</span>
                      )}
                    </Td>
                    <Td t={t}>{formatUptime(r.facts.uptimeSec)}</Td>
                    {VERSION_KEYS.map((k) => (
                      <Td key={k} changed={r.changed.get(`versions.${k}`)} t={t} mono>
                        {r.facts.versions[k] ?? <span className="text-subtle/50">—</span>}
                      </Td>
                    ))}
                    <Td changed={r.changed.get('listenPorts')} t={t} mono>
                      <span className="text-subtle">{r.facts.listenPorts.join(' ')}</span>
                    </Td>
                    <Td t={t}>
                      <span className="text-subtle whitespace-nowrap">
                        {new Date(r.collectedAt).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </Td>
                    <Td t={t}>
                      <div className="flex gap-1 whitespace-nowrap">
                        <button
                          type="button"
                          className="text-subtle hover:text-content"
                          title={t('inv.recollect')}
                          disabled={progress !== null}
                          onClick={() => void collect([r.hostId])}
                        >
                          ▶
                        </button>
                        <button type="button" className="text-subtle hover:text-danger" title={t('common.delete')} onClick={() => void remove(r.hostId)}>
                          ✕
                        </button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ModalOrPanel>
  )
}

function Th({ children }: { children: ReactNode }) {
  return <th className="px-2 py-1.5 font-semibold whitespace-nowrap">{children}</th>
}

/** Ô có `changed` tô vàng nhạt + tooltip giá trị trước → sau: đợt vá đổi kernel, PHP lên bản là thấy ngay. */
function Td({ children, changed, mono, t }: { children: ReactNode; changed?: { before: string; after: string }; mono?: boolean; t: ReturnType<typeof useT> }) {
  return (
    <td
      className={`px-2 py-1.5 ${mono ? 'font-mono' : ''} ${changed ? 'bg-warning/15' : ''}`}
      title={changed ? t('inv.changed', { before: changed.before || '—', after: changed.after || '—' }) : undefined}
    >
      {children}
    </td>
  )
}
