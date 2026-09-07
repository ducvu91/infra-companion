import { describe, expect, test } from 'vitest'
import { collectAttention, type AttentionInput } from '@infra/shared'

/** Thực thi ở `packages/shared` — renderer không import được `@infra/core` (CLAUDE.md §5). */
function input(over: Partial<AttentionInput> = {}): AttentionInput {
  return {
    watcherEnabled: true,
    hosts: [],
    hostStatus: {},
    tunnels: [],
    tunnelState: {},
    replicaIssues: [],
    ...over
  }
}

describe('collectAttention', () => {
  test('không có vấn đề gì → rỗng (dải sẽ không hiện)', () => {
    expect(collectAttention(input())).toEqual([])
  })

  test('host fail → một mục host-down', () => {
    const items = collectAttention(
      input({ hosts: [{ id: 'h1', label: 'app-01' }], hostStatus: { h1: { ok: false } } })
    )
    expect(items).toEqual([{ kind: 'host-down', id: 'host:h1', label: 'app-01' }])
  })

  test('host CHƯA có kết quả check KHÔNG tính là hỏng', () => {
    // Không thế thì mỗi lần mới bật watcher sẽ thấy cả fleet đang cháy
    const items = collectAttention(input({ hosts: [{ id: 'h1', label: 'app-01' }], hostStatus: {} }))
    expect(items).toEqual([])
  })

  test('watcher TẮT thì bỏ qua host hẳn — im lặng khác với "đều ổn"', () => {
    const items = collectAttention(
      input({ watcherEnabled: false, hosts: [{ id: 'h1', label: 'app-01' }], hostStatus: { h1: { ok: false } } })
    )
    expect(items).toEqual([])
  })

  test('tunnel lỗi được tính, tunnel do user TỰ TẮT thì không', () => {
    const tunnels = [
      { id: 't1', label: 'db-tunnel' },
      { id: 't2', label: 'web-tunnel' }
    ]
    const items = collectAttention(
      input({
        tunnels,
        tunnelState: { t1: { status: 'error', detail: 'connect ECONNREFUSED' }, t2: { status: 'stopped' } }
      })
    )
    expect(items).toEqual([
      { kind: 'tunnel-error', id: 'tunnel:t1', label: 'db-tunnel', detail: 'connect ECONNREFUSED' }
    ])
  })

  test('tunnel đang chạy hoặc đang khởi động không phải vấn đề', () => {
    const items = collectAttention(
      input({
        tunnels: [{ id: 't1', label: 'db-tunnel' }],
        tunnelState: { t1: { status: 'active' } }
      })
    )
    expect(items).toEqual([])
  })

  test('replication lệch đi kèm chi tiết', () => {
    const items = collectAttention(input({ replicaIssues: [{ id: 'r1', label: 'db-02', detail: 'trễ 340s' }] }))
    expect(items).toEqual([{ kind: 'replication', id: 'repl:r1', label: 'db-02', detail: 'trễ 340s' }])
  })

  test('thứ tự cố định host → tunnel → replication (dải không nhảy giữa 2 lần render)', () => {
    const items = collectAttention(
      input({
        hosts: [{ id: 'h1', label: 'app-01' }],
        hostStatus: { h1: { ok: false } },
        tunnels: [{ id: 't1', label: 'db-tunnel' }],
        tunnelState: { t1: { status: 'error' } },
        replicaIssues: [{ id: 'r1', label: 'db-02' }]
      })
    )
    expect(items.map((i) => i.kind)).toEqual(['host-down', 'tunnel-error', 'replication'])
  })

  test('id có tiền tố theo loại nên host và tunnel trùng id vẫn khác khoá', () => {
    const items = collectAttention(
      input({
        hosts: [{ id: 'x', label: 'app-01' }],
        hostStatus: { x: { ok: false } },
        tunnels: [{ id: 'x', label: 'db-tunnel' }],
        tunnelState: { x: { status: 'error' } }
      })
    )
    expect(new Set(items.map((i) => i.id)).size).toBe(2)
  })

  test('URL: chỉ check ĐANG BÁO mới lên dải, kèm lý do lần đo cuối; fail lẻ chưa đủ thì không', () => {
    const items = collectAttention(
      input({
        httpChecks: [
          { id: 'c1', label: 'example.com' },
          { id: 'c2', label: 'api.example.net' },
          { id: 'c3', label: 'chưa đo' }
        ],
        httpState: {
          c1: { alerting: true, last: { error: 'HTTP 502 (mong 200-399)' } },
          c2: { alerting: false, last: { error: 'hết giờ sau 10000ms' } }
        }
      })
    )
    expect(items).toEqual([{ kind: 'http-down', id: 'http:c1', label: 'example.com', detail: 'HTTP 502 (mong 200-399)' }])
  })

  test('không truyền phần URL (Dashboard cũ) → không ảnh hưởng', () => {
    expect(collectAttention(input({ httpChecks: undefined, httpState: undefined }))).toEqual([])
  })
})
