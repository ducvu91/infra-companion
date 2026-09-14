/**
 * F70 — nhân vật VRM: DTO giữa main và renderer.
 *
 * Mức 1 (mức đang làm): user tự chọn file `.vrm` trong máy, app nạp lên và hiển thị.
 * App **không tải model từ mạng** và **không copy file vào `userData`** — khác hẳn cách làm
 * của font tự thêm. Hai lý do: một model thật là 40–60 MB nên nhân bản là vô ích, và file
 * vẫn thuộc quyền quản lý của user (họ xoá/đổi chỗ thì app báo mất, không giữ bản sao ngầm).
 */

import type { VrmMeta, VrmSpec } from './vrmTypes'

/** Trần dung lượng một model. Model VRM thật thường 15–60 MB; hơn 200 MB là bất thường. */
export const VRM_MAX_BYTES = 200 * 1024 * 1024

/** Số model tối đa trong danh sách — đây là danh bạ đường dẫn, không phải kho file. */
export const VRM_MAX_MODELS = 12

export interface VrmModelDto {
  id: string
  /** Đường dẫn tuyệt đối tới file trong máy user. */
  path: string
  /** Tên hiện trên UI: lấy từ meta trong file, không có thì lấy tên file. */
  label: string
  spec: VrmSpec
  meta: VrmMeta
  sizeBytes: number
  addedAt: number
  /**
   * File còn ở chỗ cũ không (kiểm lúc trả danh sách). File biến mất là chuyện thường —
   * user dọn ổ đĩa — nên phải nói rõ trên UI thay vì để việc nạp thất bại lúc bấm.
   */
  missing: boolean
}

export type VrmPickResult =
  | { ok: true; model: VrmModelDto }
  | { ok: false; reason: 'canceled' | 'tooLarge' | 'notVrm' | 'badFile' | 'full' | 'io'; detail?: string }

export type VrmReadResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: 'missing' | 'tooLarge' | 'io'; detail?: string }

/** Trần cho file animation `.vrma` — chỉ là dữ liệu xương, vài trăm KB là cùng. */
export const VRMA_MAX_BYTES = 32 * 1024 * 1024

export type VrmAnimationPickResult =
  | { ok: true; name: string; bytes: Uint8Array }
  | { ok: false; reason: 'canceled' | 'tooLarge' | 'io'; detail?: string }

export interface VrmSettingsDto {
  /** Model đang chọn. `null` = chưa chọn gì, panel hiện màn hình mời chọn file. */
  activeId: string | null
  /** Hiện nhân vật lúc mở app. Mặc định tắt: 3D chạy liên tục là tốn pin. */
  autoShow: boolean
  /** Cho tóc/váy đu đưa (springBone). Tắt được vì đây là phần tốn CPU nhất. */
  springBones: boolean
  /** Giới hạn FPS. 30 đủ mượt cho một nhân vật đứng yên và tiết kiệm rõ rệt so với 60. */
  fpsCap: 30 | 60
  /** Hệ số phóng to (Ctrl + lăn chuột). Xem `VRM_ZOOM_MIN`/`MAX`. */
  zoom: number
  /** Đầu/mắt dõi theo con trỏ chuột. */
  lookAtCursor: boolean
  /** Đổi biểu cảm khi app có cảnh báo (nối vào trung tâm thông báo). */
  reactToEvents: boolean
  /** Góc xoay quanh trục đứng, radian (Shift + kéo chuột). */
  rotationY: number
  /**
   * Vị trí user đã kéo nhân vật tới, theo **tỉ lệ** cửa sổ (0..1), `null` = chưa kéo lần nào.
   *
   * Lưu tỉ lệ chứ không pixel: user đổi cỡ cửa sổ hoặc cắm màn hình khác thì toạ độ pixel cũ trỏ
   * ra ngoài màn hình và nhân vật biến mất. Tỉ lệ thì luôn nằm trong khung.
   */
  posX: number | null
  posY: number | null
  /**
   * Hiện nhân vật NGOÀI desktop khi có thông báo mà app đang ở khay / thu nhỏ.
   *
   * Mặc định bật: thu vào khay là lúc duy nhất user KHÔNG nhìn app, cũng là lúc cảnh báo dễ trôi
   * nhất — mà "có đứa báo cho tôi" chính là lý do người ta bật nhân vật lên. Chỉ có tác dụng khi
   * `reactToEvents` cũng bật.
   */
  desktopOverlay: boolean
}

export const DEFAULT_VRM_SETTINGS: VrmSettingsDto = {
  activeId: null,
  autoShow: false,
  springBones: true,
  fpsCap: 30,
  zoom: 1,
  lookAtCursor: true,
  reactToEvents: true,
  rotationY: 0,
  posX: null,
  posY: null,
  desktopOverlay: true
}

/** Đọc một toạ độ tỉ lệ đã lưu: phải là số trong [0,1], ngoài ra coi như chưa có. */
export function cleanPos(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null
}
