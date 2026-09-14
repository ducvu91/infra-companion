import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  buildContext,
  clampAnswer,
  hasCustomisableParts,
  matchesOutfit,
  matchOpenIntent,
  openedLine,
  placeVrmPanel,
  usableParts,
  type VrmOutfit
} from '@infra/shared'
import { useT } from '../i18n'
import { MiniMarkdown } from '../lib/miniMarkdown'
import { openTool, splitMenuLabel, TOOLS } from '../lib/toolCatalog'
import { terminalTargetPane } from '../stores/tabs'
import { errorMessage, useToastsStore } from '../stores/toasts'
import { useVrmChatStore } from '../stores/vrmChat'

/**
 * F70 — menu VÒNG TRÒN quanh nhân vật + bảng hai bên để chọn biểu cảm/trang phục.
 *
 * Thay cho menu xổ dọc: danh sách biểu cảm của một model thật lên tới 30–40 mục, xổ thẳng ra
 * thì dài quá màn hình và không đọc nổi. Vòng tròn chỉ giữ **6 hành động chính**, còn các danh
 * sách dài thì mở ra thành **hai cột hai bên nhân vật** — mắt quét hai cột ngắn nhanh hơn một
 * cột dài, và giữa vẫn thấy nhân vật để biết mình vừa chọn ra cái gì.
 *
 * Khuôn lấy từ project `anime-companion-vscode` (radial-menu.js): mỗi nút `position:absolute`
 * chồng ở tâm, đẩy ra bằng `rotate(θ) translate(r) rotate(-θ)` — vòng xoay ngược cuối cùng giữ
 * cho icon đứng thẳng thay vì nghiêng theo bán kính.
 */

export interface RadialAction {
  id: string
  icon: string
  label: string
  onSelect: () => void
}

const ITEM = 38
const RADIUS = 86

/**
 * Bán kính nở ra theo số nút, không cố định.
 *
 * Ở `RADIUS` 86, vòng 11 nút cho khoảng cách cung ~49px cho nút rộng 38px — kẽ hở 11px, chật
 * tới mức các nút dính vào nhau. Ràng buộc thật là **chu vi phải đủ chỗ**: mỗi nút cần
 * `ITEM + 12`px cung, nên `r = n × (ITEM + 12) / 2π`.
 */
function radiusFor(count: number): number {
  return Math.max(RADIUS, (count * (ITEM + 12)) / (2 * Math.PI))
}

/**
 * Vòng tròn nút quanh một điểm.
 *
 * Góc bắt đầu từ 12 giờ (`-90°`) và chia đều 360°, giống bản gốc. Mỗi nút vào theo kiểu
 * "bung ra" có trễ dần (`--i` × 26ms) — chuyển động lệch nhau khiến vòng tròn có cảm giác nở
 * ra chứ không hiện đồng loạt.
 */
export function VrmRadialMenu({
  x,
  y,
  actions,
  onDismiss
}: {
  readonly x: number
  readonly y: number
  readonly actions: readonly RadialAction[]
  readonly onDismiss: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [out, setOut] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  // Bung ra ở frame SAU khi đã gắn vào DOM: đặt class ngay thì trình duyệt gộp hai trạng thái
  // vào một lần tính layout và transition không chạy
  useEffect(() => {
    const h = requestAnimationFrame(() => setOut(true))
    return () => cancelAnimationFrame(h)
  }, [])

  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onDismiss()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onDismiss])

  /**
   * Lớp phủ `fixed` toàn cửa sổ, KHÔNG nằm trong khung nhân vật.
   *
   * Khung ôm sát người nên có model chỉ rộng ~146px, mà vòng tròn bán kính 86 thì cần ~210px —
   * đặt trong khung là nửa vòng bị `overflow-hidden` cắt mất. Toạ độ nhận vào là toạ độ màn
   * hình (clientX/clientY), kẹp lại để vòng không tràn ra ngoài cửa sổ.
   */
  const radius = radiusFor(actions.length)
  const reach = radius + ITEM / 2 + 8
  const cx = Math.min(Math.max(x, reach), window.innerWidth - reach)
  const cy = Math.min(Math.max(y, reach), window.innerHeight - reach)

  return (
    // `data-vrm-overlay`: báo cho `VrmPanel` biết đây là bảng nổi, đừng coi cú bấm ở đây là
    // "chạm vào nhân vật" (xem chú thích ở `onPointerDown` của khung nhân vật)
    <div ref={ref} data-vrm-overlay className="pointer-events-none fixed inset-0 z-50">
      <div className="absolute" style={{ left: cx, top: cy }}>
        {actions.map((a, i) => {
          const angle = -90 + (360 / actions.length) * i
          /**
           * HAI phần tử, không một.
           *
           * Lớp ngoài giữ chuyển động **bung ra**: `transform` đặt vị trí trên vòng tròn, chạy
           * 300ms theo đường cong nảy, có trễ dần `i × 26ms`.
           *
           * Lớp trong chỉ đổi **màu** khi rê chuột. Trước đây gộp làm một nên `hover:scale-110`
           * cũng là `transform` — mỗi lần rê chuột là chạy lại đúng cái transition 300ms nảy
           * **sau một độ trễ tới 156ms**, ra cảm giác giật/lag. Và user chỉ muốn "sáng menu lên".
           */
          return (
            <div
              key={a.id}
              className="pointer-events-none absolute transition-[transform,opacity] duration-300"
              style={{
                width: ITEM,
                height: ITEM,
                margin: `${-ITEM / 2}px 0 0 ${-ITEM / 2}px`,
                transitionDelay: `${i * 26}ms`,
                transitionTimingFunction: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
                opacity: out ? 1 : 0,
                transform: out
                  ? `rotate(${angle}deg) translate(${radius}px) rotate(${-angle}deg)`
                  : 'scale(0.3)'
              }}
            >
              <button
                className="border-edge-strong bg-elevated/90 text-content hover:border-accent hover:bg-accent/30 hover:text-accent pointer-events-auto grid h-full w-full place-items-center rounded-full border shadow-lg backdrop-blur transition-colors duration-150"
                style={{ fontSize: 16 }}
                title={a.label}
                aria-label={a.label}
                onMouseEnter={() => setHint(a.label)}
                onMouseLeave={() => setHint(null)}
                onClick={() => {
                  a.onSelect()
                  onDismiss()
                }}
              >
                {a.icon}
              </button>
            </div>
          )
        })}

        {/* Nhãn hiện ở GIỮA vòng khi rê chuột — nút chỉ có icon, ghi chữ lên nút thì
            nút phải to gấp ba và vòng tròn không còn vừa cạnh nhân vật */}
        <div
          className="bg-elevated/95 border-edge text-content pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border px-2.5 py-1 text-center text-[11px] whitespace-nowrap shadow-lg transition-opacity"
          style={{ opacity: hint ? 1 : 0 }}
        >
          {hint ?? ''}
        </div>
      </div>
    </div>
  )
}

