import { create } from 'zustand'
import type { JobRunDto, ScheduledJobDto, ScheduledJobInput } from '@infra/shared'

interface JobsState {
  jobs: ScheduledJobDto[]
  /** Lượt gần nhất theo job id — danh sách hiện "lần chạy cuối" mà không phải hỏi từng cái. */
  latest: Record<string, JobRunDto>
  /** Job đang chạy (từ sự kiện của main) — nút Chạy ngay mờ đi trong lúc đó. */
  running: Set<string>
  loaded: boolean
  load: () => Promise<void>
  save: (input: ScheduledJobInput) => Promise<ScheduledJobDto>
  remove: (id: string) => Promise<void>
  runNow: (id: string) => Promise<void>
  applyRunEvent: (e: { phase: 'running'; jobId: string } | { phase: 'done'; jobId: string; run: JobRunDto }) => void
}

/**
 * F40 — Lịch chạy tự động, store renderer. Nguồn sự thật ở main (`jobs.json` + `jobs.db`): lịch
 * vẫn chạy khi không cửa sổ nào mở màn hình này, nên store chỉ là bản chiếu để vẽ.
 */
export const useJobsStore = create<JobsState>((set, get) => ({
  jobs: [],
  latest: {},
  running: new Set(),
  loaded: false,
  load: async () => {
    const { jobs, latest } = await window.infra.jobs.list()
    set({ jobs, latest, loaded: true })
  },
  save: async (input) => {
    const saved = await window.infra.jobs.save(input)
    const cur = get().jobs
    set({ jobs: cur.some((j) => j.id === saved.id) ? cur.map((j) => (j.id === saved.id ? saved : j)) : [...cur, saved] })
    return saved
  },
  remove: async (id) => {
    await window.infra.jobs.remove(id)
    const latest = { ...get().latest }
    delete latest[id]
    set({ jobs: get().jobs.filter((j) => j.id !== id), latest })
  },
  runNow: async (id) => {
    // Kết quả về qua `onRunEvent` (applyRunEvent) — không set tay để một đường cập nhật duy nhất
    await window.infra.jobs.runNow(id)
  },
  applyRunEvent: (e) =>
    set((s) => {
      const running = new Set(s.running)
      if (e.phase === 'running') {
        running.add(e.jobId)
        return { running }
      }
      running.delete(e.jobId)
      return {
        running,
        latest: { ...s.latest, [e.jobId]: e.run },
        // `lastRunAt` đổi ở main → cập nhật để "lần kế tiếp" tính lại đúng
        jobs: s.jobs.map((j) => (j.id === e.jobId ? { ...j, lastRunAt: e.run.startedAt } : j))
      }
    })
}))
