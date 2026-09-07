// Cần node:sqlite (Node >= 22.5) — Node 20 dev tự skip, chạy đủ qua Node của Electron/CI.
import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { HttpCheckResultDto } from '@infra/shared'

let StoreClass: typeof import('./HttpCheckStore').HttpCheckStore | null = null
let RETENTION = 0
try {
  await import('node:sqlite')
  const mod = await import('./HttpCheckStore')
  StoreClass = mod.HttpCheckStore
  RETENTION = mod.HTTP_RESULT_RETENTION_MS
} catch {
  /* node:sqlite không có — skip */
}

const tmpRoots: string[] = []
const stores: Array<{ close(): void }> = []

function newStore(now: () => number = () => Date.now()): InstanceType<NonNullable<typeof StoreClass>> {
  const dir = mkdtempSync(join(tmpdir(), 'infra-checks-'))
  tmpRoots.push(dir)
  const store = new StoreClass!(join(dir, 'checks.db'), now)
  stores.push(store)
  return store
}

afterAll(() => {
  for (const s of stores) s.close()
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true })
})

const T0 = 1_760_000_000_000
const r = (ts: number, ok: boolean, checkId = 'c1'): HttpCheckResultDto => ({
  checkId,
  ts,
  ok,
  status: ok ? 200 : 502,
  latencyMs: ok ? 80 : null,
  certDaysLeft: ok ? 60 : null,
  error: ok ? null : 'HTTP 502 (mong 200-399)'
})

describe.skipIf(!StoreClass)('HttpCheckStore', () => {
  it('record + recent cũ → mới theo since, latest = mới nhất', () => {
    const store = newStore()
    store.record(r(T0, true))
    store.record(r(T0 + 1000, false))
    store.record(r(T0 + 2000, true))
    store.record(r(T0 + 500, true, 'c2'))
    expect(store.recent('c1', T0 + 1000).map((x) => x.ts)).toEqual([T0 + 1000, T0 + 2000])
    expect(store.recent('c1', 0)).toHaveLength(3)
    expect(store.latest('c1')?.ts).toBe(T0 + 2000)
    expect(store.latest('c2')?.checkId).toBe('c2')
    expect(store.latest('nope')).toBeNull()
  })

  it('cùng (check, ts) ghi lại là thay, không nhân đôi', () => {
    const store = newStore()
    store.record(r(T0, false))
    store.record(r(T0, true))
    const rows = store.recent('c1', 0)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.ok).toBe(true)
  })

  it('deleteCheck xoá đúng lịch sử của check đó', () => {
    const store = newStore()
    store.record(r(T0, true, 'c1'))
    store.record(r(T0, true, 'c2'))
    store.deleteCheck('c1')
    expect(store.recent('c1', 0)).toEqual([])
    expect(store.recent('c2', 0)).toHaveLength(1)
  })

  it('prune xoá kết quả quá 30 ngày', () => {
    const now = T0 + 100 * 24 * 3_600_000
    const store = newStore(() => now)
    store.record(r(now - RETENTION - 1, true))
    store.record(r(now - 1000, true))
    expect(store.prune()).toBe(1)
    expect(store.recent('c1', 0).map((x) => x.ts)).toEqual([now - 1000])
  })
})
