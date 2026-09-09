import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, type WebContents } from 'electron'
import { BulkService, JobStore, type BulkTarget } from '@infra/core'
import {
  IPC,
  capOutput,
  isDue,
  isValidCronExpression,
  runFailed,
  runSeverity,
  sanitizeJob,
  summarizeRun,
  type JobHostResultDto,
  type JobRunDto,
  type ScheduledJobDto,
  type ScheduledJobInput
} from '@infra/shared'
import { makeHostKeyVerifier, prepareConnection } from './connection'
import { recordEvent } from './events'
import { collectInventoryFor } from './inventory'
import { getVault } from './vault'

/**
 * F40 — Lịch chạy tự động.
 *
 * Cấu hình ở `jobs.json` (userData) chứ KHÔNG trong vault: scheduler phải biết lịch ngay khi app
 * mở, trước cả lúc user mở khoá. Nhưng lúc CHẠY thì cần vault mở (phải đọc credential của host),
 * nên lượt nào gặp vault khoá sẽ ghi một lượt `skipped` kèm lý do thay vì im lặng — im lặng ở đây
 * nghĩa là user tưởng backup vẫn được kiểm mỗi đêm.
 *
 * KHÔNG gọi `touchActivity()` trong vòng kiểm: một cái đồng hồ nền không phải "user đang dùng
 * app", nếu đếm thì vault sẽ không bao giờ tự khoá (cùng bài học với auto-sync ở v0.2.8).
 */

/** Vòng kiểm: 30 giây. Lịch nhỏ nhất của cron là một phút, nên nửa phút là đủ mà không trễ. */
const TICK_MS = 30_000
const CONCURRENCY = 4

let jobs: ScheduledJobDto[] = []
let loaded = false
let store: JobStore | null = null
let timer: NodeJS.Timeout | null = null
const running = new Set<string>()
/** Mốc coi như "vừa bật" cho job chưa từng chạy — tính từ lúc app khởi động, không từ 1970. */
const enabledAt = new Map<string, number>()

function configPath(): string {
  return join(app.getPath('userData'), 'jobs.json')
}

function getStore(): JobStore {
  store ??= new JobStore(join(app.getPath('userData'), 'jobs.db'))
  return store
}

function loadJobs(): ScheduledJobDto[] {
  if (loaded) return jobs
  loaded = true
  const now = Date.now()
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf8')) as unknown
    const list = Array.isArray(raw) ? raw : []
    jobs = list
      .map((j) => sanitizeJob(j as Partial<ScheduledJobDto>, now, isValidCronExpression))
      .filter((j): j is ScheduledJobDto => j !== null)
  } catch {
    jobs = [] // chưa có file hoặc hỏng → bắt đầu trống, ghi lại ở lần lưu sau
  }
  for (const job of jobs) if (!enabledAt.has(job.id)) enabledAt.set(job.id, now)
  return jobs
}

