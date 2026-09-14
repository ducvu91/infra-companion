import { describe, expect, it } from 'vitest'
import {
  appendTurn,
  buildContext,
  clampAnswer,
  matchOpenIntent,
  openedLine,
  OPENED_LINES,
  HINT_EVERY_MAX_MS,
  HINT_EVERY_MIN_MS,
  hintDelayMs,
  pickHint,
  VRM_HINTS,
  VRM_CHAT_MAX_TURNS,
  type VrmChatTurn
} from '@infra/shared'

const turn = (i: number): VrmChatTurn => ({ role: i % 2 === 0 ? 'user' : 'assistant', text: `t${i}` })

describe('lịch sử hội thoại', () => {
  it('giữ đúng số lượt tối đa, bỏ lượt CŨ nhất', () => {
    // Bong bóng nổi trên đầu nhân vật — dài quá là che mất chính nhân vật
    let h: VrmChatTurn[] = []
    for (let i = 0; i < VRM_CHAT_MAX_TURNS + 4; i++) h = appendTurn(h, turn(i))
    expect(h).toHaveLength(VRM_CHAT_MAX_TURNS)
    expect(h[h.length - 1]!.text).toBe(`t${VRM_CHAT_MAX_TURNS + 3}`)
    expect(h[0]!.text).toBe('t4')
  })

  it('không sửa mảng gốc', () => {
    const h: VrmChatTurn[] = [turn(0)]
    appendTurn(h, turn(1))
    expect(h).toHaveLength(1)
  })
})

describe('ngữ cảnh gửi kèm', () => {
  it('hội thoại trống thì KHÔNG gửi ngữ cảnh', () => {
    // `undefined` chứ không phải chuỗi rỗng: `ai.ask` nhận context tuỳ chọn
    expect(buildContext([])).toBeUndefined()
  })

  it('chỉ lấy vài lượt gần nhất', () => {
    const h = [turn(0), turn(1), turn(2), turn(3), turn(4), turn(5)]
    const ctx = buildContext(h, 2)!
    expect(ctx).toContain('t4')
    expect(ctx).toContain('t5')
    expect(ctx).not.toContain('t0')
  })

  it('ghi rõ ai nói câu nào', () => {
    expect(buildContext([{ role: 'user', text: 'hỏi' }])).toBe('User: hỏi')
    expect(buildContext([{ role: 'assistant', text: 'đáp' }])).toBe('Assistant: đáp')
  })
})

describe('nhận lệnh mở tính năng', () => {
  it('có động từ mở + tên tính năng thì khớp', () => {
    expect(matchOpenIntent('mở tunnel giúp tôi')).toBe('tunnels')
    expect(matchOpenIntent('open monitoring')).toBe('monitor')
    expect(matchOpenIntent('cho xem log')).toBe('log-tail')
    expect(matchOpenIntent('bật cài đặt')).toBe('settings')
  })

  it('chữ CÓ DẤU tiếng Việt phải khớp', () => {
    // `\b` của JS chỉ biết ASCII nên `\bmở\b` KHÔNG BAO GIỜ khớp — mọi câu có dấu lặng lẽ bị bỏ
    // qua mà không lỗi nào báo. Đã dính thật; giữ test này để không tái phát.
    expect(matchOpenIntent('mở tunnel')).toBe('tunnels')
    expect(matchOpenIntent('mở chẩn đoán')).toBe('ai-diagnose')
    expect(matchOpenIntent('xem thông báo')).toBe('notifications')
  })

  it('cụm DÀI thắng cụm ngắn nằm trong nó', () => {
    // "lịch sử lệnh" chứa "lịch" (→ jobs); sai thứ tự là mở nhầm panel
    expect(matchOpenIntent('mở lịch sử lệnh')).toBe('cmd-history')
    expect(matchOpenIntent('mở lịch chạy')).toBe('jobs')
  })

  it('gõ KHÔNG DẤU vẫn khớp', () => {
    // Gõ không dấu là chuyện thường khi đang vội — bắt gõ đủ dấu mới chạy là tính năng chết một nửa
    expect(matchOpenIntent('mo tunnel')).toBe('tunnels')
    expect(matchOpenIntent('mo cai dat')).toBe('settings')
  })

  it('CÂU HỎI về tính năng thì KHÔNG mở', () => {
    // Thiếu ràng buộc động từ thì "tunnel bị lỗi thì sửa sao" biến thành lệnh mở tunnel, và câu
    // hỏi thật không bao giờ tới được AI
    expect(matchOpenIntent('tunnel bị lỗi thì sửa sao')).toBeNull()
    expect(matchOpenIntent('làm sao để tunnel chạy lại')).toBeNull()
    expect(matchOpenIntent('monitoring báo CPU cao')).toBeNull()
  })

  it('có động từ mở nhưng không có tính năng nào thì bỏ qua', () => {
    expect(matchOpenIntent('mở file /etc/passwd ra xem')).not.toBeNull() // 'file' → sftp, đúng ý
    expect(matchOpenIntent('mở cửa sổ mới')).toBeNull()
  })

  it('câu rỗng không làm hàm vỡ', () => {
    expect(matchOpenIntent('')).toBeNull()
  })
})

