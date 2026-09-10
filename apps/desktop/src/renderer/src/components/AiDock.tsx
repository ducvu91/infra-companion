import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'
import { useUiStore, type AiDockTab } from '../stores/ui'
import { AiModal } from './AiModal'
import { AiDiagnoseModal } from './AiDiagnoseModal'

/**
 * Ô chứa các nút của panel đang hiện (⛶ ⚙ ✕) trên thanh tab.
 *
 * Pane biết nút của mình, nhưng hàng để đặt lại thuộc về shell — nối bằng portal thay vì đẩy
 * `ReactNode` ngược lên cha (setState lúc render = vòng lặp). `null` = chưa có thanh tab (chỉ
 * một panel), lúc đó pane tự vẽ header riêng như cũ.
 */
const DockActionsSlot = createContext<HTMLDivElement | null>(null)

/**
 * Chỗ duy nhất dựng cột AI: khung ngoài (bề rộng, thanh tab) vẽ một lần ở đây, hai panel nằm
 * bên trong và tự vẽ phần nội dung của mình qua `renderSpec` → `AiDockPane`.
 *
 * Danh sách tab tính từ **cờ mở/đóng trong store**, không phải từ spec do panel trả về: cần biết
 * đang mở mấy panel *trước khi* render chúng thì thanh tab mới vẽ đúng ngay lượt đầu, và tránh
 * hẳn kiểu con-báo-ngược-lên-cha (setState lúc render = vòng lặp, mutate mảng = vỡ ở concurrent).
 */
export function AiDockHost() {
  const aiOpen = useUiStore((s) => s.aiPanelOpen)
  const setAiOpen = useUiStore((s) => s.setAiPanelOpen)
  const diagOpen = useUiStore((s) => s.aiDiagnoseOpen)
  const minimizeDiag = useUiStore((s) => s.minimizeAiDiagnose)
  const activeTab = useUiStore((s) => s.aiDockTab)

  const open: AiDockTab[] = []
  if (aiOpen) open.push('ai')
  if (diagOpen) open.push('ai-diagnose')
  if (open.length === 0) return null

  // Tab đang chọn có thể vừa bị đóng — rơi về cái còn lại thay vì hiện cột trống.
  const active = open.includes(activeTab) ? activeTab : open[0]

  return (
    <AiDockShell tabs={open} active={active}>
      {aiOpen && (
        <AiModal
          onClose={() => setAiOpen(false)}
          renderSpec={(spec) => <AiDockPane spec={spec} active={active === 'ai'} />}
        />
      )}
      {diagOpen && (
        <AiDiagnoseModal
          onClose={minimizeDiag}
          renderSpec={(spec) => <AiDockPane spec={spec} active={active === 'ai-diagnose'} />}
        />
      )}
    </AiDockShell>
  )
}

/**
 * Nhãn tab — tra theo id để thanh tab vẽ được mà không cần spec của panel.
 *
 * Nhãn NGẮN riêng, không dùng lại tên đầy đủ của công cụ: cột hẹp tới 280px và hàng này còn
 * chứa 3 nút, nên "AI chẩn đoán sự cố" sẽ cụt thành "AI chẩn đoán sự…" — mất đúng phần chữ
 * mang thông tin. Tên đầy đủ vẫn ở tooltip.
 */
const TAB_META: Record<
  AiDockTab,
  { icon: string; shortKey: 'ai.tabShort' | 'ai.diagnose.tabShort'; titleKey: 'ai.title' | 'ai.diagnose.title' }
> = {
  ai: { icon: '✨', shortKey: 'ai.tabShort', titleKey: 'ai.title' },
  'ai-diagnose': { icon: '🩺', shortKey: 'ai.diagnose.tabShort', titleKey: 'ai.diagnose.title' },
}