function saveJobs(): void {
  try {
    writeFileSync(configPath(), JSON.stringify(jobs, null, 2), 'utf8')
  } catch (error) {
    console.error('[jobs] cannot write config:', error instanceof Error ? error.message : error)
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/** Cửa sổ chính — nơi `prepareConnection` gửi câu hỏi host key nếu cần. */
function mainSender(): WebContents | null {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !w.webContents.isDestroyed())
  return win ? win.webContents : null
}

/** Lệnh thật sẽ chạy: `command` thì là chính nó, `snippet` thì lấy script từ vault. */
function resolveCommand(job: ScheduledJobDto): string | null {
  if (job.kind === 'command') return job.command
  if (job.kind !== 'snippet' || !job.snippetId) return null
  const snippet = getVault().listSnippets().find((s) => s.id === job.snippetId)
  return snippet ? snippet.script : null
}

/** Host áp dụng: job `inventory` với danh sách rỗng = mọi host SSH đang có. */
function resolveHostIds(job: ScheduledJobDto): string[] {
  if (job.kind === 'inventory' && job.hostIds.length === 0) {
    return getVault()
      .listHosts()
      .filter((h) => h.protocol === 'ssh')
      .map((h) => h.id)
  }
  return job.hostIds
}

/**
 * Chốt sổ một lượt: ghi lịch sử, cập nhật `lastRunAt`, báo renderer, và ghi sự kiện khi cần.
 * MỘT chỗ duy nhất làm việc này để lượt bỏ và lượt chạy thật không lệch nhau về sau.
 */
function finish(job: ScheduledJobDto, run: Omit<JobRunDto, 'id'>): JobRunDto {
  const saved = getStore().record(run)
  job.lastRunAt = run.startedAt
  saveJobs()
  broadcast(IPC.JOBS_RUN_EVENT, { phase: 'done', jobId: job.id, run: saved })

  if (run.status === 'skipped') {
    // Bỏ lượt phải nói ra: im lặng ở đây nghĩa là user tưởng backup vẫn được kiểm mỗi đêm
    recordEvent({ kind: 'info', source: 'app', severity: 'info', title: `⏰ [${job.label}] bỏ lượt — ${run.skipReason ?? ''}`.trim() })
  } else if (runFailed(run.hosts, job.failMode)) {
    const bad = run.hosts.filter((h) => !h.ok)
    recordEvent({
      kind: 'alert',
      source: 'app',
      severity: runSeverity(run.hosts),
      title: `⏰ [${job.label}] thất bại — ${summarizeRun(run)}`,
      detail: bad
        .slice(0, 5)
        .map((h) => `${h.hostId}: ${h.error ?? h.stderr.split('\n')[0] ?? `exit ${h.code}`}`)
        .join(' · ')
    })
  }
  return saved
}

/**
 * Chạy một job.
 *
 * Chạy tay cũng đặt `lastRunAt` như chạy theo lịch: bấm thử lúc 10h thì lượt 3h sáng mai vẫn tới
 * đúng giờ, chỉ lượt còn tồn đọng của hôm nay là bỏ — đúng thứ người ta mong đợi sau khi vừa
 * chạy tay xong.
 */
export async function runJob(job: ScheduledJobDto, _manual: boolean): Promise<JobRunDto | null> {
  if (running.has(job.id)) return null // lượt trước còn dở → bỏ, không chạy chồng
  running.add(job.id)
  const startedAt = Date.now()
  broadcast(IPC.JOBS_RUN_EVENT, { phase: 'running', jobId: job.id })
  const skip = (skipReason: string): JobRunDto =>
    finish(job, { jobId: job.id, startedAt, durationMs: 0, status: 'skipped', skipReason, hosts: [] })
  try {
    if (getVault().state() !== 'unlocked') return skip('Vault đang khoá')
    const sender = mainSender()
    if (!sender) return skip('Không có cửa sổ nào để hỏi host key')
    const hostIds = resolveHostIds(job)
    if (hostIds.length === 0) return skip('Không có host nào áp dụng')

    const hosts: JobHostResultDto[] =
      job.kind === 'inventory' ? await runInventory(sender, hostIds) : await runCommand(job, sender, hostIds)
    return finish(job, {
      jobId: job.id,
      startedAt,
      durationMs: Date.now() - startedAt,
      status: runFailed(hosts, job.failMode) ? 'failed' : 'ok',
      skipReason: null,
      hosts
    })
  } finally {
    running.delete(job.id)
  }
}

/** `command` / `snippet`: dùng đúng BulkService của Bulk Execution để hành vi giống nhau. */
async function runCommand(job: ScheduledJobDto, sender: WebContents, hostIds: string[]): Promise<JobHostResultDto[]> {
  const command = resolveCommand(job)
  if (!command) {
    return hostIds.map((hostId) => ({ hostId, ok: false, code: null, stdout: '', stderr: '', error: 'Không tìm thấy snippet', durationMs: 0 }))
  }
  const targets: BulkTarget[] = []
  const results: JobHostResultDto[] = []
  for (const hostId of hostIds) {
    const host = getVault().getHost(hostId)
    if (!host || host.protocol !== 'ssh') {
      results.push({ hostId, ok: false, code: null, stdout: '', stderr: '', error: host ? 'Không phải host SSH' : 'Host không tồn tại', durationMs: 0 })
      continue
    }
    try {
      const prepared = await prepareConnection(sender, hostId)
      targets.push({ hostId, label: prepared.title, chain: prepared.chain, loginSteps: prepared.loginSteps })
    } catch (error) {
      results.push({ hostId, ok: false, code: null, stdout: '', stderr: '', error: error instanceof Error ? error.message : String(error), durationMs: 0 })
    }
  }
  await new BulkService().run(
    targets,
    command,
    makeHostKeyVerifier(sender),
    () => {},
    (r) =>
      results.push({
        hostId: r.hostId,
        ok: r.status === 'done' && (r.code ?? 0) === 0,
        code: r.code,
        stdout: capOutput(r.stdout),
        stderr: capOutput(r.stderr),
        error: r.error ?? null,
        durationMs: r.durationMs
      }),
    { concurrency: CONCURRENCY, timeoutMs: job.timeoutMs }
  )
  return results
}

/** `inventory`: gọi lại đúng đường thu facts của công cụ Kiểm kê fleet. */
async function runInventory(sender: WebContents, hostIds: string[]): Promise<JobHostResultDto[]> {
  const results = await collectInventoryFor(sender, hostIds)
  return results.map((r) => ({
    hostId: r.hostId,
    ok: r.ok,
    code: r.ok ? 0 : null,
    stdout: r.ok ? 'đã thu facts' : '',
    stderr: '',
    error: r.error ?? null,
    durationMs: 0
  }))
}

/** Một nhịp kiểm: chạy mọi job đang bật và đã đến hạn. Không ném ra ngoài. */
async function tick(): Promise<void> {
  const now = Date.now()
  for (const job of loadJobs()) {
    if (!job.enabled || running.has(job.id)) continue
    if (!isDue(job.schedule, now, job.lastRunAt, enabledAt.get(job.id) ?? job.createdAt)) continue
    try {
      await runJob(job, false)
    } catch (error) {
      console.error('[jobs] run failed:', error instanceof Error ? error.message : error)
    }
  }
}

/** Gọi sau `app.whenReady()`. */
export function startJobScheduler(): void {
  loadJobs()
  if (timer) return
  timer = setInterval(() => void tick(), TICK_MS)
  timer.unref?.()
}

export function registerJobsIpc(): () => void {
  ipcMain.handle(IPC.JOBS_LIST, () => ({ jobs: loadJobs(), latest: getStore().latestPerJob() }))

  ipcMain.handle(IPC.JOBS_SAVE, (_e, input: ScheduledJobInput): ScheduledJobDto => {
    loadJobs()
    const existing = input.id ? jobs.find((j) => j.id === input.id) : undefined
    const clean = sanitizeJob(
      { ...input, createdAt: existing?.createdAt, lastRunAt: existing?.lastRunAt },
      Date.now(),
      isValidCronExpression
    )
    if (!clean) throw new Error('Lịch hoặc nội dung việc không hợp lệ')
    if (existing) jobs = jobs.map((j) => (j.id === clean.id ? clean : j))
    else jobs = [...jobs, clean]
    enabledAt.set(clean.id, Date.now())
    saveJobs()
    return clean
  })

  ipcMain.handle(IPC.JOBS_DELETE, (_e, id: string) => {
    loadJobs()
    jobs = jobs.filter((j) => j.id !== String(id))
    enabledAt.delete(String(id))
    saveJobs()
    getStore().deleteJob(String(id))
  })

  ipcMain.handle(IPC.JOBS_RUN_NOW, async (_e, id: string) => {
    const job = loadJobs().find((j) => j.id === String(id))
    return job ? runJob(job, true) : null
  })

  ipcMain.handle(IPC.JOBS_RUNS, (_e, id: string) => getStore().runs(String(id)))

  return () => {
    if (timer) clearInterval(timer)
    timer = null
    store?.close()
    store = null
  }
}
