import { useEffect, useMemo, useRef, useState } from 'react'
import {
  commandSucceeded,
  formatDuration,
  searchCommandHistory,
  type CommandHistoryEntry
} from '@infra/shared'
import { useShellMarksStore } from '../stores/shellMarks'
import { useTabsStore } from '../stores/tabs'
import { useToastsStore } from '../stores/toasts'
import { ShellIntegrationSetup } from './ShellIntegrationSetup'
import { useT } from '../i18n'

/**
 * F24 — ô tìm lệnh đã chạy (Ctrl+Shift+R).
 *
 * Vì sao **Ctrl+Shift+R** chứ không Ctrl+R: trong terminal Ctrl+R là reverse-search của
 * bash/readline, chiếm nó ở tầng app là lấy mất một phím người ta đã dùng hàng năm. Hai đường
 * đi song song — Ctrl+R vẫn về shell remote, Ctrl+Shift+R mở ô này, tìm được cả lệnh gõ trên
 * máy KHÁC và cả khi server đã xoá `.bash_history`.
 *
 * Chọn một dòng thì lệnh được **CHÈN vào terminal mà KHÔNG kèm Enter**. Hai lý do, cả hai đều
 * quan trọng: user đọc lại trước khi chạy (lệnh cũ có thể sai host, sai đường dẫn), và guard
 * lệnh nguy hiểm chỉ chạy khi user tự bấm Enter — gửi luôn `\n` là đi vòng qua nó, tức một
 * `rm -rf` trong lịch sử sẽ chạy trên máy production mà không ai hỏi gì.
 */
