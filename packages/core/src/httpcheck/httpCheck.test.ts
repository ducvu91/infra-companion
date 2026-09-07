import { describe, expect, test } from 'vitest'
import type { HttpCheckResultDto } from '@infra/shared'
import {
  CERT_WARN_DAYS,
  DEFAULT_EXPECT_STATUS,
  certDaysLeft,
  consecutiveFails,
  evaluateProbe,
  isValidCheckUrl,
  isValidStatusSpec,
  labelFromUrl,
  parseStatusSpec,
  sanitizeHttpCheck,
  summarizeResults,
  type ProbeResult
} from './httpCheck'

const NOW = 1_760_000_000_000
const DAY = 86_400_000

const probe = (over: Partial<ProbeResult> = {}): ProbeResult => ({
  ts: NOW,
  status: 200,
  latencyMs: 120,
  bodySnippet: '<html>Welcome to example.com</html>',
  certValidTo: new Date(NOW + 90 * DAY).toUTCString(),
  error: null,
  ...over
})

describe('parseStatusSpec / isValidStatusSpec', () => {
  test('mã đơn, dải, danh sách, dạng 2xx', () => {
    expect(parseStatusSpec('200')(200)).toBe(true)
    expect(parseStatusSpec('200')(201)).toBe(false)
    const range = parseStatusSpec('200-399')
    expect(range(200)).toBe(true)
    expect(range(302)).toBe(true)
    expect(range(400)).toBe(false)
    const list = parseStatusSpec('200, 301,302')
    expect(list(301)).toBe(true)
    expect(list(300)).toBe(false)
    const cls = parseStatusSpec('2xx,401')
    expect(cls(204)).toBe(true)
    expect(cls(401)).toBe(true)
    expect(cls(301)).toBe(false)
  })

  test('spec hỏng → fallback 200-399, KHÔNG ném', () => {
    const f = parseStatusSpec('abc')
    expect(f(200)).toBe(true)
    expect(f(500)).toBe(false)
    expect(isValidStatusSpec('abc')).toBe(false)
    expect(isValidStatusSpec('')).toBe(false)
    expect(isValidStatusSpec('200-399,404')).toBe(true)
    expect(isValidStatusSpec('5xx')).toBe(true)
  })
})

describe('evaluateProbe', () => {
  const check = { expectStatus: '200-399', keyword: '', method: 'GET' as const }

  test('200 đúng spec, không từ khoá, cert còn dài → ok', () => {
    const r = evaluateProbe(check, probe())
    expect(r.ok).toBe(true)
    expect(r.error).toBeNull()
    expect(r.certDaysLeft).toBe(90)
    expect(r.latencyMs).toBe(120)
  })

  test('lỗi mạng thắng mọi thứ', () => {
    const r = evaluateProbe(check, probe({ status: null, latencyMs: null, error: 'kết nối bị từ chối (ECONNREFUSED)' }))
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('ECONNREFUSED')
  })

  test('mã sai spec → lý do nêu cả mã và spec mong đợi', () => {
    const r = evaluateProbe(check, probe({ status: 502 }))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('HTTP 502 (mong 200-399)')
  })

  test('từ khoá thiếu (GET) → fail; HEAD thì bỏ qua từ khoá', () => {
    const withKw = { ...check, keyword: 'Đăng nhập' }
    expect(evaluateProbe(withKw, probe()).ok).toBe(false)
    expect(evaluateProbe(withKw, probe()).reason).toContain('Đăng nhập')
    expect(evaluateProbe({ ...withKw, method: 'HEAD' }, probe({ bodySnippet: '' })).ok).toBe(true)
  })

  test('cert dưới ngưỡng → fail dù trang lên; hết hạn nói rõ số ngày', () => {
    const soon = evaluateProbe(check, probe({ certValidTo: new Date(NOW + (CERT_WARN_DAYS - 1) * DAY).toUTCString() }))
    expect(soon.ok).toBe(false)
    expect(soon.reason).toContain('cert TLS còn')
    const expired = evaluateProbe(check, probe({ certValidTo: new Date(NOW - 3 * DAY).toUTCString() }))
    expect(expired.ok).toBe(false)
    expect(expired.reason).toContain('đã hết hạn 3 ngày')
  })

  test('http:// không có cert → certDaysLeft null và không ảnh hưởng ok', () => {
    const r = evaluateProbe(check, probe({ certValidTo: null }))
    expect(r.ok).toBe(true)
    expect(r.certDaysLeft).toBeNull()
    expect(certDaysLeft('không phải ngày', NOW)).toBeNull()
  })
})

