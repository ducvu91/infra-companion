import { describe, expect, it } from 'vitest'
import {
  claims,
  damp,
  isClaimedByHigher,
  isDoubleBlink,
  LAYERS,
  nextActionAt,
  pickReaction,
  pulse,
  REACTIONS,
  smoothStep,
  statusForEvent
} from '@infra/shared'

/** `rng` cố định để kết quả không phụ thuộc may rủi. */
const fixed =
  (...vals: number[]) =>
  (): number =>
    vals.length > 1 ? vals.shift()! : vals[0]!

describe('quyền ghi xương giữa các tầng', () => {
  it('tầng CỘNG DỒN không giành xương của nhau', () => {
    // Đây là bài học đắt: cho `interaction`/`status`/`micro` giành `head` thì idle bỏ qua
    // TOÀN BỘ khối đầu — góc đang đuổi theo con trỏ (tới 0,55 rad) rơi về 0 trong một frame,
    // giật ~31°; còn `warning` thì đầu đơ suốt ~16 giây. Bộ cộng dồn đã đủ chặn xung đột.
    for (const l of ['micro', 'status', 'interaction'] as const) {
      expect(claims(l)).toEqual([])
      expect(isClaimedByHigher('head', 'idle', ['idle', l])).toBe(false)
      expect(isClaimedByHigher('arms', 'idle', ['idle', l])).toBe(false)
    }
  })

  it('tầng THAY THẾ thì giành thật — idle phải im', () => {
    // `critical` dành cho animation chiếm trọn tư thế; trộn cộng dồn vào đó mới là sai
    expect(isClaimedByHigher('head', 'idle', ['idle', 'critical'])).toBe(true)
    expect(isClaimedByHigher('spine', 'idle', ['idle', 'critical'])).toBe(true)
    // Nhóm `critical` không đụng tới thì idle vẫn chạy
    expect(isClaimedByHigher('hips', 'idle', ['idle', 'critical'])).toBe(false)
  })

  it('tầng cao không bị tầng thấp chặn', () => {
    expect(isClaimedByHigher('head', 'critical', ['idle', 'micro', 'critical'])).toBe(false)
  })

  it('một tầng không tự chặn chính nó', () => {
    expect(isClaimedByHigher('head', 'critical', ['critical'])).toBe(false)
  })

  it('mọi tầng đều có mặt trong bảng', () => {
    for (const l of LAYERS) expect(claims(l)).toBeDefined()
  })
})

describe('lịch hành động', () => {
  it('chớp mắt rơi trong khoảng 3–7 giây', () => {
    expect(nextActionAt('blink', 0, fixed(0))).toBe(3000)
    expect(nextActionAt('blink', 0, fixed(1))).toBe(7000)
    expect(nextActionAt('blink', 1000, fixed(0.5))).toBe(6000)
  })

  it('loại không có trong bảng vẫn ra khoảng hợp lệ, không NaN', () => {
    const v = nextActionAt('khong-co', 0, fixed(0.5))
    expect(Number.isFinite(v)).toBe(true)
    expect(v).toBeGreaterThan(0)
  })

  it('chớp đúp là hiếm, không phải mặc định', () => {
    expect(isDoubleBlink(fixed(0.01))).toBe(true)
    expect(isDoubleBlink(fixed(0.9))).toBe(false)
  })
})

describe('phản ứng khi bị chạm', () => {
  it('không bốc trúng kiểu vừa dùng', () => {
    // Click liên tiếp ra cùng một phản ứng thì hỏng hết cảm giác ngẫu nhiên
    for (const r of REACTIONS) {
      for (const p of [0, 0.4, 0.99]) {
        expect(pickReaction(fixed(p), r.id).id).not.toBe(r.id)
      }
    }
  })

  it('rng chạm biên 1 vẫn ra phản ứng hợp lệ', () => {
    // `Math.floor(1 * n)` = n → lọt chỉ số; phải kẹp lại chứ không trả undefined
    expect(pickReaction(fixed(1), null)).toBeDefined()
  })

  it('mọi phản ứng nằm trong 0,8–2 giây và kết thúc bằng biểu cảm dự phòng', () => {
    for (const r of REACTIONS) {
      expect(r.durationMs).toBeGreaterThanOrEqual(800)
      expect(r.durationMs).toBeLessThanOrEqual(2000)
      // `setValue` với tên model không khai là no-op IM LẶNG, nên danh sách phải có đường lui
      expect(r.expressions[r.expressions.length - 1]).toBe('neutral')
    }
  })

  it('biên độ giữ ở mức rất nhẹ', () => {
    // User đã phản hồi ba lần là phản ứng quá mạnh; chốt trần để lần sau không lỡ tay nới ra
    for (const r of REACTIONS) {
      expect(Math.abs(r.turn)).toBeLessThanOrEqual(0.15)
      expect(Math.abs(r.tilt)).toBeLessThanOrEqual(0.1)
      expect(Math.abs(r.nod)).toBeLessThanOrEqual(0.1)
    }
  })
})

describe('trạng thái theo sự kiện hệ thống', () => {
  it('cảnh báo nặng nhẹ ra trạng thái tương ứng', () => {
    expect(statusForEvent('alert', 'critical')).toBe('critical')
    expect(statusForEvent('alert', 'warning')).toBe('warning')
  })

  it('phục hồi thì về bình thường dù severity là gì', () => {
    expect(statusForEvent('recover', 'critical')).toBe('normal')
  })

  it('marker (user tự đánh dấu) không làm nhân vật lo lắng', () => {
    expect(statusForEvent('marker', 'info')).toBe('normal')
    expect(statusForEvent('info', 'warning')).toBe('normal')
  })
})

describe('đường cong chuyển động', () => {
  it('damp không phụ thuộc nhịp khung hình', () => {
    // Đây là bug thật đã sửa: `x += d * 0.12` mỗi frame chạy nhanh gấp đôi ở 60fps so với
    // 30fps. Hai bước 1/60s phải đuổi được xấp xỉ một bước 1/30s.
    const two = 1 - (1 - damp(7.7, 1 / 60)) ** 2
    expect(two).toBeCloseTo(damp(7.7, 1 / 30), 6)
  })

  it('damp kẹp dt âm về 0 thay vì bung ra số vô nghĩa', () => {
    expect(damp(7.7, -1)).toBe(0)
  })

  it('smoothStep phẳng ở hai đầu — không có điểm gãy', () => {
    expect(smoothStep(0)).toBe(0)
    expect(smoothStep(1)).toBe(1)
    expect(smoothStep(0.5)).toBeCloseTo(0.5, 6)
    // Đạo hàm ở hai đầu ≈ 0: đó là thứ phân biệt với nội suy tuyến tính
    expect(smoothStep(0.02)).toBeLessThan(0.02)
    expect(smoothStep(0.98)).toBeGreaterThan(0.98)
  })

  it('pulse đi rồi về đúng chỗ cũ', () => {
    // Cử chỉ một nhịp phải KẾT THÚC ở 0, nếu không nhân vật trôi dần khỏi tư thế nghỉ
    expect(pulse(0)).toBeCloseTo(0, 6)
    expect(pulse(1)).toBeCloseTo(0, 6)
    expect(pulse(0.5)).toBeCloseTo(1, 6)
  })

  it('pulse kẹp ngoài khoảng, không âm', () => {
    expect(pulse(1.4)).toBeCloseTo(0, 6)
    expect(pulse(-0.3)).toBeCloseTo(0, 6)
  })
})