export function CommandHistoryPalette({ onClose }: { readonly onClose: () => void }) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [entries, setEntries] = useState<CommandHistoryEntry[] | null>(null)
  /** Chỉ lệnh của host đang mở, hay của mọi máy. Mặc định MỌI máy — xem ghi chú ở nút. */
  const [thisHostOnly, setThisHostOnly] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const push = useToastsStore((s) => s.push)
  const writeBlocked = useShellMarksStore((s) => s.writeBlocked)

  // Pane đang focus: nơi lệnh sẽ được chèn vào, và cũng là host để cộng điểm xếp hạng.
  const target = useTabsStore((s) => {
    const tab = s.tabs.find((x) => x.id === s.activeId)
    if (!tab) return null
    const pane = tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0]
    if (!pane) return null
    return {
      sessionId: pane.sessionId,
      hostId: pane.origin?.kind === 'host' ? pane.origin.hostId : null,
      label: pane.subtitle ?? pane.title
    }
  })

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    // Nạp CẢ lịch sử một lần rồi lọc trong renderer: xếp hạng cần biết một lệnh từng chạy trên
    // bao nhiêu máy, mà đó là thông tin toàn cục — lọc ở SQL rồi mới đếm sẽ ra số sai. Trần 5000
    // dòng của vault giữ cho lần nạp này luôn nhỏ.
    void window.infra.commandHistory
      .list({ limit: 5000 })
      .then(setEntries)
      .catch(() => setEntries([]))
  }, [])

  useEffect(() => {
    setIndex(0)
  }, [query, thisHostOnly])

  const results = useMemo(() => {
    if (!entries) return []
    // Lọc theo host qua `onlyHostId` chứ KHÔNG tự cắt mảng trước: cắt trước thì `hostCount`
    // luôn ra 1 và huy hiệu "+N máy nữa" mất đúng lúc nó hữu ích nhất.
    return searchCommandHistory(entries, query, {
      hostId: target?.hostId ?? null,
      onlyHostId: thisHostOnly ? (target?.hostId ?? null) : null,
      limit: 100
    })
  }, [entries, query, thisHostOnly, target?.hostId])

  /** Xoá một dòng khỏi lịch sử — cho lệnh lọt bí mật mà bộ che chưa bắt được. */
  const remove = (id: string): void => {
    void window.infra.commandHistory.remove(id).then(() => {
      setEntries((prev) => (prev ? prev.filter((e) => e.id !== id) : prev))
    })
  }

  // Giữ dòng đang chọn trong tầm nhìn khi di chuyển bằng mũi tên.
  useEffect(() => {
    listRef.current?.querySelectorAll('[data-row]')[index]?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const insert = (command: string, redacted: boolean): void => {
    if (!target) {
      push(t('cmdHistory.noPane'), 'error')
      return
    }
    if (redacted) {
      // Lệnh đã bị che mật khẩu — chèn ra thì phần bí mật là chữ `<đã che>`, chạy sẽ lỗi. Nói
      // trước còn hơn để user bấm Enter rồi ngồi đoán vì sao sai.
      push(t('cmdHistory.redactedWarn'), 'info')
    }
    onClose()
    // KHÔNG kèm '\n' — xem ghi chú ở đầu file.
    window.infra.terminal.write(target.sessionId, command)
  }

  return (
    <div className="absolute inset-0 z-[60] flex items-start justify-center bg-black/50 pt-24" onMouseDown={onClose}>
      <div
        className="border-edge-strong bg-elevated w-[720px] max-w-[92vw] overflow-hidden rounded-lg border shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIndex((i) => Math.min(i + 1, results.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIndex((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const picked = results[index]
              if (picked) insert(picked.command, picked.redacted)
            } else if (e.key === 'Escape') {
              onClose()
            }
          }}
          placeholder={t('cmdHistory.placeholder')}
          aria-label={t('cmdHistory.placeholder')}
          className="border-edge text-content placeholder-subtle w-full border-b bg-transparent px-4 py-3 text-sm outline-none"
        />

        <div className="border-edge text-subtle flex items-center gap-3 border-b px-4 py-1.5 text-[11px]">
          {/* Mặc định MỌI máy: thứ người ta đi tìm thường là lệnh đã gõ trên một máy khác cùng
              vai trò ("hôm trước làm trên app-02 thế nào nhỉ") — lọc sẵn theo host đang mở sẽ
              ẩn đúng cái đó. Lệnh cùng host vẫn nổi lên đầu nhờ điểm xếp hạng. */}
          <button
            className={`rounded px-1.5 py-0.5 ${thisHostOnly ? 'bg-accent-soft/50 text-accent-fg' : 'hover:bg-hover'}`}
            aria-pressed={thisHostOnly}
            disabled={!target?.hostId}
            title={target?.hostId ? undefined : t('cmdHistory.noHostFilter')}
            onClick={() => setThisHostOnly((v) => !v)}
          >
            {target?.hostId ? t('cmdHistory.thisHost', { host: target.label }) : t('cmdHistory.allHosts')}
          </button>
          <span className="flex-1" />
          <span>{t('cmdHistory.count', { n: results.length })}</span>
        </div>

        <div ref={listRef} className="max-h-96 overflow-y-auto py-1">
          {entries === null && <p className="text-subtle px-4 py-3 text-sm">{t('cmdHistory.loading')}</p>}
          {/* Ba trạng thái rỗng KHÁC NHAU, và nói sai thì user đi sửa nhầm chỗ:
              · vault khoá giữa lúc làm việc → shell integration vẫn tốt, đừng bảo đi dán snippet;
              · chưa có gì được ghi → gần như luôn là chưa bật shell integration, nên hiện thẳng
                khối BẬT ĐƯỢC NGAY thay vì một câu chỉ đường bắt rời khỏi đây đi tìm;
              · có dữ liệu mà không khớp → chỉ là truy vấn không ra. */}
          {entries !== null && results.length === 0 && entries.length > 0 && (
            <p className="text-subtle px-4 py-3 text-sm leading-relaxed">{t('cmdHistory.noMatch')}</p>
          )}
          {entries !== null && entries.length === 0 && writeBlocked && (
            <p className="text-subtle px-4 py-3 text-sm leading-relaxed">{t('cmdHistory.blocked')}</p>
          )}
          {entries !== null && entries.length === 0 && !writeBlocked && (
            <>
              <p className="text-subtle px-4 pt-3 text-sm leading-relaxed">{t('cmdHistory.empty')}</p>
              <ShellIntegrationSetup />
            </>
          )}
          {/* Hàng là `div` chứa HAI nút (chèn / xoá) chứ không phải một `button` lớn: button
              lồng button là HTML không hợp lệ và React sẽ cảnh báo. */}
          {results.map((row, i) => (
            <div
              key={row.id}
              data-row
              className={`group flex items-start gap-2 px-4 py-1.5 ${i === index ? 'bg-accent/25' : 'hover:bg-hover'}`}
              onMouseEnter={() => setIndex(i)}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-start gap-2 text-left"
                onClick={() => insert(row.command, row.redacted)}
              >
                <span
                  className={`mt-0.5 shrink-0 text-[10px] ${commandSucceeded(row) ? 'text-success' : 'text-danger'}`}
                  title={row.exitCode === null ? undefined : `exit ${row.exitCode}`}
                >
                  {commandSucceeded(row) ? '●' : '✕'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate font-mono text-xs ${i === index ? 'text-content' : 'text-muted'}`}>
                    {row.command}
                    {row.redacted && <span className="text-warning ml-1.5 text-[10px]">🔒</span>}
                  </span>
                  <span className="text-subtle block truncate text-[10px]">
                    {row.hostLabel}
                    {row.hostCount > 1 ? ` +${row.hostCount - 1}` : ''} · {formatDuration(row.durationMs)}
                    {row.runCount > 1 ? ` · ${t('cmdHistory.runs', { n: row.runCount })}` : ''} ·{' '}
                    {new Date(row.startedAt).toLocaleString()}
                  </span>
                </span>
              </button>
              {/* Xoá MỘT dòng. Cần thật: bộ che dựa trên mẫu nên sẽ có dạng bí mật chưa nghĩ tới,
                  và lúc đó lựa chọn duy nhất không được là "xoá sạch cả lịch sử". */}
              <button
                type="button"
                className="text-subtle hover:bg-edge-strong hover:text-danger shrink-0 rounded px-1 text-[11px] opacity-0 group-hover:opacity-100"
                title={t('cmdHistory.removeOne')}
                aria-label={t('cmdHistory.removeOne')}
                onClick={() => remove(row.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="border-edge text-subtle flex items-center gap-3 border-t px-4 py-1.5 text-[10px]">
          <span>{t('cmdHistory.insertHint')}</span>
        </div>
      </div>
    </div>
  )
}
