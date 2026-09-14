/**
 * F70 — tay nhân vật VRM là **bài toán tư thế giải phẫu**, giải bằng IK, không phải vài góc xương.
 *
 * Lịch sử ngắn của file này, để không ai quay lại đường cũ: bốn vòng chỉnh euler từng xương
 * (hạ/gập/xoay) đều ra "cứng, đang tạo dáng" — vì khuỷu, cổ tay, ngón được đặt RỜI nhau chứ
 * không suy ra từ chỗ bàn tay cần rơi xuống; và ngón tay chưa bao giờ được đụng tới nên thẳng
 * song song như ma-nơ-canh.
 *
 * Bản này: bàn tay có một **vị trí đích tương đối với khớp háng** (ngoài đùi, hơi ra trước), độ
 * với chỉ 95–96% chiều dài tay nên khuỷu tự mềm đúng mức; khuỷu hướng theo pole (xuống, ra ngoài,
 * hơi ra sau); cẳng tay + bàn tay xoay để lòng bàn tay hướng vào đùi; ngón cong tăng dần từ trỏ
 * tới út. Mọi thứ ở đây là toán THUẦN trên `{x,y,z}` — không phụ thuộc three — để test được.
 *
 * Hệ toạ độ: **khung model** — model nhìn về +Z, +Y lên, trái/phải theo dấu `x` của khớp vai
 * (rig 1.0 và 0.x khác nhau nên nơi gọi đo `sideX = sign(shoulder.x)` chứ không giả định).
 */

export interface V3 {
  x: number
  y: number
  z: number
}

const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const scale = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k })
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const len3 = (a: V3): number => Math.sqrt(dot(a, a))
export function normalize3(a: V3): V3 {
  const l = len3(a)
  return l > 1e-9 ? scale(a, 1 / l) : { x: 0, y: -1, z: 0 }
}
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export interface TwoBoneIk {
  /** Vị trí khuỷu. */
  elbow: V3
  /** Đích thực sự đã dùng (bằng `target` nếu với tới; bị kéo về trong tầm nếu không). */
  end: V3
  /** Góc gập khuỷu (rad): 0 = duỗi thẳng. */
  bendRad: number
  /** `|đích − gốc| / (a + b)` sau khi kẹp — 1 là duỗi hết cỡ. */
  reachFrac: number
}

/**
 * IK giải tích hai xương (vai → khuỷu → cổ tay).
 *
 * Định lý cos cho góc ở vai; khuỷu nằm trên vòng tròn quanh trục gốc→đích, chọn điểm về phía
 * `pole`. Không lặp (CCD/FABRIK) vì hai xương có nghiệm đóng — nhanh, ổn định, không "rung".
 *
 * Kẹp đích vào tầm `[|a−b|, (a+b)·0.9995]`: đích xa quá thì tay duỗi thẳng hết cỡ chứ không
 * bung khớp; `0.9995` chứ không `1` vì đúng bằng tổng chiều dài là `acos(1)` → khuỷu mất phương.
 */
export function solveTwoBoneIk(root: V3, target: V3, lenA: number, lenB: number, pole: V3): TwoBoneIk {
  const d = sub(target, root)
  const dist = len3(d)
  const reach = clamp(dist, Math.abs(lenA - lenB) + 1e-4, (lenA + lenB) * 0.9995)
  const u = dist > 1e-9 ? scale(d, 1 / dist) : { x: 0, y: -1, z: 0 }
  const end = add(root, scale(u, reach))

  // Pole chiếu vuông góc với trục gốc→đích; nếu pole trùng trục thì lấy một hướng bất kỳ ⊥
  let w = sub(pole, scale(u, dot(pole, u)))
  if (len3(w) < 1e-6) w = Math.abs(u.y) < 0.9 ? { x: -u.y, y: u.x, z: 0 } : { x: 0, y: -u.z, z: u.y }
  w = normalize3(w)

  const cosA = clamp((lenA * lenA + reach * reach - lenB * lenB) / (2 * lenA * reach), -1, 1)
  const a = Math.acos(cosA)
  const elbow = add(root, add(scale(u, lenA * Math.cos(a)), scale(w, lenA * Math.sin(a))))

  const cosE = clamp((lenA * lenA + lenB * lenB - reach * reach) / (2 * lenA * lenB), -1, 1)
  return { elbow, end, bendRad: Math.PI - Math.acos(cosE), reachFrac: reach / (lenA + lenB) }
}

