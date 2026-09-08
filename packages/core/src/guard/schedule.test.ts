import { describe, expect, test } from 'vitest'
import { isDue, isValidCronExpression, nextCronRun, parseCronExpression } from '@infra/shared'

/** Thực thi ở `packages/shared` — renderer dùng để hiện "lần chạy kế tiếp" (CLAUDE.md §5). */

/** Mốc local, không dùng UTC: lịch trong app theo đồng hồ máy như crontab của server. */
const at = (y: number, m: number, d: number, h: number, min: number): number => new Date(y, m - 1, d, h, min, 0, 0).getTime()
const show = (ts: number | null): string => {
  if (ts === null) return 'null'
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

describe('parseCronExpression', () => {
  test('trường đủ dạng: *, số, danh sách, dải, bước', () => {
    expect(parseCronExpression('*/15 * * * *')!.minutes).toEqual([0, 15, 30, 45])
    expect(parseCronExpression('0 9-17 * * *')!.hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17])
    expect(parseCronExpression('0 2,14 * * *')!.hours).toEqual([2, 14])
    expect(parseCronExpression('0 0 * * 1-5')!.daysOfWeek).toEqual([1, 2, 3, 4, 5])
    expect(parseCronExpression('0-30/10 * * * *')!.minutes).toEqual([0, 10, 20, 30])
    // `5/10` = từ 5 tới hết cột, bước 10 (cú pháp cron thật)
    expect(parseCronExpression('5/10 * * * *')!.minutes).toEqual([5, 15, 25, 35, 45, 55])
  })

  test('7 = Chủ nhật, quy về 0; cờ hạn chế theo cột ngày', () => {
    expect(parseCronExpression('0 0 * * 7')!.daysOfWeek).toEqual([0])
    const both = parseCronExpression('0 0 13 * 5')!
    expect(both.domRestricted).toBe(true)
    expect(both.dowRestricted).toBe(true)
    const plain = parseCronExpression('*/5 * * * *')!
    expect(plain.domRestricted).toBe(false)
    expect(plain.dowRestricted).toBe(false)
  })

  test('bí danh @hourly/@daily/@weekly/@monthly', () => {
    expect(parseCronExpression('@daily')!.hours).toEqual([0])
    expect(parseCronExpression('@weekly')!.daysOfWeek).toEqual([0])
    expect(parseCronExpression('@monthly')!.daysOfMonth).toEqual([1])
    expect(parseCronExpression('@hourly')!.minutes).toEqual([0])
  })

  test('biểu thức sai → null (KHÔNG ném)', () => {
    for (const bad of ['', '* * * *', '* * * * * *', '60 * * * *', '* 24 * * *', '0 0 32 * *', '0 0 * 13 *', 'abc', '@reboot', '5-1 * * * *', '*/0 * * * *', 'MON * * * *']) {
      expect(parseCronExpression(bad), bad).toBeNull()
      expect(isValidCronExpression(bad), bad).toBe(false)
    }
    expect(isValidCronExpression('0 3 * * *')).toBe(true)
  })
})

