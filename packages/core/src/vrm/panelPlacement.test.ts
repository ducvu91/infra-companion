import { describe, expect, it } from 'vitest'
import { placeVrmPanel } from '@infra/shared'

/**
 * Bảng cài đặt nổi cạnh nhân vật phải LUÔN nằm trọn trong màn hình.
 *
 * Lỗi thật đã gặp: nhân vật đứng sát đáy, bảng mở xuống dưới nên nửa dưới lọt ra ngoài và mất hẳn
 * các nút ở đó — user chụp được. Loại lỗi này chỉ lộ ở đúng độ phân giải và đúng vị trí, nên chặn
 * bằng test thay vì nhìn một lần rồi tin.
 */
const fits = (anchorTop: number, h: number): boolean => {
  const p = placeVrmPanel(anchorTop, h)
  return p.top >= 0 && p.top + p.maxHeight <= h
}

describe('chỗ đặt bảng cài đặt nhân vật', () => {
  it('nhân vật sát ĐÁY màn hình — ca user gặp: bảng mở LÊN, không tràn', () => {
    const p = placeVrmPanel(1040, 1080)
    expect(p.openDown).toBe(false)
    expect(p.top).toBeGreaterThanOrEqual(0)
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(1080)
  })

  it('nhân vật sát ĐỈNH: mở xuống', () => {
    expect(placeVrmPanel(20, 1080).openDown).toBe(true)
  })

  it('không tràn ở MỌI vị trí trên nhiều cỡ màn hình', () => {
    for (const h of [600, 720, 768, 900, 1080, 1440, 2160]) {
      for (let y = 0; y <= h; y += 20) {
        expect(fits(y, h), `anchorTop=${y} viewport=${h}`).toBe(true)
      }
    }
  })

  it('luôn còn chiều cao dùng được, kể cả màn hình rất thấp', () => {
    // Dưới ngưỡng này thì bảng thành một khe không đọc được gì
    for (const h of [480, 600, 768]) {
      expect(placeVrmPanel(h - 10, h).maxHeight).toBeGreaterThanOrEqual(160)
    }
  })

  it('chọn bên RỘNG hơn khi cả hai đều chật', () => {
    // Nhân vật hơi dưới giữa màn hình thấp → phía trên rộng hơn
    const p = placeVrmPanel(500, 700)
    expect(p.openDown).toBe(false)
  })

  it('giá trị luôn là số hữu hạn, không NaN', () => {
    for (const [y, h] of [
      [0, 0],
      [100, 0],
      [0, 100]
    ]) {
      const p = placeVrmPanel(y!, h!)
      expect(Number.isFinite(p.top) && Number.isFinite(p.maxHeight)).toBe(true)
    }
  })
})