/** Đặc tả tư thế nghỉ của MỘT tay — đại lượng hình học tương đối thân người, không phải góc xương. */
export interface ArmRestSide {
  /** Bàn tay cách tâm thân theo ngang = `|hip.x| · lateralFrac + lateralM` (hip = khớp háng). */
  lateralFrac: number
  lateralM: number
  /** Bàn tay ra trước khớp háng (m). */
  forwardM: number
  /** Với bao nhiêu phần chiều dài tay — 1 là duỗi thẳng; ~0,95–0,97 cho khuỷu mềm. */
  reach: number
  /** Pole khuỷu: ra ngoài / ra sau (thành phần đơn vị, sẽ chuẩn hoá cùng −0,15 xuống). */
  poleOut: number
  poleBack: number
  /** Lòng bàn tay: hướng vào thân, pha thêm bao nhiêu ra sau (0 = thẳng vào đùi). */
  palmBack: number
  /** Vai hạ thêm (rad) — người thả lỏng vai không ở đúng góc rig. */
  shoulderDrop: number
}

/**
 * Tư thế nghỉ: **đứng thả lỏng, hai tay buông cạnh đùi** — RELAXED, tư thế duy nhất cho tới khi
 * user nghiệm thu bằng mắt (§20: chưa đẹp thì DỪNG, không thêm gì).
 *
 * Lệch trái/phải cố ý và nhỏ (§10): trái thấp hơn, sát thân hơn, khuỷu mềm hơn, lòng bàn tay
 * hướng vào; phải cao hơn, xa thân hơn, lòng bàn tay hơi ra sau.
 */
/**
 * `reach` 0,988–0,992, KHÔNG 0,955: định lý cos với hai khúc bằng nhau cho khuỷu gập
 * `180° − acos((a²+b²−r²)/2ab)` → 95,5% là **34°** (đo được đúng vậy trên Carlotta), 99% mới là
 * ~15°. "Hơi gập" của người đứng thả lỏng là 10–18°.
 */
/**
 * `poleOut` THẤP (0,2–0,25), `poleBack` cao: khuỷu **áp sát eo**, chỉ hơi hé ra sau.
 *
 * Bản trước để 0,7–0,75 nên khuỷu chìa ra hai bên, nhìn như đang chống nạnh hụt — user chụp ảnh
 * chỉ đúng chỗ đó. Người đứng thả lỏng thì khuỷu gần như chạm sườn, phần hé ra là **ra sau** chứ
 * không phải ra ngang: xoay pole về sau thì cẳng tay vẫn xuôi mà khuỷu không cấn vào hông.
 */
export const NATURAL_REST: { readonly left: ArmRestSide; readonly right: ArmRestSide } = {
  left: { lateralFrac: 0.75, lateralM: 0.015, forwardM: 0.05, reach: 0.988, poleOut: 0.2, poleBack: 0.95, palmBack: 0.25, shoulderDrop: 0.035 },
  right: { lateralFrac: 0.85, lateralM: 0.02, forwardM: 0.065, reach: 0.992, poleOut: 0.25, poleBack: 0.92, palmBack: 0.45, shoulderDrop: 0.03 }
}

/**
 * Đích bàn tay trong khung model.
 *
 * Ngang/trước tính từ **khớp háng** (nên theo thân người, không hard-code toạ độ); độ cao thì
 * KHÔNG đặt trực tiếp — suy từ độ với: `|đích − vai| = reach · armLen`. Nhờ vậy khuỷu luôn mềm
 * đúng mức trên mọi model, dù vai cao thấp khác nhau; còn bàn tay rơi ở đâu trên đùi thì đo lại
 * sau (`handVsHip.up`).
 */
export function restTarget(sideX: number, shoulder: V3, hip: V3, spec: ArmRestSide, armLen: number): V3 {
  const x = hip.x + sideX * (Math.abs(hip.x) * spec.lateralFrac + spec.lateralM)
  const z = hip.z + spec.forwardM
  const r = spec.reach * armLen
  const dx = x - shoulder.x
  const dz = z - shoulder.z
  // Không bao giờ để trong căn âm: lệch ngang/trước lớn quá thì rút ngắn độ hạ, tay vẫn hướng xuống
  const dy = -Math.sqrt(Math.max(r * r - dx * dx - dz * dz, (0.3 * armLen) ** 2))
  return { x, y: shoulder.y + dy, z }
}

/** Pole khuỷu: ra ngoài, hơi xuống, ra sau — khuỷu người đứng thả lỏng chỉ về phía đó. */
export function poleFor(sideX: number, spec: ArmRestSide): V3 {
  return normalize3({ x: sideX * spec.poleOut, y: -0.15, z: -spec.poleBack })
}

