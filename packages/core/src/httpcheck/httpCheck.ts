import { randomUUID } from 'node:crypto'
import type { HttpCheckDto, HttpCheckInput, HttpCheckMethod, HttpCheckResultDto, HttpCheckSummaryDto } from '@infra/shared'
import { isSafeIpLiteral } from '../hostmap/hostMap'

/**
 * Theo dõi URL — phần QUYẾT ĐỊNH, thuần: đọc spec mã trạng thái, chấm một lần đo là ok hay
 * không, chuẩn hoá cấu hình từ JSON, tóm tắt lịch sử. Phần MẠNG ở `probe.ts`, kho ở
 * `HttpCheckStore.ts`, lịch chạy ở main.
 *
 * Vì sao là tính năng riêng chứ không cắm vào uptime watcher: watcher chỉ biết "cổng TCP mở".
 * Web sau load balancer thì cổng luôn mở — thứ hỏng là mã 502, trang trắng, cert hết hạn, hay
 * MỘT backend chết trong khi LB vẫn trả 200 từ con khác. Check HTTP nhìn đúng vào ba chỗ đó,
 * và `resolveIp` cho phép hỏi thẳng từng backend mà cert vẫn khớp tên miền.
 */

export const HTTP_CHECK_LIMITS = {
  intervalSec: { min: 30, max: 86_400, default: 60 },
  timeoutMs: { min: 1_000, max: 60_000, default: 10_000 },
  failsBeforeAlert: { min: 1, max: 10, default: 2 }
} as const

export const DEFAULT_EXPECT_STATUS = '200-399'
/** Cert còn dưới ngưỡng này (ngày) thì coi là fail dù trang vẫn lên — hết hạn rồi mới báo là quá muộn. */
export const CERT_WARN_DAYS = 14
/** Đọc tối đa bấy nhiêu byte body để tìm từ khoá — đủ cho trang HTML thường, không nuốt file lớn. */
export const BODY_SNIPPET_BYTES = 65_536

/**
 * Spec mã trạng thái → hàm khớp. Chấp nhận: `200` · `200-399` · `200,301,302` · `2xx`/`3xx`,
 * trộn được bằng dấu phẩy. Spec không hiểu được → fallback `200-399` (không bao giờ ném — cấu
 * hình đến từ file JSON user sửa tay được).
 */
export function parseStatusSpec(spec: string): (code: number) => boolean {
  const parts = spec
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const tests: Array<(c: number) => boolean> = []
  for (const part of parts) {
    let m = part.match(/^(\d)xx$/)
    if (m) {
      const hundred = Number(m[1]) * 100
      tests.push((c) => c >= hundred && c < hundred + 100)
      continue
    }
    m = part.match(/^(\d{3})-(\d{3})$/)
    if (m) {
      const lo = Number(m[1])
      const hi = Number(m[2])
      if (lo <= hi) tests.push((c) => c >= lo && c <= hi)
      continue
    }
    m = part.match(/^(\d{3})$/)
    if (m) {
      const only = Number(m[1])
      tests.push((c) => c === only)
    }
  }
  if (tests.length === 0) return (c) => c >= 200 && c <= 399
  return (c) => tests.some((t) => t(c))
}

/** Spec có hiểu được không (để form báo lỗi thay vì âm thầm rơi về mặc định). */
export function isValidStatusSpec(spec: string): boolean {
  const parts = spec
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return parts.length > 0 && parts.every((p) => /^(\dxx|\d{3}-\d{3}|\d{3})$/.test(p))
}

/** Kết quả thô của một lần đo — trước khi chấm ok/fail. */
export interface ProbeResult {
  ts: number
  status: number | null
  latencyMs: number | null
  /** Body đã đọc (GET, tối đa BODY_SNIPPET_BYTES) — '' với HEAD hoặc lỗi. */
  bodySnippet: string
  /** `valid_to` của cert (chuỗi Date) — null với http:// hoặc không đọc được. */
  certValidTo: string | null
  /** Lỗi tầng mạng/TLS/timeout — null khi có phản hồi HTTP. */
  error: string | null
}

export function certDaysLeft(validTo: string | null, now: number): number | null {
  if (!validTo) return null
  const t = new Date(validTo).getTime()
  if (!Number.isFinite(t)) return null
  return Math.floor((t - now) / 86_400_000)
}

/**
 * Chấm một lần đo. Thứ tự lý do: lỗi mạng → mã trạng thái → từ khoá → cert sắp hết hạn. Lý do
 * viết bằng câu người đọc hiểu vì nó đi thẳng vào thông báo và trung tâm sự kiện.
 */
