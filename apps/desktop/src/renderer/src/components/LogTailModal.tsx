import { useEffect, useMemo, useRef, useState } from 'react'
import {
  COMMON_LOG_PATHS,
  assignHostTones,
  highlightSegments,
  lineMatches,
  padLabel,
  prefixWidth,
  type LogFilter,
  type LogLine
} from '@infra/shared'
import { Button, ModalOrPanel, Select, TextInput } from './ui'
import { OpenInTabButton } from './OpenInTabButton'
import { useDataStore } from '../stores/data'
import { useT } from '../i18n'

/**
 * Trần số dòng giữ trong bộ nhớ. Một log ồn chạy qua đêm sẽ ăn hết RAM nếu giữ tất cả —
 * đây là cửa sổ theo dõi, không phải kho lưu trữ (muốn lưu thì đã có session logging).
 */
const MAX_LINES = 5000

/** Một dòng log kèm host phát ra nó — tail nhiều host gộp chung một dòng chảy. */
type TailLine = LogLine & { hostId: string }

/** Trạng thái từng phiên tail (một host = một phiên `tail -F` riêng ở main). */
interface HostSession {
  hostId: string
  sessionId: string | null
  status: 'starting' | 'running' | 'closed' | 'error'
  error?: string
}

/**
 * F30 — theo dõi file log mà không chiếm một tab terminal.
 *
 * Trước đây mở `tail -f` là mất trọn một tab, và tab đó không dùng vào việc gì khác được nữa.
 * Panel này chạy qua kênh exec riêng: lọc/tô màu tại chỗ, tự cuộn khi đang ở đáy, và dừng
 * dứt khoát khi đóng.
 *
 * **Nhiều host cùng lúc**: chọn N máy → N phiên `tail -F` cùng một đường dẫn, dòng gộp theo thứ
 * tự tới, mỗi dòng mang prefix `[tên máy]` tô màu cố định theo máy. Với fleet app-01…09 sau load
 * balancer, câu hỏi thật là "lỗi 500 đang nổ ở máy nào" — tail từng máy một không trả lời được.
 * Bộ lọc áp lên NỘI DUNG dòng (không tính prefix), nên `/500/` không khớp nhầm vào tên máy.
 *
 * `embedded` = nhúng vào tab/trang (bỏ khung popup). `fill` = vùng log lấp đầy chiều cao còn lại
 * của chỗ nhúng thay vì tính theo `100vh` — cần cho panel đáy Workbench (cao 120–600px, không phải
 * cả cửa sổ). Chỉ có ý nghĩa khi `embedded`.
 */
