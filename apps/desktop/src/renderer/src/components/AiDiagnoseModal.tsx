import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AiDiagnoseRecordDto } from '@infra/shared'
import { useT } from '../i18n'
import { formatTime } from '../lib/paths'
import { MiniMarkdown } from '../lib/miniMarkdown'
import { useAiDiagnoseStore, type DiagnoseStep } from '../stores/aiDiagnose'
import { useDataStore } from '../stores/data'
import { terminalTargetPane, useTabsStore } from '../stores/tabs'
import type { AiDockPaneSpec } from './AiDock'
import { Button, Field, Select, TextArea } from './ui'
import { OpenInTabButton } from './OpenInTabButton'

/**
 * F48 — AI chẩn đoán sự cố: mô tả triệu chứng → AI đề xuất lệnh read-only từng bước, user duyệt
 * → chạy qua kênh exec riêng → AI đọc output đề xuất tiếp → kết luận.
 *
 * **Cột DOCK cạnh terminal** (cùng khuôn Trợ lý AI, v0.2.25) chứ không phải modal. Ở đây lý do
 * còn mạnh hơn: một phiên chẩn đoán chạy **nhiều bước, mỗi bước chờ user duyệt** — có backdrop
 * thì suốt phiên đó không xem được gì khác, kể cả chính terminal của máy đang chẩn đoán. Trước
 * đây phải bù bằng nút "–" thu xuống pill; giờ dock chiếm chỗ thật nên không cần né nữa.
 *
 * Nút **⊞ Mở dạng tab** khi output các bước dài — cùng component ở chế độ `embedded`.
 */
export function AiDiagnoseModal({
  onClose,
  embedded,
  renderSpec,
}: {
  onClose?: () => void
  embedded?: boolean
  /** Chế độ dock: góp spec vào cột AI dùng chung — xem `AiDockShell`. */
  renderSpec?: (spec: AiDockPaneSpec) => ReactNode
}) {
  const t = useT()
  const session = useAiDiagnoseStore((s) => s.session)
  const start = useAiDiagnoseStore((s) => s.start)
  const approve = useAiDiagnoseStore((s) => s.approve)
  const skip = useAiDiagnoseStore((s) => s.skip)
  const stop = useAiDiagnoseStore((s) => s.stop)
  const reset = useAiDiagnoseStore((s) => s.close)
  const history = useAiDiagnoseStore((s) => s.history)
  const loadHistory = useAiDiagnoseStore((s) => s.loadHistory)
  const openHistory = useAiDiagnoseStore((s) => s.openHistory)
  const deleteHistory = useAiDiagnoseStore((s) => s.deleteHistory)

  // Nạp lịch sử mỗi lần mở modal (modal mount/unmount theo state)
  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const hosts = useDataStore((s) => s.hosts).filter((h) => h.protocol === 'ssh')
  // Host gợi ý sẵn = host của pane terminal user đang/vừa làm. Dùng `terminalTargetPane()` vì
  // modal này mở được DẠNG TAB — lúc đó tab active là chính nó, phải rơi về tab terminal gần nhất.
  const tabsSnapshot = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeId)
  const lastTerminalTabId = useTabsStore((s) => s.lastTerminalTabId)
  const activeHostId = useMemo(() => {
    const origin = terminalTargetPane()?.pane.origin
    return origin?.kind === 'host' ? origin.hostId : null
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cố ý phụ thuộc vào 3 giá trị store
  }, [tabsSnapshot, activeTabId, lastTerminalTabId])

  const [hostId, setHostId] = useState(activeHostId ?? hosts[0]?.id ?? '')
  const [symptom, setSymptom] = useState('')

  const begin = (): void => {
    const host = hosts.find((h) => h.id === hostId)
    if (!host || !symptom.trim()) return
    void start(host.id, host.label, symptom.trim())
  }

  const wrap = (node: ReactNode): ReactNode => (
    <div className={embedded ? 'mx-auto w-full max-w-3xl' : 'w-full'}>{node}</div>
  )

  /**
   * Vùng CUỘN — thứ dài ra theo thời gian: lịch sử phiên cũ (màn hình bắt đầu) hoặc các bước đã
   * chạy cùng output (trong phiên). Cố ý không chứa ô nhập / nút duyệt: xem `composer`.
   */
  const body = wrap(
    !session ? (
      history.length > 0 ? (
        <>
          <div className="text-subtle mb-2 text-[11px] font-semibold tracking-wide uppercase">
            {t('ai.diagnose.historyTitle')}
          </div>
          <div className="space-y-1.5">
            {history.map((rec) => (
              <HistoryItem
                key={rec.id}
                rec={rec}
                onOpen={() => void openHistory(rec.id)}
                onDelete={() => void deleteHistory(rec.id)}
              />
            ))}
          </div>
        </>
      ) : (
        <p className="text-subtle text-[11px] leading-relaxed">{t('ai.diagnose.readonlyNote')}</p>
      )
    ) : (
      <SessionLog />
    ),
  )

  /**
   * Khe ĐÁY: chỗ user thao tác — mô tả triệu chứng + nút Bắt đầu, hoặc (trong phiên) nút duyệt
   * bước đang chờ.
   *
   * Neo ở đáy vì đây là panel dùng nhiều bước: mỗi bước chạy xong lại đắp thêm output vào vùng
   * cuộn, mà nút "Duyệt" của bước kế tiếp thì trước đây nằm cuối chính vùng đó — càng về sau càng
   * phải cuộn xuống tìm nút bấm. Nay nút chờ duyệt luôn ở cùng một chỗ, ngang tầm mắt.
   */
  const composer = wrap(
    !session ? (
      <>
        <Field label={t('ai.diagnose.hostLabel')}>
          <Select value={hostId} onChange={(e) => setHostId(e.target.value)}>
            {hosts.length === 0 && <option value="">{t('ai.diagnose.noHosts')}</option>}
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('ai.diagnose.symptomLabel')}>
          <TextArea
            rows={3}
            autoFocus
            value={symptom}
            placeholder={t('ai.diagnose.symptomPlaceholder')}
            onChange={(e) => setSymptom(e.target.value)}
          />
        </Field>
        <div className="flex justify-end">
          <Button variant="primary" disabled={!hostId || !symptom.trim()} onClick={begin}>
            {t('ai.diagnose.start')}
          </Button>
        </div>
      </>
    ) : (
      <SessionActions onApprove={() => void approve()} onSkip={() => void skip()} onStop={stop} onNew={reset} />
    ),
  )

  // Chế độ TAB: nội dung chảy trong vùng tab (ToolTabView đã vẽ header) — cùng cách chia khe.
  if (embedded) {
    return (
      <div className="@container flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">{body}</div>
        <div className="border-edge bg-panel shrink-0 border-t px-4 py-2.5">{composer}</div>
      </div>
    )
  }

  return renderSpec?.({
    id: 'ai-diagnose',
    icon: '🩺',
    title: t('ai.diagnose.title'),
    // ✕ = cất dock đi. KHÔNG dừng phiên đang chạy: nửa chừng một chuỗi chẩn đoán mà bấm ✕ rồi
    // mất luôn kết quả các bước trước là thứ không ai muốn. Phiên còn sống thì pill hiện lên
    // và vẫn báo "đang chờ bạn duyệt"; muốn dừng thật thì có nút Dừng trong phiên.
    onClose: () => onClose?.(),
    closeHint: t('ai.diagnose.minimizeHint'),
    headerExtra: <OpenInTabButton kind="ai-diagnose" onDone={onClose} compact />,
    footer: composer,
    children: body,
  })
}

