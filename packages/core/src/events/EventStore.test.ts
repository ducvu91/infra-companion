// Cần node:sqlite (Node >= 22.5) — Node 20 dev tự skip, chạy đủ qua Node của Electron/CI
// (giống MetricsStore.test.ts). Chạy tay: $env:ELECTRON_RUN_AS_NODE=1; electron vitest run
import { describe, expect, it, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let EventStoreClass: typeof import('./EventStore').EventStore | null = null
let retention: { EVENT_RETENTION_MS: number; MARKER_RETENTION_MS: number } | null = null
try {
  await import('node:sqlite')
  const mod = await import('./EventStore')
  EventStoreClass = mod.EventStore
  retention = { EVENT_RETENTION_MS: mod.EVENT_RETENTION_MS, MARKER_RETENTION_MS: mod.MARKER_RETENTION_MS }
} catch {
  /* node:sqlite không có — skip */
}

const tmpRoots: string[] = []
const stores: Array<{ close(): void }> = []

function newStore(now: () => number = () => Date.now()): InstanceType<NonNullable<typeof EventStoreClass>> {
  const dir = mkdtempSync(join(tmpdir(), 'infra-events-'))
  tmpRoots.push(dir)
  const store = new EventStoreClass!(join(dir, 'events.db'), now)
  stores.push(store)
  return store
}

afterAll(() => {
  // close() TRƯỚC khi xoá — SQLite mở (WAL) làm rmSync EPERM trên Windows
  for (const s of stores) s.close()
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true })
})

const T0 = 1_760_000_000_000

describe.skipIf(!EventStoreClass)('EventStore', () => {
  it('ghi rồi liệt kê mới → cũ; marker tự coi là đã đọc, alert thì chưa', () => {
    const store = newStore()
    const a = store.add({ kind: 'alert', source: 'watcher', severity: 'critical', hostId: 'h1', title: 'app-01 không phản hồi', ts: T0 })
    const m = store.add({ kind: 'marker', source: 'user', severity: 'info', hostId: null, title: 'Deploy v2', ts: T0 + 1000 })
    expect(a.ackedAt).toBeNull()
    expect(m.ackedAt).toBe(T0 + 1000)
    const list = store.list()
    expect(list.map((e) => e.id)).toEqual([m.id, a.id])
    expect(list[1]).toMatchObject({ kind: 'alert', source: 'watcher', hostId: 'h1', detail: null })
  })

  it('đếm chưa đọc bỏ marker; ack một / ack hết đều đổi số đếm', () => {
    const store = newStore(() => T0 + 5000)
    const a = store.add({ kind: 'alert', source: 'monitor', severity: 'warning', hostId: 'h1', title: 'CPU cao', ts: T0 })
    store.add({ kind: 'recover', source: 'monitor', severity: 'info', hostId: 'h1', title: 'CPU hồi', ts: T0 + 1 })
    store.add({ kind: 'marker', source: 'user', severity: 'info', title: 'Deploy', ts: T0 + 2 })
    expect(store.unreadCount()).toBe(2)
    store.ack(a.id)
    expect(store.unreadCount()).toBe(1)
    expect(store.list({ unackedOnly: true }).map((e) => e.title)).toEqual(['CPU hồi'])
    expect(store.list().find((e) => e.id === a.id)?.ackedAt).toBe(T0 + 5000)
    store.ackAll()
    expect(store.unreadCount()).toBe(0)
  })

  it('lọc theo since / nguồn / host / limit', () => {
    const store = newStore()
    store.add({ kind: 'alert', source: 'tunnel', severity: 'warning', hostId: 'h1', title: 't1', ts: T0 })
    store.add({ kind: 'alert', source: 'watcher', severity: 'critical', hostId: 'h2', title: 'w1', ts: T0 + 10 })
    store.add({ kind: 'info', source: 'app', severity: 'info', title: 'a1', ts: T0 + 20 })
    expect(store.list({ since: T0 + 10 }).map((e) => e.title)).toEqual(['a1', 'w1'])
    expect(store.list({ sources: ['tunnel', 'app'] }).map((e) => e.title)).toEqual(['a1', 't1'])
    expect(store.list({ hostId: 'h2' }).map((e) => e.title)).toEqual(['w1'])
    expect(store.list({ limit: 1 }).map((e) => e.title)).toEqual(['a1'])
  })

  it('xoá một sự kiện', () => {
    const store = newStore()
    const e = store.add({ kind: 'info', source: 'app', severity: 'info', title: 'x', ts: T0 })
    store.remove(e.id)
    expect(store.list()).toEqual([])
  })

  it('timeline của host: marker toàn fleet + marker host + alert/recover của host, cũ → mới, đúng khoảng', () => {
    const store = newStore()
    store.add({ kind: 'marker', source: 'user', severity: 'info', hostId: null, title: 'Deploy fleet', ts: T0 + 100 })
    store.add({ kind: 'marker', source: 'user', severity: 'info', hostId: 'h1', title: 'Restart nginx h1', ts: T0 + 200 })
    store.add({ kind: 'marker', source: 'user', severity: 'info', hostId: 'h2', title: 'Chỉ h2', ts: T0 + 250 })
    store.add({ kind: 'alert', source: 'monitor', severity: 'warning', hostId: 'h1', title: 'CPU h1', ts: T0 + 300 })
    store.add({ kind: 'alert', source: 'monitor', severity: 'warning', hostId: 'h2', title: 'CPU h2', ts: T0 + 310 })
    store.add({ kind: 'info', source: 'app', severity: 'info', hostId: 'h1', title: 'info không vẽ', ts: T0 + 320 })
    store.add({ kind: 'recover', source: 'monitor', severity: 'info', hostId: 'h1', title: 'CPU h1 hồi', ts: T0 + 400 })
    store.add({ kind: 'marker', source: 'user', severity: 'info', hostId: null, title: 'Ngoài khoảng', ts: T0 + 10_000 })

    expect(store.timeline('h1', T0, T0 + 1000).map((e) => e.title)).toEqual([
      'Deploy fleet',
      'Restart nginx h1',
      'CPU h1',
      'CPU h1 hồi'
    ])
    // Không gắn host → chỉ marker toàn fleet
    expect(store.timeline(null, T0, T0 + 1000).map((e) => e.title)).toEqual(['Deploy fleet'])
  })

  it('prune: alert quá 30 ngày bị xoá, marker giữ tới 180 ngày', () => {
    const now = T0 + 400 * 24 * 3_600_000
    const store = newStore(() => now)
    store.add({ kind: 'alert', source: 'monitor', severity: 'warning', title: 'cũ', ts: now - retention!.EVENT_RETENTION_MS - 1 })
    store.add({ kind: 'alert', source: 'monitor', severity: 'warning', title: 'mới', ts: now - 1000 })
    store.add({ kind: 'marker', source: 'user', severity: 'info', title: 'marker 100 ngày', ts: now - 100 * 24 * 3_600_000 })
    store.add({ kind: 'marker', source: 'user', severity: 'info', title: 'marker quá hạn', ts: now - retention!.MARKER_RETENTION_MS - 1 })
    expect(store.prune()).toBe(2)
    expect(store.list().map((e) => e.title).sort()).toEqual(['marker 100 ngày', 'mới'])
  })
})
