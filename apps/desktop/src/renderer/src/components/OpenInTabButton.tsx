import { useTabsStore, type ToolTabKind } from '../stores/tabs'
import { useT } from '../i18n'

/**
 * Nút "⊞ Mở ở tab" trên header của các công cụ dạng popup/dock.
 *
 * Lý do tồn tại: popup là modal — mở lên là KHOÁ cả app, không làm được việc khác trong lúc công
 * cụ chạy dài (AI chẩn đoán từng bước, theo dõi tunnel, xem tiến trình). Bấm nút này chuyển đúng
 * công cụ đó sang một tab rồi đóng popup, state giữ nguyên vì cả hai đọc chung store. Với dock AI
 * thì lý do khác: cột hẹp đọc câu trả lời dài rất mệt, tab rộng hơn nhiều.
 */
export function OpenInTabButton({
  kind,
  onDone,
  compact,
}: {
  kind: ToolTabKind
  onDone?: () => void
  /**
   * Chỉ icon ⛶, không chữ và không viền — cho header CHẬT (dock AI: hàng đó còn phải chứa hai
   * tab). Modal rộng thì giữ bản có chữ: "⛶" một mình không nói được nó làm gì, mà ở đó không
   * thiếu chỗ nên đánh đổi ngược là lỗ. Cả hai bản đều có tooltip.
   */
  compact?: boolean
}) {
  const t = useT()
  const openToolTab = useTabsStore((s) => s.openToolTab)
  const open = (): void => {
    openToolTab(kind)
    onDone?.()
  }

  if (compact) {
    return (
      <button
        type="button"
        className="text-subtle hover:bg-hover hover:text-content shrink-0 rounded px-1 py-0.5 text-sm leading-none"
        title={t('tabs.openInTabHint')}
        aria-label={t('tabs.openInTab')}
        onClick={open}
      >
        ⛶
      </button>
    )
  }

  return (
    <button
      type="button"
      className="border-edge-strong text-muted hover:bg-hover hover:text-content shrink-0 rounded border px-2 py-0.5 text-[11px] font-normal"
      title={t('tabs.openInTabHint')}
      onClick={open}
    >
      ⊞ {t('tabs.openInTab')}
    </button>
  )
}