/**
 * Cột DOCK bên phải vùng làm việc — khuôn của panel Claude Code trong VS Code.
 *
 * Khác panel nổi ở đúng điểm người dùng quan tâm: dock **chiếm chỗ thật**, terminal hẹp lại
 * nhường chỗ chứ không bị che. Hỏi AI về hạ tầng thì nửa việc là *đọc output*, nên một panel
 * nổi — dù kéo đi đâu — vẫn cắn vào phần đang đọc; còn dock thì output luôn nguyên vẹn, chỉ
 * ngắn dòng hơn.
 *
 * **Một cột, nhiều tab.** Hai công cụ AI (Trợ lý · Chẩn đoán) dùng chung đúng cột này thay vì
 * mỗi cái một cột: hai cột là 800px, terminal còn một mẩu — mà cả hai đều là thứ vừa-hỏi-vừa-
 * nhìn-output, mất output thì mở ra làm gì. Thanh tab chỉ hiện khi có từ 2 panel trở lên; một
 * mình thì vẫn là header đơn như trước, không bắt ai học thêm gì.
 *
 * Panel không được chọn **vẫn mounted**, chỉ ẩn bằng `hidden` — chuyển tab qua lại không được
 * làm mất câu đang gõ hay phiên chẩn đoán đang chờ duyệt (cùng lý do `BottomPanel` giữ cả 3 tab).
 *
 * Kéo **mép trái** để đổi bề rộng (kẹp 280–720px, nhớ qua localStorage). Trong lúc kéo phủ một
 * lớp `fixed` lên toàn cửa sổ: không có nó thì xterm bên cạnh nuốt `mousemove` và thao tác kéo
 * đứt giữa chừng — cùng bẫy đã gặp ở `SidePanel` và `BottomPanel`.
 */
function AiDockShell({
  tabs,
  active,
  children,
}: {
  readonly tabs: readonly AiDockTab[]
  readonly active: AiDockTab
  readonly children: ReactNode
}) {
  const t = useT()
  const width = useUiStore((s) => s.aiDockWidth)
  const setWidth = useUiStore((s) => s.setAiDockWidth)
  const setActiveTab = useUiStore((s) => s.setAiDockTab)
  const [dragging, setDragging] = useState(false)
  // `useState` chứ không `useRef`: portal cần một lượt render NỮA sau khi div có thật trong DOM,
  // mà gán ref thì không kích hoạt render — nút sẽ không bao giờ hiện ở lượt đầu.
  const [actionsEl, setActionsEl] = useState<HTMLDivElement | null>(null)

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

      {/* Thanh tab chỉ khi có nhiều hơn một panel — mở mỗi Trợ lý AI thì một hàng tab một mục là
          thừa, chỉ tốn chiều cao của thứ đang hẹp sẵn. Khi có tab thì các nút của panel (⛶ ⚙ ✕)
          dọn lên NGANG HÀNG này (`AiDockPane` bỏ header riêng): để chúng ở dòng dưới thì mất
          nguyên một hàng trống chỉ để chứa ba nút, trong một cột 400px. */}
      {tabs.length > 1 && (
        <div className="border-edge flex shrink-0 items-stretch gap-1 border-b pr-1.5">
          <div className="flex min-w-0 flex-1 items-stretch">
            {tabs.map((id) => {
              const meta = TAB_META[id]
              const label = t(meta.shortKey)
              return (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  title={t(meta.titleKey)}
                  // Tab không active vẫn đọc được TÊN: nhận diện bằng chữ chứ không bằng icon, hai
                  // icon ✨/🩺 ở cỡ này nhìn na ná nhau.
                  className={`min-w-0 flex-1 truncate px-2 py-1.5 text-xs ${
                    id === active ? 'text-content font-medium' : 'text-subtle hover:bg-hover hover:text-content'
                  }`}
                  style={id === active ? { boxShadow: 'inset 0 -2px 0 var(--c-accent)' } : undefined}
                >
                  {meta.icon} {label}
                </button>
              )
            })}
          </div>
          {/* Nút của panel ĐANG hiện (⛶ ⚙ ✕). `AiDockPane` gửi chúng lên đây bằng portal — pane
              biết nút của mình, còn hàng để đặt thì thuộc về shell. */}
          <div ref={setActionsEl} className="flex shrink-0 items-center gap-1" />
        </div>
      )}

      {/* Mọi panel đều render; cái không active bị `hidden`. KHÔNG unmount — xem chú thích đầu file. */}
      <DockActionsSlot.Provider value={tabs.length > 1 ? actionsEl : null}>{children}</DockActionsSlot.Provider>
    </div>
  )
}

