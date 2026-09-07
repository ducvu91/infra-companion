import { describe, expect, test } from 'vitest'
import {
  EVENT_SOURCES,
  countUnread,
  dayKey,
  defaultSeverity,
  groupEventsByDay,
  markerX,
  toChartMarkers,
  type AppEventDto
} from '@infra/shared'

/** Thực thi ở `packages/shared` — renderer dùng, không import được `@infra/core` (CLAUDE.md §5). */

const ev = (id: number, over: Partial<AppEventDto>): AppEventDto => ({
  id,
  ts: 0,
  kind: 'alert',
  source: 'monitor',
  severity: 'warning',
  hostId: 'h1',
  title: `e${id}`,
  detail: null,
  ackedAt: null,
  ...over
})

// Dùng Date theo giờ máy để test không phụ thuộc múi giờ của máy chạy CI
const at = (y: number, m: number, d: number, h: number): number => new Date(y, m - 1, d, h).getTime()

describe('dayKey / groupEventsByDay', () => {
  test('dayKey theo giờ máy, đủ 2 chữ số', () => {
    expect(dayKey(at(2026, 9, 6, 23))).toBe('2026-09-06')
    expect(dayKey(at(2026, 1, 1, 0))).toBe('2026-01-01')
  })

  test('gom theo ngày, giữ thứ tự đầu vào (mới → cũ), ngày rải rác vẫn về một nhóm', () => {
    const events = [
      ev(4, { ts: at(2026, 9, 7, 9) }),
      ev(3, { ts: at(2026, 9, 6, 22) }),
      ev(2, { ts: at(2026, 9, 6, 8) }),
      ev(1, { ts: at(2026, 9, 5, 1) })
    ]
    const groups = groupEventsByDay(events)
    expect(groups.map((g) => g.day)).toEqual(['2026-09-07', '2026-09-06', '2026-09-05'])
    expect(groups[1]!.items.map((e) => e.id)).toEqual([3, 2])
  })

  test('rỗng → rỗng', () => {
    expect(groupEventsByDay([])).toEqual([])
  })
})

describe('countUnread / defaultSeverity', () => {
  test('không tính marker, không tính đã ack', () => {
    expect(
      countUnread([
        ev(1, {}),
        ev(2, { ackedAt: 5 }),
        ev(3, { kind: 'marker', ackedAt: 1 }),
        ev(4, { kind: 'marker', ackedAt: null }),
        ev(5, { kind: 'recover' })
      ])
    ).toBe(2)
  })

  test('alert → warning, còn lại info', () => {
    expect(defaultSeverity('alert')).toBe('warning')
    expect(defaultSeverity('recover')).toBe('info')
    expect(defaultSeverity('marker')).toBe('info')
  })

  test('bộ nguồn đủ 7 và có user (marker tay)', () => {
    expect(EVENT_SOURCES).toHaveLength(7)
    expect(EVENT_SOURCES).toContain('user')
  })
})

describe('toChartMarkers / markerX', () => {
  test('marker → accent, alert critical → danger, alert warning → warning, recover → success, info bỏ', () => {
    const marks = toChartMarkers([
      ev(1, { kind: 'marker', title: 'Deploy', ts: 10 }),
      ev(2, { kind: 'alert', severity: 'critical', title: 'offline', ts: 20 }),
      ev(3, { kind: 'alert', severity: 'warning', title: 'cpu', ts: 30 }),
      ev(4, { kind: 'recover', title: 'ok', ts: 40 }),
      ev(5, { kind: 'info', title: 'bỏ', ts: 50 })
    ])
    expect(marks).toEqual([
      { ts: 10, label: 'Deploy', tone: 'accent' },
      { ts: 20, label: 'offline', tone: 'danger' },
      { ts: 30, label: 'cpu', tone: 'warning' },
      { ts: 40, label: 'ok', tone: 'success' }
    ])
  })

  test('markerX: 0–100 trong khoảng, null ngoài khoảng hoặc khoảng rỗng', () => {
    expect(markerX(100, 100, 200)).toBe(0)
    expect(markerX(150, 100, 200)).toBe(50)
    expect(markerX(200, 100, 200)).toBe(100)
    expect(markerX(99, 100, 200)).toBeNull()
    expect(markerX(201, 100, 200)).toBeNull()
    expect(markerX(100, 100, 100)).toBeNull()
  })
})