/**
 * Bảng hai cột hai bên nhân vật.
 *
 * Danh sách chia đôi: nửa đầu sang trái, nửa sau sang phải, **giữa để trống cho nhân vật** —
 * đó là điểm chính, user vẫn thấy mình đang đổi cái gì trong lúc chọn.
 *
 * Không đóng khi click ra ngoài (chỉ nút ✕ hoặc Esc): chọn biểu cảm là việc thử nhiều lần
 * liên tiếp, đóng mỗi lần bấm hụt thì phải mở lại từ đầu.
 */
export function VrmSidePanel({
  title,
  items,
  activeId,
  anchor,
  onPick,
  onRemove,
  onClose
}: {
  readonly title: string
  readonly items: readonly { id: string; label: string; active?: boolean }[]
  readonly activeId?: string | null
  /** Vùng nhân vật trên màn hình — hai cột bám hai bên vùng này. */
  readonly anchor: { left: number; top: number; width: number; height: number }
  readonly onPick: (id: string) => void
  /**
   * Bỏ một mục khỏi danh sách. Không truyền = danh sách không xoá được.
   *
   * Chỉ bảng "Nhân vật" dùng: biểu cảm và trang phục là thứ model khai ra, không xoá được.
   */
  readonly onRemove?: (id: string) => void
  readonly onClose: () => void
}) {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const h = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(h)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const half = Math.ceil(items.length / 2)
  const cols = [items.slice(0, half), items.slice(half)]

  /**
   * Hai cột đặt NGOÀI hai mép vùng nhân vật (`fixed`, toạ độ màn hình).
   *
   * Không dùng grid ba cột bên trong khung như bản gốc: khung ở đây ôm sát người nên chỉ rộng
   * ~150–250px, nhét hai cột vào là đè lên chính nhân vật. Đặt ra ngoài thì nhân vật vẫn hiện
   * nguyên ở giữa — đó là điểm chính của kiểu bố cục này.
   */
  /**
   * Hai cột **ôm sát hai bên nhân vật, chờm lên người một chút**.
   *
   * Bản trước cố né hẳn ra ngoài và phải dồn cả hai cột sang một bên khi hụt chỗ — nhân vật
   * đứng sát mép phải nên gần như lúc nào cũng rơi vào ca đó, thành ra hai cột xếp chồng bên
   * trái, xa người, mất luôn dáng "menu vây quanh nhân vật".
   *
   * Nay chờm `OVERLAP` px lên mỗi bên thân người: nền cột trong mờ nên vẫn thấy nhân vật phía
   * sau, mà hai cột thì luôn cân đối hai bên dù khung người rộng hẹp bao nhiêu.
   */
  /**
   * Bề rộng cột: **hẹp có chủ ý**.
   *
   * Nội dung là tên biểu cảm (`neutral`, `blinkLeft`, `happy`) và tên bộ đồ — chuỗi ngắn, 96px
   * đủ cho hầu hết, dài hơn thì cắt bớt và có tooltip. Bản trước 124px nên hai cột che mất phần
   * lớn nhân vật, mà thấy nhân vật lúc đang chọn chính là điểm của kiểu bố cục này.
   */
  const W = 96
  const GAP = 8
  /** Chờm lên thân người mỗi bên (px) — đủ để hai cột ôm sát mà không che mặt. */
  /**
   * Chờm lên thân người mỗi bên (px) — **tự co theo chỗ trống hai bên**.
   *
   * Bản trước chờm cố định 26px bất kể màn hình còn rộng bao nhiêu, nên nhân vật bị che khá
   * nhiều một cách không cần thiết. Nay: còn chỗ thì tách hẳn ra (`OVERLAP_MIN`, chỉ chờm 4px cho
   * hai cột vẫn "ôm" lấy người), hết chỗ mới chờm sâu dần tới `OVERLAP_MAX`.
   *
   * Vì sao không bao giờ chờm 0: tách rời hẳn thì hai cột trông như hai hộp rời rạc đứng cạnh
   * nhân vật, mất dáng "menu vây quanh" — mà đó là lý do chọn kiểu bố cục này.
   */
  const OVERLAP_MIN = 4
  const OVERLAP_MAX = 30
  /**
   * Chỗ trống hai bên nhân vật, tính **sau khi đã dời cả cặp** (xem `shift` bên dưới): cặp cột
   * luôn được kéo vào trong cửa sổ, nên thứ quyết định độ chờm là **tổng bề ngang còn lại**, không
   * phải khoảng trống của riêng bên nào.
   *
   * Đo sai chỗ này một lần: lấy `W − min(tráiTrống, phảiTrống)` thì nhân vật đứng sát mép luôn ra
   * chờm tối đa (che 40–64% thân người), dù việc tràn đã được `shift` lo xong.
   */
  const need = W * 2 + anchor.width + GAP * 2
  const spare = window.innerWidth - need
  // Còn dư chỗ → chờm tối thiểu; thiếu bao nhiêu thì hai cột lấn vào người bấy nhiêu, chia đôi
  const OVERLAP = Math.round(Math.min(OVERLAP_MAX, Math.max(OVERLAP_MIN, OVERLAP_MIN - spare / 2)))

  /**
   * Chiều cao **CỐ ĐỊNH và bằng nhau** cho cả hai cột, dư thì cuộn trong cột.
   *
   * Trước đây dùng `maxHeight` nên mỗi cột tự co theo số mục nó chứa: `items` chia đôi mà lẻ
   * thì cột trái nhiều hơn cột phải một mục, ra hai khối cao thấp lệch nhau trông như lỗi
   * dựng hình. Cao cố định thì hai cột luôn khớp nhau bất kể danh sách dài ngắn.
   *
   * Lấy theo chiều cao nhân vật (hai cột ôm sát người) nhưng kẹp trong `[MIN, MAX]`: model lùn
   * thì khung quá thấp chỉ hiện được một hai dòng, model cao thì cột dài quá chạm đáy màn hình.
   */
  const COL_MIN = 120
  /**
   * Trần: đủ để chạm đầu gối ở cỡ nhân vật mặc định (khung ~460px → gối ở 327px).
   *
   * Trần 320 cũ cắt sớm đúng 7px trước gối — nhìn thì tưởng đúng mốc, đo mới thấy hụt. Vẫn giữ
   * một trần vì model phóng to hết cỡ sẽ cho cột dài quá tay với.
   */
  const COL_MAX = 340
  /**
   * Cột dài xuống ngang **đầu gối** nhân vật — user chọn mốc này bằng mắt.
   *
   * 0,71 không phải số ước: đo vị trí xương `leftLowerLeg` so với chiều cao khung trên hai model
   * khác hẳn nhau (Shino 71%, Carlotta 72% tính từ đỉnh đầu). Tỉ lệ người khá ổn định giữa các
   * model nên một hằng số dùng chung là đủ, không cần đọc xương lúc chạy.
   */
  const KNEE_FRAC = 0.71
  const colHeight = Math.min(
    COL_MAX,
    Math.max(COL_MIN, Math.min(anchor.height * KNEE_FRAC, window.innerHeight - anchor.top - GAP * 2))
  )

  /**
   * Vị trí hai cột, kèm phép **dời CẢ CẶP** khi chạm mép cửa sổ.
   *
   * ⚠️ Không kẹp từng cột riêng: nhân vật hay đứng sát mép phải, kẹp riêng sẽ đẩy cột phải ngược
   * vào trong và nó chồng lên giữa người — đo được **che 43–76% thân người**, tệ hơn cả bản chờm
   * cố định. Dời cả cặp thì khoảng cách hai cột giữ nguyên, nhân vật chỉ bị che đúng phần chờm.
   */
  const rawLeft = anchor.left - W + OVERLAP
  const rawRight = anchor.left + anchor.width - OVERLAP
  // Lệch cần dời để cả cặp nằm trong cửa sổ; ưu tiên sửa mép phải trước vì đó là ca hay gặp
  const overflowRight = Math.max(0, rawRight + W + GAP - window.innerWidth)
  const shift = overflowRight > 0 ? -overflowRight : Math.max(0, GAP - rawLeft)

  const posFor = (side: 0 | 1): { left: number } => ({ left: (side === 0 ? rawLeft : rawRight) + shift })

  return (
    <div data-vrm-overlay className="pointer-events-none fixed inset-0 z-50">
      {cols.map((col, side) => (
        <div
          key={side}
          /* Nền TRONG MỜ + `backdrop-blur`: cột chờm lên người nên nền đục là che mất nhân vật,
             mà thấy nhân vật lúc đang chọn chính là điểm của kiểu bố cục này. Blur giữ cho chữ
             vẫn đọc được trên nền 3D nhiều chi tiết. */
          className="bg-elevated/55 border-edge/60 pointer-events-auto absolute flex flex-col rounded-lg border py-1 shadow-2xl backdrop-blur-md transition-all duration-200"
          style={{
            width: W,
            top: anchor.top,
            // `height` chứ không `maxHeight`: co theo nội dung là hai cột cao thấp lệch nhau
            height: colHeight,
            ...posFor(side as 0 | 1),
            opacity: shown ? 1 : 0,
            transform: shown ? 'none' : `translateX(${side === 0 ? -8 : 8}px)`
          }}
        >
          <div className="flex h-4 shrink-0 items-center justify-between px-1.5">
            {/* Tiêu đề chỉ ở cột trái, nút đóng chỉ ở cột phải — lặp cả hai là thừa chỗ */}
            <span className="text-subtle truncate text-[10px] font-semibold">{side === 0 ? title : ''}</span>
            {side === 1 && (
              <button
                className="text-subtle hover:text-content shrink-0 px-0.5 text-xs leading-none"
                aria-label="Đóng"
                onClick={onClose}
              >
                ✕
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1">
            {col.map((it) => (
              <div key={it.id} className="group flex items-center">
                <button
                  className={`min-w-0 flex-1 truncate rounded px-1.5 py-0.5 text-left text-[11px] ${
                    (activeId != null && it.id === activeId) || it.active
                      ? 'bg-accent/30 text-content'
                      : 'text-subtle hover:bg-base/60 hover:text-content'
                  }`}
                  title={it.label}
                  onClick={() => onPick(it.id)}
                >
                  {it.label}
                </button>
                {/* Chỉ hiện khi rê chuột vào dòng: danh sách này để CHỌN, nút xoá lúc nào cũng
                    nằm cạnh mỗi dòng thì vừa chật vừa dễ bấm nhầm */}
                {onRemove && (
                  <button
                    className="text-subtle hover:text-danger shrink-0 px-1 text-[11px] opacity-0 group-hover:opacity-100"
                    title="Bỏ khỏi danh sách (không xoá file gốc)"
                    onClick={() => onRemove(it.id)}
                  >
                    🗑
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Bảng trang phục: danh sách **bộ do user lưu** ở trên, tuỳ chỉnh từng món ở dưới.
 *
 * ⚠️ File VRM **không mang thông tin bộ trang phục** — đo thật trên 3 model thấy chỉ có mesh
 * rời (`Dress`, `Sleeve`, `Socks`…), tên máy sinh (`U_Char_0`), hoặc gộp cứng hết vào một mesh
 * (`Body (merged)`). Không có metadata nào để đọc ra "bộ", và đoán theo tên chỉ đúng trong đầu
 * người. Nên bộ ở đây là **tổ hợp bật/tắt user tự lưu lại**, đúng như user đã tự mô tả: model
 * không có sẵn bộ thì nói thẳng, rồi cho tự custom.
 */
export function VrmOutfitPanel({
  modelId,
  parts,
  onTogglePart,
  onApplyOutfit,
  anchor,
  onClose
}: {
  readonly modelId: string | null
  readonly parts: ReadonlyArray<{ name: string; visible: boolean }>
  readonly onTogglePart: (name: string, visible: boolean) => void
  readonly onApplyOutfit: (hidden: readonly string[]) => void
  readonly anchor: { left: number; top: number; width: number; height: number }
  readonly onClose: () => void
}) {
  const [outfits, setOutfits] = useState<VrmOutfit[]>([])
  const [naming, setNaming] = useState(false)
  const [draftName, setDraftName] = useState('')

  useEffect(() => {
    if (!modelId) return
    let alive = true
    void window.infra.vrm.listOutfits(modelId).then((r) => {
      if (alive) setOutfits(r.outfits)
    })
    return () => {
      alive = false
    }
  }, [modelId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const items = usableParts(parts)
  const customisable = hasCustomisableParts(parts.map((p) => p.name))
  const hiddenNow = parts.filter((p) => !p.visible).map((p) => p.name)

  const save = async (): Promise<void> => {
    if (!modelId) return
    const r = await window.infra.vrm.saveOutfit(modelId, draftName, hiddenNow)
    setOutfits(r.outfits)
    setNaming(false)
    setDraftName('')
  }

  const W = 260
  const left = Math.min(Math.max(8, anchor.left + anchor.width / 2 - W / 2), Math.max(8, window.innerWidth - W - 8))
  const top = Math.min(Math.max(8, anchor.top), Math.max(8, window.innerHeight - 380))

  return (
    <div
      style={{ left, top, width: W, maxHeight: 370 }}
      data-vrm-overlay
      className="bg-elevated/95 border-edge pointer-events-auto fixed z-50 flex flex-col rounded-lg border shadow-2xl"
    >
      <div className="border-edge flex items-center justify-between border-b px-3 py-2">
        <span className="text-content text-xs font-medium">Trang phục</span>
        <button className="text-subtle hover:text-content text-xs" onClick={onClose} aria-label="Đóng">
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!customisable ? (
          /* Không nói NGUYÊN NHÂN vì có hai kiểu khác nhau và ta không phân biệt được chắc
             chắn: model gộp hết vào một mesh (`Body (merged)`), hoặc mesh tách nhưng mang tên
             máy sinh (`U_Char_0/1/2`). Khẳng định "tác giả đã gộp" là đoán. */
          <p className="text-subtle px-1 py-3 text-[11px] leading-relaxed">
            Nhân vật này không có trang phục tách rời để thay — file chỉ chứa một khối duy nhất, không chia thành các
            món riêng.
          </p>
        ) : (
          <>
            {outfits.length === 0 ? (
              <p className="text-subtle mb-2 px-1 text-[11px] leading-relaxed">
                Chưa có bộ trang phục nào. Bật/tắt các món bên dưới rồi bấm <b>Lưu thành bộ</b> để dùng lại sau.
              </p>
            ) : (
              <div className="mb-2">
                <div className="text-subtle px-1 pb-1 text-[10px] tracking-wide uppercase">Bộ đã lưu</div>
                {outfits.map((o) => (
                  <div key={o.id} className="group flex items-center gap-1">
                    <button
                      className={`min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-[11px] ${
                        matchesOutfit(o, parts)
                          ? 'bg-accent/30 text-content'
                          : 'text-subtle hover:bg-base/60 hover:text-content'
                      }`}
                      title={o.name}
                      onClick={() => {
                        onApplyOutfit(o.hidden)
                        // Nhớ lại để lần mở app sau còn khoác đúng bộ này
                        if (modelId) void window.infra.vrm.setWornOutfit(modelId, o.id)
                      }}
                    >
                      {o.name}
                    </button>
                    <button
                      className="text-subtle hover:text-danger px-1 text-[11px] opacity-0 group-hover:opacity-100"
                      title="Xoá bộ này"
                      onClick={() => {
                        if (modelId) void window.infra.vrm.removeOutfit(modelId, o.id).then((r) => setOutfits(r.outfits))
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="border-edge border-t pt-2">
              <div className="text-subtle px-1 pb-1 text-[10px] tracking-wide uppercase">Từng món</div>
              {items.map((p) => (
                <button
                  key={p.name}
                  className={`block w-full truncate rounded px-2 py-1 text-left text-[11px] ${
                    p.visible ? 'text-content' : 'text-subtle line-through opacity-60'
                  } hover:bg-base/60`}
                  title={p.label}
                  onClick={() => onTogglePart(p.name, !p.visible)}
                >
                  {p.visible ? '☑' : '☐'} {p.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {customisable && (
        <div className="border-edge border-t p-2">
          {naming ? (
            <div className="flex gap-1">
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save()
                  if (e.key === 'Escape') setNaming(false)
                }}
                placeholder="Tên bộ…"
                className="border-edge bg-base text-content min-w-0 flex-1 rounded border px-2 py-1 text-[11px]"
              />
              <button className="bg-accent rounded px-2 py-1 text-[11px] text-white" onClick={() => void save()}>
                Lưu
              </button>
            </div>
          ) : (
            <button
              className="border-edge-strong text-muted hover:bg-hover w-full rounded border px-2 py-1 text-[11px]"
              onClick={() => setNaming(true)}
            >
              💾 Lưu thành bộ
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Chat với trợ lý AI ngay trên đầu nhân vật.
 *
 * Dùng lại `window.infra.ai.ask()` của Trợ lý AI (F09) — **không** có đường gọi AI thứ hai:
 * provider/model/API key chỉ cấu hình một chỗ.
 *
 * Khác `AiModal` ở **hình thái** chứ không ở lõi. `AiModal` cố ý là cột dock chiếm chỗ thật, vì
 * việc ở đó là *vừa hỏi vừa đọc output terminal*. Bong bóng này để hỏi nhanh một câu: nó nổi,
 * nhỏ, không chiếm chỗ — đổi lại không đọc nổi câu trả lời dài, nên khi câu trả lời bị cắt thì
 * mời sang panel đầy đủ thay vì im lặng giấu mất một nửa.
 */
export function VrmChatBubble({
  anchor,
  onClose,
  onOpenFull
}: {
  readonly anchor: { left: number; top: number; width: number; height: number }
  readonly onClose: () => void
  /** Mở Trợ lý AI đầy đủ — dùng khi câu trả lời dài hơn chỗ bong bóng có. */
  readonly onOpenFull: () => void
}) {
  const t = useT()
  /**
   * Hội thoại giữ ở STORE, không `useState`.
   *
   * Bong bóng bị unmount mỗi lần đóng — để trong component thì tắt rồi mở lại là mất sạch lịch
   * sử lẫn câu đang gõ dở, đúng như user báo.
   */
  const history = useVrmChatStore((s) => s.history)
  const input = useVrmChatStore((s) => s.draft)
  const busy = useVrmChatStore((s) => s.busy)
  const mini = useVrmChatStore((s) => s.mini)
  const setMini = useVrmChatStore((s) => s.setMini)
  const setInput = useVrmChatStore((s) => s.setDraft)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Chưa cấu hình AI thì nói thẳng ngay, đừng để user gõ xong câu hỏi mới báo lỗi
  useEffect(() => {
    void window.infra.ai.getConfig().then((c) => setConfigured(!!c))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Luôn cuộn xuống lượt mới nhất — bong bóng thấp nên câu trả lời mới dễ nằm ngoài tầm nhìn
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [history, busy])

  const send = async (): Promise<void> => {
    const text = input.trim()
    if (!text || busy) return
    const store = useVrmChatStore.getState()
    const before = store.history
    store.push({ role: 'user', text })
    store.setDraft('')

    /**
     * "Mở tunnel giúp tôi" → mở luôn, **không gửi qua AI**.
     *
     * Mở một panel là việc chắc chắn đúng hoặc chắc chắn sai — đưa qua AI chỉ thêm độ trễ và
     * một chỗ để nó đoán sai. Quan trọng hơn: chạy được cả khi user chưa cấu hình AI.
     */
    const intent = matchOpenIntent(text)
    const tool = intent ? TOOLS.find((x) => x.id === intent) : undefined
    if (tool) {
      const name = splitMenuLabel(t(tool.menuKey)).name
      openTool(tool)
      useVrmChatStore.getState().push({ role: 'assistant', text: openedLine(name) })
      return
    }

    store.setBusy(true)
    try {
      // `generate` là chế độ hợp với hỏi nhanh: sinh lệnh từ câu tiếng Việt/Anh
      const res = await window.infra.ai.ask('generate', text, buildContext(before))
      const clamped = clampAnswer(res.text)
      // Đọc lại store chứ không dùng biến cũ: bong bóng có thể đã đóng/mở giữa chừng, và câu
      // trả lời vẫn phải về đúng cuối hội thoại
      useVrmChatStore.getState().push({
        role: 'assistant',
        text: clamped.truncated ? `${clamped.text}\n\n…` : clamped.text,
        command: res.command
      })
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
      // Bỏ lượt hỏi vừa thêm: để lại một câu hỏi không có trả lời trông như AI lơ mình
      useVrmChatStore.getState().restore(before, text)
    } finally {
      useVrmChatStore.getState().setBusy(false)
    }
  }

  /** Chèn lệnh vào terminal đang mở — **không kèm Enter**, giống Trợ lý AI. */
  const insert = (command: string): void => {
    const target = terminalTargetPane()
    if (!target) {
      useToastsStore.getState().push(t('ai.noTarget'), 'info')
      return
    }
    window.infra.terminal.write(target.pane.sessionId, command)
    useToastsStore.getState().push(t('ai.inserted'), 'info')
  }

  const W = 320
  const left = Math.min(Math.max(8, anchor.left + anchor.width / 2 - W / 2), Math.max(8, window.innerWidth - W - 8))
  const H = 300
  // Nổi TRÊN đầu nhân vật; hết chỗ phía trên thì tụt xuống chứ không tràn ra ngoài cửa sổ
  const top = Math.max(8, Math.min(anchor.top - H - 12, window.innerHeight - H - 8))

  /**
   * Câu trả lời MỚI NHẤT — dùng khi thu nhỏ.
   *
   * Thu nhỏ không phải là ẩn: nhân vật vừa nói gì thì vẫn thấy, chỉ là thấy dưới dạng một bong
   * bóng thoại trên đầu thay vì cả khung chat che mất người.
   */
  const lastSaid = [...history].reverse().find((h) => h.role === 'assistant')

  if (mini) {
    const MW = 236
    const mleft = Math.min(
      Math.max(8, anchor.left + anchor.width / 2 - MW / 2),
      Math.max(8, window.innerWidth - MW - 8)
    )
    return (
      <div
        style={{ left: mleft, top: Math.max(8, anchor.top - 92), width: MW }}
        data-vrm-overlay
        className="pointer-events-auto fixed z-50"
      >
        {/* Bong bóng thoại: bo tròn nhiều, viền accent, có mũi nhọn chỉ xuống nhân vật */}
        <div className="border-accent/70 bg-elevated text-content relative rounded-2xl border px-3 py-2 text-[11px] leading-snug shadow-2xl">
          <div className="line-clamp-3">
            {busy ? t('ai.asking') : (lastSaid?.text ?? t('vrmChat.hint'))}
          </div>
          <div className="border-accent/70 bg-elevated absolute -bottom-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-r border-b" />
        </div>
        <div className="mt-1.5 flex justify-center gap-1">
          <button
            className="border-edge bg-elevated text-subtle hover:text-content rounded-full border px-2 py-0.5 text-[10px] backdrop-blur"
            onClick={() => setMini(false)}
          >
            💬 {t('vrmChat.expand')}
          </button>
          <button
            className="border-edge bg-elevated text-subtle hover:text-content rounded-full border px-1.5 py-0.5 text-[10px] backdrop-blur"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{ left, top, width: W, height: H }}
      data-vrm-overlay
      className="border-accent/60 bg-elevated pointer-events-auto fixed z-50 flex flex-col rounded-2xl border shadow-2xl"
    >
      <div className="border-edge flex shrink-0 items-center justify-between border-b px-3 py-1.5">
        <span className="text-content text-[11px] font-medium">💬 {t('vrmChat.title')}</span>
        <div className="flex items-center gap-1">
          {/* Hội thoại giờ sống qua các lần đóng/mở, nên phải có đường dọn */}
          {history.length > 0 && (
            <button
              className="text-subtle hover:text-content text-[11px]"
              title={t('vrmChat.clear')}
              onClick={() => useVrmChatStore.getState().clear()}
            >
              🗑
            </button>
          )}
          {/* Thu nhỏ về bong bóng trên đầu — vẫn thấy nhân vật vừa nói gì mà không che mất người */}
          <button className="text-subtle hover:text-content text-[11px]" title={t('vrmChat.minimize')} onClick={() => setMini(true)}>
            ▁
          </button>
          <button
            className="text-subtle hover:text-content text-[11px]"
            title={t('vrmChat.openFull')}
            onClick={onOpenFull}
          >
            ⛶
          </button>
          <button className="text-subtle hover:text-content text-xs" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {configured === false && (
          <p className="text-warning text-[11px] leading-relaxed">{t('vrmChat.notSetUp')}</p>
        )}
        {history.length === 0 && configured !== false && (
          <p className="text-subtle text-[11px] leading-relaxed">{t('vrmChat.hint')}</p>
        )}
        {history.map((turn, i) => (
          <div key={i} className={turn.role === 'user' ? 'text-right' : ''}>
            {/* Lời nhân vật bo tròn kiểu bong bóng thoại + viền accent, lời user thì vuông vức
                hơn: nhìn vào là biết ngay bên nào đang nói, không cần đọc chữ */}
            <div
              className={`inline-block max-w-[92%] px-2.5 py-1.5 text-left text-[11px] leading-snug ${
                turn.role === 'user'
                  ? 'bg-accent/25 text-content rounded-xl rounded-br-sm'
                  : 'border-accent/40 bg-base/70 text-content rounded-2xl rounded-bl-sm border'
              }`}
            >
              {turn.role === 'assistant' ? <MiniMarkdown source={turn.text} onCommand={insert} /> : turn.text}
            </div>
            {turn.command && (
              <button
                className="border-edge text-subtle hover:text-content mt-1 block rounded border px-1.5 py-0.5 text-[10px]"
                onClick={() => insert(turn.command!)}
              >
                ⌨ {t('vrmChat.insert')}
              </button>
            )}
          </div>
        ))}
        {/* "Đang soạn" kiểu ba chấm nhấp nháy — cảm giác nhân vật đang nghĩ, không phải app treo */}
        {busy && (
          <div className="border-accent/40 bg-base/70 inline-flex items-center gap-1 rounded-2xl rounded-bl-sm border px-2.5 py-2">
            {[0, 150, 300].map((d) => (
              <span
                key={d}
                className="bg-accent/70 h-1.5 w-1.5 animate-bounce rounded-full"
                style={{ animationDelay: `${d}ms` }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="border-edge flex shrink-0 gap-1 border-t p-2">
        <input
          autoFocus
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          // Enter gửi, Shift+Enter xuống dòng — nhưng ô một dòng nên chỉ cần chặn Enter khi đang bận
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder={t('vrmChat.placeholder')}
          className="border-edge bg-base text-content min-w-0 flex-1 rounded border px-2 py-1 text-[11px]"
        />
        <button
          className="bg-accent rounded px-2 py-1 text-[11px] text-white disabled:opacity-50"
          disabled={busy || !input.trim()}
          onClick={() => void send()}
        >
          ↵
        </button>
      </div>
    </div>
  )
}

/**
 * Bong bóng thoại nổi trên đầu nhân vật khi có thông báo.
 *
 * `pointer-events-none` tuyệt đối: bong bóng nằm đè lên chỗ user hay bấm (đầu nhân vật, menu
 * chuột phải). Từng dính đúng lỗi này với hai nút ✕/⚙ ẩn — `opacity-0` không tắt vùng nhận
 * chuột, và một ô vô hình nuốt click là loại lỗi user không bao giờ đoán ra.
 */
export function VrmSpeechBubble({
  text,
  severity,
  anchor,
  opaque
}: {
  readonly text: string
  readonly severity: 'info' | 'warning' | 'critical'
  readonly anchor: { left: number; top: number; width: number; height: number }
  /**
   * Nền ĐỤC — cho cửa sổ nhân vật ngoài desktop: phía sau là wallpaper/app khác của user, nền 20%
   * alpha trên đó là chữ trắng trên hình nền sáng, không đọc được (đã chụp thử). Trong app thì
   * giữ bản bán trong suốt vì nó luôn nằm trên nền tối của chính app.
   */
  readonly opaque?: boolean
}) {
  // Kẹp trong cửa sổ: nhân vật đứng sát mép phải nên bong bóng căn giữa theo khung sẽ tràn ra
  const W = 220
  const left = Math.min(Math.max(8, anchor.left + anchor.width / 2 - W / 2), Math.max(8, window.innerWidth - W - 8))
  const tone = opaque
    ? severity === 'critical'
      ? 'border-danger bg-danger text-white'
      : severity === 'warning'
        ? 'border-warning bg-warning text-white'
        : 'border-accent bg-elevated text-content'
    : severity === 'critical'
      ? 'border-danger/70 bg-danger/20 text-content'
      : severity === 'warning'
        ? 'border-warning/70 bg-warning/20 text-content'
        : 'border-accent/60 bg-elevated/95 text-content'

  return (
    <div
      style={{ left, top: Math.max(8, anchor.top - 56), width: W }}
      className={`pointer-events-none fixed z-50 rounded-2xl border px-3 py-2 text-[11px] leading-snug shadow-2xl ${opaque ? '' : 'backdrop-blur'} ${tone}`}
    >
      <div className="line-clamp-3">{text}</div>
      {/* Mũi nhọn chỉ xuống nhân vật — hình thoi xoay 45° cho ra góc nhọn */}
      <div
        className={`absolute -bottom-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-r border-b ${tone}`}
      />
    </div>
  )
}

/** Hộp nhỏ cho các mục chỉnh còn lại (FPS, cỡ, công tắc) — không hợp với dạng danh sách. */
export function VrmMiniPanel({
  title,
  anchor,
  children,
  onClose
}: {
  readonly title: string
  readonly anchor: { left: number; top: number; width: number; height: number }
  readonly children: ReactNode
  readonly onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /**
   * `fixed` + kẹp trong màn hình **cả hai chiều**, không `left-1/2` của khung nhân vật.
   *
   * Ngang: hộp rộng 256px mà khung nhân vật chỉ ~150px và thường nằm sát mép phải — căn giữa theo
   * khung là tràn ra ngoài cửa sổ, mất cả nút đóng.
   *
   * Dọc: nhân vật hay đứng **sát đáy** màn hình, mà hộp mở xuống dưới từ `anchor.top`. Bản trước
   * chỉ kẹp chiều ngang nên phần dưới hộp nằm ngoài màn hình và **mất hẳn** — user chụp được cảnh
   * đó. Nay hộp tự chọn mở lên trên hay xuống dưới tuỳ chỗ nào còn rộng, và có trần chiều cao +
   * vùng cuộn để nội dung dài bao nhiêu cũng với tới được.
   */
  const W = 256
  const MARGIN = 8
  const left = Math.min(Math.max(MARGIN, anchor.left + anchor.width / 2 - W / 2), Math.max(MARGIN, window.innerWidth - W - MARGIN))
  // Hình học dọc ở `@infra/shared` để có test — xem `placeVrmPanel`
  const { top, maxHeight } = placeVrmPanel(anchor.top, window.innerHeight, MARGIN)

  return (
    <div
      style={{ left, top, width: W, maxHeight }}
      data-vrm-overlay
      className="bg-elevated/95 border-edge pointer-events-auto fixed z-50 flex flex-col rounded-lg border shadow-2xl"
    >
      {/* Tiêu đề KHÔNG cuộn: nút đóng phải luôn với tới được, kể cả khi nội dung dài */}
      <div className="border-edge flex shrink-0 items-center justify-between border-b px-3 py-2">
        <span className="text-content text-xs font-semibold">{title}</span>
        <button className="text-subtle hover:text-content px-1 text-sm leading-none" aria-label="Đóng" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2.5">{children}</div>
    </div>
  )
}

/**
 * Khung CÀI ĐẶT lớn — hai cột, nhân vật đứng ở khe giữa.
 *
 * Khác `VrmMiniPanel` (hộp 256px nổi trên đầu): bảng cài đặt có nhiều mục nên hộp nhỏ phải cuộn
 * liên tục và vẫn che mất nhân vật. Ở đây khung rộng gần hết màn hình, nội dung chia hai cột trái
 * phải, còn nhân vật thì `VrmPanel` dời vào chính giữa — nên nó nằm gọn trong khe, không bị che.
 *
 * Nội dung tự chia cột bằng `columns` của CSS thay vì tách tay thành hai danh sách: các mục cài
 * đặt cao thấp khác nhau, chia tay là một cột dài một cột ngắn, còn `columns` thì trình duyệt tự
 * cân. `break-inside: avoid` để một khối không bị cắt đôi giữa hai cột.
 */
export function VrmSettingsFrame({
  anchor,
  children,
  onClose
}: {
  readonly anchor: { left: number; top: number; width: number; height: number }
  readonly children: ReactNode
  readonly onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const MARGIN = 24
  const W = Math.min(880, window.innerWidth - MARGIN * 2)
  const H = Math.min(560, window.innerHeight - MARGIN * 2)
  const left = Math.round((window.innerWidth - W) / 2)
  const top = Math.round((window.innerHeight - H) / 2)
  /** Khe giữa vừa đúng bề ngang nhân vật, để hai cột không đè lên người. */
  const gap = Math.min(Math.max(anchor.width, 150), 260)

  return (
    <div
      data-vrm-overlay
      style={{ left, top, width: W, height: H }}
      className="bg-elevated/95 border-edge-strong pointer-events-auto fixed z-50 flex flex-col rounded-xl border shadow-2xl backdrop-blur-md"
    >
      <div className="border-edge flex shrink-0 items-center justify-between border-b px-4 py-2.5">
        <span className="text-content text-sm font-semibold">⚙ Cài đặt nhân vật</span>
        <button
          className="text-subtle hover:bg-hover hover:text-content rounded px-1.5 py-0.5 text-sm leading-none"
          aria-label="Đóng"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      {/* Khe giữa dành cho nhân vật: `column-gap` đúng bằng bề ngang thân người */}
      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3"
        style={{ columnCount: 2, columnGap: gap }}
      >
        <div className="[&>*]:break-inside-avoid">{children}</div>
      </div>
    </div>
  )
}