/** Một panel trong dock: header (khi đứng một mình) · vùng cuộn · khe đáy. */
export interface AiDockPaneSpec {
  readonly id: AiDockTab
  readonly title: string
  readonly icon: string
  readonly children: ReactNode
  readonly onClose: () => void
  readonly headerExtra?: ReactNode
  /** Tooltip cho nút ✕ — mặc định "Đóng (Ctrl+I)"; đặt khi đóng có nghĩa khác (vd giữ phiên chạy nền). */
  readonly closeHint?: string
  /** Khe đáy KHÔNG cuộn — chỗ nhập & nút chính. Bỏ trống thì `children` chiếm cả chiều cao. */
  readonly footer?: ReactNode
}

/**
 * Ba khe theo chiều dọc: header · `children` **cuộn** · `footer` **neo ở đáy**. Chỗ nhập thuộc
 * khe đáy — khuôn của mọi khung chat, và ở đây là bắt buộc chứ không phải cho giống: bỏ chung
 * vào một vùng cuộn thì mỗi câu trả lời dài lại đẩy ô nhập trôi khỏi tầm nhìn, nên hỏi tiếp là
 * phải cuộn đi tìm chỗ gõ. Neo ở đáy thì ô nhập ở đúng một chỗ suốt phiên.
 */
function AiDockPane({
  spec,
  active,
}: {
  readonly spec: AiDockPaneSpec
  readonly active: boolean
}) {
  const t = useT()
  // Có slot = đang có thanh tab → nút đi lên hàng đó, pane bỏ hẳn header riêng để khỏi tốn thêm
  // một hàng. Không có slot = panel đứng một mình → header như cũ (tên + nút).
  const slot = useContext(DockActionsSlot)

  /**
   * Nội dung mới (câu trả lời, bước chẩn đoán vừa xong) thì cuộn xuống đáy — **nhưng chỉ khi user
   * đang ở sẵn gần đáy**. Cuộn vô điều kiện là bẫy quen của khung chat: đang cuộn ngược lên đọc
   * output của bước 2 thì bước 4 chạy xong và giật màn hình đi mất. Ngưỡng 60px = "đang theo dõi
   * dòng cuối"; xa hơn thì coi như user chủ động đọc chỗ khác, để yên.
   */
  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  useEffect(() => {
    const el = scrollRef.current
    // Panel đang ẩn có kích thước 0 nên `scrollHeight` vô nghĩa — bỏ qua, lượt hiện lại sẽ cuộn.
    if (el && active && nearBottom.current) el.scrollTop = el.scrollHeight
  }, [spec.children, active])

  const actions = (
    <>
      {spec.headerExtra}
      <button
        className="text-subtle hover:bg-hover hover:text-content shrink-0 rounded px-1 py-0.5 text-sm leading-none"
        aria-label={t('panel.close')}
        title={spec.closeHint ?? `${t('panel.close')} (Ctrl+I)`}
        onClick={spec.onClose}
      >
        ✕
      </button>
    </>
  )

  return (
    <div className={active ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
      {/* Chỉ pane ĐANG hiện mới gửi nút lên thanh tab — hai pane cùng gửi thì hàng đó có 6 nút,
          nửa số đó thuộc panel đang ẩn. */}
      {slot ? (
        active && createPortal(actions, slot)
      ) : (
        <div className="border-edge flex shrink-0 items-center gap-1 border-b px-3 py-2">
          <span className="text-content min-w-0 flex-1 truncate text-sm font-semibold">
            {spec.icon} {spec.title}
          </span>
          {actions}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3"
      >
        {spec.children}
      </div>

      {/* Khe đáy: `shrink-0` để nội dung dài phía trên không bao giờ bóp ô nhập lại, và `border-t`
          tách khỏi vùng cuộn cho thấy rõ nó không trôi theo. */}
      {spec.footer && <div className="border-edge bg-panel shrink-0 border-t px-3 py-2.5">{spec.footer}</div>}
    </div>
  )
}
