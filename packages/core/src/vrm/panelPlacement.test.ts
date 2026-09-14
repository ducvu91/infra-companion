import { describe, expect, it } from 'vitest'
import {
  characterSlotInSettings,
  placeVrmPanel,
  settingsFrameBox,
  VRM_WIDTH_MARGIN,
  VRM_ZOOM_MAX,
  VRM_ZOOM_MAX_IN_SETTINGS
} from '@infra/shared'

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

describe('khung cài đặt hai cột + chỗ đứng nhân vật', () => {
  const VW = 1920
  const VH = 1080

  it('khung nằm giữa màn hình và không tràn', () => {
    for (const [w, h] of [
      [1920, 1080],
      [1366, 768],
      [1280, 720],
      [1024, 600]
    ]) {
      const b = settingsFrameBox(w!, h!, 264)
      expect(b.left).toBeGreaterThanOrEqual(0)
      expect(b.top).toBeGreaterThanOrEqual(0)
      expect(b.left + b.width, `${w}×${h} tràn ngang`).toBeLessThanOrEqual(w!)
      expect(b.top + b.height, `${w}×${h} tràn dọc`).toBeLessThanOrEqual(h!)
    }
  })

  it('KHÔNG co theo bề ngang thẻ — thẻ rộng gấp VRM_WIDTH_MARGIN lần người, co theo nó là co người vô cớ', () => {
    // Ca thật: model đo ra tỉ lệ 2,2 → thẻ 677px ở cỡ 65%. Bản cũ co theo khe 352 → người còn
    // 150px, và kéo thanh cỡ KHÔNG đổi gì (chiều cao hiển thị = khe ÷ tỉ lệ, H triệt tiêu).
    // 1161 = thẻ rộng hơn cả khung 880: vẫn không co, phần tràn là lề trong suốt.
    for (const cw of [150, 264, 380, 450, 677, 1161]) {
      const b = settingsFrameBox(VW, VH, cw)
      expect(characterSlotInSettings(b, cw, 440).scale, `thẻ ${cw} bị co theo bề ngang`).toBe(1)
    }
  })

  it('chiều cao hiển thị ĐỔI theo cỡ, kể cả với thẻ rộng bất thường', () => {
    // Đúng triệu chứng user thấy: kéo thanh cỡ mà người vẫn y nguyên
    const at = (zoom: number): number => {
      const h = Math.round(440 * zoom)
      const w = Math.round(h * 2.2)
      return h * characterSlotInSettings(settingsFrameBox(VW, VH, w), w, h).scale
    }
    expect(at(1.2) - at(0.65)).toBeGreaterThan(100)
  })

  it('nhân vật đứng TRỌN trong lòng khung, thân người nằm trong KHE', () => {
    // Lỗi cũ: neo `bottom` theo màn hình nên nửa dưới nhân vật nằm ngoài khung (user chụp được)
    for (const [cw, ch] of [
      [264, 440],
      [380, 620],
      [200, 330],
      [475, 528]
    ]) {
      const b = settingsFrameBox(VW, VH, cw!)
      const s = characterSlotInSettings(b, cw!, ch!)
      /**
       * Hình SAU KHI co, với `transform-origin: bottom center`: đáy đứng yên ở `top + ch`, tâm
       * ngang đứng yên ở `left + cw/2`; đỉnh tụt xuống và hai mép co vào đúng phần mất đi. Tính
       * nhầm chỗ này bằng kích thước ĐÃ co làm nhân vật thò đáy 22px và lệch phải 62px — đo được
       * bằng ảnh render thật; `left`/`top` phải theo kích thước GỐC.
       */
      const bottom = s.top + ch!
      const top = bottom - ch! * s.scale
      const center = s.left + cw! / 2
      // Thân người nhìn thấy = thẻ ÷ VRM_WIDTH_MARGIN, ở giữa thẻ; phần còn lại là lề trong suốt
      const bodyW = (cw! / VRM_WIDTH_MARGIN) * s.scale
      const gapLeft = b.left + b.width / 2 - b.gap / 2
      expect(center - bodyW / 2, `${cw}×${ch} thân tràn khe trái`).toBeGreaterThanOrEqual(gapLeft - 1)
      expect(center + bodyW / 2, `${cw}×${ch} thân tràn khe phải`).toBeLessThanOrEqual(gapLeft + b.gap + 1)
      // Không đè lên hàng tiêu đề (có nút đóng)
      expect(top, `${cw}×${ch} đè tiêu đề`).toBeGreaterThanOrEqual(b.bodyTop)
      expect(bottom, `${cw}×${ch} thò đáy`).toBeLessThanOrEqual(b.top + b.height)
    }
  })

  it('tâm ngang nhân vật TRÙNG tâm khung, kể cả khi bị co', () => {
    // Ca harness ảnh thật: model bề ngang lớn → scale 0,74. Bản lỗi tính `left` theo bề ngang đã
    // co nên tâm lệch phải 62px, cột chữ phải đè lên người
    const b = settingsFrameBox(VW, VH, 475)
    const s = characterSlotInSettings(b, 475, 528)
    expect(s.scale).toBeLessThan(1)
    // transform-origin bottom center → tâm layout của thẻ gốc chính là tâm hình sau co.
    // Dung sai 1px: `left` làm tròn số nguyên (≤0,5) + bề ngang lẻ chia đôi (0,5)
    expect(Math.abs(s.left + 475 / 2 - (b.left + b.width / 2))).toBeLessThanOrEqual(1)
  })

  it('nhân vật cao quá thì THU NHỎ, không bị cắt', () => {
    const b = settingsFrameBox(VW, VH, 380)
    expect(characterSlotInSettings(b, 380, 620).scale).toBeLessThan(1)
    // Vừa khung thì giữ nguyên cỡ, đừng thu nhỏ vô cớ
    expect(characterSlotInSettings(b, 264, 440).scale).toBe(1)
  })

  it('giá trị luôn hữu hạn ở màn hình rất nhỏ', () => {
    const b = settingsFrameBox(400, 300, 264)
    const s = characterSlotInSettings(b, 264, 440)
    expect(Number.isFinite(s.left) && Number.isFinite(s.top) && Number.isFinite(s.scale)).toBe(true)
  })

  it('trần cỡ trong cài đặt THẤP hơn trần chung', () => {
    // Khe giữa hẹp; để trần 300% thì nhân vật phải thu còn 0,37× — thanh trượt nói 300% mà nhìn
    // như 110%, tức con số nói dối
    expect(VRM_ZOOM_MAX_IN_SETTINGS).toBeLessThan(VRM_ZOOM_MAX)
    expect(VRM_ZOOM_MAX_IN_SETTINGS).toBeGreaterThanOrEqual(1)
  })

  it('ở trần cỡ trong cài đặt, nhân vật gần như KHÔNG phải thu nhỏ', () => {
    // Thu nhẹ (≥0,9) thì con số trên thanh trượt còn gần đúng; thu sâu hơn là nói dối
    const h = Math.round(440 * VRM_ZOOM_MAX_IN_SETTINGS)
    const w = Math.round(h * 0.6)
    const s = characterSlotInSettings(settingsFrameBox(1920, 1080, w), w, h)
    expect(s.scale).toBeGreaterThanOrEqual(0.9)
  })
})
