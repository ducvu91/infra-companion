import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'
import { useAiDiagnoseStore } from '../stores/aiDiagnose'
import { useUiStore, type AiDockTab } from '../stores/ui'
import { useVrmChatStore } from '../stores/vrmChat'
import { AiModal } from './AiModal'
import { AiDiagnoseModal } from './AiDiagnoseModal'
import { CodexPanel } from './CodexPanel'

/**
 * Ô chứa các nút của panel đang hiện (💬 ⛶ ⚙) trên thanh tab.
 *
 * Pane biết nút của mình, nhưng hàng để đặt lại thuộc về shell — nối bằng portal thay vì đẩy
 * `ReactNode` ngược lên cha (setState lúc render = vòng lặp). `null` chỉ ở lượt render đầu, khi
 * div chưa có trong DOM.
 */
const DockActionsSlot = createContext<HTMLDivElement | null>(null)

/** Ba tab của cột AI, thứ tự cố định — luôn hiện đủ, kể cả panel chưa mở. */
const ALL_TABS: readonly AiDockTab[] = ['ai', 'ai-diagnose', 'codex']

/** Tab → id công cụ cho `setModal` (Codex có id riêng cho chế độ dock). */
const MODAL_FOR: Record<AiDockTab, 'ai' | 'ai-diagnose' | 'codex-dock'> = {
  ai: 'ai',
  'ai-diagnose': 'ai-diagnose',
  codex: 'codex-dock',
}

/**
 * Đóng CẢ cột. Panel chỉ được cất đi, không có gì bị dừng: phiên Codex sống ở main, phiên chẩn
 * đoán ở store — mở lại là nguyên trạng. Chẩn đoán đang có phiên thì để lại pill: đó là thứ duy
 * nhất còn báo "AI đã đề xuất lệnh, đang chờ bạn duyệt" khi dock đã đóng. Không có phiên thì
 * không pill — một cái pill "AI chẩn đoán" trơ trọi sau khi user chỉ đóng Trợ lý AI là rác.
 */
function closeAiDock(): void {
  const ui = useUiStore.getState()
  if (ui.aiPanelOpen) ui.setAiPanelOpen(false)
  if (ui.codexPanelOpen) ui.setCodexPanelOpen(false)
  if (ui.aiDiagnoseOpen) {
    if (useAiDiagnoseStore.getState().session) ui.minimizeAiDiagnose()
    else ui.setAiDiagnoseOpen(false)
  }
}

/**
 * Chỗ duy nhất dựng cột AI: khung ngoài (bề rộng, thanh tab) vẽ một lần ở đây, các panel nằm
 * bên trong và tự vẽ phần nội dung của mình qua `renderSpec` → `AiDockPane`.
 *
 * **Thanh tab luôn đủ ba mục** (Trợ lý · Chẩn đoán · Codex), mở công cụ nào thì tab đó active.
 * Bản trước chỉ hiện tab của panel đã mở, nên mở Trợ lý AI là một cột không tab, mở thêm Chẩn
 * đoán mới thấy hàng tab nhảy ra — cùng một cột mà lúc có lúc không, và user không biết còn hai
 * công cụ nữa ở ngay đó. Panel **chỉ mount khi tab được mở** (cờ trong store): mount Codex là
 * `attach()` vào phiên ở main, không đáng trả giá đó chỉ vì user mở Trợ lý AI.
 *
 * Danh sách panel đã mở tính từ **cờ trong store**, không phải từ spec do panel trả về: cần biết
 * *trước khi* render chúng thì tab active mới đúng ngay lượt đầu, và tránh hẳn kiểu con-báo-
 * ngược-lên-cha (setState lúc render = vòng lặp, mutate mảng = vỡ ở concurrent).
 */