/** Hướng lòng bàn tay mong muốn: vào thân (−sideX), pha thêm ra sau. */
export function palmDirFor(sideX: number, spec: ArmRestSide): V3 {
  return normalize3({ x: -sideX, y: 0, z: -spec.palmBack })
}

/**
 * Ngón tay cong nhẹ (rad) theo từng khớp, từ gốc ra đầu ngón.
 *
 * Tăng dần trỏ < giữa < nhẫn < út — bàn tay thả lỏng thật là vậy (§9); đầu ngón vì thế không
 * thẳng hàng. Ngón cái cong ít. KHÔNG nắm, KHÔNG xoè.
 */
export const FINGER_CURL: Readonly<Record<'thumb' | 'index' | 'middle' | 'ring' | 'little', readonly [number, number, number]>> = {
  thumb: [0.05, 0.12, 0.16],
  index: [0.16, 0.24, 0.18],
  middle: [0.18, 0.28, 0.2],
  ring: [0.26, 0.36, 0.26],
  little: [0.32, 0.42, 0.3]
}

/** Tay phải cong ít hơn tay trái một chút — lệch nhỏ, cố định, không ngẫu nhiên. */
export const FINGER_CURL_RIGHT_SCALE = 0.92

/** Tên ba khớp của mỗi ngón trong humanoid VRM (ngón cái dùng Metacarpal thay Intermediate). */
export const FINGER_JOINTS: Readonly<Record<keyof typeof FINGER_CURL, readonly [string, string, string]>> = {
  thumb: ['ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal'],
  index: ['IndexProximal', 'IndexIntermediate', 'IndexDistal'],
  middle: ['MiddleProximal', 'MiddleIntermediate', 'MiddleDistal'],
  ring: ['RingProximal', 'RingIntermediate', 'RingDistal'],
  little: ['LittleProximal', 'LittleIntermediate', 'LittleDistal']
}

/**
 * Dồn trọng tâm kéo theo tay (§11): chân trụ bên nào thì vai bên đó hạ, bàn tay bên đó sát thân
 * hơn, bên kia ngược lại. Biên độ nhỏ — đây là hệ quả, không phải cử chỉ.
 */
export const WEIGHT_SHIFT_ARM = {
  /** Bàn tay dịch ngang (m) theo `shift` ∈ [−1,1]. */
  lateralM: 0.01,
  /** Vai hạ thêm (rad) theo `shift`. */
  shoulderRad: 0.008
}

/** Vi chuyển động khi giữ tư thế (§16): nhúc nhích đích bàn tay vài mm, chu kỳ dài. */
export const MICRO_ARM = {
  lateralM: 0.006,
  forwardM: 0.005,
  reach: 0.004,
  palmRad: 0.03,
  fingerRad: 0.03
}

/**
 * ==== Khuỷu tay SỐNG ====
 *
 * Bản trước pole khuỷu là **hằng số** (`poleOut`/`poleBack` cố định), nên dù bàn tay có nhúc nhích
 * vài mm thì khuỷu vẫn nằm đúng một chỗ suốt — user nhìn ra ngay: "tay vẫn bị đơ ở cùi chỏ". Tay
 * Live2D mà user gửi làm chuẩn thì khuỷu **trôi** liên tục: cẳng tay xoay quanh trục vai→cổ tay
 * chứ không chỉ gập duỗi.
 *
 * Ở đây pole được quay quanh trục vai→đích theo hai sóng chậm lệch pha, cộng thêm chút đổi độ gập.
 * Quay pole KHÔNG dời bàn tay (đích IK giữ nguyên) — đúng bậc tự do thứ ba mà khớp vai có thật.
 */
export const ELBOW_DRIFT = {
  /** Biên độ quay pole quanh trục vai→tay (rad). ~11° — thấy rõ mà không thành múa. */
  swingRad: 0.2,
  /** Hai tần số không chia hết cho nhau (rad/s) → nhịp không lặp lại thấy rõ. */
  freqA: 0.21,
  freqB: 0.34,
  /** Đổi độ với kèm theo: khuỷu gập/duỗi vài độ cùng nhịp, vì người thật không giữ y một góc. */
  reachAmp: 0.006
}

/**
 * Góc quay pole khuỷu tại thời điểm `s` (giây). `phase` tách hai tay ra khỏi nhau (§10: không
 * bao giờ đối xứng tuyệt đối).
 */
