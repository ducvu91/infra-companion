import type { AppEventSeverity } from './types'

/**
 * Lịch chạy tự động (F40) — kiểu dữ liệu + phép tính thuần dùng chung main/renderer.
 *
 * App đã sống 24/7 trong khay hệ thống (v0.2.22) và có kho sự kiện (v0.2.23), nên phần còn thiếu
 * chỉ là "chạy cái gì, khi nào, và giữ lại kết quả". Ba loại việc, đều là thứ app đã làm được khi
 * user tự bấm:
 *  · `command` — chạy một lệnh trên N host (như Bulk Execution);
 *  · `snippet` — chạy một snippet đã lưu trên N host;
 *  · `inventory` — thu kiểm kê fleet cho N host (để bảng luôn mới và ô đổi tự nổi lên).
 *
 * Cấu hình lưu `jobs.json` ở userData (KHÔNG trong vault: scheduler phải biết lịch cả khi vault
 * khoá — nhưng lúc CHẠY thì cần vault mở vì phải đọc credential; lượt nào vault khoá thì bỏ và
 * ghi lý do). Lịch sử chạy ở `jobs.db`.
 */

export type JobKind = 'command' | 'snippet' | 'inventory'

/** Ngưỡng coi một lượt là thất bại — quyết định có báo hay không. */
export type JobFailMode =
  /** Bất kỳ host nào lỗi (exit code ≠ 0 hoặc không nối được). */
  | 'any-host'
  /** Chỉ khi TẤT CẢ host lỗi (dùng cho việc chạy trên fleet lớn, một máy đang bảo trì là bình thường). */
  | 'all-hosts'
  /** Không bao giờ báo — chỉ ghi lịch sử. */
  | 'never'

export interface ScheduledJobDto {
  id: string
  label: string
  kind: JobKind
  /** Biểu thức cron 5 trường hoặc bí danh `@daily`… (giờ theo máy này). */
  schedule: string
  /** Host áp dụng. Rỗng với `inventory` = mọi host SSH. */
  hostIds: string[]
  /** `command`: lệnh chạy. `snippet`: rỗng. */
  command: string
  /** `snippet`: id snippet trong vault. */
  snippetId: string | null
  enabled: boolean
  failMode: JobFailMode
  /** Trần thời gian mỗi host (ms). */
  timeoutMs: number
  createdAt: number
  /** Lần chạy gần nhất (mọi kết quả) — scheduler dùng để tính mốc kế tiếp. */
  lastRunAt: number | null
}

export type ScheduledJobInput = Omit<ScheduledJobDto, 'id' | 'createdAt' | 'lastRunAt'> & { id?: string }

export interface JobHostResultDto {
  hostId: string
  ok: boolean
  code: number | null
  /** Cắt bớt trước khi lưu — lịch sử là để đối chiếu, không phải kho log. */
  stdout: string
  stderr: string
  error: string | null
  durationMs: number
}

export type JobRunStatus = 'ok' | 'failed' | 'skipped'

export interface JobRunDto {
  id: number
  jobId: string
  startedAt: number
  durationMs: number
  status: JobRunStatus
  /** Vì sao bỏ lượt (vault khoá, không host nào hợp lệ) — chỉ có với `skipped`. */
  skipReason: string | null
  hosts: JobHostResultDto[]
}

/** Trần ký tự output lưu mỗi host mỗi lượt. */
export const JOB_OUTPUT_CAP = 4000
/** Giữ bao nhiêu lượt gần nhất mỗi job. */
export const JOB_RUN_KEEP = 50

export const JOB_TIMEOUT_LIMITS = { min: 5_000, max: 600_000, default: 120_000 } as const

/** Cắt output cho lịch sử: giữ ĐẦU và CUỐI, bỏ giữa — lỗi thường nằm ở cuối, ngữ cảnh ở đầu. */
export function capOutput(text: string, cap: number = JOB_OUTPUT_CAP): string {
  if (text.length <= cap) return text
  const head = Math.floor(cap * 0.6)
  const tail = cap - head - 24
  return `${text.slice(0, head)}\n… (cắt ${text.length - head - tail} ký tự) …\n${text.slice(text.length - tail)}`
}

