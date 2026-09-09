import { useState, type ReactNode } from 'react'
import { useT } from '../i18n'
import { useUiStore } from '../stores/ui'

/**
 * Cột DOCK bên phải vùng làm việc — khuôn của panel Claude Code trong VS Code.
 *
 * Khác panel nổi ở đúng điểm người dùng quan tâm: dock **chiếm chỗ thật**, terminal hẹp lại
 * nhường chỗ chứ không bị che. Hỏi AI về hạ tầng thì nửa việc là *đọc output*, nên một panel
 * nổi — dù kéo đi đâu — vẫn cắn vào phần đang đọc; còn dock thì output luôn nguyên vẹn, chỉ
 * ngắn dòng hơn.
 *
 * Kéo **mép trái** để đổi bề rộng (kẹp 280–720px, nhớ qua localStorage). Trong lúc kéo phủ một
 * lớp `fixed` lên toàn cửa sổ: không có nó thì xterm bên cạnh nuốt `mousemove` và thao tác kéo
 * đứt giữa chừng — cùng bẫy đã gặp ở `SidePanel` và `BottomPanel`.
 */
export function AiDock({
  title,
  icon,
  children,
  onClose,
  headerExtra,
  /** Tooltip cho nút ✕ — mặc định "Đóng (Ctrl+I)"; đặt khi đóng có nghĩa khác (vd giữ phiên chạy nền). */
  closeHint,
}: {
  readonly title: string
  readonly icon: string
  readonly children: ReactNode
  readonly onClose: () => void
  readonly headerExtra?: ReactNode
  readonly closeHint?: string
}) {
  const t = useT()
  const width = useUiStore((s) => s.aiDockWidth)
  const setWidth = useUiStore((s) => s.setAiDockWidth)
  const [dragging, setDragging] = useState(false)

  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    setDragging(true)
    // Kéo sang TRÁI là rộng thêm: dock nằm bên phải nên chênh lệch clientX trừ vào bề rộng.
    // Store tự kẹp min/max.
    const onMove = (ev: MouseEvent): void => setWidth(startW - (ev.clientX - startX))
    const onUp = (): void => {
      setDragging(false)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className="border-edge bg-panel relative flex shrink-0 flex-col border-l select-none" style={{ width }}>
      {/* Tay kéo đổi bề rộng — đè lên mép trái 6px, sáng lên khi hover/kéo */}
      <div
        role="separator"
        aria-orientation="vertical"
        title={t('ai.dockResize')}
        onMouseDown={startDrag}
        className={`hover:bg-accent/40 absolute inset-y-0 -left-[3px] z-10 w-1.5 cursor-col-resize ${
          dragging ? 'bg-accent/60' : ''
        }`}
      />
      {dragging && <div className="fixed inset-0 z-[60] cursor-col-resize" />}

      <div className="border-edge flex shrink-0 items-center gap-1 border-b px-3 py-2">
        <span className="text-content min-w-0 flex-1 truncate text-sm font-semibold">
          {icon} {title}
        </span>
        {headerExtra}
        <button
          className="text-subtle hover:bg-hover hover:text-content shrink-0 rounded px-1 py-0.5 text-sm leading-none"
          aria-label={t('panel.close')}
          title={closeHint ?? `${t('panel.close')} (Ctrl+I)`}
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{children}</div>
    </div>
  )
}
