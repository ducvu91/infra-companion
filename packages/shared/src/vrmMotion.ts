/**
 * F70 — thư viện chuyển động `.vrma` tải theo yêu cầu.
 *
 * Cùng lý do với model mẫu (`vrmSample.ts`): 13 file là ~4 MB, không đáng nhét vào bản cài của
 * mọi người khi phần lớn không bật nhân vật. Tải một lần rồi nằm trong `userData`.
 *
 * ⚠️ **Chỉ đưa vào đây clip có giấy phép cho PHÂN PHỐI LẠI.** Bộ "VRMA_MotionPack" chính thức
 * của pixiv **KHÔNG** đủ điều kiện: điều khoản của nó cấm *"distributing these motions or their
 * alterations without permission in a way that can be rigged or extracted"* — đặt file vào repo
 * hay release công khai là đúng hành vi đó. User tự tải về rồi dùng nút "Nạp file .vrma" thì hợp
 * lệ, đó là chuyện giữa họ và pixiv.
 *
 * Toàn bộ clip dưới đây là **CC0 1.0** từ ba tác giả trên BOOTH (đã đối chiếu điều khoản ở trang
 * gốc, không chỉ tin nơi phân phối lại). CC0 không bắt ghi công; vẫn ghi vì nó là hồ sơ nguồn gốc.
 */

/** Vai trò của clip trong app — quyết định nó tự chạy lúc nào. */
export type VrmMotionRole =
  /** Nền lúc rảnh: nhiều clip **luân phiên** nhau, xem `motionsForRole`. */
  | 'idle'
  /** Khi mở khung chat. */
  | 'chat'
  /** Khi user chạm vào nhân vật. */
  | 'poke'
  /** Khi hệ thống có cảnh báo. */
  | 'alert'
  /** Khi mọi thứ trở lại bình thường. */
  | 'recover'
  /** Khi mở công cụ cần ngồi đọc lâu (so sánh config, replication). */
  | 'inspect'
  /** Không tự chạy — chỉ khi user chọn trong menu 🎬. */
  | 'manual'

export interface VrmMotionClip {
  id: string
  /** Tên hiện trên UI. */
  label: string
  role: VrmMotionRole
  /** Dài bao lâu (giây) — đo từ chính file, dùng để đặt hẹn giờ và hiện trên UI. */
  durationSec: number
  author: string
  license: string
  licenseUrl: string
  /** Trang gốc của tác giả — nguồn đáng tin hơn nơi phân phối lại. */
  sourceUrl: string
  url: string
  sha256: string
  sizeBytes: number
  fileName: string
  /**
   * Clip làm nhân vật RỜI khỏi chỗ đứng (đi, chạy, nhảy).
   *
   * App neo nhân vật ở một góc màn hình cố định, nên clip loại này làm nó trôi ra khỏi khung hoặc
   * lún qua mép — đo được: `walk` lún 11 cm, `run-slow` nhấc chân 34 cm. Không bao giờ tự chạy;
   * chỉ user chủ động chọn.
   */
  locomotion?: boolean
}

const RAW = 'https://raw.githubusercontent.com/SanHsien/voxavatar/main/public/assets/animations'
const CC0 = 'CC0 1.0'
const CC0_URL = 'https://creativecommons.org/publicdomain/zero/1.0/'
const REROFUMI = { author: 'へすい / rerofumi', sourceUrl: 'https://booth.pm/ja/items/5527394' }
const SASHII = { author: 'sashii', sourceUrl: 'https://booth.pm/ja/items/6412084' }
const SASHII_RT = { author: 'sashii (retarget) · JenJell (gốc)', sourceUrl: 'https://booth.pm/ja/items/7861818' }

/** Dựng một mục cho gọn — mọi clip đều CC0 và cùng nơi host. */
function clip(
  id: string,
  label: string,
  role: VrmMotionRole,
  durationSec: number,
  sha256: string,
  sizeBytes: number,
  src: { author: string; sourceUrl: string },
  locomotion?: boolean
): VrmMotionClip {
  return {
    id,
    label,
    role,
    durationSec,
    author: src.author,
    license: CC0,
    licenseUrl: CC0_URL,
    sourceUrl: src.sourceUrl,
    url: `${RAW}/${id}.vrma`,
    sha256,
    sizeBytes,
    fileName: `${id}.vrma`,
    ...(locomotion ? { locomotion: true } : {})
  }
}

/**
 * Thư viện clip. Thời lượng và sha256 **đo từ chính file đã tải**, không chép từ mô tả.
 *
 * Bốn clip cuối là loại di chuyển — xem `locomotion`.
 */