export function evaluateProbe(check: Pick<HttpCheckDto, 'expectStatus' | 'keyword' | 'method'>, probe: ProbeResult): HttpCheckResultDto & { reason: string | null } {
  const certDays = certDaysLeft(probe.certValidTo, probe.ts)
  const base = { checkId: '', ts: probe.ts, status: probe.status, latencyMs: probe.latencyMs, certDaysLeft: certDays }
  if (probe.error !== null || probe.status === null) {
    const reason = probe.error ?? 'không có phản hồi'
    return { ...base, ok: false, error: reason, reason }
  }
  if (!parseStatusSpec(check.expectStatus)(probe.status)) {
    const reason = `HTTP ${probe.status} (mong ${check.expectStatus})`
    return { ...base, ok: false, error: reason, reason }
  }
  if (check.method === 'GET' && check.keyword && !probe.bodySnippet.includes(check.keyword)) {
    const reason = `thiếu từ khoá "${check.keyword}"`
    return { ...base, ok: false, error: reason, reason }
  }
  if (certDays !== null && certDays < CERT_WARN_DAYS) {
    const reason = certDays < 0 ? `cert TLS đã hết hạn ${-certDays} ngày` : `cert TLS còn ${certDays} ngày`
    return { ...base, ok: false, error: reason, reason }
  }
  return { ...base, ok: true, error: null, reason: null }
}

function clampInt(v: unknown, lim: { min: number; max: number; default: number }): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return lim.default
  return Math.min(lim.max, Math.max(lim.min, Math.round(n)))
}

/** URL hợp lệ cho check: chỉ http/https, có hostname. */
export function isValidCheckUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.length > 0
  } catch {
    return false
  }
}

/**
 * Chuẩn hoá một check từ input (form hoặc JSON trên đĩa user có thể sửa tay): kẹp khoảng số,
 * bỏ resolveIp không phải IP literal, giữ id/createdAt nếu là bản sửa. Trả null khi URL hỏng —
 * đó là lỗi duy nhất không sửa thay được.
 */
export function sanitizeHttpCheck(raw: Partial<HttpCheckInput> & { createdAt?: number }, now: number): HttpCheckDto | null {
  const url = String(raw.url ?? '').trim()
  if (!isValidCheckUrl(url)) return null
  const method: HttpCheckMethod = raw.method === 'HEAD' ? 'HEAD' : 'GET'
  const expect = String(raw.expectStatus ?? '').trim()
  const resolveIp = String(raw.resolveIp ?? '').trim()
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : randomUUID(),
    label: String(raw.label ?? '').trim() || labelFromUrl(url),
    url,
    method,
    expectStatus: isValidStatusSpec(expect) ? expect : DEFAULT_EXPECT_STATUS,
    keyword: method === 'GET' ? String(raw.keyword ?? '') : '',
    intervalSec: clampInt(raw.intervalSec, HTTP_CHECK_LIMITS.intervalSec),
    timeoutMs: clampInt(raw.timeoutMs, HTTP_CHECK_LIMITS.timeoutMs),
    resolveIp: isSafeIpLiteral(resolveIp) ? resolveIp : '',
    enabled: raw.enabled !== false,
    failsBeforeAlert: clampInt(raw.failsBeforeAlert, HTTP_CHECK_LIMITS.failsBeforeAlert),
    hostId: typeof raw.hostId === 'string' && raw.hostId ? raw.hostId : null,
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now
  }
}

/** Nhãn mặc định = host của URL (+ path nếu không phải `/`). */
export function labelFromUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.pathname && u.pathname !== '/' ? `${u.hostname}${u.pathname}` : u.hostname
  } catch {
    return url
  }
}

/** Số lần fail liên tiếp tính từ cuối danh sách (kết quả cũ → mới). */
export function consecutiveFails(results: readonly Pick<HttpCheckResultDto, 'ok'>[]): number {
  let n = 0
  for (let i = results.length - 1; i >= 0; i -= 1) {
    if (results[i]!.ok) break
    n += 1
  }
  return n
}

/** Tóm tắt cho danh sách: uptime %, latency trung bình của lần ok, lần đo cuối. */
export function summarizeResults(
  checkId: string,
  results: readonly HttpCheckResultDto[],
  alerting: boolean
): HttpCheckSummaryDto {
  const total = results.length
  const okResults = results.filter((r) => r.ok)
  const latencies = okResults.map((r) => r.latencyMs).filter((v): v is number => v !== null)
  return {
    checkId,
    total,
    okCount: okResults.length,
    uptimePct: total > 0 ? Math.round((okResults.length / total) * 1000) / 10 : null,
    avgLatencyMs: latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
    last: results.length > 0 ? results[results.length - 1]! : null,
    consecutiveFails: consecutiveFails(results),
    alerting
  }
}
