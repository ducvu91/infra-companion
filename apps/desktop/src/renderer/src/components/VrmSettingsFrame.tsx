import { useEffect, type ReactNode } from 'react'
import { SETTINGS_HEADER_H, type SettingsFrameBox } from '@infra/shared'

/**
 * Khung CÀI ĐẶT lớn — hai cột, nhân vật đứng ở khe giữa.
 *
 * ⚠️ PHẢI là **ANH EM** của thẻ nhân vật trong cây DOM, không được là con của nó.
 *
 * Bản đầu đặt khung bên trong thẻ nhân vật cho tiện. Thẻ đó có `transform: scale()` (co nhân vật
 * cho vừa khe) và `opacity` (làm mờ dưới chữ) — mà con `position: fixed` của một cha có
 * `transform` thì tính toạ độ theo **cha** và co theo cha. Hệ quả user chụp được ba lần liền:
 * bảng văng khỏi tâm màn hình, kéo thanh cỡ thì bảng to nhỏ theo, bảng mờ 55% như nhân vật.
 * Không dòng lỗi nào được báo. Đặt làm anh em (cùng cha `App`, thẻ đó `relative isolate` ở 0,0
 * và không có transform) thì `fixed` là màn hình thật, và không thuộc tính nào của thẻ nhân vật
 * lan sang được.
 *
 * HAI LỚP tách rời, cùng một hộp `box`:
 *  - lớp NỀN `z-30` — **dưới** nhân vật (`z-40`): tấm kính, viền, bóng.
 *  - lớp NỘI DUNG `z-50` — **trên** nhân vật: tiêu đề + hai cột chữ. User yêu cầu nhân vật to quá
 *    thì chữ đè lên người chứ đừng đẩy người ra ngoài. Một thẻ duy nhất không làm được việc này:
 *    `fixed` luôn tạo stacking context riêng, nên `z-50` bên trong nó chỉ so với nhau, không so
 *    được với nhân vật bên ngoài.
 *  Khe giữa của lớp nội dung **không nhận chuột** → kéo / xoay nhân vật vẫn chạy khi bảng đang mở.
 *
 * `box` do **nơi gọi** tính (`settingsFrameBox`) và cũng là thứ nó dùng để đặt nhân vật — một
 * nguồn, không tính lại ở đây: tính hai nơi thì lệch nhau vài px là nhân vật chệch khe.
 *
 * File riêng, chỉ phụ thuộc `react` + `@infra/shared`: để harness bundle được **đúng component
 * này** bằng esbuild và chụp ảnh kiểm — `VrmRadialMenu.tsx` kéo theo store/i18n nên không bundle
 * rời được.
 */
export function VrmSettingsFrame({
  box,
  children,
  right,
  onClose
}: {
  readonly box: SettingsFrameBox
  /** Cột TRÁI. */
  readonly children: ReactNode
  /** Cột PHẢI — hai thuộc tính riêng, không tách một `children` gộp: tách gộp thì nơi gọi phải
   *  nhớ đúng thứ tự phần tử, mà quên thứ tự thì lỗi im lặng (một cột trống). */
  readonly right: ReactNode
  readonly onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const { left, top, width, height, gap } = box
  const place = { left, top, width, height }

  return (
    <>
      {/* Lớp NỀN — dưới nhân vật. `pointer-events-auto` để bấm vào tấm kính không lọt xuống Dashboard */}
      <div
        data-vrm-overlay
        data-vrm-settings-bg
        aria-hidden
        style={place}
        className="bg-elevated/95 border-edge-strong pointer-events-auto fixed z-30 rounded-xl border shadow-2xl"
      />
      {/* Lớp NỘI DUNG — trên nhân vật. Cả lớp không nhận chuột; chỉ tiêu đề và hai cột bật lại */}
      <div
        data-vrm-overlay
        data-vrm-settings-content
        role="dialog"
        aria-label="Cài đặt nhân vật"
        style={place}
        className="pointer-events-none fixed z-50 flex flex-col"
      >
        {/* Cao cố định `SETTINGS_HEADER_H`: `characterSlotInSettings` trừ đúng con số này để đặt
            nhân vật, hai bên lệch nhau là nhân vật đè lên tiêu đề hoặc thò ra ngoài */}
        <div
          className="border-edge pointer-events-auto flex shrink-0 items-center justify-between border-b px-4"
          style={{ height: SETTINGS_HEADER_H }}
        >
          <span className="text-content text-sm font-semibold">⚙ Cài đặt nhân vật</span>
          <button
            className="text-subtle hover:bg-hover hover:text-content rounded px-1.5 py-0.5 text-sm leading-none"
            aria-label="Đóng"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        {/**
         * HAI KHE THẬT, không phải `columns` của CSS: `column-count: 2` chỉ chia khi nội dung đủ cao
         * để tràn — bảng cài đặt ngắn nên nó dồn hết vào cột trái và chừa cột phải trống (user chụp
         * được). Ở đây chia tay, khe giữa đúng bề ngang nhân vật.
         *
         * `gridTemplateRows: minmax(0, 1fr)` để mỗi CỘT tự cuộn trong chiều cao khung — cuộn ở
         * cột (nhận chuột) thì thanh cuộn kéo được; cuộn ở lưới (không nhận chuột) thì không.
         *
         * KHÔNG `backdrop-blur` trên cột: blur đè lên canvas WebGL vẽ liên tục là mỗi khung hình
         * phải tính lại blur — đã có model lag vì GPU. Nền cột 70% + nhân vật mờ 55% là đủ đọc.
         */}
        <div
          className="grid min-h-0 flex-1 px-4 py-3"
          style={{ gridTemplateColumns: `1fr ${gap}px 1fr`, gridTemplateRows: 'minmax(0, 1fr)' }}
        >
          <div className="bg-elevated/70 pointer-events-auto min-h-0 min-w-0 overflow-y-auto overscroll-contain rounded-lg p-2">
            {children}
          </div>
          {/* Khe giữa để trống — nhân vật đứng ở đây, chuột xuyên qua tới nhân vật */}
          <div aria-hidden data-vrm-settings-gap />
          <div className="bg-elevated/70 pointer-events-auto min-h-0 min-w-0 overflow-y-auto overscroll-contain rounded-lg p-2">
            {right}
          </div>
        </div>
      </div>
    </>
  )
}
