import { DatabaseSync } from 'node:sqlite'
import type { HttpCheckResultDto } from '@infra/shared'

/**
 * Kết quả đo URL trong SQLite riêng (`checks.db`, userData, không mã hoá). Mỗi lần đo một dòng;
 * giữ 30 ngày. Cùng khuôn MetricsStore/EventStore: mở lười, migration append-only, prune theo giờ.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE results (
    check_id   TEXT    NOT NULL,
    ts         INTEGER NOT NULL,
    ok         INTEGER NOT NULL,
    status     INTEGER,
    latency_ms INTEGER,
    cert_days  INTEGER,
    error      TEXT,
    PRIMARY KEY (check_id, ts)
  ) WITHOUT ROWID;
  CREATE INDEX idx_results_ts ON results(ts);
  `
]

export const HTTP_RESULT_RETENTION_MS = 30 * 24 * 3_600_000
const PRUNE_INTERVAL_MS = 3_600_000

interface Row {
  check_id: string
  ts: number
  ok: number
  status: number | null
  latency_ms: number | null
  cert_days: number | null
  error: string | null
}

function toDto(r: Row): HttpCheckResultDto {
  return { checkId: r.check_id, ts: r.ts, ok: r.ok === 1, status: r.status, latencyMs: r.latency_ms, certDaysLeft: r.cert_days, error: r.error }
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

export class HttpCheckStore {
  private db: DatabaseSync | null = null
  private pruneTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly dbPath: string,
    private readonly now: () => number = () => Date.now()
  ) {}

  record(result: HttpCheckResultDto): void {
    this.ensureDb()
      .prepare('INSERT OR REPLACE INTO results (check_id, ts, ok, status, latency_ms, cert_days, error) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(result.checkId, result.ts, result.ok ? 1 : 0, result.status, result.latencyMs, result.certDaysLeft, result.error)
  }

  /** Kết quả từ `sinceTs`, cũ → mới, tối đa `limit` dòng gần nhất. */
  recent(checkId: string, sinceTs: number, limit = 5000): HttpCheckResultDto[] {
    const rows = this.ensureDb()
      .prepare('SELECT * FROM results WHERE check_id = ? AND ts >= ? ORDER BY ts DESC LIMIT ?')
      .all(checkId, sinceTs, Math.max(1, limit)) as unknown as Row[]
    return rows.reverse().map(toDto)
  }

  latest(checkId: string): HttpCheckResultDto | null {
    const row = this.ensureDb().prepare('SELECT * FROM results WHERE check_id = ? ORDER BY ts DESC LIMIT 1').get(checkId) as
      | Row
      | undefined
    return row ? toDto(row) : null
  }

  /** Xoá check thì xoá luôn lịch sử của nó — id không dùng lại. */
  deleteCheck(checkId: string): void {
    this.ensureDb().prepare('DELETE FROM results WHERE check_id = ?').run(checkId)
  }

  prune(): number {
    const r = this.ensureDb().prepare('DELETE FROM results WHERE ts < ?').run(this.now() - HTTP_RESULT_RETENTION_MS)
    return Number(r.changes)
  }

  close(): void {
    if (this.pruneTimer) clearInterval(this.pruneTimer)
    this.pruneTimer = null
    this.db?.close()
    this.db = null
  }

  private ensureDb(): DatabaseSync {
    if (this.db) return this.db
    this.db = openDb(this.dbPath)
    this.prune()
    this.pruneTimer = setInterval(() => this.prune(), PRUNE_INTERVAL_MS)
    this.pruneTimer.unref?.()
    return this.db
  }
}
