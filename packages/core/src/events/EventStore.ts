import { DatabaseSync } from 'node:sqlite'
import type { AppEventDto, AppEventInput, AppEventKind, AppEventQuery, AppEventSeverity, AppEventSource } from '@infra/shared'

/**
 * Kho sự kiện chung của app (`events.db` ở userData, KHÔNG mã hoá — nội dung là "host X không
 * phản hồi lúc 10:02", không phải bí mật; tách khỏi vault.db để không đụng schema vault).
 *
 * Trước đây mỗi hệ theo dõi (monitoring, replication, uptime watcher, tunnel) tự bắn toast rồi
 * thôi: toast trôi là mất, mở app sáng hôm sau không biết đêm qua có gì. Kho này là chỗ mọi hệ
 * cùng ghi vào, trung tâm thông báo đọc ra, và biểu đồ metrics vẽ lại thành vạch (marker deploy
 * của user cũng nằm đây — kind `marker`).
 */

/** Chỉ append vào cuối, KHÔNG sửa entry cũ (giống vault/db.ts, metrics). */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    ts        INTEGER NOT NULL,
    kind      TEXT    NOT NULL,
    source    TEXT    NOT NULL,
    severity  TEXT    NOT NULL,
    host_id   TEXT,
    title     TEXT    NOT NULL,
    detail    TEXT,
    acked_at  INTEGER
  );
  CREATE INDEX idx_events_ts ON events(ts);
  CREATE INDEX idx_events_host_ts ON events(host_id, ts);
  `
]

/** Alert/recover/info giữ 30 ngày; marker do user đặt giữ 180 ngày (deploy tháng trước vẫn đáng đối chiếu). */
export const EVENT_RETENTION_MS = 30 * 24 * 3_600_000
export const MARKER_RETENTION_MS = 180 * 24 * 3_600_000
const DEFAULT_LIMIT = 500
const PRUNE_INTERVAL_MS = 3_600_000

interface Row {
  id: number
  ts: number
  kind: string
  source: string
  severity: string
  host_id: string | null
  title: string
  detail: string | null
  acked_at: number | null
}

function toDto(row: Row): AppEventDto {
  return {
    id: row.id,
    ts: row.ts,
    kind: row.kind as AppEventKind,
    source: row.source as AppEventSource,
    severity: row.severity as AppEventSeverity,
    hostId: row.host_id,
    title: row.title,
    detail: row.detail,
    ackedAt: row.acked_at
  }
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

export class EventStore {
  private db: DatabaseSync | null = null
  private pruneTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly dbPath: string,
    private readonly now: () => number = () => Date.now()
  ) {}

  /** Ghi một sự kiện; marker luôn coi như đã đọc (acked_at = ts) vì user vừa tự tay đặt nó. */
  add(input: AppEventInput): AppEventDto {
    const db = this.ensureDb()
    const ts = input.ts ?? this.now()
    const ackedAt = input.kind === 'marker' ? ts : null
    const result = db
      .prepare('INSERT INTO events (ts, kind, source, severity, host_id, title, detail, acked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ts, input.kind, input.source, input.severity, input.hostId ?? null, input.title, input.detail ?? null, ackedAt)
    const id = Number(result.lastInsertRowid)
    return {
      id,
      ts,
      kind: input.kind,
      source: input.source,
      severity: input.severity,
      hostId: input.hostId ?? null,
      title: input.title,
      detail: input.detail ?? null,
      ackedAt
    }
  }

  /** Mới → cũ. Bộ lọc nào không truyền thì không áp. */
  list(query: AppEventQuery = {}): AppEventDto[] {
    const db = this.ensureDb()
    const where: string[] = []
    const params: Array<string | number> = []
    if (query.since !== undefined) {
      where.push('ts >= ?')
      params.push(query.since)
    }
    if (query.unackedOnly) where.push("acked_at IS NULL AND kind <> 'marker'")
    if (query.sources && query.sources.length > 0) {
      where.push(`source IN (${query.sources.map(() => '?').join(', ')})`)
      params.push(...query.sources)
    }
    if (query.hostId !== undefined) {
      where.push('host_id = ?')
      params.push(query.hostId)
    }
    const limit = Math.max(1, Math.min(5000, query.limit ?? DEFAULT_LIMIT))
    const sql = `SELECT * FROM events${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ts DESC, id DESC LIMIT ?`
    return (db.prepare(sql).all(...params, limit) as unknown as Row[]).map(toDto)
  }

  unreadCount(): number {
    const row = this.ensureDb().prepare("SELECT COUNT(*) AS n FROM events WHERE acked_at IS NULL AND kind <> 'marker'").get() as {
      n: number
    }
    return row.n
  }

  ack(id: number): void {
    this.ensureDb().prepare('UPDATE events SET acked_at = ? WHERE id = ? AND acked_at IS NULL').run(this.now(), id)
  }

  ackAll(): void {
    this.ensureDb().prepare('UPDATE events SET acked_at = ? WHERE acked_at IS NULL').run(this.now())
  }

  remove(id: number): void {
    this.ensureDb().prepare('DELETE FROM events WHERE id = ?').run(id)
  }

  /**
   * Dòng thời gian cho biểu đồ của một host: marker TOÀN FLEET (host_id NULL) + marker của host +
   * alert/recover của host, trong khoảng `from…to`, cũ → mới. `hostId` null = chỉ marker toàn fleet
   * (biểu đồ không gắn host).
   */
  timeline(hostId: string | null, fromTs: number, toTs: number): AppEventDto[] {
    const db = this.ensureDb()
    const rows =
      hostId === null
        ? (db
            .prepare("SELECT * FROM events WHERE kind = 'marker' AND host_id IS NULL AND ts >= ? AND ts <= ? ORDER BY ts")
            .all(fromTs, toTs) as unknown as Row[])
        : (db
            .prepare(
              `SELECT * FROM events WHERE ts >= ? AND ts <= ? AND (
                 (kind = 'marker' AND (host_id IS NULL OR host_id = ?))
                 OR (kind IN ('alert', 'recover') AND host_id = ?)
               ) ORDER BY ts`
            )
            .all(fromTs, toTs, hostId, hostId) as unknown as Row[])
    return rows.map(toDto)
  }

  /** Dọn theo hạn giữ. Trả số dòng đã xoá. */
  prune(): number {
    const db = this.ensureDb()
    const now = this.now()
    const a = db.prepare("DELETE FROM events WHERE kind <> 'marker' AND ts < ?").run(now - EVENT_RETENTION_MS)
    const b = db.prepare("DELETE FROM events WHERE kind = 'marker' AND ts < ?").run(now - MARKER_RETENTION_MS)
    return Number(a.changes) + Number(b.changes)
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
    // unref: timer dọn không được giữ tiến trình sống lúc thoát
    this.pruneTimer = setInterval(() => this.prune(), PRUNE_INTERVAL_MS)
    this.pruneTimer.unref?.()
    return this.db
  }
}