/** Một lượt là thất bại hay không, theo `failMode`. Lượt không có host nào KHÔNG tính là thất bại. */
export function runFailed(hosts: readonly Pick<JobHostResultDto, 'ok'>[], mode: JobFailMode): boolean {
  if (mode === 'never' || hosts.length === 0) return false
  const bad = hosts.filter((h) => !h.ok).length
  return mode === 'all-hosts' ? bad === hosts.length : bad > 0
}

/** Mức nghiêm trọng của sự kiện khi một lượt thất bại: cả fleet đổ = critical, lẻ vài máy = warning. */
export function runSeverity(hosts: readonly Pick<JobHostResultDto, 'ok'>[]): AppEventSeverity {
  const bad = hosts.filter((h) => !h.ok).length
  return bad > 0 && bad === hosts.length ? 'critical' : 'warning'
}

/** Câu tóm tắt một lượt cho danh sách và cho thông báo. */
export function summarizeRun(run: Pick<JobRunDto, 'status' | 'hosts' | 'skipReason'>): string {
  if (run.status === 'skipped') return run.skipReason ?? 'đã bỏ lượt'
  const bad = run.hosts.filter((h) => !h.ok)
  if (bad.length === 0) return `${run.hosts.length}/${run.hosts.length} host OK`
  return `${run.hosts.length - bad.length}/${run.hosts.length} host OK · ${bad.length} lỗi`
}

function clampInt(v: unknown, lim: { min: number; max: number; default: number }): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return lim.default
  return Math.min(lim.max, Math.max(lim.min, Math.round(n)))
}

/**
 * Chuẩn hoá một job từ input hoặc từ JSON trên đĩa (user sửa tay được). Trả null khi thiếu thứ
 * không thay được: lịch sai, `command` mà không có lệnh, `snippet` mà không có id.
 */
export function sanitizeJob(raw: Partial<ScheduledJobDto>, now: number, isValidSchedule: (s: string) => boolean): ScheduledJobDto | null {
  const kind: JobKind = raw.kind === 'snippet' || raw.kind === 'inventory' ? raw.kind : 'command'
  const schedule = String(raw.schedule ?? '').trim()
  if (!isValidSchedule(schedule)) return null
  const command = String(raw.command ?? '').trim()
  const snippetId = typeof raw.snippetId === 'string' && raw.snippetId ? raw.snippetId : null
  if (kind === 'command' && !command) return null
  if (kind === 'snippet' && !snippetId) return null
  const hostIds = Array.isArray(raw.hostIds) ? raw.hostIds.filter((h): h is string => typeof h === 'string' && h !== '') : []
  if (kind !== 'inventory' && hostIds.length === 0) return null
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `job-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    label: String(raw.label ?? '').trim() || defaultLabel(kind, command),
    kind,
    schedule,
    hostIds,
    command: kind === 'command' ? command : '',
    snippetId: kind === 'snippet' ? snippetId : null,
    enabled: raw.enabled !== false,
    failMode: raw.failMode === 'all-hosts' || raw.failMode === 'never' ? raw.failMode : 'any-host',
    timeoutMs: clampInt(raw.timeoutMs, JOB_TIMEOUT_LIMITS),
    createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now,
    lastRunAt: typeof raw.lastRunAt === 'number' && Number.isFinite(raw.lastRunAt) ? raw.lastRunAt : null
  }
}

function defaultLabel(kind: JobKind, command: string): string {
  if (kind === 'inventory') return 'Thu kiểm kê fleet'
  if (kind === 'snippet') return 'Chạy snippet'
  const first = command.split('\n')[0] ?? ''
  return first.length > 40 ? `${first.slice(0, 39)}…` : first || 'Việc theo lịch'
}
