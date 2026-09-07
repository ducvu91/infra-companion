// Cần node:sqlite (Node >= 22.5) — Node 20 dev tự skip, chạy đủ qua Node của Electron/CI.
import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyFacts } from '@infra/shared'

let StoreClass: typeof import('./InventoryStore').InventoryStore | null = null
let KEEP = 0
try {
  await import('node:sqlite')
  const mod = await import('./InventoryStore')
  StoreClass = mod.InventoryStore
  KEEP = mod.KEEP_PER_HOST
} catch {
  /* node:sqlite không có — skip */
}

const tmpRoots: string[] = []
const stores: Array<{ close(): void }> = []

function newStore(): InstanceType<NonNullable<typeof StoreClass>> {
  const dir = mkdtempSync(join(tmpdir(), 'infra-inventory-'))
  tmpRoots.push(dir)
  const store = new StoreClass!(join(dir, 'inventory.db'))
  stores.push(store)
  return store
}

afterAll(() => {
  for (const s of stores) s.close()
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true })
})

const T0 = 1_760_000_000_000
const facts = (kernel: string) => ({ ...emptyFacts(), hostname: 'app-01', kernel, versions: { php: '8.3.6' } })

describe.skipIf(!StoreClass)('InventoryStore', () => {
  it('record trả bản gần nhất kèm bản trước; lần đầu previous = null', () => {
    const store = newStore()
    const first = store.record('h1', facts('5.15.0-100'), T0)
    expect(first.previous).toBeNull()
    expect(first.facts.kernel).toBe('5.15.0-100')
    const second = store.record('h1', facts('5.15.0-105'), T0 + 1000)
    expect(second.collectedAt).toBe(T0 + 1000)
    expect(second.previous?.kernel).toBe('5.15.0-100')
    expect(second.previousAt).toBe(T0)
  })

  it('latestAll: mỗi host một dòng, xếp theo host_id; history mới → cũ', () => {
    const store = newStore()
    store.record('h2', facts('a'), T0)
    store.record('h1', facts('b'), T0)
    store.record('h1', facts('c'), T0 + 5)
    const all = store.latestAll()
    expect(all.map((r) => r.hostId)).toEqual(['h1', 'h2'])
    expect(all[0]!.facts.kernel).toBe('c')
    expect(store.history('h1').map((h) => h.facts.kernel)).toEqual(['c', 'b'])
  })

  it('giữ tối đa KEEP_PER_HOST bản mỗi host', () => {
    const store = newStore()
    for (let i = 0; i < KEEP + 5; i += 1) store.record('h1', facts(`k${i}`), T0 + i)
    const hist = store.history('h1')
    expect(hist).toHaveLength(KEEP)
    expect(hist[0]!.facts.kernel).toBe(`k${KEEP + 4}`)
  })

  it('deleteHost xoá hết lịch sử của host đó; JSON hỏng → emptyFacts thay vì ném', () => {
    const store = newStore()
    store.record('h1', facts('x'), T0)
    store.record('h2', facts('y'), T0)
    store.deleteHost('h1')
    expect(store.latest('h1')).toBeNull()
    expect(store.latestAll()).toHaveLength(1)
  })
})
