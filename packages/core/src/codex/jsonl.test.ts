import { describe, expect, it } from 'vitest'
import { splitJsonl } from './jsonl'

describe('splitJsonl', () => {
  it('tach nhieu frame trong mot chunk', () => {
    const r = splitJsonl('', '{"a":1}\n{"b":2}\n')
    expect(r.frames).toEqual([{ a: 1 }, { b: 2 }])
    expect(r.rest).toBe('')
    expect(r.dropped).toEqual([])
  })

  it('giu phan du khi chunk cat GIUA dong', () => {
    const a = splitJsonl('', '{"method":"turn/star')
    expect(a.frames).toEqual([])
    expect(a.rest).toBe('{"method":"turn/star')

    const b = splitJsonl(a.rest, 'ted","params":{}}\n')
    expect(b.frames).toEqual([{ method: 'turn/started', params: {} }])
    expect(b.rest).toBe('')
  })

  it('gop duoc dong bi cat thanh NHIEU chunk', () => {
    // Ca thật: một message dài (diff của patch) về qua 4 chunk.
    let rest = ''
    const pieces = ['{"id":1,', '"result":{"text":', '"xin chao"', '}}\n']
    const all: unknown[] = []
    for (const p of pieces) {
      const r = splitJsonl(rest, p)
      rest = r.rest
      all.push(...r.frames)
    }
    expect(all).toEqual([{ id: 1, result: { text: 'xin chao' } }])
    expect(rest).toBe('')
  })

  it('dong trang KHONG tinh la loi', () => {
    // app-server có phát dòng trắng; coi nó là lỗi thì log đầy warning vô nghĩa.
    const r = splitJsonl('', '\n{"a":1}\n\n  \n{"b":2}\n')
    expect(r.frames).toEqual([{ a: 1 }, { b: 2 }])
    expect(r.dropped).toEqual([])
  })

  it('dong JSON hong vao `dropped`, KHONG throw, va cac dong khac VAN parse', () => {
    // Đây là hợp đồng quan trọng nhất: một dòng rác không được giết cả phiên.
    const r = splitJsonl('', '{"ok":1}\nkhong-phai-json\n{"ok":2}\n')
    expect(r.frames).toEqual([{ ok: 1 }, { ok: 2 }])
    expect(r.dropped).toEqual(['khong-phai-json'])
  })

  it('cat bot dong hong that dai truoc khi tra ve de log', () => {
    const huge = 'x'.repeat(5000)
    const r = splitJsonl('', `${huge}\n`)
    expect(r.frames).toEqual([])
    expect(r.dropped).toHaveLength(1)
    expect(r.dropped[0]!.length).toBeLessThan(250)
    expect(r.dropped[0]!.endsWith('…')).toBe(true)
  })

  it('KHONG doi \\r nam trong noi dung JSON', () => {
    // Khác `splitLines` (chuẩn hoá CRLF cho log nginx): ở đây \r là dữ liệu thật của message —
    // agent đang thuật lại output có carriage return. Đổi nó là làm sai nội dung.
    const r = splitJsonl('', `${JSON.stringify({ text: 'dong1\r\ndong2' })}\n`)
    expect(r.frames).toEqual([{ text: 'dong1\r\ndong2' }])
  })

  it('bo qua \\r thua o cuoi dong (JSON.parse tu xu ly)', () => {
    const r = splitJsonl('', '{"a":1}\r\n')
    expect(r.frames).toEqual([{ a: 1 }])
    expect(r.dropped).toEqual([])
  })

  it('giu dung thu tu voi mot chunk chua rat nhieu frame', () => {
    const n = 500
    const chunk = Array.from({ length: n }, (_, i) => `{"i":${i}}`).join('\n') + '\n'
    const r = splitJsonl('', chunk)
    expect(r.frames).toHaveLength(n)
    expect(r.frames[0]).toEqual({ i: 0 })
    expect(r.frames[n - 1]).toEqual({ i: n - 1 })
  })

  it('giu nguyen tieng Viet khi chunk da la chuoi hop le', () => {
    // Chunk cắt giữa byte UTF-8 là việc của StringDecoder ở nơi gọi, không phải của hàm này.
    const r = splitJsonl('', `${JSON.stringify({ msg: 'Đã chạy xong lượt' })}\n`)
    expect(r.frames).toEqual([{ msg: 'Đã chạy xong lượt' }])
  })
})
