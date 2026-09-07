import { describe, expect, test } from 'vitest'
import {
  DEFAULT_VARIANT_ID,
  RUNBOOK_CATEGORIES,
  RUNBOOK_CATEGORY_ICON,
  RUNBOOK_LIBRARY,
  extractVars,
  fillVars,
  hasUnfilledVars,
  parseRunbookText,
  renderRunbookText,
  sanitizeRunbook,
  searchRunbooks,
  variantVars,
  type RunbookStep
} from '@infra/shared'

/** Thực thi ở `packages/shared` — renderer dùng, không import được `@infra/core` (CLAUDE.md §5). */

describe('biến {{x}}', () => {
  test('extractVars: theo thứ tự, không trùng, chấp nhận khoảng trắng trong ngoặc', () => {
    expect(extractVars('ufw allow from {{ip}} to any port {{ port }} proto tcp; echo {{ip}}')).toEqual(['ip', 'port'])
    expect(extractVars('không có biến')).toEqual([])
  })

  test('fillVars điền có giá trị, GIỮ placeholder khi trống', () => {
    expect(fillVars('iptables -I INPUT -s {{ip}} --dport {{port}}', { ip: '203.0.113.10' })).toBe('iptables -I INPUT -s 203.0.113.10 --dport {{port}}')
    expect(hasUnfilledVars('-s {{ip}}', {})).toBe(true)
    expect(hasUnfilledVars('-s {{ip}}', { ip: '203.0.113.10' })).toBe(false)
  })

  test('variantVars gom biến của mọi LỆNH trong variant — biến chỉ nằm trong ghi chú không tính', () => {
    const rb = RUNBOOK_LIBRARY.find((r) => r.id === 'fw-whitelist-ip')!
    // iptables: `{{port}}` chỉ xuất hiện trong ghi chú ("thêm -p tcp --dport {{port}}") → không hỏi
    expect(variantVars(rb.variants.find((v) => v.id === 'iptables')!)).toEqual(['ip'])
    // ufw: lệnh có cả hai
    expect(variantVars(rb.variants.find((v) => v.id === 'ufw')!)).toEqual(['ip', 'port'])
  })
})

describe('parseRunbookText / renderRunbookText', () => {
  const TEXT = `dòng rác trước bước đầu bị bỏ
## Xem rule
$ iptables -L INPUT -n
Nhớ vị trí rule DROP.

## Thêm rule sống
!!
$ iptables -I INPUT -s {{ip}} -j ACCEPT
$ iptables-save > /etc/sysconfig/iptables
Hai dòng $ liền nhau thành một khối.

## Chỉ hướng dẫn chữ, không lệnh
Mở phiên SSH thứ hai.`

  test('parse: tiêu đề, khối lệnh nhiều dòng, ghi chú, cờ nguy hiểm, bước không lệnh', () => {
    const steps = parseRunbookText(TEXT)
    expect(steps).toHaveLength(3)
    expect(steps[0]).toEqual({ title: 'Xem rule', command: 'iptables -L INPUT -n', note: 'Nhớ vị trí rule DROP.' })
    expect(steps[1]).toEqual({
      title: 'Thêm rule sống',
      command: 'iptables -I INPUT -s {{ip}} -j ACCEPT\niptables-save > /etc/sysconfig/iptables',
      note: 'Hai dòng $ liền nhau thành một khối.',
      danger: true
    })
    expect(steps[2]).toEqual({ title: 'Chỉ hướng dẫn chữ, không lệnh', note: 'Mở phiên SSH thứ hai.' })
  })

  test('render ↔ parse là vòng tròn kín', () => {
    const steps: RunbookStep[] = [
      { title: 'A', command: 'ls\n\npwd', note: 'ghi chú\nhai dòng', danger: true },
      { title: 'B' },
      { title: 'C', command: 'echo x' }
    ]
    const text = renderRunbookText(steps)
    expect(text).toContain('## A\n!!\n$ ls\n$\n$ pwd\nghi chú\nhai dòng')
    expect(parseRunbookText(text)).toEqual(steps)
  })

  test('"!!" kèm chữ → cờ nguy hiểm + chữ vào ghi chú; ## trống → tên bước tự đánh số', () => {
    const steps = parseRunbookText('##\n!! Mất kết nối nếu sai\n$ systemctl restart iptables')
    expect(steps[0]).toEqual({ title: 'Bước 1', command: 'systemctl restart iptables', note: 'Mất kết nối nếu sai', danger: true })
  })

  test('văn bản rỗng → không bước', () => {
    expect(parseRunbookText('')).toEqual([])
  })
})

