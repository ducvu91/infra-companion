/**
 * F70 — các **quyết định thuần** của bộ điều khiển hoạt ảnh nhân vật.
 *
 * Đặt ở `shared` chứ không `core` vì nơi gọi là renderer (§5: renderer không import được
 * `@infra/core`). Test nằm ở `packages/core/src/vrm/` vì vitest chỉ quét `packages/core`.
 *
 * Phần đụng three.js (ghi xương, raycast) ở lại `vrmStage.ts`. Ở đây chỉ có: *khi nào* làm gì,
 * *chọn* cái gì, và *ai* được quyền ghi xương nào — những thứ vừa dễ sai vừa dễ test.
 */

/** Nhóm xương, đơn vị nhỏ nhất mà một tầng có thể "giành quyền". */
export type BoneGroup = 'hips' | 'spine' | 'head' | 'arms' | 'face'

/**
 * Tầng hoạt ảnh, xếp theo ưu tiên TĂNG DẦN.
 *
 * Thứ tự này chính là §8 của yêu cầu: sự kiện hệ thống > tương tác người dùng > trạng thái >
 * cử chỉ nhỏ > idle.
 */
export const LAYERS = ['idle', 'micro', 'status', 'interaction', 'critical'] as const
export type Layer = (typeof LAYERS)[number]

/**
 * Tầng nào **giành trọn** nhóm xương nào, tức tầng thấp hơn phải im lặng hoàn toàn ở đó.
 *
 * ⚠️ Gần như mọi tầng để TRỐNG, và đó là chủ ý. Các tầng hiện có đều **cộng dồn** vào `pose`,
 * nên bản thân bộ cộng dồn đã khiến "hai animation tranh một xương" là chuyện không thể —
 * không cần giành gì thêm.
 *
 * Đã thử cho `micro`/`status`/`interaction` giành `head` và **hỏng**: giành nhóm nào là tầng
 * idle bỏ qua **toàn bộ** khối đó, nên lúc click, góc đầu đang đuổi theo con trỏ (tới 0,55 rad)
 * rơi thẳng về 0 trong một frame — giật ~31°. Trạng thái `warning` còn tệ hơn: đầu đơ suốt
 * ~16 giây, không nhìn theo chuột nữa, tức nhân vật cứng lại đúng lúc hệ thống có chuyện.
 *
 * Bảng này giữ lại cho tầng nào **thật sự thay thế** tư thế (một clip toàn thân, animation
 * khẩn cấp) — lúc đó trộn cộng dồn mới là sai.
 */
const CLAIMS: Record<Layer, readonly BoneGroup[]> = {
  idle: [],
  micro: [],
  status: [],
  interaction: [],
  critical: ['spine', 'head', 'face']
}

export function claims(layer: Layer): readonly BoneGroup[] {
  return CLAIMS[layer]
}

/**
 * Nhóm xương này có bị một tầng ƯU TIÊN CAO HƠN chiếm không.
 *
 * Đây là chỗ chặn lỗi "hai nguồn cùng ghi một xương" — lỗi đã mắc ba lần trong lúc làm tính
 * năng này (`hips.position.y` bị gán đè, `spine.rotation.y` bị cả idle lẫn hướng nhìn ghi).
 * Thay vì dò bằng mắt mỗi lần thêm chuyển động, hỏi hàm này.
 */
export function isClaimedByHigher(group: BoneGroup, self: Layer, active: readonly Layer[]): boolean {
  const selfRank = LAYERS.indexOf(self)
  return active.some((l) => LAYERS.indexOf(l) > selfRank && CLAIMS[l].includes(group))
}

/** Khoảng thời gian (ms) giữa hai lần của từng loại hành động — bảng ở §2. */
const INTERVALS: Record<string, readonly [number, number]> = {
  blink: [3000, 7000],
  look: [8000, 15000],
  weight: [6000, 12000],
  micro: [15000, 30000]
}

/**
 * Thời điểm kế tiếp cho một hành động, rải ngẫu nhiên trong khoảng của nó.
 *
 * Ngẫu nhiên là bắt buộc chứ không phải trang trí: chu kỳ cố định dù nhỏ đến đâu cũng bị mắt
 * nhận ra sau vài chục giây và lập tức thành "máy móc".
 *
 * `rng` truyền vào để test cố định được kết quả.
 */
export function nextActionAt(kind: keyof typeof INTERVALS | string, now: number, rng: () => number): number {
  const range = INTERVALS[kind] ?? [5000, 10000]
  return now + range[0]! + rng() * (range[1]! - range[0]!)
}

/** Xác suất một lần chớp mắt là chớp ĐÚP — thấp, vì gặp thường xuyên là thành tật giật mắt. */
export const DOUBLE_BLINK_CHANCE = 0.15

export function isDoubleBlink(rng: () => number): boolean {
  return rng() < DOUBLE_BLINK_CHANCE
}

/** Trạng thái nhân vật phản ánh tình hình hệ thống. */
export type AvatarStatus = 'normal' | 'warning' | 'critical'