describe('nextCronRun', () => {
  test('mỗi 5 phút: mốc kế tiếp SAU thời điểm đưa vào (không tính phút hiện tại)', () => {
    expect(show(nextCronRun('*/5 * * * *', at(2026, 9, 7, 10, 3)))).toBe('2026-09-07 10:05')
    // Đúng phút khớp → trả mốc SAU đó, không trả lại chính nó (nếu không sẽ chạy hai lần)
    expect(show(nextCronRun('*/5 * * * *', at(2026, 9, 7, 10, 5)))).toBe('2026-09-07 10:10')
  })

  test('hằng ngày 3:15 — hôm nay đã qua thì sang ngày mai', () => {
    expect(show(nextCronRun('15 3 * * *', at(2026, 9, 7, 1, 0)))).toBe('2026-09-07 03:15')
    expect(show(nextCronRun('15 3 * * *', at(2026, 9, 7, 9, 0)))).toBe('2026-09-08 03:15')
  })

  test('hằng tuần thứ Hai 8:00 (2026-09-07 là thứ Hai)', () => {
    expect(new Date(at(2026, 9, 7, 0, 0)).getDay()).toBe(1)
    expect(show(nextCronRun('0 8 * * 1', at(2026, 9, 7, 9, 0)))).toBe('2026-09-14 08:00')
    expect(show(nextCronRun('0 8 * * 1', at(2026, 9, 5, 0, 0)))).toBe('2026-09-07 08:00')
  })

  test('hằng tháng ngày 1 lúc 0:00, và sang năm', () => {
    expect(show(nextCronRun('@monthly', at(2026, 9, 7, 12, 0)))).toBe('2026-10-01 00:00')
    expect(show(nextCronRun('0 0 1 1 *', at(2026, 9, 7, 12, 0)))).toBe('2027-01-01 00:00')
  })

  test('cả hai cột ngày bị hạn chế → HOẶC (ngày 13 hoặc thứ Sáu)', () => {
    // 2026-09-07 thứ Hai; thứ Sáu gần nhất là 11/09, ngày 13 là 13/09
    expect(show(nextCronRun('0 0 13 * 5', at(2026, 9, 7, 12, 0)))).toBe('2026-09-11 00:00')
    expect(show(nextCronRun('0 0 13 * 5', at(2026, 9, 11, 12, 0)))).toBe('2026-09-13 00:00')
  })

  test('lịch không bao giờ khớp (30 tháng 2) → null, không treo', () => {
    expect(nextCronRun('0 0 30 2 *', at(2026, 9, 7, 0, 0))).toBeNull()
  })

  test('biểu thức sai → null', () => {
    expect(nextCronRun('sai bét', at(2026, 9, 7, 0, 0))).toBeNull()
  })

  test('ngày 29/2 chỉ khớp năm nhuận', () => {
    expect(show(nextCronRun('0 0 29 2 *', at(2026, 3, 1, 0, 0)))).toBe('2028-02-29 00:00')
  })
})

describe('isDue', () => {
  const enabledAt = at(2026, 9, 7, 0, 0)

  test('chưa tới hạn → false; tới hạn → true', () => {
    expect(isDue('15 3 * * *', at(2026, 9, 7, 3, 0), null, enabledAt)).toBe(false)
    expect(isDue('15 3 * * *', at(2026, 9, 7, 3, 15), null, enabledAt)).toBe(true)
  })

  test('đã chạy rồi thì chờ mốc kế tiếp', () => {
    const lastRun = at(2026, 9, 7, 3, 15)
    expect(isDue('15 3 * * *', at(2026, 9, 7, 12, 0), lastRun, enabledAt)).toBe(false)
    expect(isDue('15 3 * * *', at(2026, 9, 8, 3, 15), lastRun, enabledAt)).toBe(true)
  })

  test('máy tắt qua đêm → chạy bù, nhưng đến hạn là true dù trễ bao lâu', () => {
    // Lần chạy trước hôm 5/9; bật máy lại 7/9 lúc 10h → đến hạn ngay
    expect(isDue('15 3 * * *', at(2026, 9, 7, 10, 0), at(2026, 9, 5, 3, 15), enabledAt)).toBe(true)
  })

  test('lịch mới bật, mốc kế tính từ lúc bật', () => {
    // Bật lúc 3:20, lịch 3:15 hằng ngày → không chạy ngay hôm nay
    expect(isDue('15 3 * * *', at(2026, 9, 7, 3, 30), null, at(2026, 9, 7, 3, 20))).toBe(false)
    expect(isDue('15 3 * * *', at(2026, 9, 8, 3, 15), null, at(2026, 9, 7, 3, 20))).toBe(true)
  })

  test('biểu thức sai → không bao giờ đến hạn', () => {
    expect(isDue('sai', at(2030, 1, 1, 0, 0), null, enabledAt)).toBe(false)
  })
})
