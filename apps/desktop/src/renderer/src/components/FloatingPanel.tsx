import { useEffect, useState, type ReactNode } from 'react'
import { useT } from '../i18n'
import { useDraggablePanel } from '../lib/useDraggablePanel'

/**
 * Khung panel NỔI, ghim trong khung app — **không backdrop, không bắt Esc**.
 *
 * Đây là khuôn đã dùng cho `AiExplainPanel` (F46) và giờ dùng chung cho Trợ lý AI: kéo header
 * để di chuyển, grip `◢` góc dưới-phải để chỉnh cỡ (CSS `resize` gốc của Chromium — browser tự
 * ghi width/height inline nên React không đè lại), `–` thu thành pill, `⛶` phóng gần full khung.
 *
 * Khác `Modal` ở đúng điểm quan trọng nhất: **terminal bên dưới vẫn gõ được**. Một cửa sổ AI có
 * backdrop biến "hỏi AI rồi chạy thử" thành "đóng AI, chạy thử, mở lại AI, gõ lại câu hỏi" —
 * mà hỏi AI về hạ tầng thì gần như luôn là vừa hỏi vừa nhìn output.
 *
 * `maxHeight` tính theo vị trí top THỰC TẾ (neo hoặc đã kéo) nên đáy panel không tràn khỏi khung
 * app → nội dung dài luôn cuộn được thay vì bị cắt mất.
 */
export function FloatingPanel({
  title,
  icon,
  children,
  onClose,
  headerExtra,
  /** Cách mép trên khung app (px) khi chưa kéo — để nhiều panel không đè nhau. */
  anchorTop = 56,
  /** Bề rộng mặc định (px) trước khi user chỉnh bằng grip. */
  width = 460,
  /** Nhãn hiện trên pill khi thu nhỏ; mặc định lấy `title`. */
  pillLabel,
  /** Panel này đang chạy việc gì đó ở nền → pill nhấp nháy để user biết chưa xong. */
  busy = false,
  /**
   * Đổi giá trị này = "có việc mới" → panel tự bung nếu đang thu nhỏ.
   *
   * Cần một khoá tường minh chứ không suy từ `busy`: một yêu cầu mới có thể xong ngay (cache,
   * lỗi tức thì) nên `busy` không kịp đổi, và lúc đó panel thu nhỏ sẽ im lặng giữ kết quả cũ.
   */
  restoreKey
}: {
  readonly title: string
  readonly icon: string
  readonly children: ReactNode
  readonly onClose: () => void
  readonly headerExtra?: ReactNode
  readonly anchorTop?: number
  readonly width?: number
  readonly pillLabel?: string
  readonly busy?: boolean
  readonly restoreKey?: string | number
}) {
  const t = useT()
  const [minimized, setMinimized] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const { panelRef, pos, headerHandlers } = useDraggablePanel()

  // Yêu cầu mới thì bung ra — thu nhỏ rồi mà im lặng là mất dấu kết quả.
  useEffect(() => {
    setMinimized(false)
  }, [restoreKey])

  if (minimized) {
    return (
      <div
        className="bg-elevated/95 border-edge-strong absolute right-3 z-40 flex max-w-[280px] cursor-pointer items-center gap-2 rounded-full border py-1.5 pr-2 pl-3 opacity-75 shadow-2xl transition-opacity duration-150 hover:opacity-100"
        style={{ top: anchorTop }}
        title={t('panel.restore')}
        onClick={() => setMinimized(false)}
      >
        <span className="text-xs leading-none">{icon}</span>
        <span className="text-content min-w-0 truncate text-xs">{pillLabel ?? title}</span>
        {busy && <span className="bg-warning size-2 shrink-0 animate-pulse rounded-full" />}
        <button
          className="text-subtle hover:text-content shrink-0 px-1 text-sm leading-none"
          aria-label={t('panel.close')}
          title={t('panel.close')}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        >
          ✕
        </button>
      </div>
    )
  }

  return (
    <div
      ref={panelRef}
      style={
        expanded
          ? // Gần full khung app; chừa 12px lề để vẫn thấy panel "nổi"
            { left: 12, top: anchorTop, width: 'calc(100% - 24px)', height: `calc(100% - ${anchorTop + 12}px)` }
          : {
              ...(pos ? { left: pos.x, top: pos.y } : { top: anchorTop }),
              width,
              maxHeight: `calc(100% - ${(pos ? pos.y : anchorTop) + 12}px)`
            }
      }
      className={`bg-elevated/95 border-edge-strong absolute z-40 flex max-w-[calc(100%-1.5rem)] min-h-40 min-w-72 flex-col overflow-hidden rounded-lg border opacity-95 shadow-2xl transition-opacity duration-150 hover:opacity-100 ${
        expanded ? '' : 'resize'
      } ${pos || expanded ? '' : 'right-3'}`}
    >
      <div
        className="border-edge flex shrink-0 cursor-move items-center justify-between gap-2 border-b px-4 py-2.5 select-none"
        title={t('panel.dragHint')}
        {...headerHandlers}
      >
        <span className="text-content truncate text-sm font-semibold">
          {icon} {title}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          {headerExtra}
          <button
            className="text-subtle hover:text-content px-1 text-xs leading-none"
            aria-label={expanded ? t('panel.restoreSize') : t('panel.maximize')}
            title={expanded ? t('panel.restoreSize') : t('panel.maximize')}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '❐' : '⛶'}
          </button>
          <button
            className="text-subtle hover:text-content px-1 text-sm leading-none"
            aria-label={t('panel.minimize')}
            title={t('panel.minimize')}
            onClick={() => setMinimized(true)}
          >
            –
          </button>
          <button
            className="text-subtle hover:text-content px-1 text-sm leading-none"
            aria-label={t('panel.close')}
            title={t('panel.close')}
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
      {/* Dấu gợi ý grip resize của Chromium (grip thật vô hình trên nền tối) */}
      {!expanded && (
        <span
          aria-hidden
          className="text-subtle pointer-events-none absolute right-1 bottom-0.5 text-[9px] leading-none opacity-60 select-none"
        >
          ◢
        </span>
      )}
    </div>
  )
}
