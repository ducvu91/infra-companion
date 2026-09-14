import { describe, expect, it } from 'vitest'
// Hàm nằm ở `shared` chứ không phải `core` vì **renderer phải dùng được** (§5: renderer không
// import được `@infra/core`). Test thì đặt ở đây, nơi vitest thật sự quét tới.
import {
  armSignFor,
  expressionForEvent,
  frameDistance,
  VRM_ZOOM_MAX,
  VRM_ZOOM_MIN,
  zoomStep
} from '@infra/shared'

describe('frameDistance', () => {
  const base = { frameH: 1.6, bbW: 0.5, fovDeg: 30, aspect: 260 / 440 }

  it('đủ xa để chiều cao khung lọt trong FOV dọc', () => {
    const d = frameDistance(base)
    // Nửa chiều cao nhìn thấy được ở khoảng cách d phải >= nửa khung cần lọt
    const visibleHalfH = d * Math.tan((base.fovDeg * Math.PI) / 360)
    expect(visibleHalfH).toBeGreaterThanOrEqual(base.frameH / 2 - 1e-9)
  })

  it('đủ xa để bề ngang model lọt trong FOV ngang', () => {
    // Model rất rộng (váy xoè): ràng buộc ngang phải thắng, nếu không là cắt mất hai bên
    const wide = { ...base, bbW: 3 }
    const d = frameDistance(wide)
    const visibleHalfW = d * Math.tan((wide.fovDeg * Math.PI) / 360) * wide.aspect
    expect(visibleHalfW).toBeGreaterThanOrEqual(wide.bbW / 2 - 1e-9)
  })

  it('khung càng hẹp thì camera càng phải lùi xa', () => {
    // Đây là lý do phải tính lại mỗi lần resize: giữ nguyên khoảng cách khi panel hẹp lại
    // là cắt mất hai bên người
    const wide = frameDistance({ ...base, bbW: 3, aspect: 1.5 })
    const narrow = frameDistance({ ...base, bbW: 3, aspect: 0.4 })
    expect(narrow).toBeGreaterThan(wide)
  })

  it('model cao hơn thì camera lùi xa hơn', () => {
    expect(frameDistance({ ...base, frameH: 3 })).toBeGreaterThan(frameDistance(base))
  })
})

describe('armSignFor', () => {
  it('lật dấu cho VRM 0.x vì rotateVRM0 đã xoay hệ trục 180°', () => {
    expect(armSignFor('0')).toBe(-1)
  })

  it('giữ nguyên dấu cho VRM 1.0', () => {
    expect(armSignFor('1')).toBe(1)
  })
})

describe('zoomStep', () => {
  it('lăn lên (deltaY âm) là phóng to', () => {
    expect(zoomStep(1, -100)).toBeGreaterThan(1)
  })

  it('lăn xuống là thu nhỏ', () => {
    expect(zoomStep(1, 100)).toBeLessThan(1)
  })

  it('kẹp trong khoảng cho phép', () => {
    expect(zoomStep(VRM_ZOOM_MAX, -100)).toBe(VRM_ZOOM_MAX)
    expect(zoomStep(VRM_ZOOM_MIN, 100)).toBe(VRM_ZOOM_MIN)
  })

  it('mỗi nấc đổi cùng một TỈ LỆ, không phải cùng một lượng', () => {
    // Lý do dùng nhân thay vì cộng: cộng 0.1 ở mức 0.5 là nhảy 20%, ở mức 3 chỉ 3%
    const lo = zoomStep(0.8, -1) / 0.8
    const hi = zoomStep(2.4, -1) / 2.4
    expect(lo).toBeCloseTo(hi, 10)
  })

  it('phóng to rồi thu nhỏ thì về đúng chỗ cũ', () => {
    expect(zoomStep(zoomStep(1.5, -1), 1)).toBeCloseTo(1.5, 10)
  })
})

describe('expressionForEvent', () => {
  it('hết chuyện thì vui', () => {
    expect(expressionForEvent('recover', 'info')[0]).toBe('relaxed')
  })

  it('cảnh báo nặng khác cảnh báo nhẹ', () => {
    expect(expressionForEvent('alert', 'critical')[0]).toBe('surprised')
    expect(expressionForEvent('alert', 'warning')[0]).toBe('sad')
  })

  it('luôn kết thúc bằng neutral làm lưới an toàn', () => {
    // Model chỉ khai những biểu cảm tác giả muốn; setValue tên không có là no-op IM LẶNG,
    // nên danh sách phải luôn có một tên mà mọi model đều có
    for (const kind of ['alert', 'recover', 'info', 'marker']) {
      for (const sev of ['info', 'warning', 'critical']) {
        expect(expressionForEvent(kind, sev).at(-1)).toBe('neutral')
      }
    }
  })
})