export function AiDockHost() {
  const aiOpen = useUiStore((s) => s.aiPanelOpen)
  const setAiOpen = useUiStore((s) => s.setAiPanelOpen)
  const diagOpen = useUiStore((s) => s.aiDiagnoseOpen)
  const minimizeDiag = useUiStore((s) => s.minimizeAiDiagnose)
  const codexOpen = useUiStore((s) => s.codexPanelOpen)
  const setCodexOpen = useUiStore((s) => s.setCodexPanelOpen)
  const activeTab = useUiStore((s) => s.aiDockTab)
  const vrmAttached = useVrmChatStore((s) => s.attached)

  const mounted: Record<AiDockTab, boolean> = { ai: aiOpen, 'ai-diagnose': diagOpen, codex: codexOpen }
  if (!aiOpen && !diagOpen && !codexOpen) return null

  // Tab đang chọn phải là panel ĐÃ mở — vừa bị đóng lẻ (Ctrl+I, ⛶ sang tab) thì rơi về panel còn lại
  const active: AiDockTab = mounted[activeTab] ? activeTab : (ALL_TABS.find((id) => mounted[id]) ?? 'ai')

  /**
   * "Thu về nhân vật": đóng cột, mở bong bóng chat trên đầu nhân vật VRM — đường ngược của nút
   * ⛶ trong bong bóng. Chỉ đưa cho panel khi nhân vật đang hiện; không có chỗ để về thì không mời.
   */
  const collapseToCharacter = vrmAttached
    ? (): void => {
        closeAiDock()
        useVrmChatStore.getState().requestOpen()
      }
    : undefined

  return (
    <AiDockShell active={active} mounted={mounted} onClose={closeAiDock}>
      {aiOpen && (
        <AiModal
          onClose={() => setAiOpen(false)}
          onCollapseToCharacter={collapseToCharacter}
          renderSpec={(spec) => <AiDockPane spec={spec} active={active === 'ai'} />}
        />
      )}
      {diagOpen && (
        <AiDiagnoseModal
          onClose={minimizeDiag}
          renderSpec={(spec) => <AiDockPane spec={spec} active={active === 'ai-diagnose'} />}
        />
      )}
      {/* Codex ở dock: cất cột KHÔNG dừng phiên (phiên sống ở main). Mở lại thấy nguyên trạng qua `attach()`. */}
      {codexOpen && (
        <CodexPanel
          onClose={() => setCodexOpen(false)}
          renderSpec={(spec) => <AiDockPane spec={spec} active={active === 'codex'} />}
        />
      )}
    </AiDockShell>
  )
}

/**
 * Nhãn tab — tra theo id để thanh tab vẽ được mà không cần spec của panel (panel chưa mở thì
 * không có spec nào cả).
 *
 * Nhãn NGẮN riêng, không dùng lại tên đầy đủ của công cụ: cột hẹp tới 280px và hàng này còn
 * chứa 3–4 nút, nên "AI chẩn đoán sự cố" sẽ cụt thành "AI chẩn đoán sự…" — mất đúng phần chữ
 * mang thông tin. Tên đầy đủ vẫn ở tooltip.
 */
const TAB_META: Record<
  AiDockTab,
  {
    icon: string
    shortKey: 'ai.tabShort' | 'ai.diagnose.tabShort' | 'codex.title'
    titleKey: 'ai.title' | 'ai.diagnose.title' | 'codex.title'
  }
> = {
  ai: { icon: '✨', shortKey: 'ai.tabShort', titleKey: 'ai.title' },
  'ai-diagnose': { icon: '🩺', shortKey: 'ai.diagnose.tabShort', titleKey: 'ai.diagnose.title' },
  // "Codex" đã là một từ ngắn — không cần nhãn rút gọn riêng.
  codex: { icon: '🤖', shortKey: 'codex.title', titleKey: 'codex.title' },
}

/**
 * Cột DOCK bên phải vùng làm việc — khuôn của panel Claude Code trong VS Code.
 *
 * Khác panel nổi ở đúng điểm người dùng quan tâm: dock **chiếm chỗ thật**, terminal hẹp lại
 * nhường chỗ chứ không bị che. Hỏi AI về hạ tầng thì nửa việc là *đọc output*, nên một panel
 * nổi — dù kéo đi đâu — vẫn cắn vào phần đang đọc; còn dock thì output luôn nguyên vẹn, chỉ
 * ngắn dòng hơn.
 *
 * **Một cột, ba tab, một nút ✕.** Ba công cụ AI dùng chung đúng cột này thay vì mỗi cái một
 * cột: hai cột là 800px, terminal còn một mẩu — mà cả ba đều là thứ vừa-hỏi-vừa-nhìn-output,
 * mất output thì mở ra làm gì. Bấm tab chưa mở là mở công cụ đó (qua `setModal`, như mọi lối vào
 * khác). ✕ đóng CẢ cột — thanh tab luôn đủ ba mục nên "✕ đóng tab này" sẽ trông như không có gì
 * xảy ra (tab vẫn ở đó, chỉ đổi mục active); phiên đang chạy không bị dừng, xem `closeAiDock`.
 *
 * Panel không được chọn **vẫn mounted**, chỉ ẩn bằng `hidden` — chuyển tab qua lại không được
 * làm mất câu đang gõ hay phiên chẩn đoán đang chờ duyệt (cùng lý do `BottomPanel` giữ cả 3 tab).
 *
 * Kéo **mép trái** để đổi bề rộng (kẹp 280–720px, nhớ qua localStorage). Trong lúc kéo phủ một
 * lớp `fixed` lên toàn cửa sổ: không có nó thì xterm bên cạnh nuốt `mousemove` và thao tác kéo
 * đứt giữa chừng — cùng bẫy đã gặp ở `SidePanel` và `BottomPanel`.
 */
