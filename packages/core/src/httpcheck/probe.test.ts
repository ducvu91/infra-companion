import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { describeNetError, probeUrl } from './probe'

/**
 * Server HTTP cục bộ ở cổng EPHEMERAL (CLAUDE.md §6: không khẳng định hành vi mạng qua một cổng
 * cố định — máy dev có thể đang thật sự mở cổng đó).
 */
let server: http.Server
let port = 0
let lastHostHeader: string | undefined

beforeAll(async () => {
  server = http.createServer((req, res) => {
    lastHostHeader = req.headers.host
    if (req.url === '/ok') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body>hello world</body></html>')
    } else if (req.url === '/err') {
      res.writeHead(503)
      res.end('down')
    } else if (req.url === '/slow') {
      setTimeout(() => {
        res.writeHead(200)
        res.end('late')
      }, 2000)
    } else if (req.url === '/big') {
      res.writeHead(200)
      res.end('x'.repeat(200_000) + 'TAIL')
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const base = (path: string) => ({ url: `http://127.0.0.1:${port}${path}`, method: 'GET' as const, timeoutMs: 5000, resolveIp: '' })

describe('probeUrl', () => {
  test('200 + body → status, latency, body; http nên certValidTo null', async () => {
    const r = await probeUrl(base('/ok'))
    expect(r.status).toBe(200)
    expect(r.error).toBeNull()
    expect(r.latencyMs).toBeGreaterThanOrEqual(0)
    expect(r.bodySnippet).toContain('hello world')
    expect(r.certValidTo).toBeNull()
  })

  test('503 vẫn là phản hồi HTTP (không phải lỗi mạng)', async () => {
    const r = await probeUrl(base('/err'))
    expect(r.status).toBe(503)
    expect(r.error).toBeNull()
  })

  test('HEAD không đọc body', async () => {
    const r = await probeUrl({ ...base('/ok'), method: 'HEAD' })
    expect(r.status).toBe(200)
    expect(r.bodySnippet).toBe('')
  })

  test('hết giờ → error nói rõ timeout, status null', async () => {
    const r = await probeUrl({ ...base('/slow'), timeoutMs: 300 })
    expect(r.status).toBeNull()
    expect(r.error).toContain('hết giờ')
  })

  test('cổng đóng → ECONNREFUSED được diễn giải', async () => {
    // Mở rồi đóng một listener để lấy một cổng chắc chắn đang đóng ngay lúc đó
    const tmp = http.createServer()
    await new Promise<void>((resolve) => tmp.listen(0, '127.0.0.1', () => resolve()))
    const closedPort = (tmp.address() as AddressInfo).port
    await new Promise<void>((resolve) => tmp.close(() => resolve()))
    const r = await probeUrl({ ...base('/ok'), url: `http://127.0.0.1:${closedPort}/ok` })
    expect(r.status).toBeNull()
    expect(r.error).toContain('ECONNREFUSED')
  })

  test('body lớn bị cắt ở 64KB, không đọc hết 200KB', async () => {
    const r = await probeUrl(base('/big'))
    expect(r.status).toBe(200)
    expect(r.bodySnippet.length).toBeLessThanOrEqual(65_536)
    expect(r.bodySnippet).not.toContain('TAIL')
  })

  test('resolveIp: nối tới IP chỉ định nhưng Host header giữ hostname của URL', async () => {
    // URL nói "example-lb.test" (không phân giải được) nhưng ép nối vào 127.0.0.1 → server nhận Host là tên miền
    const r = await probeUrl({ url: `http://example-lb.test:${port}/ok`, method: 'GET', timeoutMs: 5000, resolveIp: '127.0.0.1' })
    expect(r.status).toBe(200)
    expect(lastHostHeader).toBe(`example-lb.test:${port}`)
  })

  test('describeNetError: mã quen thành câu ngắn, mã lạ giữ message + mã', () => {
    expect(describeNetError(Object.assign(new Error('x'), { code: 'ENOTFOUND' }))).toContain('tên miền')
    expect(describeNetError(Object.assign(new Error('x'), { code: 'CERT_HAS_EXPIRED' }))).toContain('TLS')
    expect(describeNetError(Object.assign(new Error('boom'), { code: 'EWEIRD' }))).toBe('boom (EWEIRD)')
    expect(describeNetError(new Error('plain'))).toBe('plain')
  })
})
