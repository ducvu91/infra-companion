import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { MiniMarkdown } from '../lib/miniMarkdown'
import { useAiExplainStore } from '../stores/aiExplain'
import { usePluginStore } from '../stores/plugins'
import { FloatingPanel } from './FloatingPanel'
import { Button } from './ui'

/**
 * F46 — Panel kết quả "AI giải thích output".
 *
 * Khung (kéo thả · grip chỉnh cỡ · thu thành pill · phóng to · không backdrop) nằm ở
 * {@link FloatingPanel} — tách ra khỏi file này ở v0.2.25 để tái dùng được.
 *
 * Panel này vẫn NỔI, cố ý không đổi thành dock như Trợ lý AI: nó là **kết quả một lần** của
 * đoạn output vừa bôi chọn — mở, đọc, đóng. Cắt hẳn một cột màn hình cho một câu trả lời dùng
 * xong là bỏ thì đắt hơn giá trị nhận lại; còn Trợ lý AI là chỗ **làm việc liên tục** (hỏi →
 * chạy → hỏi tiếp) nên xứng một cột cố định.
 *
 * Có panel plugin (cùng `z-40`) thì tụt xuống một bậc để không đè nhau.
 */
export function AiExplainPanel() {
  const t = useT()
  const request = useAiExplainStore((s) => s.request)
  const close = useAiExplainStore((s) => s.close)
  const retry = useAiExplainStore((s) => s.retry)
  const hasPluginPanel = usePluginStore((s) => s.panel !== null)
  const [copiedAll, setCopiedAll] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    },
    []
  )

  if (!request) return null

  const copyAll = (): void => {
    void navigator.clipboard.writeText(request.answer ?? '')
    setCopiedAll(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopiedAll(false), 1500)
  }

  return (
    <FloatingPanel
      icon="✨"
      title={t('ai.explainTitle')}
      onClose={close}
      anchorTop={hasPluginPanel ? 96 : 56}
      busy={request.status === 'loading'}
      restoreKey={request.text}
      headerExtra={
        request.status === 'done' && !!request.answer ? (
          <button
            className={`px-1 text-xs leading-none ${copiedAll ? 'text-accent' : 'text-subtle hover:text-content'}`}
            aria-label={t('ai.copyAll')}
            title={copiedAll ? t('md.copied') : t('ai.copyAll')}
            onClick={copyAll}
          >
            {copiedAll ? '✓' : '📋'}
          </button>
        ) : undefined
      }
    >
      {request.status === 'loading' && (
        <div className="text-muted flex items-center gap-2 py-2 text-xs">
          <span className="bg-warning size-2 animate-pulse rounded-full" />
          {t('ai.explaining')}
        </div>
      )}
      {request.status === 'error' && (
        <div className="space-y-2">
          <p className="text-danger text-xs break-words">{request.error}</p>
          <Button className="!px-2 !py-1 !text-xs" onClick={retry}>
            {t('ai.retry')}
          </Button>
        </div>
      )}
      {request.status === 'done' && <MiniMarkdown source={request.answer ?? ''} />}
    </FloatingPanel>
  )
}