function AiDockShell({
  active,
  mounted,
  onClose,
  children,
}: {
  readonly active: AiDockTab
  /** Panel nào đã mở (mounted). Tab chưa mở bấm vào là mở. */
  readonly mounted: Readonly<Record<AiDockTab, boolean>>
  readonly onClose: () => void
  readonly children: ReactNode
}) {
  const t = useT()
  const width = useUiStore((s) => s.aiDockWidth)
  const setWidth = useUiStore((s) => s.setAiDockWidth)
  const setActiveTab = useUiStore((s) => s.setAiDockTab)
  const setModal = useUiStore((s) => s.setModal)
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

      {/* Thanh tab: luôn đủ ba mục. Các nút của panel đang hiện (💬 ⛶ ⚙) dọn lên NGANG HÀNG này
          (`AiDockPane` gửi qua portal): để chúng ở dòng dưới thì mất nguyên một hàng trống chỉ để
          chứa ba nút, trong một cột 400px. ✕ đứng cuối, cố định — nó là của cột, không của panel. */}
      <div className="border-edge flex shrink-0 items-stretch gap-1 border-b pr-1.5">
        <div className="flex min-w-0 flex-1 items-stretch">
          {ALL_TABS.map((id) => {
            const meta = TAB_META[id]
            const label = t(meta.shortKey)
            return (
              <button
                key={id}
                // Đã mở → chỉ đưa lên trước; chưa mở → mở qua `setModal` để lượt dùng được đếm
                // và tab active được đặt đúng như mọi lối vào khác (menu ⋯, palette, lưới).
                onClick={() => (mounted[id] ? setActiveTab(id) : setModal(MODAL_FOR[id]))}
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
        {/* Nút của panel ĐANG hiện. `AiDockPane` gửi chúng lên đây bằng portal — pane biết nút
            của mình, còn hàng để đặt thì thuộc về shell. */}
        <div ref={setActionsEl} className="flex shrink-0 items-center gap-1" />
        <button
          className="text-subtle hover:bg-hover hover:text-content my-auto shrink-0 rounded px-1 py-0.5 text-sm leading-none"
          aria-label={t('panel.close')}
          title={t('ai.dockCloseHint')}
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      {/* Mọi panel đã mở đều render; cái không active bị `hidden`. KHÔNG unmount — xem chú thích đầu file. */}
      <DockActionsSlot.Provider value={actionsEl}>{children}</DockActionsSlot.Provider>
    </div>
  )
}

/** Một panel trong dock: nút trên thanh tab · vùng cuộn · khe đáy. */
export interface AiDockPaneSpec {
  readonly id: AiDockTab
  readonly title: string
  readonly icon: string
  readonly children: ReactNode
  /** Nút riêng của panel (💬 ⛶ ⚙) — đưa lên thanh tab khi panel đang hiện. */
  readonly headerExtra?: ReactNode
  /** Khe đáy KHÔNG cuộn — chỗ nhập & nút chính. Bỏ trống thì `children` chiếm cả chiều cao. */
  readonly footer?: ReactNode
}

/**
 * Hai khe theo chiều dọc: `children` **cuộn** · `footer` **neo ở đáy** (header là thanh tab của
 * shell, dùng chung). Chỗ nhập thuộc khe đáy — khuôn của mọi khung chat, và ở đây là bắt buộc chứ
 * không phải cho giống: bỏ chung vào một vùng cuộn thì mỗi câu trả lời dài lại đẩy ô nhập trôi
 * khỏi tầm nhìn, nên hỏi tiếp là phải cuộn đi tìm chỗ gõ. Neo ở đáy thì ô nhập ở đúng một chỗ
 * suốt phiên.
 */
function AiDockPane({
  spec,
  active,
}: {
  readonly spec: AiDockPaneSpec
  readonly active: boolean
}) {
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

  return (
    <div className={active ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
      {/* Chỉ pane ĐANG hiện mới gửi nút lên thanh tab — hai pane cùng gửi thì hàng đó có 6 nút,
          nửa số đó thuộc panel đang ẩn. */}
      {slot && active && spec.headerExtra && createPortal(spec.headerExtra, slot)}

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