export function elbowDrift(s: number, phase: number): number {
  return (
    (Math.sin(s * ELBOW_DRIFT.freqA + phase) * 0.65 + Math.sin(s * ELBOW_DRIFT.freqB + phase * 1.7) * 0.35) *
    ELBOW_DRIFT.swingRad
  )
}

/** Đổi độ với đi kèm khuỷu trôi — cùng nhịp nên hai thứ là MỘT chuyển động, không phải hai. */
export function elbowDriftReach(s: number, phase: number): number {
  return Math.sin(s * ELBOW_DRIFT.freqB + phase * 1.7) * ELBOW_DRIFT.reachAmp
}

/**
 * ==== Tay đưa theo hướng NHÌN ====
 *
 * Người quay đầu nhìn sang một bên thì cả thân trên hơi vặn theo, và hai tay đi theo thân: tay
 * bên phía nhìn lùi ra sau, tay bên kia đưa ra trước. Không có bước này thì đầu quay mà hai tay
 * đứng nguyên — đúng cảm giác "đầu rời khỏi thân" user tả.
 *
 * Trả về độ dịch đích bàn tay (m) trong khung model theo trục trước-sau. `yaw` là góc nhìn ngang
 * (rad, dương = nhìn sang trái model), `sideX` là dấu trục ngang của tay (trái +1).
 */
export const LOOK_ARM = {
  /** Bàn tay đưa trước/lùi sau bao nhiêu mét trên mỗi radian góc nhìn. */
  forwardPerRad: 0.055,
  /** Tay cùng bên hướng nhìn thì cũng SÁT thân thêm chút — vai bên đó xoay ra sau. */
  lateralPerRad: 0.022,
  /** Pole khuỷu cũng đổi theo: tay đưa ra trước thì khuỷu hơi mở ra ngoài. */
  polePerRad: 0.35
}

export function lookArmOffset(yaw: number, sideX: number): { forwardM: number; lateralM: number } {
  // sideX = +1 (trái). yaw > 0 = nhìn sang trái → thân vặn trái → tay TRÁI lùi, tay PHẢI đưa tới
  return {
    forwardM: -yaw * sideX * LOOK_ARM.forwardPerRad,
    lateralM: -Math.abs(yaw) * (yaw * sideX > 0 ? 1 : -1) * LOOK_ARM.lateralPerRad
  }
}

/**
 * ==== Kéo nhân vật: đàn hồi rồi bật về ====
 *
 * Kéo chuột trần (không Ctrl) không còn dời cửa sổ nữa mà **tác động vào nhân vật**: thân nghiêng
 * theo hướng kéo như bị níu áo, thả tay thì bật về chỗ cũ. Cùng họ mô phỏng với `stepArmSwing` —
 * lò xo giảm chấn — nhưng ở đây lực vào là **độ lệch con trỏ**, không phải vận tốc góc.
 *
 * Đầu ra là radian nghiêng thân, không phải mét: kéo mạnh tới đâu thân cũng chỉ ngả được chừng
 * ấy, không có cách nào kéo nhân vật ra khỏi khung hình.
 */
export interface TugState {
  /** Độ nghiêng hiện tại (rad): x = ngả trước/sau, z = ngả trái/phải. */
  x: number
  z: number
  vx: number
  vz: number
}

export const TUG = {
  /** Kéo 1 phần bề rộng khung = bao nhiêu radian nghiêng (trước khi kẹp). */
  radPerFrac: 0.55,
  /** Trần độ nghiêng (rad) ~17° — quá số này là ngã, không phải bị níu. */
  maxRad: 0.3,
  /** Lò xo về 0. ω₀ = √k ≈ 6 rad/s. */
  stiffness: 36,
  /** Giảm chấn: ζ ≈ 0,42 — bật về có nảy MỘT nhịp nhẹ, đúng kiểu buông tay áo. */
  damping: 5,
  /** Lúc đang giữ thì bám theo chuột nhanh hơn nhiều (1/s) — cảm giác dính tay. */
  followSpeed: 14,
  maxDt: 0.05
}

export function newTug(): TugState {
  return { x: 0, z: 0, vx: 0, vz: 0 }
}

/**
 * Một bước mô phỏng kéo.
 *
 * @param target `null` = đã thả tay (lò xo kéo về 0); có giá trị = độ lệch con trỏ theo TỈ LỆ
 *               bề rộng/cao khung (dương x = kéo sang phải màn hình, dương y = kéo xuống).
 */