export function LogTailModal({ onClose, embedded, fill }: { onClose?: () => void; embedded?: boolean; fill?: boolean }) {
  const t = useT()
  const allHosts = useDataStore((s) => s.hosts)
  // useMemo: lọc lại mỗi render là mảng mới → `hostLabel` đổi → effect onEvent bên dưới huỷ/đăng ký lại mỗi render
  const hosts = useMemo(() => allHosts.filter((h) => h.protocol === 'ssh'), [allHosts])
  // Rỗng = chưa chọn. Panel này không tự nối, nhưng mặc định sẵn một máy thì rất dễ bấm
  // Bắt đầu nhầm máy — giữ nhất quán với các hộp thoại khác: phải chọn tường minh.
  const [hostIds, setHostIds] = useState<string[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [path, setPath] = useState('/var/log/syslog')
  const [sessions, setSessions] = useState<HostSession[]>([])
  const [lines, setLines] = useState<TailLine[]>([])
  const [filter, setFilter] = useState<LogFilter>({ query: '', invert: false, caseSensitive: false })
  const [follow, setFollow] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const seqRef = useRef(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const sessionsRef = useRef<HostSession[]>([])
  sessionsRef.current = sessions

  const running = sessions.some((s) => s.sessionId !== null)
  const hostLabel = useMemo(() => new Map(hosts.map((h) => [h.id, h.label])), [hosts])
  const tones = useMemo(() => assignHostTones(hostIds), [hostIds])
  const multi = hostIds.length > 1
  const width = useMemo(() => prefixWidth(hostIds.map((id) => hostLabel.get(id) ?? id)), [hostIds, hostLabel])

  useEffect(() => {
    const off = window.infra.logTail.onEvent((event) => {
      const session = sessionsRef.current.find((s) => s.sessionId === event.id)
      if (!session) return
      if (event.kind === 'lines') {
        setLines((prev) => {
          const next = [...prev]
          for (const line of event.lines) next.push({ seq: seqRef.current++, text: line.text, source: line.source, hostId: session.hostId })
          // Cắt từ ĐẦU: dòng mới mới là dòng đáng xem
          return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
        })
        if (session.status === 'starting') {
          setSessions((prev) => prev.map((s) => (s.hostId === session.hostId ? { ...s, status: 'running' } : s)))
        }
      } else {
        setSessions((prev) =>
          prev.map((s) =>
            s.hostId === session.hostId
              ? { ...s, sessionId: null, status: event.error ? 'error' : 'closed', error: event.error }
              : s
          )
        )
        if (event.error) setError(`${hostLabel.get(session.hostId) ?? session.hostId}: ${event.error}`)
      }
    })
    return off
  }, [hostLabel])

  // Dừng mọi phiên khi đóng panel — không có bước này thì `tail -F` chạy tiếp trên remote
  useEffect(
    () => () => {
      for (const s of sessionsRef.current) if (s.sessionId) void window.infra.logTail.stop(s.sessionId)
    },
    []
  )

  const shown = lines.filter((line) => lineMatches(line.text, filter))

  // Tự cuộn CHỈ khi đang bám đáy: kéo lên đọc mà bị giật xuống là mất chỗ đang đọc
  useEffect(() => {
    if (follow && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight
  }, [shown.length, follow])

  const start = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    setLines([])
    seqRef.current = 0
    const initial: HostSession[] = hostIds.map((hostId) => ({ hostId, sessionId: null, status: 'starting' }))
    setSessions(initial)
    try {
      // Song song: mỗi host một kết nối SSH riêng; một máy lỗi không cản các máy còn lại
      const results = await Promise.all(
        hostIds.map(async (hostId) => {
          try {
            const result = await window.infra.logTail.start(hostId, path.trim())
            return result.ok
              ? ({ hostId, sessionId: result.id, status: 'starting' } satisfies HostSession)
              : ({ hostId, sessionId: null, status: 'error', error: result.error } satisfies HostSession)
          } catch (err) {
            return { hostId, sessionId: null, status: 'error', error: err instanceof Error ? err.message : String(err) } satisfies HostSession
          }
        })
      )
      setSessions(results)
      const failed = results.filter((r) => r.status === 'error')
      if (failed.length > 0) setError(failed.map((f) => `${hostLabel.get(f.hostId) ?? f.hostId}: ${f.error ?? ''}`).join(' · '))
    } finally {
      setBusy(false)
    }
  }

  const stop = async (): Promise<void> => {
    const open = sessions.filter((s) => s.sessionId)
    await Promise.all(open.map((s) => window.infra.logTail.stop(s.sessionId!)))
    setSessions((prev) => prev.map((s) => (s.sessionId ? { ...s, sessionId: null, status: 'closed' } : s)))
  }

  const toggleHost = (id: string): void =>
    setHostIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const pickerLabel =
    hostIds.length === 0
      ? t('common.pickHost')
      : hostIds.length === 1
        ? (hostLabel.get(hostIds[0]!) ?? '')
        : t('tail.hostsPicked', { n: hostIds.length })

  return (
    <ModalOrPanel
      embedded={embedded}
      title={t('tail.title')}
      onClose={onClose}
      headerExtra={embedded ? undefined : <OpenInTabButton kind="log-tail" onDone={onClose} />}
    >
      {/* Trong tab thì dùng hết chiều rộng — log dài, càng rộng càng đỡ phải cuộn ngang */}
      <div className={embedded ? (fill ? 'flex h-full w-full flex-col' : 'w-full') : 'w-[760px] max-w-full'}>
        <div className="mb-2 flex items-center gap-2">
          {/* Chọn NHIỀU máy: nút mở danh sách tick — <select multiple> vừa xấu vừa không hiện được số đã chọn */}
          <div className="relative shrink-0">
            <button
              type="button"
              disabled={running}
              onClick={() => setPickerOpen((v) => !v)}
              className={`border-edge-strong bg-input text-content hover:bg-hover flex max-w-52 items-center gap-1.5 rounded border px-2 py-1.5 text-xs disabled:opacity-60 ${
                pickerOpen ? 'border-accent' : ''
              }`}
              title={t('tail.hosts')}
            >
              <span className="truncate">{pickerLabel}</span>
              <span className="text-subtle">▾</span>
            </button>
            {pickerOpen && (
              <div className="border-edge bg-elevated absolute top-full left-0 z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded border p-1 shadow-xl">
                <div className="text-subtle px-2 py-1 text-[10px] leading-relaxed">{t('tail.multiHint')}</div>
                {hosts.map((h) => (
                  <label key={h.id} className="hover:bg-hover flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs">
                    <input type="checkbox" checked={hostIds.includes(h.id)} onChange={() => toggleHost(h.id)} className="accent-accent" />
                    <span className="text-content min-w-0 flex-1 truncate">{h.label}</span>
                    <span className="text-subtle truncate font-mono text-[10px]">{h.hostname}</span>
                  </label>
                ))}
                <div className="border-edge mt-1 flex justify-between border-t px-1 pt-1">
                  <button type="button" className="text-subtle hover:text-content text-[11px]" onClick={() => setHostIds([])}>
                    {t('tail.clearHosts')}
                  </button>
                  <button type="button" className="text-accent hover:text-content text-[11px]" onClick={() => setPickerOpen(false)}>
                    {t('common.close')}
                  </button>
                </div>
              </div>
            )}
          </div>
          <TextInput
            className="flex-1 font-mono"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/var/log/nginx/error.log"
            disabled={running}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !running && !busy && hostIds.length > 0) void start()
            }}
          />
          {/* Gợi ý đường dẫn mặc định của phần mềm hay gặp — ô nhập vẫn tự do, vì bản cài tự
              dựng để log ở đâu cũng được. Chọn xong tự về '' để lần sau còn chọn lại được. */}
          <Select
            value=""
            className="max-w-40"
            disabled={running}
            onChange={(e) => {
              if (e.target.value) setPath(e.target.value)
            }}
          >
            <option value="">{t('tail.presets')}</option>
            {COMMON_LOG_PATHS.map((group) => (
              <optgroup key={group.software} label={group.software}>
                {group.paths.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          {running ? (
            <Button variant="danger" onClick={() => void stop()}>
              {t('tail.stop')}
            </Button>
          ) : (
            <Button variant="primary" disabled={busy || hostIds.length === 0 || !path.trim()} onClick={() => void start()}>
              {busy ? t('tail.starting') : t('tail.start')}
            </Button>
          )}
        </div>

        {/* Chip từng máy khi tail nhiều host: màu = màu prefix, chấm = trạng thái phiên */}
        {multi && sessions.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {sessions.map((s) => (
              <span
                key={s.hostId}
                className={`border-edge bg-input flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${tones[s.hostId] ?? ''}`}
                title={s.error ?? s.status}
              >
                <span
                  className={`size-1.5 rounded-full ${
                    s.status === 'running' ? 'bg-success' : s.status === 'starting' ? 'bg-warning animate-pulse' : s.status === 'error' ? 'bg-danger' : 'bg-edge-strong'
                  }`}
                />
                {hostLabel.get(s.hostId) ?? s.hostId}
                {s.status === 'closed' && <span className="text-subtle">· {t('tail.hostClosed')}</span>}
              </span>
            ))}
          </div>
        )}

        <div className="mb-2 flex items-center gap-2">
          <TextInput
            className="flex-1"
            value={filter.query}
            onChange={(e) => setFilter({ ...filter, query: e.target.value })}
            placeholder={t('tail.filterPh')}
          />
          <label className="text-muted flex items-center gap-1 text-[11px] select-none">
            <input
              type="checkbox"
              checked={filter.invert}
              onChange={(e) => setFilter({ ...filter, invert: e.target.checked })}
            />
            {t('tail.invert')}
          </label>
          <label className="text-muted flex items-center gap-1 text-[11px] select-none">
            <input
              type="checkbox"
              checked={filter.caseSensitive}
              onChange={(e) => setFilter({ ...filter, caseSensitive: e.target.checked })}
            />
            Aa
          </label>
          <label className="text-muted flex items-center gap-1 text-[11px] select-none">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
            {t('tail.follow')}
          </label>
        </div>

        {error && <p className="text-danger mb-2 text-xs leading-relaxed">{error}</p>}

        <div
          ref={boxRef}
          // Bám đáy hay không do CHÍNH việc user cuộn quyết định, không phải do ô tick
          onScroll={(e) => {
            const el = e.currentTarget
            setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 24)
          }}
          className={`border-edge bg-app overflow-auto rounded border p-2 font-mono text-[11px] leading-relaxed ${
            embedded ? (fill ? 'min-h-0 flex-1' : 'h-[calc(100vh-16rem)]') : 'h-96'
          }`}
        >
          {shown.length === 0 ? (
            <p className="text-subtle py-8 text-center">{running ? t('tail.waiting') : t('tail.idle')}</p>
          ) : (
            shown.map((line) => (
              <div key={line.seq} className={`whitespace-pre ${line.source === 'stderr' ? 'text-warning' : 'text-content'}`}>
                {multi && (
                  <span className={`${tones[line.hostId] ?? 'text-subtle'} select-none`}>
                    [{padLabel(hostLabel.get(line.hostId) ?? line.hostId, width)}]{' '}
                  </span>
                )}
                {highlightSegments(line.text, filter).map((seg, i) =>
                  seg.hit ? (
                    <mark key={i} className="bg-accent/30 text-content rounded-sm">
                      {seg.text}
                    </mark>
                  ) : (
                    <span key={i}>{seg.text}</span>
                  )
                )}
                {line.text === '' && ' '}
              </div>
            ))
          )}
        </div>

        <div className="text-subtle mt-1.5 flex items-center justify-between text-[10px]">
          <span>{t('tail.shown', { shown: shown.length, total: lines.length })}</span>
          <span>{t('tail.note')}</span>
        </div>
      </div>
    </ModalOrPanel>
  )
}