/**
 * Trạng thái suy từ một sự kiện của app.
 *
 * ⚠️ Chỉ có ba trạng thái, **không** có LOADING / ERROR / DISCONNECTED như bản mô tả ban đầu:
 * app không có nguồn dữ liệu nào cấp những tín hiệu đó. `AppEventDto` chỉ mang `kind` +
 * `severity`, nên bịa thêm trạng thái là tạo thứ không bao giờ chạy.
 */
export function statusForEvent(kind: string, severity: string): AvatarStatus {
  if (kind === 'recover') return 'normal'
  if (kind !== 'alert') return 'normal'
  return severity === 'critical' ? 'critical' : severity === 'warning' ? 'warning' : 'normal'
}

/** Bao lâu thì nhân vật thôi "để ý" và về lại bình thường (ms). */
export const STATUS_HOLD_MS = 12_000

/** Một kiểu phản ứng khi bị click. */
export interface Reaction {
  id: string
  /** Thời lượng (ms) — §4 yêu cầu 0,8–2 giây. */
  durationMs: number
  /** Biểu cảm ưu tiên theo thứ tự; nơi gọi dò xuống lấy cái model thật sự khai. */
  expressions: readonly string[]
  /** Nghiêng đầu (rad). */
  tilt: number
  /** Gật đầu (rad, dương = cúi xuống). */
  nod: number
  /** Xoay người về phía con trỏ (rad). */
  turn: number
}

/**
 * Bộ phản ứng khi bị chạm vào.
 *
 * Biên độ cố tình **rất nhỏ**: đã thử mạnh hơn ba lần và lần nào user cũng nói không tự nhiên.
 * Thứ tạo cảm giác sống là *có phản ứng* và *mỗi lần một khác*, không phải biên độ lớn.
 */
export const REACTIONS: readonly Reaction[] = [
  // A — nghiêng đầu, cười nhẹ
  { id: 'tilt', durationMs: 1200, expressions: ['relaxed', 'happy', 'neutral'], tilt: 0.09, nod: 0, turn: 0.05 },
  // B — nhìn về phía con trỏ, gật nhẹ
  { id: 'nod', durationMs: 1000, expressions: ['happy', 'relaxed', 'neutral'], tilt: 0, nod: 0.07, turn: 0.1 },
  // C — hơi ngạc nhiên rồi về bình thường
  { id: 'surprise', durationMs: 1400, expressions: ['surprised', 'neutral'], tilt: 0.04, nod: -0.05, turn: 0.08 },
  // D — chỉ xoay người, không biểu cảm mạnh
  { id: 'turn', durationMs: 900, expressions: ['neutral'], tilt: 0.03, nod: 0, turn: 0.13 }
]

/**
 * Chọn một phản ứng, **tránh lặp lại cái vừa dùng**.
 *
 * Click liên tiếp ra cùng một phản ứng thì hỏng hết cảm giác ngẫu nhiên — mà ngẫu nhiên thuần
 * thì vẫn có lúc ra hai lần liền.
 */
export function pickReaction(rng: () => number, lastId: string | null): Reaction {
  const pool = REACTIONS.filter((r) => r.id !== lastId)
  const list = pool.length > 0 ? pool : REACTIONS
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))]!
}

/**
 * Hệ số nội suy theo THỜI GIAN, không theo frame.
 *
 * `x += (target - x) * 0.12` mỗi frame là sai: ở 60fps nó chạy **nhanh gấp đôi** 30fps, mà FPS
 * là tuỳ chọn của user — cùng một cấu hình cho hai cảm giác khác nhau. Công thức mũ cho tốc độ
 * như nhau ở mọi FPS.
 *
 * `k` = tốc độ đuổi (đơn vị 1/giây); dt tính bằng giây.
 */
export function damp(k: number, dt: number): number {
  return 1 - Math.exp(-k * Math.max(0, dt))
}

/** Ease-in-out mượt hai đầu — dùng cho mọi chuyển động rời (§9: tránh tuyến tính). */
export function smoothStep(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

/** Đường cong đi-rồi-về của một cử chỉ một nhịp: 0 → 1 → 0, mượt hai đầu. */
export function pulse(t: number): number {
  return Math.sin(Math.min(1, Math.max(0, t)) * Math.PI)
}

/**
 * Nhân vật tự xoay MỘT vòng quanh trục đứng mỗi 2–3 phút (yêu cầu của user).
 *
 * Kết thúc đúng 2π nên góc nhìn về **y như cũ** — không tích luỹ lệch, không đè lên góc user đã
 * Shift+kéo (nơi gọi CỘNG offset này vào góc của user rồi mới ghi xuống scene).
 */
export const SPIN_EVERY_MIN_MS = 120_000
export const SPIN_EVERY_MAX_MS = 180_000
/** Một vòng mất 8 giây — nhanh hơn là "quay như con quay", chậm hơn là không nhận ra đang xoay. */
export const SPIN_MS = 8000

export function spinDelayMs(rng: () => number): number {
  return SPIN_EVERY_MIN_MS + rng() * (SPIN_EVERY_MAX_MS - SPIN_EVERY_MIN_MS)
}

/** Góc xoay thêm tại tiến độ `t` ∈ [0,1]: 0 → 2π, có easing hai đầu để không giật lúc bắt đầu/dừng. */
export function spinAngle(t: number): number {
  return smoothStep(t) * Math.PI * 2
}
