/**
 * F70 — hai quyết định thuần của sân khấu VRM, tách khỏi renderer để có test.
 *
 * Renderer (`vrmStage.ts`) giữ phần đụng three.js/WebGL; phần *tính ra con số* nằm đây theo
 * mục 5 CLAUDE.md. Cả hai đều là loại sai mà **không có lỗi nào được ném ra** — nhân vật chỉ
 * đơn giản đứng sai chỗ hoặc sai tư thế — nên đáng có test chặn tái phát.
 *
 * Đặt ở `shared` chứ không `core`: nơi gọi là **renderer**, mà renderer không import được
 * `@infra/core` (kéo `ssh2` vào bundle web là vỡ build). Test nằm ở
 * `packages/core/src/vrm/framing.test.ts` vì vitest chỉ quét `packages/core`.
 */

export interface FrameDistanceInput {
  /** Chiều cao khung hình cần lọt (đơn vị scene), đã tính cả lề. */
  frameH: number
  /** Bề ngang model theo trục X. */
  bbW: number
  /** FOV **dọc** của camera, độ. */
  fovDeg: number
  /** Tỉ lệ ngang/dọc của khung vẽ. */
  aspect: number
}

/**
 * Khoảng cách camera để model lọt trọn **cả hai chiều**.
 *
 * `fov` của `PerspectiveCamera` là FOV DỌC, nên tính riêng theo nó thì khung ngang hẹp (panel
 * dọc) cắt mất hai bên — váy xoè hoặc tay dang ra là thấy ngay. Lấy khoảng cách lớn hơn giữa
 * hai ràng buộc.
 */
export function frameDistance({ frameH, bbW, fovDeg, aspect }: FrameDistanceInput): number {
  const halfFovY = (fovDeg * Math.PI) / 360
  const tan = Math.tan(halfFovY)
  const distV = frameH / 2 / tan
  const distH = bbW / 2 / (tan * aspect)
  return Math.max(distV, distH)
}

/**
 * Dấu xoay tay theo phiên bản spec VRM.
 *
 * `VRMUtils.rotateVRM0` xoay model 0.x 180° quanh trục Y để nó quay mặt vào camera, kéo theo
 * hệ trục cục bộ của xương. Hệ quả: cùng một `rotation.z` hạ tay xuống ở VRM 1.0 thì ở 0.x
 * **giơ tay lên trời** — không lỗi, không cảnh báo, chỉ là nhân vật đứng giơ hai tay. Đã gặp
 * đúng vậy trên model 0.x thật.
 */
export function armSignFor(metaVersion: string): 1 | -1 {
  return metaVersion === '0' ? -1 : 1
}

/**
 * Chỗ đặt bảng cài đặt nổi cạnh nhân vật (`VrmMiniPanel`).
 *
 * Tách khỏi component để **test được**: nhân vật hay đứng sát đáy màn hình, mà bảng mở xuống dưới
 * từ vị trí nhân vật — bản đầu chỉ kẹp chiều ngang nên phần dưới bảng nằm ngoài màn hình và mất
 * hẳn các nút ở đó. Đây là loại lỗi chỉ thấy khi ở đúng độ phân giải và đúng vị trí, nên phải có
 * test chặn thay vì nhìn bằng mắt một lần.
 */
export interface PanelPlacement {
  top: number
  maxHeight: number
  /** Mở xuống dưới (true) hay lên trên (false) — nơi gọi không cần biết, để debug. */
  openDown: boolean
}

export function placeVrmPanel(anchorTop: number, viewportHeight: number, margin = 8): PanelPlacement {
  const spaceBelow = viewportHeight - (anchorTop + margin) - margin
  const spaceAbove = anchorTop - margin * 2
  // Mở xuống nếu dưới còn đủ chỗ cho một bảng bình thường, ngược lại chọn bên rộng hơn
  const openDown = spaceBelow >= 260 || spaceBelow >= spaceAbove
  const maxHeight = Math.max(160, openDown ? spaceBelow : spaceAbove)
  const top = openDown ? anchorTop + margin : Math.max(margin, anchorTop - margin - maxHeight)
  return { top, maxHeight, openDown }
}

/** Trần phóng to/thu nhỏ (Ctrl + lăn chuột). */
export const VRM_ZOOM_MIN = 0.5
export const VRM_ZOOM_MAX = 3

/**
 * Mức phóng mới sau một nấc lăn chuột.
 *
 * Nhân/chia theo **hệ số** chứ không cộng/trừ một lượng cố định: ở mức 0.5 thì cộng 0.1 là
 * nhảy 20%, còn ở mức 3 chỉ là 3% — cùng một cú lăn mà cảm giác khác hẳn. Nhân thì mỗi nấc
 * đổi đúng một tỉ lệ như nhau.
 *
 * `deltaY` âm = lăn lên = phóng to (theo quy ước của mọi trình duyệt).
 */
export function zoomStep(current: number, deltaY: number): number {
  const next = deltaY < 0 ? current * 1.1 : current / 1.1
  return Math.min(VRM_ZOOM_MAX, Math.max(VRM_ZOOM_MIN, next))
}

/**
 * Biểu cảm nên hiện khi app có sự kiện mới.
 *
 * Trả về **tên ưu tiên theo thứ tự**, không phải một tên duy nhất: model VRM chỉ khai những
 * biểu cảm tác giả muốn có, và `expressionManager.setValue('angry', …)` trên model không có
 * `angry` là **no-op im lặng** (mục 8 CLAUDE.md). Nơi gọi phải dò xuống danh sách này và lấy
 * cái đầu tiên model thật sự có.
 *
 * `neutral` luôn đứng cuối vì mọi model đều khai nó — nó là lưới an toàn.
 */
export function expressionForEvent(kind: string, severity: string): readonly string[] {
  if (kind === 'recover') return ['relaxed', 'happy', 'neutral']
  if (kind === 'alert') {
    return severity === 'critical' ? ['surprised', 'sad', 'angry', 'neutral'] : ['sad', 'surprised', 'neutral']
  }
  return ['neutral']
}