describe('searchRunbooks', () => {
  test('AND theo từ trên tiêu đề / tag / lệnh; rỗng giữ hết', () => {
    expect(searchRunbooks(RUNBOOK_LIBRARY, '').length).toBe(RUNBOOK_LIBRARY.length)
    const hits = searchRunbooks(RUNBOOK_LIBRARY, 'firewalld whitelist')
    expect(hits.map((r) => r.id)).toEqual(['fw-whitelist-ip'])
    expect(searchRunbooks(RUNBOOK_LIBRARY, 'certbot').map((r) => r.id)).toContain('ssl-letsencrypt')
    expect(searchRunbooks(RUNBOOK_LIBRARY, 'iptables-save').length).toBeGreaterThan(0) // khớp trong lệnh
    expect(searchRunbooks(RUNBOOK_LIBRARY, 'khong-co-gi-nhu-vay')).toEqual([])
  })
})

describe('sanitizeRunbook', () => {
  test('bổ mặc định, bỏ bước hỏng, luôn có ≥ 1 variant, builtin ép false', () => {
    const rb = sanitizeRunbook({
      id: 'x',
      title: '  Của tôi ',
      category: 'khong-ton-tai',
      tags: ['a', 3, ' b '],
      variants: [{ id: '', label: 'L', steps: [{ title: 'ok', command: 'ls', danger: true }, { nope: 1 }, null] }],
      builtin: true
    })
    expect(rb).toEqual({
      id: 'x',
      title: 'Của tôi',
      category: 'other',
      tags: ['a', 'b'],
      summary: '',
      warnings: [],
      variants: [{ id: DEFAULT_VARIANT_ID, label: 'L', steps: [{ title: 'ok', command: 'ls', danger: true }] }],
      builtin: false
    })
    expect(sanitizeRunbook({ id: 'x' })).toBeNull()
    expect(sanitizeRunbook(null)).toBeNull()
    expect(sanitizeRunbook({ id: 'y', title: 't' })!.variants).toEqual([{ id: DEFAULT_VARIANT_ID, label: '', steps: [] }])
  })
})

describe('RUNBOOK_LIBRARY', () => {
  test('id duy nhất, category hợp lệ có icon, mỗi sổ tay ≥ 1 variant có ≥ 1 bước, builtin true', () => {
    const ids = RUNBOOK_LIBRARY.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const rb of RUNBOOK_LIBRARY) {
      expect(RUNBOOK_CATEGORIES).toContain(rb.category)
      expect(RUNBOOK_CATEGORY_ICON[rb.category]).toBeTruthy()
      expect(rb.builtin).toBe(true)
      expect(rb.variants.length).toBeGreaterThan(0)
      for (const v of rb.variants) expect(v.steps.length).toBeGreaterThan(0)
      const vids = rb.variants.map((v) => v.id)
      expect(new Set(vids).size).toBe(vids.length)
    }
  })

  test('không có IP public thật trong sổ tay (chỉ dải tài liệu / riêng)', () => {
    const blob = JSON.stringify(RUNBOOK_LIBRARY)
    const ips = blob.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g) ?? []
    for (const ip of ips) expect(ip).toMatch(/^(203\.0\.113\.|10\.|127\.|0\.0\.0\.0)/)
  })

  test('sổ tay whitelist có 4 hệ và bước restart iptables đánh dấu nguy hiểm', () => {
    const rb = RUNBOOK_LIBRARY.find((r) => r.id === 'fw-whitelist-ip')!
    expect(rb.variants.map((v) => v.id)).toEqual(['iptables', 'firewalld', 'ufw', 'nft'])
    const restart = rb.variants[0]!.steps.find((st) => st.command?.includes('systemctl restart iptables'))
    expect(restart?.danger).toBe(true)
  })
})
