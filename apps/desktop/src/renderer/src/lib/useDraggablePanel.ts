import { useRef, useState, type PointerEvent, type RefObject } from 'react'

export interface DraggablePanel {
  /** Gắn vào phần tử panel (khung ngoài cùng cần định vị). */
  panelRef: RefObject<HTMLDivElement | null>
  /** null = chưa kéo lần nào → panel giữ vị trí neo mặc định qua className.
   *  Có giá trị = toạ độ (theo offsetParent) user đã thả → set qua style left/top. */
  pos: { x: number; y: number } | null
  /** Trả panel về vị trí neo mặc định (className), quên chỗ user đã kéo tới. */
  resetPos: () => void
  /** Spread vào phần tử "nắm để kéo" (thường là header). */
  headerHandlers: {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => void
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => void
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => void
  }
}

/** Kéo thả panel bằng cách nắm header. Toạ độ tính theo offsetParent (khung app) và
 *  kẹp trong khung để header không văng mất. pos=null khi user chưa kéo → panel neo
 *  vị trí mặc định (className). Vị trí nhớ trong phiên (theo vòng đời component).
 *  Bấm vào <button> trong header KHÔNG khởi động kéo (để nút –/✕ vẫn bấm được).
 *  Dùng chung cho AiExplainPanel / MonitorDock / PluginPanelModal — kết hợp CSS
 *  `resize` (grip góc dưới-phải của Chromium) để vừa kéo vừa chỉnh cỡ. */
export function useDraggablePanel(opts?: {
  /** Vị trí ban đầu (đã lưu từ phiên trước). */
  initial?: { x: number; y: number } | null
  /** Gọi khi user THẢ TAY — nơi gọi ghi xuống đĩa. Không gọi mỗi lần di chuột. */
  onCommit?: (pos: { x: number; y: number }) => void
  /**
   * Chỉ kéo khi đang giữ Ctrl (hoặc ⌘ trên mac).
   *
   * Dành cho nhân vật VRM: ở đó kéo TRẦN đã mang nghĩa khác (níu nhân vật, thả ra bật về), nên
   * dời khung phải có phím bổ trợ. Các panel khác giữ nguyên kéo trần — chúng có header thật.
   */
  requireCtrl?: boolean
  /**
   * Kẹp theo **TÂM** thẻ thay vì theo mép.
   *
   * Dành cho nhân vật VRM: thẻ rộng gấp `VRM_WIDTH_MARGIN` (2,2) lần người nhìn thấy — phần dư là
   * lề trong suốt cho clip giang tay. Kẹp mép thì "đụng tường" khi người còn cách mép cả gang tay
   * (user chụp được). Kẹp tâm: tâm thẻ cách mép ≥ 40px, tức phần giữa (nơi người đứng) luôn còn
   * trên màn hình để nắm lại được, còn lề vô hình được phép tràn ra ngoài.
   */
  clampCenter?: boolean
}): DraggablePanel {
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(opts?.initial ?? null)
  const drag = useRef<{ pointerId: number; offX: number; offY: number } | null>(null)
  // Giữ trong ref: callback thường là hàm mới mỗi lần render, đóng gói vào handler là bắt nơi
  // gọi phải `useCallback` mới không lỡ mất lượt ghi
  const commitRef = useRef(opts?.onCommit)
  commitRef.current = opts?.onCommit
  /** Vị trí mới nhất, đọc được ngay trong handler (state thì phải chờ render). */
  const lastPos = useRef<{ x: number; y: number } | null>(opts?.initial ?? null)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    /**
     * Bấm vào một điều khiển là thao tác với nó, không phải bắt đầu kéo.
     *
     * ⚠️ Phải kể **đủ** các loại, không chỉ `button`: `setPointerCapture` ở dưới kéo con trỏ về
     * div này, làm đứt chuỗi pointerdown→pointerup trên phần tử con nên trình duyệt **không bao
     * giờ sinh ra `click`**. Với `<input type="checkbox">` thì hậu quả là *tích vào không ăn* mà
     * chẳng có lỗi nào — đúng kiểu hỏng im lặng ở mục 8 CLAUDE.md (đã dính thật với ô "Hiện lúc
     * mở app" trong bảng cài đặt nhân vật).
     */
    if ((e.target as HTMLElement).closest('button, input, select, textarea, label, a, [contenteditable]')) return
    if (opts?.requireCtrl && !e.ctrlKey && !e.metaKey) return
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    drag.current = { pointerId: e.pointerId, offX: e.clientX - rect.left, offY: e.clientY - rect.top }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    const panel = panelRef.current
    if (!d || d.pointerId !== e.pointerId || !panel) return
    const parent = panel.offsetParent as HTMLElement | null
    if (!parent) return
    const pr = parent.getBoundingClientRect()
    const rect = panel.getBoundingClientRect()
    // Kẹp trong khung app: không cho văng mất — header luôn còn với tới được.
    // `clampCenter` (nhân vật VRM): chỉ giữ TÂM thẻ trong khung, lề trong suốt được tràn.
    const half = rect.width / 2
    const x = opts?.clampCenter
      ? Math.min(Math.max(e.clientX - pr.left - d.offX, 40 - half), pr.width - 40 - half)
      : Math.min(Math.max(e.clientX - pr.left - d.offX, 0), Math.max(0, pr.width - rect.width))
    const y = Math.min(Math.max(e.clientY - pr.top - d.offY, 0), Math.max(0, pr.height - 40))
    lastPos.current = { x, y }
    setPos({ x, y })
  }

  const onPointerUp = (e: PointerEvent<HTMLDivElement>): void => {
    if (drag.current?.pointerId !== e.pointerId) return
    drag.current = null
    // Ghi ở đây chứ không trong `onPointerMove`: kéo một lần sinh hàng chục sự kiện, ghi mỗi
    // lần là ngần ấy lượt ghi JSON xuống đĩa cho một thao tác liên tục.
    // Đọc từ ref chứ không gọi trong updater của `setPos`: updater phải là hàm thuần (React
    // gọi lại nó ở StrictMode), nhét lệnh ghi file vào đó là ghi hai lần.
    if (lastPos.current) commitRef.current?.(lastPos.current)
  }

  const resetPos = (): void => {
    lastPos.current = null
    setPos(null)
  }

  return { panelRef, pos, resetPos, headerHandlers: { onPointerDown, onPointerMove, onPointerUp } }
}