export const VRM_MOTIONS: readonly VrmMotionClip[] = [
  // ── Tự chạy theo trạng thái ────────────────────────────────────────────────
  /**
   * Hai clip idle LUÂN PHIÊN — một tư thế lặp mãi thì 15 phút sau thành tật máy móc.
   *
   * ⚠️ Clip idle phải **vừa khung hình**: đo bề ngang thật thì "máy bay" dang tay rộng **3,55×**
   * thân người lúc đứng, vượt xa lề `WIDTH_MARGIN` (2,2×) nên hai bàn tay bị cắt cụt. Nó nằm ở
   * nhóm chọn tay. "Uống nước" (1,3×) thay chỗ: đủ hẹp, và là cử chỉ đời thường hợp lúc rảnh.
   */
  clip('idle-01', 'Đứng thư giãn', 'idle', 7.97, '5ed6c016df035b21daaefe64751e1356387c6a33693d31366b0912ac7566ea92', 95888, SASHII),
  clip('drink-water', 'Uống nước', 'idle', 23.73, 'ba56122fecb5014f019096dcd014c0c35f1d560dcb0f6b1d55d3d66e5d69740c', 613560, REROFUMI),
  clip('speaking-01', 'Đang nói', 'chat', 1.97, 'ba0339d2d9755fc2e0dab06e96a0d91303d0a508c9f89f07dc17a07dc0e2535c', 37208, SASHII),
  // Chạm vào người → TẠO DÁNG (user đổi từ "giật mình")
  clip('pose-motion', 'Tạo dáng', 'poke', 20.0, 'e3b06f78b21df2fe1f26d80dd1826fd47941a891d44b46a6197f8a87de05ff2c', 521156, REROFUMI),
  clip('failed-apology', 'Cúi xin lỗi', 'alert', 7.27, 'fdc0cdeca81c8130c8fd4c257cae4392c58f48e3b016fe2db696b6d40823f504', 204992, REROFUMI),
  clip('success-cheer', 'Ăn mừng', 'recover', 21.5, '88123be97c20633b926b911c1904aae3cdc790c5416b39788b753749ba087afb', 559496, REROFUMI),
  // Mở công cụ ngồi đọc lâu → nhân vật cũng ngồi xem điện thoại cho hợp cảnh
  clip('review-phone', 'Xem điện thoại', 'inspect', 10.43, '54a37ca48a1d4ffb60cfc539013f59fecd48d93375b2069c6c35b5e9f416b726', 281528, REROFUMI),
  // ── Chỉ chạy khi user chọn ─────────────────────────────────────────────────
  clip('reaction-startle', 'Giật mình', 'manual', 11.43, 'ad2a5118837bfa6789cb89383d4e0bd98bed7685158b692bbfb6662ee42ae6c9', 307340, REROFUMI),
  // Dang tay rộng 3,55× thân người — vượt khung nếu tự chạy, nên chỉ khi user chủ động chọn
  clip('airplane-02', 'Máy bay', 'manual', 7.5, '6a8dd04f6a0b4f071d881df1fce68e116dc4c5c1d651f5a5585a91cfa4037ccd', 235656, SASHII),
  // ── Di chuyển: KHÔNG tự chạy (nhân vật rời khỏi chỗ đứng) ──────────────────
  clip('walk', 'Đi bộ', 'manual', 0.83, '51c4158488a86a6bb99b978fb4d269e1798f9749bceaf0420473bae413fc3271', 66604, SASHII_RT, true),
  clip('run-slow', 'Chạy chậm', 'manual', 0.73, '54fff21bbbbbe6364dc812f39dd849eadb61de3888b556580143d386592d17e5', 48864, SASHII_RT, true),
  clip('exercise-step', 'Bước thể dục', 'manual', 2.33, '62c3f543c0386feadf475d81f5d6a77f7dd21cd638892d1e0fed811cd9dedd5f', 79256, REROFUMI, true),
  clip('airplane-05', 'Máy bay (dài)', 'manual', 43.7, 'efcb583b0548cdf76e4c4a623f10875204dcba8a2d06f978321b5b4d4a1221b8', 1155048, SASHII, true)
]

/** Clip đầu tiên của một vai trò; `null` nếu vai trò đó không có clip nào. */
export function motionForRole(role: VrmMotionRole): VrmMotionClip | null {
  return VRM_MOTIONS.find((m) => m.role === role) ?? null
}

/** Tất cả clip của một vai trò — vai trò `idle` có nhiều clip luân phiên. */
export function motionsForRole(role: VrmMotionRole): VrmMotionClip[] {
  return VRM_MOTIONS.filter((m) => m.role === role)
}

/**
 * Clip kế tiếp cho một vai trò: **xoay vòng, không bốc ngẫu nhiên**.
 *
 * Ngẫu nhiên thì có lúc ra cùng một clip hai ba lần liền, mà ở nhịp 90–180 giây một lần thì user
 * sẽ thấy đúng cái đó lặp lại và nghĩ tính năng hỏng. Xoay vòng thì luôn đổi, và với hai clip
 * là đúng nghĩa "luân phiên".
 *
 * @param lastId clip vừa chạy (`null` nếu chưa chạy lần nào)
 * @param available chỉ xét clip đã tải về máy — chưa tải mà chọn thì không có gì để phát
 */
export function nextMotionForRole(
  role: VrmMotionRole,
  lastId: string | null,
  available: readonly string[]
): VrmMotionClip | null {
  const pool = motionsForRole(role).filter((m) => available.includes(m.id))
  if (pool.length === 0) return null
  if (pool.length === 1 || lastId === null) return pool[0]!
  const i = pool.findIndex((m) => m.id === lastId)
  // Không thấy clip cũ trong nhóm (vừa đổi vai trò) → bắt đầu lại từ đầu
  return pool[i < 0 ? 0 : (i + 1) % pool.length]!
}

/** Tổng dung lượng phải tải (byte) — hiện trên nút để user biết trước. */
export function motionPackBytes(): number {
  return VRM_MOTIONS.reduce((s, m) => s + m.sizeBytes, 0)
}

/**
 * Khoảng cách giữa hai lần chạy clip idle (ms).
 *
 * Thưa là chủ ý: clip idle chạy thì **tắt toàn bộ lớp tự sinh** (nhìn theo chuột, kéo níu, tay đu
 * theo quán tính), nên để nó chạy liên tục là đánh đổi cả phần tương tác lấy một vòng lặp cố định.
 * Chạy thỉnh thoảng thì được cái hay của cả hai.
 */
export const MOTION_IDLE_EVERY_MIN_MS = 90_000
export const MOTION_IDLE_EVERY_MAX_MS = 180_000

export function motionIdleDelayMs(rng: () => number): number {
  return MOTION_IDLE_EVERY_MIN_MS + rng() * (MOTION_IDLE_EVERY_MAX_MS - MOTION_IDLE_EVERY_MIN_MS)
}
