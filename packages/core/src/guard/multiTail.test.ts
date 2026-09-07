import { describe, expect, test } from 'vitest'
import { HOST_TONES, assignHostTones, padLabel, prefixWidth } from '@infra/shared'

/** Thực thi ở `packages/shared` — renderer dùng, không import được `@infra/core` (CLAUDE.md §5). */

describe('assignHostTones', () => {
  test('theo thứ tự chọn, bỏ trùng, quay vòng sau 8 host', () => {
    const ids = ['h1', 'h2', 'h1', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9']
    const tones = assignHostTones(ids)
    expect(Object.keys(tones)).toHaveLength(9)
    expect(tones['h1']).toBe(HOST_TONES[0])
    expect(tones['h2']).toBe(HOST_TONES[1])
    expect(tones['h9']).toBe(HOST_TONES[0]) // host thứ 9 quay về màu đầu
  })

  test('rỗng → rỗng', () => {
    expect(assignHostTones([])).toEqual({})
  })
})

describe('prefixWidth / padLabel', () => {
  test('bề rộng = tên dài nhất, kẹp 4–16', () => {
    expect(prefixWidth(['app-01', 'db'])).toBe(6)
    expect(prefixWidth(['a'])).toBe(4)
    expect(prefixWidth(['ten-host-dai-vo-tan-luon'])).toBe(16)
    expect(prefixWidth([])).toBe(4)
  })

  test('đệm cho thẳng hàng, dài quá thì cắt kèm …', () => {
    expect(padLabel('db', 6)).toBe('db    ')
    expect(padLabel('ten-host-dai-vo-tan-luon', 16)).toBe('ten-host-dai-vo…')
    expect(padLabel('ten-host-dai-vo…', 16)).toHaveLength(16)
  })
})