describe('câu nhân vật nói khi mở tính năng', () => {
  it('luôn chèn tên tính năng vào câu', () => {
    for (let i = 0; i < OPENED_LINES.length; i++) {
      const line = openedLine('Tunnels', () => i / OPENED_LINES.length)
      expect(line).toContain('Tunnels')
      expect(line).not.toContain('{name}')
    }
  })

  it('rng chạm biên 1 vẫn ra câu hợp lệ', () => {
    // `Math.floor(1 * n)` = n → lọt chỉ số; phải kẹp lại chứ không trả undefined
    expect(openedLine('Tunnels', () => 1)).toContain('Tunnels')
  })
})

describe('cắt câu trả lời dài', () => {
  it('ngắn thì giữ nguyên, không báo cắt', () => {
    expect(clampAnswer('ngắn')).toEqual({ text: 'ngắn', truncated: false })
  })

  it('dài thì cắt và BÁO là đã cắt', () => {
    // Im lặng giấu mất nửa câu trả lời là kiểu hỏng user không bao giờ đoán ra
    const r = clampAnswer('x'.repeat(1000), 100)
    expect(r.truncated).toBe(true)
    expect(r.text.length).toBeLessThanOrEqual(100)
  })

  it('cắt ở ranh giới dòng khi có dòng đủ gần cuối', () => {
    const src = `${'a'.repeat(60)}\n${'b'.repeat(200)}`
    const r = clampAnswer(src, 100)
    expect(r.text).toBe('a'.repeat(60))
    expect(r.truncated).toBe(true)
  })

  it('dòng nằm quá sớm thì cắt thẳng, không bỏ gần hết nội dung', () => {
    const src = `ab\n${'c'.repeat(300)}`
    const r = clampAnswer(src, 100)
    expect(r.text.length).toBe(100)
  })
})

describe('gợi ý thao tác lúc rảnh', () => {
  const fixed = (v: number) => (): number => v

  it('mỗi gợi ý một id, có chữ, và id trùng tên thao tác đánh dấu được', () => {
    expect(new Set(VRM_HINTS.map((h) => h.id)).size).toBe(VRM_HINTS.length)
    for (const h of VRM_HINTS) expect(h.text.length).toBeGreaterThan(10)
  })

  it('không gợi thao tác user ĐÃ làm', () => {
    const done = ['hold', 'menu']
    for (const r of [0, 0.5, 0.99]) {
      const h = pickHint(done, null, fixed(r))
      expect(h).not.toBeNull()
      expect(done).not.toContain(h!.id)
    }
  })

  it('không nói lại cái vừa nói khi còn cái khác', () => {
    for (const r of [0, 0.5, 0.99]) expect(pickHint([], 'hold', fixed(r))!.id).not.toBe('hold')
  })

  it('chỉ còn một cái chưa làm thì vẫn nói cái đó dù vừa nói', () => {
    const done = VRM_HINTS.map((h) => h.id).filter((id) => id !== 'zoom')
    expect(pickHint(done, 'zoom', fixed(0.3))!.id).toBe('zoom')
  })

  it('làm hết rồi thì IM — trả null, không lải nhải', () => {
    expect(pickHint(VRM_HINTS.map((h) => h.id), null, fixed(0.5))).toBeNull()
  })

  it('rng chạm biên 1 vẫn ra gợi ý hợp lệ', () => {
    expect(pickHint([], null, fixed(1))).toBeDefined()
  })

  it('giữa hai gợi ý cách 3–6 phút', () => {
    expect(hintDelayMs(fixed(0))).toBe(HINT_EVERY_MIN_MS)
    expect(hintDelayMs(fixed(1))).toBe(HINT_EVERY_MAX_MS)
    expect(HINT_EVERY_MIN_MS).toBeGreaterThanOrEqual(120_000)
  })
})