describe('sanitizeHttpCheck', () => {
  test('điền mặc định, kẹp khoảng, bỏ resolveIp không phải IP, nhãn từ URL', () => {
    const c = sanitizeHttpCheck({ url: 'https://example.com/health', intervalSec: 5, timeoutMs: 999_999, resolveIp: 'not-an-ip', failsBeforeAlert: 0 }, NOW)
    expect(c).not.toBeNull()
    expect(c!.label).toBe('example.com/health')
    expect(c!.method).toBe('GET')
    expect(c!.expectStatus).toBe(DEFAULT_EXPECT_STATUS)
    expect(c!.intervalSec).toBe(30)
    expect(c!.timeoutMs).toBe(60_000)
    expect(c!.failsBeforeAlert).toBe(1)
    expect(c!.resolveIp).toBe('')
    expect(c!.enabled).toBe(true)
    expect(c!.hostId).toBeNull()
    expect(c!.createdAt).toBe(NOW)
    expect(c!.id).toMatch(/[0-9a-f-]{36}/)
  })

  test('giữ id/createdAt khi sửa, IP literal hợp lệ được giữ, HEAD xoá từ khoá', () => {
    const c = sanitizeHttpCheck(
      { id: 'c1', createdAt: 5, url: 'http://web-01.example.net', method: 'HEAD', keyword: 'x', resolveIp: '203.0.113.10', expectStatus: '2xx', hostId: 'h1', enabled: false },
      NOW
    )
    expect(c).toMatchObject({ id: 'c1', createdAt: 5, method: 'HEAD', keyword: '', resolveIp: '203.0.113.10', expectStatus: '2xx', hostId: 'h1', enabled: false })
  })

  test('URL hỏng hoặc không phải http(s) → null', () => {
    expect(sanitizeHttpCheck({ url: 'ftp://example.com' }, NOW)).toBeNull()
    expect(sanitizeHttpCheck({ url: 'không phải url' }, NOW)).toBeNull()
    expect(isValidCheckUrl('https://example.com')).toBe(true)
    expect(isValidCheckUrl('javascript:alert(1)')).toBe(false)
  })

  test('labelFromUrl bỏ path gốc', () => {
    expect(labelFromUrl('https://example.com/')).toBe('example.com')
    expect(labelFromUrl('https://example.com/api/health')).toBe('example.com/api/health')
  })
})

describe('consecutiveFails / summarizeResults', () => {
  const r = (ok: boolean, latencyMs: number | null = 100, ts = NOW): HttpCheckResultDto => ({
    checkId: 'c1',
    ts,
    ok,
    status: ok ? 200 : 502,
    latencyMs,
    certDaysLeft: null,
    error: ok ? null : 'HTTP 502'
  })

  test('đếm fail liên tiếp từ cuối', () => {
    expect(consecutiveFails([])).toBe(0)
    expect(consecutiveFails([r(true), r(false), r(false)])).toBe(2)
    expect(consecutiveFails([r(false), r(true)])).toBe(0)
  })

  test('uptime %, latency trung bình chỉ tính lần ok, last = cuối', () => {
    const s = summarizeResults('c1', [r(true, 100, NOW), r(true, 300, NOW + 1), r(false, null, NOW + 2)], true)
    expect(s).toMatchObject({ checkId: 'c1', total: 3, okCount: 2, uptimePct: 66.7, avgLatencyMs: 200, consecutiveFails: 1, alerting: true })
    expect(s.last?.ts).toBe(NOW + 2)
  })

  test('chưa đo → uptime/latency null', () => {
    expect(summarizeResults('c1', [], false)).toMatchObject({ total: 0, uptimePct: null, avgLatencyMs: null, last: null, consecutiveFails: 0 })
  })
})
