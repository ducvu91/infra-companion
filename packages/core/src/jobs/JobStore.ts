import { DatabaseSync } from 'node:sqlite'
import { JOB_RUN_KEEP, type JobHostResultDto, type JobRunDto, type JobRunStatus } from '@infra/shared'

/**
 * Lịch sử các lượt chạy theo lịch (`jobs.db` ở userData, không mã hoá — output lệnh chẩn đoán,
 * không phải bí mật; nếu lệnh của user in ra bí mật thì đó là lựa chọn của họ, và ghi chú ở UI
 * nói rõ điều đó).
 *
 * Giữ {@link JOB_RUN_KEEP} lượt gần nhất mỗi job: đủ để trả lời "backup đêm qua có chạy không, và
 * lần cuối nó fail là khi nào", không phình thành kho log.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id      TEXT    NOT NULL,
    started_at  INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    status      TEXT    NOT NULL,
    skip_reason TEXT,
    hosts_json  TEXT    NOT NULL
  );
  CREATE INDEX idx_runs_job ON runs(job_id, started_at);
  `
]

interface Row {
  id: number
  job_id: string
  started_at: number
  duration_ms: number
  status: string
  skip_reason: string | null
  hosts_json: string
}

function toDto(row: Row): JobRunDto {
  let hosts: JobHostResultDto[] = []
  try {
    const parsed = JSON.parse(row.hosts_json) as unknown
    if (Array.isArray(parsed)) hosts = parsed as JobHostResultDto[]
  } catch {
    /* JSON hỏng → coi như lượt không có chi tiết, vẫn hiện được dòng tóm tắt */
  }
  return {
    id: row.id,
    jobId: row.job_id,
    startedAt: row.started_at,
    durationMs: row.duration_ms,
    status: row.status as JobRunStatus,
    skipReason: row.skip_reason,
    hosts
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

export class JobStore {
  private db: DatabaseSync | null = null

  constructor(private readonly dbPath: string) {}

  /** Ghi một lượt rồi cắt bớt lượt cũ của job đó. Trả về lượt vừa ghi (có id). */
  record(run: Omit<JobRunDto, 'id'>): JobRunDto {
    const db = this.ensureDb()
    const res = db
      .prepare('INSERT INTO runs (job_id, started_at, duration_ms, status, skip_reason, hosts_json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(run.jobId, run.startedAt, run.durationMs, run.status, run.skipReason, JSON.stringify(run.hosts))
    db.prepare(
      `DELETE FROM runs WHERE job_id = ? AND id NOT IN (
         SELECT id FROM runs WHERE job_id = ? ORDER BY started_at DESC, id DESC LIMIT ?
       )`
    ).run(run.jobId, run.jobId, JOB_RUN_KEEP)
    return { id: Number(res.lastInsertRowid), ...run }
  }

  /** Lượt của một job, mới → cũ. */
  runs(jobId: string, limit = JOB_RUN_KEEP): JobRunDto[] {
    const rows = this.ensureDb()
      .prepare('SELECT * FROM runs WHERE job_id = ? ORDER BY started_at DESC, id DESC LIMIT ?')
      .all(jobId, Math.max(1, limit)) as unknown as Row[]
    return rows.map(toDto)
  }

  /** Lượt gần nhất của MỌI job — danh sách job hiện "lần chạy cuối" mà không phải hỏi từng cái. */
  latestPerJob(): Record<string, JobRunDto> {
    const rows = this.ensureDb()
      .prepare('SELECT * FROM runs WHERE id IN (SELECT MAX(id) FROM runs GROUP BY job_id)')
      .all() as unknown as Row[]
    const out: Record<string, JobRunDto> = {}
    for (const row of rows) out[row.job_id] = toDto(row)
    return out
  }

  /** Xoá job thì xoá luôn lịch sử của nó — id không dùng lại. */
  deleteJob(jobId: string): void {
    this.ensureDb().prepare('DELETE FROM runs WHERE job_id = ?').run(jobId)
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
