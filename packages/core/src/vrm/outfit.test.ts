import { describe, expect, it } from 'vitest'
import { cleanPartName, hasCustomisableParts, matchesOutfit, usableParts, visibilityFor } from '@infra/shared'

/**
 * Tên trong các test này lấy từ **model thật** của user (đọc chunk JSON của file `.vrm`), không
 * phải bịa: đó là lý do biết được VRM không hề mang thông tin "bộ trang phục".
 */
const CTG = ['Body.baked', 'Dress.baked', 'Sleeve.baked', 'Socks.baked', 'Ribbon.baked', 'HandGloves.baked']
const CARLOTTA = ['U_Char_0.baked.baked', 'U_Char_1.baked.baked', 'U_Char_2.baked.baked']
const AOSTYLISH = ['Body (merged).baked']

describe('dọn tên mesh', () => {
  it('bỏ đuôi do công cụ xuất thêm vào', () => {
    expect(cleanPartName('Dress.baked')).toBe('Dress')
    expect(cleanPartName('U_Char_0.baked.baked')).toBe('U_Char_0')
    expect(cleanPartName('Body (merged).baked')).toBe('Body')
  })

  it('giữ nguyên tên tác giả đặt tử tế', () => {
    expect(cleanPartName('HandGloves')).toBe('HandGloves')
  })
})

describe('model nào tuỳ chỉnh được', () => {
  it('model có nhiều món rời thì tuỳ chỉnh được', () => {
    expect(hasCustomisableParts(CTG)).toBe(true)
  })

  it('tên máy sinh không tính là món', () => {
    // `U_Char_0/1/2` hiện ra chỉ làm user bấm thử rồi không hiểu vì sao chẳng đổi gì
    expect(hasCustomisableParts(CARLOTTA)).toBe(false)
  })

  it('model gộp hết vào một mesh thì không tách được', () => {
    expect(hasCustomisableParts(AOSTYLISH)).toBe(false)
  })

  it('model trống không làm hàm vỡ', () => {
    expect(hasCustomisableParts([])).toBe(false)
  })
})

describe('lọc món để hiện', () => {
  it('trả nhãn đã dọn và bỏ tên vô nghĩa', () => {
    const got = usableParts(CARLOTTA.map((name) => ({ name, visible: true })))
    expect(got).toEqual([])
  })

  it('giữ đủ món của model tách được', () => {
    const got = usableParts(CTG.map((name) => ({ name, visible: true })))
    expect(got.map((p) => p.label)).toEqual(['Body', 'Dress', 'Sleeve', 'Socks', 'Ribbon', 'HandGloves'])
  })
})

describe('áp một bộ trang phục', () => {
  const outfit = { id: 'o1', name: 'Đi chơi', hidden: ['Sleeve.baked', 'Socks.baked'] }

  it('món trong danh sách thì tắt, còn lại BẬT hết', () => {
    // Bộ lưu danh sách món TẮT, nên mặc bộ B sau bộ A phải bật lại đồ của A — thiếu bước này
    // là còn sót món đang tắt từ bộ trước
    const vis = visibilityFor(outfit, CTG)
    expect(vis['Sleeve.baked']).toBe(false)
    expect(vis['Socks.baked']).toBe(false)
    expect(vis['Dress.baked']).toBe(true)
    expect(vis['Ribbon.baked']).toBe(true)
  })

  it('món mới xuất hiện thì mặc định HIỆN, không làm nhân vật trần trụi', () => {
    expect(visibilityFor(outfit, [...CTG, 'Hat.baked'])['Hat.baked']).toBe(true)
  })

  it('nhận ra bộ đang mặc', () => {
    const wearing = CTG.map((name) => ({ name, visible: !outfit.hidden.includes(name) }))
    expect(matchesOutfit(outfit, wearing)).toBe(true)

    wearing[0]!.visible = false
    expect(matchesOutfit(outfit, wearing)).toBe(false)
  })
})
