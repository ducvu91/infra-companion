import { describe, expect, test } from 'vitest'
import {
  JOB_OUTPUT_CAP,
  JOB_TIMEOUT_LIMITS,
  capOutput,
  isValidCronExpression,
  runFailed,
  runSeverity,
  sanitizeJob,
  summarizeRun,
  type JobHostResultDto
} from '@infra/shared'

/** Thực thi ở `packages/shared` — renderer dựng form và danh sách từ đúng các hàm này (CLAUDE.md §5). */

const NOW = 1_760_000_000_000
const host = (ok: boolean): JobHostResultDto => ({ hostId: ok ? 'h-ok' : 'h-bad', ok, code: ok ? 0 : 1, stdout: '', stderr: '', error: null, durationMs: 10 })

describe('capOutput', () => {
  test('ngắn hơn trần thì giữ nguyên', () => {
    expect(capOutput('abc')).toBe('abc')
  })

  test('dài hơn trần: giữ ĐẦU và CUỐI (lỗi thường ở cuối), nói rõ đã cắt bao nhiêu', () => {
    const text = 'ĐẦU-NGỮ-CẢNH' + 'A'.repeat(3000) + 'B'.repeat(3000) + 'LỖI-Ở-CUỐI'
    const out = capOutput(text, 1000)
    expect(out.length).toBeLessThan(1100)
    expect(out.startsWith('ĐẦU-NGỮ-CẢNH')).toBe(true)
    expect(out.endsWith('LỖI-Ở-CUỐI')).toBe(true)
    expect(out).toMatch(/cắt \d+ ký tự/)
  })

  test('trần mặc định là JOB_OUTPUT_CAP', () => {
    expect(capOutput('x'.repeat(JOB_OUTPUT_CAP))).toHaveLength(JOB_OUTPUT_CAP)
    expect(capOutput('x'.repeat(JOB_OUTPUT_CAP + 1)).length).toBeLessThanOrEqual(JOB_OUTPUT_CAP)
  })
})

describe('runFailed / runSeverity / summarizeRun', () => {
  test('any-host: một máy lỗi là thất bại', () => {
    expect(runFailed([host(true), host(false)], 'any-host')).toBe(true)
    expect(runFailed([host(true), host(true)], 'any-host')).toBe(false)
  })

  test('all-hosts: chỉ khi mọi máy lỗi', () => {
    expect(runFailed([host(true), host(false)], 'all-hosts')).toBe(false)
    expect(runFailed([host(false), host(false)], 'all-hosts')).toBe(true)
  })

  test('never: không bao giờ báo; lượt không host nào cũng không tính thất bại', () => {
    expect(runFailed([host(false), host(false)], 'never')).toBe(false)
    expect(runFailed([], 'any-host')).toBe(false)
  })

  test('severity: cả fleet đổ = critical, lẻ vài máy = warning', () => {
    expect(runSeverity([host(false), host(false)])).toBe('critical')
    expect(runSeverity([host(true), host(false)])).toBe('warning')
  })

  test('summarizeRun nói được bằng lời, kể cả lượt bỏ', () => {
    expect(summarizeRun({ status: 'ok', hosts: [host(true), host(true)], skipReason: null })).toBe('2/2 host OK')
    expect(summarizeRun({ status: 'failed', hosts: [host(true), host(false)], skipReason: null })).toBe('1/2 host OK · 1 lỗi')
    expect(summarizeRun({ status: 'skipped', hosts: [], skipReason: 'Vault đang khoá' })).toBe('Vault đang khoá')
  })
})

describe('sanitizeJob', () => {
  const ok = (raw: Parameters<typeof sanitizeJob>[0]) => sanitizeJob(raw, NOW, isValidCronExpression)

  test('điền mặc định, sinh id, nhãn lấy từ lệnh', () => {
    const job = ok({ kind: 'command', schedule: '15 3 * * *', hostIds: ['h1'], command: 'systemctl status nginx' })
    expect(job).toMatchObject({
      kind: 'command',
      schedule: '15 3 * * *',
      hostIds: ['h1'],
      command: 'systemctl status nginx',
      label: 'systemctl status nginx',
      enabled: true,
      failMode: 'any-host',
      timeoutMs: JOB_TIMEOUT_LIMITS.default,
      createdAt: NOW,
      lastRunAt: null,
      snippetId: null
    })
    expect(job!.id).toMatch(/^job-/)
  })

  test('nhãn dài bị cắt; lệnh nhiều dòng chỉ lấy dòng đầu', () => {
    const job = ok({ kind: 'command', schedule: '@daily', hostIds: ['h1'], command: `${'x'.repeat(60)}\ndòng hai` })
    expect(job!.label).toHaveLength(40)
    expect(job!.label.endsWith('…')).toBe(true)
  })

  test('kẹp timeout trong khoảng cho phép', () => {
    expect(ok({ kind: 'command', schedule: '@daily', hostIds: ['h1'], command: 'ls', timeoutMs: 1 })!.timeoutMs).toBe(JOB_TIMEOUT_LIMITS.min)
    expect(ok({ kind: 'command', schedule: '@daily', hostIds: ['h1'], command: 'ls', timeoutMs: 9_999_999 })!.timeoutMs).toBe(JOB_TIMEOUT_LIMITS.max)
  })

  test('inventory: KHÔNG cần host (rỗng = mọi host SSH), xoá lệnh và snippet', () => {
    const job = ok({ kind: 'inventory', schedule: '0 2 * * *', hostIds: [], command: 'bị bỏ', snippetId: 's1' })
    expect(job).toMatchObject({ kind: 'inventory', hostIds: [], command: '', snippetId: null, label: 'Thu kiểm kê fleet' })
  })

  test('snippet: giữ snippetId, xoá command', () => {
    const job = ok({ kind: 'snippet', schedule: '@weekly', hostIds: ['h1', 'h2'], snippetId: 's1', command: 'bị bỏ' })
    expect(job).toMatchObject({ kind: 'snippet', snippetId: 's1', command: '' })
  })

  test('trả null khi thiếu thứ không thay được', () => {
    expect(ok({ kind: 'command', schedule: 'sai bét', hostIds: ['h1'], command: 'ls' })).toBeNull()
    expect(ok({ kind: 'command', schedule: '@daily', hostIds: ['h1'], command: '   ' })).toBeNull()
    expect(ok({ kind: 'snippet', schedule: '@daily', hostIds: ['h1'], snippetId: null })).toBeNull()
    expect(ok({ kind: 'command', schedule: '@daily', hostIds: [], command: 'ls' })).toBeNull()
  })

  test('giữ id / createdAt / lastRunAt khi sửa job cũ, bỏ host rác', () => {
    const job = ok({
      id: 'job-1',
      kind: 'command',
      schedule: '@daily',
      hostIds: ['h1', '', 'h2'] as string[],
      command: 'ls',
      createdAt: 5,
      lastRunAt: 99,
      enabled: false,
      failMode: 'all-hosts'
    })
    expect(job).toMatchObject({ id: 'job-1', createdAt: 5, lastRunAt: 99, enabled: false, failMode: 'all-hosts', hostIds: ['h1', 'h2'] })
  })

  test('failMode lạ → any-host', () => {
    expect(ok({ kind: 'command', schedule: '@daily', hostIds: ['h1'], command: 'ls', failMode: 'xxx' as never })!.failMode).toBe('any-host')
  })
})
