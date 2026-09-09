import { useT } from '../i18n'
import { useAiDiagnoseStore } from '../stores/aiDiagnose'
import { useUiStore } from '../stores/ui'

/**
 * F48 — pill hiện khi cửa sổ AI chẩn đoán được thu nhỏ (aiDiagnoseMin). Session vẫn chạy
 * nền trong store aiDiagnose; pill phản ánh trạng thái live để user biết khi nào cần quay lại
 * (đặc biệt lúc 'awaiting' = AI đã đề xuất lệnh, chờ duyệt). Bấm thân pill → mở lại DOCK;
 * bấm ✕ → chỉ đóng pill (KHÔNG dừng session — mở lại qua menu/palette vẫn thấy phiên).
 * Neo bottom-20 right-3 để xếp TRÊN pill Monitor (bottom-8 right-3), không đè nhau.
 */
export function AiDiagnosePill() {
  const t = useT()
  const minimized = useUiStore((s) => s.aiDiagnoseMin)
  const setModal = useUiStore((s) => s.setModal)
  const dismiss = useUiStore((s) => s.setAiDiagnoseMin)
  const session = useAiDiagnoseStore((s) => s.session)

  if (!minimized) return null

  const status = session?.status
  // Chấm màu + nhãn theo trạng thái phiên (khớp màu dùng ở nơi khác)
  const dot =
    status === 'awaiting'
      ? 'bg-accent'
      : status === 'thinking' || status === 'running'
        ? 'bg-warning animate-pulse'
        : status === 'done'
          ? 'bg-success'
          : status === 'error'
            ? 'bg-danger'
            : 'bg-subtle'
  const label =
    status === 'awaiting'
      ? t('ai.diagnose.awaitingApproval')
      : status === 'thinking'
        ? t('ai.diagnose.thinking')
        : status === 'running'
          ? t('ai.diagnose.running')
          : status === 'done'
            ? t('ai.diagnose.statusDone')
            : status === 'error'
              ? t('ai.diagnose.statusError')
              : status === 'stopped'
                ? t('ai.diagnose.statusStopped')
                : t('ai.diagnose.title')

  return (
    <div
      className="bg-elevated/95 border-edge-strong absolute right-3 bottom-20 z-40 flex max-w-[280px] cursor-pointer items-center gap-2 rounded-full border py-1.5 pr-2 pl-3 opacity-80 shadow-2xl transition-opacity duration-150 hover:opacity-100"
      title={t('panel.restore')}
      onClick={() => setModal('ai-diagnose')}
    >
      <span className="text-xs leading-none">🩺</span>
      <span className={`size-1.5 shrink-0 rounded-full ${dot}`} />
      <span className="text-content min-w-0 truncate text-xs">{label}</span>
      <button
        type="button"
        className="text-subtle hover:text-content shrink-0 px-1 text-sm leading-none"
        aria-label={t('panel.close')}
        title={t('panel.close')}
        onClick={(e) => {
          e.stopPropagation()
          dismiss(false)
        }}
      >
        ✕
      </button>
    </div>
  )
}
