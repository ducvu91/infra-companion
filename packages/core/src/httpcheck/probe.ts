import * as http from 'node:http'
import * as https from 'node:https'
import { isIP } from 'node:net'
import type { TLSSocket } from 'node:tls'
import type { HttpCheckDto } from '@infra/shared'
import { BODY_SNIPPET_BYTES, type ProbeResult } from './httpCheck'

/**
 * Một lần đo HTTP/HTTPS — phần MẠNG của theo dõi URL. Không theo redirect (3xx là một mã trạng
 * thái như mọi mã khác, spec `200-399` mặc định đã chấp nhận), không gửi cookie, không cache DNS.
 *
 * `resolveIp`: nối TCP tới IP đó nhưng Host header và SNI vẫn là hostname trong URL → hỏi thẳng
 * một backend sau load balancer mà cert HTTPS vẫn được kiểm đúng tên. Làm bằng `lookup` tuỳ biến
 * của Node (không đụng DNS hệ thống, không cần quyền).
 */
export function probeUrl(
  check: Pick<HttpCheckDto, 'url' | 'method' | 'timeoutMs' | 'resolveIp'>,
  now: () => number = () => Date.now()
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const started = now()
    let settled = false
    const finish = (partial: Omit<ProbeResult, 'ts'>): void => {
      if (settled) return
      settled = true
      resolve({ ts: started, ...partial })
    }

    let target: URL
    try {
      target = new URL(check.url)
    } catch {
      finish({ status: null, latencyMs: null, bodySnippet: '', certValidTo: null, error: 'URL không hợp lệ' })
      return
    }
    const secure = target.protocol === 'https:'
    const lib = secure ? https : http
    const options: https.RequestOptions = {
      method: check.method,
      headers: { 'user-agent': 'InfraCompanion-HttpCheck/1', accept: '*/*' },
      timeout: check.timeoutMs,
      // Cert vẫn được xác thực theo hostname trong URL (SNI = servername mặc định của Node)
      ...(check.resolveIp && isIP(check.resolveIp)
        ? {
            lookup: (_host, opts, cb) => {
              const family = isIP(check.resolveIp) as 4 | 6
              // Node chấp nhận cả dạng (err, address, family) lẫn mảng khi opts.all — trả dạng đơn cho chắc
              if ((opts as { all?: boolean }).all) (cb as unknown as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [{ address: check.resolveIp, family }])
              else cb(null, check.resolveIp, family)
            }
          }
        : {})
    }

    const req = lib.request(target, options, (res) => {
      const latencyMs = now() - started
      const status = res.statusCode ?? null
      const socket = res.socket as TLSSocket | undefined
      let certValidTo: string | null = null
      if (secure && socket && typeof socket.getPeerCertificate === 'function') {
        const cert = socket.getPeerCertificate()
        if (cert && typeof cert.valid_to === 'string' && cert.valid_to) certValidTo = cert.valid_to
      }
      if (check.method === 'HEAD') {
        res.resume()
        finish({ status, latencyMs, bodySnippet: '', certValidTo, error: null })
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        if (size >= BODY_SNIPPET_BYTES) return
        const room = BODY_SNIPPET_BYTES - size
        const slice = chunk.length > room ? chunk.subarray(0, room) : chunk
        chunks.push(slice)
        size += slice.length
        // Đủ mẫu rồi thì thôi: huỷ phần còn lại để một trang 50MB không kéo dài lần đo
        if (size >= BODY_SNIPPET_BYTES) res.destroy()
      })
      res.on('end', () => finish({ status, latencyMs, bodySnippet: Buffer.concat(chunks).toString('utf8'), certValidTo, error: null }))
      res.on('close', () => finish({ status, latencyMs, bodySnippet: Buffer.concat(chunks).toString('utf8'), certValidTo, error: null }))
      res.on('error', () => finish({ status, latencyMs, bodySnippet: Buffer.concat(chunks).toString('utf8'), certValidTo, error: null }))
    })
    req.on('timeout', () => {
      req.destroy()
      finish({ status: null, latencyMs: null, bodySnippet: '', certValidTo: null, error: `hết giờ sau ${check.timeoutMs}ms` })
    })
    req.on('error', (err: NodeJS.ErrnoException) => {
      finish({ status: null, latencyMs: null, bodySnippet: '', certValidTo: null, error: describeNetError(err) })
    })
    req.end()
  })
}

/** Lỗi mạng → câu ngắn có mã (ECONNREFUSED…) để người đọc biết là DNS, từ chối, hay TLS. */
export function describeNetError(err: NodeJS.ErrnoException): string {
  const code = err.code ?? ''
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `không phân giải được tên miền (${code})`
  if (code === 'ECONNREFUSED') return 'kết nối bị từ chối (ECONNREFUSED)'
  if (code === 'ECONNRESET') return 'kết nối bị ngắt (ECONNRESET)'
  if (code === 'ETIMEDOUT') return 'hết giờ kết nối (ETIMEDOUT)'
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return `không tới được máy (${code})`
  if (code.startsWith('ERR_TLS') || code === 'CERT_HAS_EXPIRED' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'ERR_SSL_WRONG_VERSION_NUMBER') {
    return `lỗi TLS: ${code}`
  }
  return code ? `${err.message} (${code})` : err.message
}