export function stepTug(st: TugState, target: { x: number; y: number } | null, dt: number): void {
  const h = Math.min(Math.max(dt, 0), TUG.maxDt)
  if (h === 0) return
  if (target) {
    // Kéo sang phải màn hình → thân ngả sang phải = quay quanh trục Z âm dần; kéo xuống → ngả ra trước
    const tz = clamp(-target.x * TUG.radPerFrac, -TUG.maxRad, TUG.maxRad)
    const tx = clamp(target.y * TUG.radPerFrac, -TUG.maxRad, TUG.maxRad)
    const k = 1 - Math.exp(-TUG.followSpeed * h)
    // Ghi lại vận tốc thật để lúc buông tay lò xo còn có đà — buông giữa lúc đang giật thì nảy mạnh hơn
    st.vx = ((tx - st.x) * k) / h
    st.vz = ((tz - st.z) * k) / h
    st.x += (tx - st.x) * k
    st.z += (tz - st.z) * k
    return
  }
  const ax = -TUG.stiffness * st.x - TUG.damping * st.vx
  const az = -TUG.stiffness * st.z - TUG.damping * st.vz
  st.vx += ax * h
  st.vz += az * h
  st.x += st.vx * h
  st.z += st.vz * h
}

/**
 * ==== Tay đu theo quán tính khi THÂN xoay ====
 *
 * Shift+kéo và vòng tự xoay chỉ xoay `scene`. Tóc, váy có SpringBone nên bay theo; còn tay do IK
 * ghim vào đích tương đối thân nên đứng im như tượng giữa lúc mọi thứ khác đang bay — nhìn là
 * biết tay bị "gắn" vào người. Ở đây mô phỏng **con lắc tắt dần**: bàn tay có khối lượng, bị kéo
 * ngược chiều vận tốc tiếp tuyến của điểm treo, rồi lò xo kéo về, lố nhẹ một nhịp. Đầu ra là độ
 * lệch ĐÍCH bàn tay (m, khung model); IK giải lại nên tay văng theo mặt cầu quanh vai như tay
 * thật, không duỗi khớp.
 */
export interface ArmSwingState {
  /** Lệch đích (m), khung model. */
  x: number
  z: number
  /** Vận tốc của độ lệch (m/s). */
  vx: number
  vz: number
}

export const ARM_SWING = {
  /** Kéo ngược theo vận tốc tiếp tuyến: 1 m/s ở điểm treo → bấy nhiêu m/s² lên bàn tay. */
  drag: 5.5,
  /** Lò xo (1/s²): ω₀ = √k ≈ 6,3 rad/s → chu kỳ ~1 s, đúng nhịp một cánh tay buông thõng. */
  stiffness: 40,
  /** Giảm chấn (1/s): ζ ≈ 0,55 — lố MỘT nhịp nhỏ rồi yên; rung nhiều lần là lò xo, không phải tay. */
  damping: 7,
  /** Biên tối đa (m): kéo giật cỡ nào cũng không văng tay xuyên người hay thẳng đơ. */
  maxM: 0.06,
  /** Kẹp trên cho `dt`: tab ẩn rồi hiện lại có dt hàng giây, Euler sẽ nổ. */
  maxDt: 0.05
}

export function newArmSwing(): ArmSwingState {
  return { x: 0, z: 0, vx: 0, vz: 0 }
}

/**
 * Một bước mô phỏng — ghi thẳng vào `st` (vòng vẽ không cấp phát).
 *
 * @param x,z   vị trí bàn tay trong khung model, gốc nằm trên trục xoay
 * @param omega tốc độ góc của thân quanh +Y (rad/s)
 */
export function stepArmSwing(st: ArmSwingState, x: number, z: number, omega: number, dt: number): void {
  const h = Math.min(Math.max(dt, 0), ARM_SWING.maxDt)
  if (h === 0) return
  // Vận tốc tiếp tuyến của điểm treo: v = ω × r, với ω = (0, ω, 0) và r = (x, 0, z)
  const vx = omega * z
  const vz = -omega * x
  // Euler bán ẩn (cập nhật vận tốc trước rồi mới vị trí): ổn định khi ω₀·h < 2, ở đây tối đa 0,32
  const ax = -ARM_SWING.drag * vx - ARM_SWING.stiffness * st.x - ARM_SWING.damping * st.vx
  const az = -ARM_SWING.drag * vz - ARM_SWING.stiffness * st.z - ARM_SWING.damping * st.vz
  st.vx += ax * h
  st.vz += az * h
  st.x += st.vx * h
  st.z += st.vz * h
  const m = Math.hypot(st.x, st.z)
  if (m > ARM_SWING.maxM) {
    const k = ARM_SWING.maxM / m
    st.x *= k
    st.z *= k
    st.vx *= k
    st.vz *= k
  }
}