/** Nhật ký phiên — phần CUỘN: triệu chứng, từng bước đã chạy, kết luận. */
function SessionLog() {
  const t = useT()
  const session = useAiDiagnoseStore((s) => s.session)
  if (!session) return null

  return (
    <div className="space-y-3">
      {session.readonly && (
        <div className="text-subtle flex items-center justify-between text-[11px]">
          <span>🕓 {t('ai.diagnose.readonlyView')}</span>
          {session.createdAt ? <span>{formatTime(session.createdAt)}</span> : null}
        </div>
      )}
      <div className="border-edge bg-input rounded border px-3 py-2 text-xs">
        <span className="text-subtle">{session.hostLabel}</span>
        <p className="text-content mt-0.5">{session.symptom}</p>
      </div>

      <div className="space-y-2">
        {session.steps.map((step, i) => (
          <StepCard key={i} index={i} step={step} />
        ))}

        {session.status === 'thinking' && (
          <div className="text-muted flex items-center gap-2 py-1 text-xs">
            <span className="bg-warning size-2 animate-pulse rounded-full" />
            {t('ai.diagnose.thinking')}
          </div>
        )}

        {session.status === 'done' && session.conclusion && (
          <div className="border-success/40 bg-success/5 rounded border px-3 py-2">
            <div className="text-success mb-1 text-[11px] font-semibold tracking-wide uppercase">
              {t('ai.diagnose.conclusion')}
            </div>
            <MiniMarkdown source={session.conclusion} />
          </div>
        )}

        {session.status === 'error' && <p className="text-danger text-xs break-words">{session.error}</p>}

        {session.status === 'stopped' && <p className="text-subtle text-xs">{t('ai.diagnose.stopped')}</p>}
      </div>
    </div>
  )
}

/**
 * Khe đáy của một phiên: lệnh đang chờ duyệt + Duyệt/Bỏ qua, rồi tới hàng Phiên mới / Dừng.
 *
 * Lệnh chờ duyệt lặp lại ở đây (nó cũng nằm trong thẻ bước phía trên) là **cố ý**: đây là chỗ
 * bấm nút, mà lệnh sắp chạy trên máy thật thì phải đọc được ngay cạnh nút chứ không phải cuộn
 * ngược lên tìm.
 */
