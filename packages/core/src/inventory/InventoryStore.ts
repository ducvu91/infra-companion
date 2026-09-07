import { DatabaseSync } from 'node:sqlite'
import { emptyFacts, type HostFactsDto, type InventoryRowDto } from '@infra/shared'

/**
 * Kho kiểm kê (`inventory.db`, userData, không mã hoá — facts là "máy này chạy Ubuntu 22.04,
 * PHP 8.3", không phải bí mật). Mỗi lần thu một dòng JSON; giữ `KEEP_PER_HOST` bản gần nhất mỗi
 * host để so lệch theo thời gian. Cùng khuôn với EventStore/HttpCheckStore.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE facts (
    host_id      TEXT    NOT NULL,
    collected_at INTEGER NOT NULL,
    json         TEXT    NOT NULL,
    PRIMARY KEY (host_id, collected_at)
  ) WITHOUT ROWID;
  `
]

export const KEEP_PER_HOST = 20

interface Row {
  host_id: string
  collected_at: number
  json: string
}

function openDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
  let version = row.user_version
  while (version < MIGRATIONS.length) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[version]!)
      version += 1
      db.exec(`PRAGMA user_version = ${version}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  return db
}

function parseJson(json: string): HostFactsDto {
  try {
    return { ...emptyFacts(), ...(JSON.parse(json) as Partial<HostFactsDto>) }
  } catch {
    return emptyFacts()
  }
}

export class InventoryStore {
  private db: DatabaseSync | null = null

  constructor(private readonly dbPath: string) {}

  /** Ghi một bản thu rồi cắt bớt bản cũ của host đó. Trả về dòng đầy đủ (kèm bản trước). */
  record(hostId: string, facts: HostFactsDto, collectedAt: number): InventoryRowDto {
    const db = this.ensureDb()
    db.prepare('INSERT OR REPLACE INTO facts (host_id, collected_at, json) VALUES (?, ?, ?)').run(hostId, collectedAt, JSON.stringify(facts))
    db.prepare(
      `DELETE FROM facts WHERE host_id = ? AND collected_at NOT IN (
         SELECT collected_at FROM facts WHERE host_id = ? ORDER BY collected_at DESC LIMIT ?
       )`
    ).run(hostId, hostId, KEEP_PER_HOST)
    return this.latest(hostId)!
  }

  /** Bản gần nhất + bản ngay trước của một host. */
  latest(hostId: string): InventoryRowDto | null {
    const rows = this.ensureDb()
      .prepare('SELECT * FROM facts WHERE host_id = ? ORDER BY collected_at DESC LIMIT 2')
      .all(hostId) as unknown as Row[]
    const cur = rows[0]
    if (!cur) return null
    const prev = rows[1]
    return {
      hostId,
      collectedAt: cur.collected_at,
      facts: parseJson(cur.json),
      previous: prev ? parseJson(prev.json) : null,
      previousAt: prev ? prev.collected_at : null
    }
  }

  /** Bản gần nhất của MỌI host trong kho (kèm bản trước), xếp theo host_id. */
  latestAll(): InventoryRowDto[] {
    const ids = (this.ensureDb().prepare('SELECT DISTINCT host_id FROM facts ORDER BY host_id').all() as unknown as Array<{ host_id: string }>).map(
      (r) => r.host_id
    )
    return ids.map((id) => this.latest(id)).filter((r): r is InventoryRowDto => r !== null)
  }

  /** Lịch sử một host, mới → cũ. */
  history(hostId: string): Array<{ collectedAt: number; facts: HostFactsDto }> {
    const rows = this.ensureDb().prepare('SELECT * FROM facts WHERE host_id = ? ORDER BY collected_at DESC').all(hostId) as unknown as Row[]
    return rows.map((r) => ({ collectedAt: r.collected_at, facts: parseJson(r.json) }))
  }

  deleteHost(hostId: string): void {
    this.ensureDb().prepare('DELETE FROM facts WHERE host_id = ?').run(hostId)
  }

  close(): void {
    this.db?.close()
    this.db = null
  }

  private ensureDb(): DatabaseSync {
    this.db ??= openDb(this.dbPath)
    return this.db
  }
}
