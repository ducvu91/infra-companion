import { describe, expect, it } from 'vitest'
import {
  ARM_SWING,
  ELBOW_DRIFT,
  elbowDrift,
  elbowDriftReach,
  lookArmOffset,
  newTug,
  stepTug,
  TUG,
  type TugState,
  FINGER_CURL,
  FINGER_CURL_RIGHT_SCALE,
  FINGER_JOINTS,
  len3,
  NATURAL_REST,
  newArmSwing,
  palmDirFor,
  poleFor,
  restTarget,
  solveTwoBoneIk,
  stepArmSwing,
  type ArmSwingState,
  type V3
} from '@infra/shared'

const dist = (a: V3, b: V3): number => len3({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z
const deg = (rad: number): number => (rad * 180) / Math.PI

describe('IK giải tích hai xương', () => {
  const S: V3 = { x: 0.12, y: 1.26, z: 0 }
  const A = 0.25
  const B = 0.24
  const poleOut: V3 = { x: 1, y: 0, z: -0.5 }

  it('giữ đúng chiều dài hai khúc — không kéo giãn/co xương', () => {
    const T: V3 = { x: 0.2, y: 0.82, z: 0.05 }
    const r = solveTwoBoneIk(S, T, A, B, poleOut)
    expect(dist(S, r.elbow)).toBeCloseTo(A, 6)
    expect(dist(r.elbow, r.end)).toBeCloseTo(B, 6)
  })

  it('đích trong tầm thì với ĐÚNG tới đích', () => {
    const T: V3 = { x: 0.2, y: 0.82, z: 0.05 }
    const r = solveTwoBoneIk(S, T, A, B, poleOut)
    expect(dist(r.end, T)).toBeLessThan(1e-9)
    expect(r.reachFrac).toBeLessThan(1)
  })

  it('đích ngoài tầm thì duỗi thẳng về phía đích, KHÔNG bung khớp', () => {
    const T: V3 = { x: 0.12, y: 0, z: 0 } // 1,26 m dưới vai, tay chỉ 0,49 m
    const r = solveTwoBoneIk(S, T, A, B, poleOut)
    expect(r.reachFrac).toBeLessThanOrEqual(0.9995)
    // Kẹp ở 99,95% với hai khúc KHÔNG bằng nhau (0,25/0,24) còn lại ~3,6° — "gần thẳng", không phải 0
    expect(deg(r.bendRad)).toBeLessThan(5)
    // Vẫn hướng về đích
    expect(r.end.y).toBeLessThan(S.y)
    expect(Math.abs(r.end.x - S.x)).toBeLessThan(1e-6)
  })

  it('với càng ít thì khuỷu gập càng nhiều', () => {
    const near = solveTwoBoneIk(S, { x: 0.12, y: S.y - 0.9 * (A + B), z: 0 }, A, B, poleOut)
    const far = solveTwoBoneIk(S, { x: 0.12, y: S.y - 0.98 * (A + B), z: 0 }, A, B, poleOut)
    expect(near.bendRad).toBeGreaterThan(far.bendRad)
    // 99% chiều dài tay (giá trị dùng thật) → khuỷu gập ~15°, đúng "hơi gập". Định lý cos: 95,5%
    // đã là 34° — đo được đúng vậy trên Carlotta, và đó là mức user gọi "cong rõ rệt"
    const rest = solveTwoBoneIk(S, { x: 0.12, y: S.y - 0.99 * (A + B), z: 0 }, A, B, poleOut)
    expect(deg(rest.bendRad)).toBeGreaterThan(8)
    expect(deg(rest.bendRad)).toBeLessThan(20)
    const tooBent = solveTwoBoneIk(S, { x: 0.12, y: S.y - 0.955 * (A + B), z: 0 }, A, B, poleOut)
    expect(deg(tooBent.bendRad)).toBeGreaterThan(30)
  })

  it('khuỷu lệch về phía pole, không lật ngược', () => {
    const T: V3 = { x: 0.12, y: S.y - 0.9 * (A + B), z: 0 }
    const r = solveTwoBoneIk(S, T, A, B, poleOut)
    const off: V3 = { x: r.elbow.x - S.x, y: 0, z: r.elbow.z - S.z }
    expect(dot(off, poleOut)).toBeGreaterThan(0)
    const flipped = solveTwoBoneIk(S, T, A, B, { x: -1, y: 0, z: 0.5 })
    expect(dot({ x: flipped.elbow.x - S.x, y: 0, z: flipped.elbow.z - S.z }, poleOut)).toBeLessThan(0)
  })

  it('pole trùng trục gốc→đích vẫn ra khuỷu hợp lệ (không NaN)', () => {
    const T: V3 = { x: 0.12, y: S.y - 0.9 * (A + B), z: 0 }
    const r = solveTwoBoneIk(S, T, A, B, { x: 0, y: -1, z: 0 })
    expect(Number.isFinite(r.elbow.x + r.elbow.y + r.elbow.z)).toBe(true)
    expect(dist(S, r.elbow)).toBeCloseTo(A, 6)
  })
})

describe('đích bàn tay tương đối thân người', () => {
  const S: V3 = { x: 0.12, y: 1.26, z: -0.03 }
  const H: V3 = { x: 0.09, y: 0.85, z: -0.01 }
  const armLen = 0.49

  it('nằm NGOÀI khớp háng và ra TRƯỚC, độ cao suy từ độ với', () => {
    const t = restTarget(1, S, H, NATURAL_REST.left, armLen)
    expect(Math.abs(t.x)).toBeGreaterThan(Math.abs(H.x))
    expect(t.z).toBeGreaterThan(H.z)
    expect(t.y).toBeLessThan(S.y)
    // |đích − vai| = reach · armLen — chính là thứ giữ khuỷu mềm đúng mức trên mọi model
    expect(dist(t, S)).toBeCloseTo(NATURAL_REST.left.reach * armLen, 6)
  })

  it('đối xứng gương theo dấu bên: tay phải ra −x', () => {
    const l = restTarget(1, S, H, NATURAL_REST.left, armLen)
    const r = restTarget(-1, { ...S, x: -S.x }, { ...H, x: -H.x }, NATURAL_REST.left, armLen)
    expect(r.x).toBeCloseTo(-l.x, 9)
    expect(r.y).toBeCloseTo(l.y, 9)
  })

  it('lệch ngang/trước quá lớn không làm căn âm — tay vẫn hướng xuống', () => {
    const wild = { ...NATURAL_REST.left, lateralM: 1, forwardM: 1 }
    const t = restTarget(1, S, H, wild, armLen)
    expect(Number.isFinite(t.y)).toBe(true)
    expect(t.y).toBeLessThan(S.y)
  })

  it('pole khuỷu ra ngoài + ra sau, lòng bàn tay vào thân + hơi ra sau', () => {
    const p = poleFor(1, NATURAL_REST.left)
    expect(p.x).toBeGreaterThan(0)
    expect(p.z).toBeLessThan(0)
    expect(len3(p)).toBeCloseTo(1, 9)
    const palm = palmDirFor(1, NATURAL_REST.right)
    expect(palm.x).toBeLessThan(0)
    expect(palm.z).toBeLessThan(0)
  })
})

describe('đặc tả tư thế nghỉ', () => {
  it('với 98–99,5% chiều dài tay — khuỷu mềm (~12–18°), không khoá thẳng, không gập rõ', () => {
    // Dưới 0,98 là khuỷu gập > 25° (đo được: 0,955 → 34°, user gọi "cong rõ rệt");
    // 0,9995 là ngưỡng kẹp của solver = khoá thẳng đơ
    for (const s of [NATURAL_REST.left, NATURAL_REST.right]) {
      expect(s.reach).toBeGreaterThanOrEqual(0.98)
      expect(s.reach).toBeLessThanOrEqual(0.995)
    }
  })

  it('hai tay lệch nhau — có, và nhỏ (§10)', () => {
    const L = NATURAL_REST.left
    const R = NATURAL_REST.right
    // Trái sát thân/thấp/mềm hơn; phải xa/cao hơn, lòng bàn tay ra sau hơn
    expect(L.lateralFrac).toBeLessThan(R.lateralFrac)
    expect(L.reach).toBeLessThan(R.reach)
    expect(L.palmBack).toBeLessThan(R.palmBack)
    expect(Math.abs(L.reach - R.reach)).toBeLessThan(0.03)
    expect(Math.abs(L.forwardM - R.forwardM)).toBeLessThan(0.03)
  })

  it('vai hạ rất nhẹ', () => {
    for (const s of [NATURAL_REST.left, NATURAL_REST.right]) {
      expect(deg(s.shoulderDrop)).toBeGreaterThan(0)
      expect(deg(s.shoulderDrop)).toBeLessThan(4)
    }
  })

  it('khuỷu ÁP SÁT EO: hé ra sau là chính, ra ngang thì rất ít', () => {
    // Bản đầu để poleOut 0,7–0,75 → khuỷu chìa ra hai bên như chống nạnh hụt (user chụp ảnh
    // chỉ ra). Người đứng thả lỏng thì khuỷu gần chạm sườn; phần hé ra phải là RA SAU.
    for (const s of [NATURAL_REST.left, NATURAL_REST.right]) {
      expect(s.poleOut).toBeLessThan(0.35)
      expect(s.poleBack).toBeGreaterThan(s.poleOut * 2)
    }
  })

  it('khuỷu vẫn hé ra NGOÀI chút, không quặp vào trong người', () => {
    // poleOut = 0 thì khuỷu ép thẳng vào sườn và xuyên qua thân khi model gầy
    for (const s of [NATURAL_REST.left, NATURAL_REST.right]) expect(s.poleOut).toBeGreaterThan(0.1)
  })
})

describe('ngón tay thả lỏng', () => {
  it('cong tăng dần trỏ < giữa < nhẫn < út ở mọi khớp', () => {
    for (let j = 0; j < 3; j++) {
      expect(FINGER_CURL.index[j]).toBeLessThan(FINGER_CURL.middle[j])
      expect(FINGER_CURL.middle[j]).toBeLessThan(FINGER_CURL.ring[j])
      expect(FINGER_CURL.ring[j]).toBeLessThan(FINGER_CURL.little[j])
    }
  })

  it('không nắm tay, không duỗi thẳng đơ', () => {
    for (const curls of Object.values(FINGER_CURL)) {
      for (const c of curls) {
        expect(c).toBeGreaterThan(0)
        expect(deg(c)).toBeLessThan(30)
      }
    }
  })

  it('tay phải cong ít hơn một chút, không quá khác', () => {
    expect(FINGER_CURL_RIGHT_SCALE).toBeLessThan(1)
    expect(FINGER_CURL_RIGHT_SCALE).toBeGreaterThan(0.85)
  })

  it('tên khớp đúng humanoid VRM — ngón cái dùng Metacarpal', () => {
    expect(FINGER_JOINTS.thumb[0]).toBe('ThumbMetacarpal')
    expect(FINGER_JOINTS.index).toEqual(['IndexProximal', 'IndexIntermediate', 'IndexDistal'])
  })
})

describe('tay đu theo quán tính khi xoay thân', () => {
  // Bàn tay trái đứng nghỉ: 12 cm ngoài trục, 5 cm về trước — đúng cỡ đích IK đo được
  const HAND = { x: 0.12, z: 0.05 }
  const run = (omega: number, seconds: number, st = newArmSwing(), x = HAND.x, z = HAND.z): ArmSwingState => {
    for (let i = 0; i < seconds * 60; i++) stepArmSwing(st, x, z, omega, 1 / 60)
    return st
  }
  const mag = (s: ArmSwingState): number => Math.hypot(s.x, s.z)

  it('thân không xoay thì tay không tự nhúc nhích', () => {
    expect(mag(run(0, 2))).toBe(0)
  })

  it('xoay đều thì tay lệch NGƯỢC chiều vận tốc tiếp tuyến — đủ thấy nhưng có giới hạn', () => {
    // ω > 0 quanh +Y đưa +X về −Z: tay trái (x>0) đang bị kéo về −Z nên phải lệch về +Z (đi sau)
    const st = run(3, 2)
    expect(st.z).toBeGreaterThan(0.01)
    expect(mag(st)).toBeGreaterThan(0.02)
    expect(mag(st)).toBeLessThanOrEqual(ARM_SWING.maxM + 1e-9)
  })

  it('hai tay đối xứng: bên phải lệch ngược dấu trục Z so với bên trái', () => {
    const l = run(3, 2)
    const r = run(3, 2, newArmSwing(), -HAND.x, HAND.z)
    expect(Math.sign(r.z)).toBe(-Math.sign(l.z))
  })

  it('dừng xoay thì tay về đúng chỗ cũ, không NaN', () => {
    const st = run(3, 1)
    run(0, 3, st)
    expect(Number.isFinite(st.x) && Number.isFinite(st.z)).toBe(true)
    expect(mag(st)).toBeLessThan(0.002)
  })

  it('lố nhẹ một hai nhịp rồi yên — con lắc, không phải lò xo rung', () => {
    // Chỉ đếm những lần đổi dấu còn THẤY được (> 0,5 mm): sóng tắt dần đổi dấu mãi ở cỡ micromet
    const st = run(3, 1)
    let flips = 0
    let last = Math.sign(st.z)
    for (let i = 0; i < 3 * 60; i++) {
      stepArmSwing(st, HAND.x, HAND.z, 0, 1 / 60)
      const s = Math.sign(st.z)
      if (Math.abs(st.z) > 0.0005 && s !== last) {
        flips++
        last = s
      }
    }
    expect(flips).toBeGreaterThanOrEqual(1)
    expect(flips).toBeLessThanOrEqual(3)
  })

  it('dt khổng lồ (tab ẩn rồi hiện lại) không làm nổ mô phỏng', () => {
    const st = newArmSwing()
    for (let i = 0; i < 20; i++) stepArmSwing(st, HAND.x, HAND.z, 6, 5)
    expect(Number.isFinite(mag(st))).toBe(true)
    expect(mag(st)).toBeLessThanOrEqual(ARM_SWING.maxM + 1e-9)
  })

  it('vòng tự xoay (8 s một vòng) chỉ làm tay lệch cỡ centimet — không bay như đang bị kéo', () => {
    const st = run((2 * Math.PI) / 8, 3)
    expect(mag(st)).toBeGreaterThan(0.003)
    expect(mag(st)).toBeLessThan(0.03)
  })
})

describe('khuỷu tay trôi (chống "đơ ở cùi chỏ")', () => {
  it('KHÔNG đứng yên: trong một phút phải quét qua một dải góc thấy được', () => {
    // Đây chính là lỗi user báo — pole hằng số thì mọi mẫu bằng nhau và dải = 0
    let lo = Infinity
    let hi = -Infinity
    for (let s = 0; s < 60; s += 0.25) {
      const v = elbowDrift(s, 0)
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
    }
    // Ít nhất 10° tổng biên độ — dưới mức đó nhìn vẫn như tượng
    expect(hi - lo).toBeGreaterThan(0.17)
  })

  it('không vượt biên đã đặt — khuỷu trôi chứ không múa', () => {
    for (let s = 0; s < 200; s += 0.1) {
      expect(Math.abs(elbowDrift(s, 0))).toBeLessThanOrEqual(ELBOW_DRIFT.swingRad + 1e-9)
    }
  })

  it('hai tay KHÁC pha — đối xứng tuyệt đối là dấu hiệu hình nộm', () => {
    let same = 0
    for (let s = 0; s < 40; s += 0.5) {
      if (Math.abs(elbowDrift(s, 0) - elbowDrift(s, 1.9)) < 0.01) same++
    }
    // Hai sóng lệch pha vẫn cắt nhau vài điểm, nhưng không thể trùng gần hết
    expect(same).toBeLessThan(10)
  })

  it('nhịp KHÔNG lặp lại trong chu kỳ ngắn — hai tần số không chia hết cho nhau', () => {
    expect(ELBOW_DRIFT.freqA / ELBOW_DRIFT.freqB).not.toBeCloseTo(Math.round(ELBOW_DRIFT.freqA / ELBOW_DRIFT.freqB), 3)
  })

  it('đổi độ với đi kèm rất nhỏ — vài mm, không kéo tay ra xa thân', () => {
    for (let s = 0; s < 60; s += 0.3) {
      expect(Math.abs(elbowDriftReach(s, 0))).toBeLessThanOrEqual(ELBOW_DRIFT.reachAmp + 1e-9)
    }
  })
})

describe('tay đưa theo hướng nhìn', () => {
  it('nhìn thẳng thì tay không dịch', () => {
    // `toBeCloseTo` chứ không `toBe`: nhân với 0 cho ra `-0`, mà `Object.is(-0, 0)` là false —
    // giá trị đúng nhưng test đỏ vì dấu của số không
    const o = lookArmOffset(0, 1)
    expect(o.forwardM).toBeCloseTo(0, 10)
    expect(o.lateralM).toBeCloseTo(0, 10)
  })

  it('quay đầu sang trái: tay TRÁI lùi sau, tay PHẢI đưa tới — thân vặn chứ không chỉ cổ', () => {
    const l = lookArmOffset(0.5, 1)
    const r = lookArmOffset(0.5, -1)
    expect(l.forwardM).toBeLessThan(0)
    expect(r.forwardM).toBeGreaterThan(0)
  })

  it('đổi bên nhìn thì đổi chiều — không phải cứ nhìn là tay đi một hướng', () => {
    expect(Math.sign(lookArmOffset(0.5, 1).forwardM)).toBe(-Math.sign(lookArmOffset(-0.5, 1).forwardM))
  })

  it('ở góc nhìn tối đa (0,55 rad) tay dịch cỡ centimet, không vung ra', () => {
    const o = lookArmOffset(0.55, 1)
    expect(Math.abs(o.forwardM)).toBeGreaterThan(0.01)
    expect(Math.abs(o.forwardM)).toBeLessThan(0.06)
  })
})

describe('kéo nhân vật rồi buông (đàn hồi)', () => {
  const hold = (st: TugState, target: { x: number; y: number }, seconds: number): TugState => {
    for (let i = 0; i < seconds * 60; i++) stepTug(st, target, 1 / 60)
    return st
  }
  const release = (st: TugState, seconds: number): TugState => {
    for (let i = 0; i < seconds * 60; i++) stepTug(st, null, 1 / 60)
    return st
  }

  it('kéo sang phải thì thân ngả sang phải, kéo xuống thì ngả ra trước', () => {
    const st = hold(newTug(), { x: 0.4, y: 0.3 }, 1)
    expect(st.z).toBeLessThan(0) // quanh Z âm = ngả sang phải màn hình
    expect(st.x).toBeGreaterThan(0)
  })

  it('kéo mạnh cỡ nào cũng không ngả quá trần — bị níu, không phải ngã', () => {
    const st = hold(newTug(), { x: 50, y: -50 }, 2)
    expect(Math.abs(st.z)).toBeLessThanOrEqual(TUG.maxRad + 1e-9)
    expect(Math.abs(st.x)).toBeLessThanOrEqual(TUG.maxRad + 1e-9)
  })

  it('BUÔNG TAY thì về đúng chỗ cũ — yêu cầu chính của tính năng', () => {
    const st = hold(newTug(), { x: 0.5, y: 0.4 }, 1)
    expect(Math.hypot(st.x, st.z)).toBeGreaterThan(0.05)
    release(st, 3)
    expect(Math.hypot(st.x, st.z)).toBeLessThan(0.002)
  })

  it('bật về có NẢY một nhịp rồi yên, không rung mãi', () => {
    const st = hold(newTug(), { x: 0.5, y: 0 }, 1)
    let flips = 0
    let last = Math.sign(st.z)
    for (let i = 0; i < 3 * 60; i++) {
      stepTug(st, null, 1 / 60)
      const s = Math.sign(st.z)
      if (Math.abs(st.z) > 0.002 && s !== last) {
        flips++
        last = s
      }
    }
    expect(flips).toBeGreaterThanOrEqual(1)
    expect(flips).toBeLessThanOrEqual(3)
  })

  it('dt khổng lồ không làm nổ mô phỏng', () => {
    const st = newTug()
    for (let i = 0; i < 20; i++) stepTug(st, { x: 3, y: 3 }, 5)
    for (let i = 0; i < 20; i++) stepTug(st, null, 5)
    expect(Number.isFinite(st.x) && Number.isFinite(st.z)).toBe(true)
  })

  it('không kéo, không buông gì thì đứng im tuyệt đối', () => {
    const st = newTug()
    release(st, 2)
    expect(st.x).toBe(0)
    expect(st.z).toBe(0)
  })
})