function SessionActions({
  onApprove,
  onSkip,
  onStop,
  onNew,
}: {
  onApprove: () => void
  onSkip: () => void
  onStop: () => void
  onNew: () => void
}) {
  const t = useT()
  const session = useAiDiagnoseStore((s) => s.session)
  if (!session) return null
  const busy = session.status === 'thinking' || session.status === 'running'
  // `findLast` chưa có trong lib target của renderer — lọc rồi lấy phần tử cuối là tương đương.
  const proposed = session.steps.filter((s) => s.status === 'proposed')
  const pending = proposed[proposed.length - 1]

  return (
    <div className="space-y-2">
      {pending && (
        <div>
          <pre className="border-edge-strong bg-input text-content overflow-x-auto rounded border px-2 py-1 font-mono text-[11px]">
            {pending.command}
          </pre>
          <div className="mt-2 flex gap-2">
            <Button variant="primary" className="!px-2 !py-1 !text-xs" onClick={onApprove}>
              {t('ai.diagnose.approve')}
            </Button>
            <Button className="!px-2 !py-1 !text-xs" onClick={onSkip}>
              {t('ai.diagnose.skip')}
            </Button>
          </div>
        </div>
      )}

      <div className="flex justify-between gap-2">
        <Button className="!text-xs" onClick={onNew}>
          {t('ai.diagnose.new')}
        </Button>
        {(session.status === 'awaiting' || busy) && (
          <Button className="!text-xs" onClick={onStop}>
            {t('ai.diagnose.stop')}
          </Button>
        )}
      </div>
    </div>
  )
}

function HistoryItem({
  rec,
  onOpen,
  onDelete,
}: {
  rec: AiDiagnoseRecordDto
  onOpen: () => void
  onDelete: () => void
}) {
  const t = useT()
  const statusLabel =
    rec.status === 'done'
      ? t('ai.diagnose.statusDone')
      : rec.status === 'stopped'
        ? t('ai.diagnose.statusStopped')
        : t('ai.diagnose.statusError')
  const statusCls = rec.status === 'done' ? 'text-success' : rec.status === 'stopped' ? 'text-subtle' : 'text-danger'
  return (
    <div className="border-edge hover:border-edge-strong group rounded border px-2.5 py-2">
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="text-content truncate text-xs font-medium">{rec.hostLabel}</span>
            <span className={`shrink-0 text-[10px] ${statusCls}`}>{statusLabel}</span>
          </div>
          <p className="text-subtle mt-0.5 truncate text-[11px]">{rec.symptom}</p>
          {rec.conclusionSnippet && (
            <p
              className="text-muted mt-0.5 text-[10px] leading-snug"
              style={{
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {rec.conclusionSnippet}…
            </p>
          )}
          <div className="text-subtle mt-1 text-[10px]">{formatTime(rec.createdAt)}</div>
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="text-subtle hover:text-danger shrink-0 rounded px-1 text-xs opacity-0 transition-opacity group-hover:opacity-100"
          title={t('ai.diagnose.delete')}
          aria-label={t('ai.diagnose.delete')}
        >
          🗑
        </button>
      </div>
    </div>
  )
}

/** Một bước trong nhật ký. Chỉ ĐỌC — nút Duyệt/Bỏ qua nằm ở khe đáy (`SessionActions`). */
function StepCard({ index, step }: { index: number; step: DiagnoseStep }) {
  const t = useT()
  return (
    <div className="border-edge rounded border px-3 py-2">
      <div className="text-subtle mb-1 text-[10px] tracking-wide uppercase">
        {t('ai.diagnose.step')} {index + 1}
      </div>
      {step.reasoning && (
        <div className="mb-1.5 text-xs">
          <MiniMarkdown source={step.reasoning} />
        </div>
      )}
      <pre className="border-edge-strong bg-input text-content overflow-x-auto rounded border px-2 py-1 font-mono text-[11px]">
        {step.command}
      </pre>

      {/* Nút duyệt ở khe đáy, nên bước này chỉ nói rõ nó đang chờ — không có dòng này thì thẻ
          trông y hệt một bước đã xong mà không thấy output, dễ tưởng bị treo. */}
      {step.status === 'proposed' && (
        <p className="text-warning mt-1.5 text-[11px]">↓ {t('ai.diagnose.awaitingBelow')}</p>
      )}
      {step.status === 'running' && <p className="text-muted mt-1.5 text-[11px]">{t('ai.diagnose.running')}</p>}
      {step.status === 'skipped' && <p className="text-subtle mt-1.5 text-[11px]">{t('ai.diagnose.skipped')}</p>}
      {step.status === 'blocked' && (
        <p className="text-danger mt-1.5 text-[11px]">
          ⛔ {t('ai.diagnose.blocked')}: {step.blockedReason}
        </p>
      )}
      {step.status === 'error' && <p className="text-danger mt-1.5 text-[11px] break-words">{step.error}</p>}
      {step.status === 'done' && step.output !== undefined && (
        <pre className="border-edge/70 text-muted mt-1.5 max-h-40 overflow-auto border-t pt-1.5 font-mono text-[10px] whitespace-pre-wrap">
          {step.output || t('ai.diagnose.emptyOutput')}
        </pre>
      )}
    </div>
  )
}
