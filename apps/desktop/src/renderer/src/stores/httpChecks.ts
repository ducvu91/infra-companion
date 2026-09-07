import { create } from 'zustand'
import type { HttpCheckDto, HttpCheckInput, HttpCheckResultDto, HttpCheckSummaryDto } from '@infra/shared'

interface HttpChecksState {
  checks: HttpCheckDto[]
  /** Tóm tắt 24h theo check id — main tính, đẩy lại sau mỗi lần đo. */
  summaries: Record<string, HttpCheckSummaryDto>
  loaded: boolean
  load: () => Promise<void>
  save: (input: HttpCheckInput) => Promise<HttpCheckDto>
  remove: (id: string) => Promise<void>
  runNow: (id: string) => Promise<HttpCheckResultDto | null>
  applySummary: (summary: HttpCheckSummaryDto) => void
}

/**
 * Theo dõi URL — store renderer. Nguồn sự thật ở main (`http-checks.json` + `checks.db`); store
 * này nạp một lần lúc mở app (KHÔNG cần vault) và nhận tóm tắt mới qua `onSummary`. Dashboard đọc
 * `summaries` để đưa URL đang lỗi vào dải "Cần chú ý".
 */
export const useHttpChecksStore = create<HttpChecksState>((set, get) => ({
  checks: [],
  summaries: {},
  loaded: false,
  load: async () => {
    const [checks, list] = await Promise.all([window.infra.httpChecks.list(), window.infra.httpChecks.summaries()])
    const summaries: Record<string, HttpCheckSummaryDto> = {}
    for (const s of list) summaries[s.checkId] = s
    set({ checks, summaries, loaded: true })
  },
  save: async (input) => {
    const saved = await window.infra.httpChecks.save(input)
    const cur = get().checks
    set({ checks: cur.some((c) => c.id === saved.id) ? cur.map((c) => (c.id === saved.id ? saved : c)) : [...cur, saved] })
    return saved
  },
  remove: async (id) => {
    await window.infra.httpChecks.remove(id)
    const summaries = { ...get().summaries }
    delete summaries[id]
    set({ checks: get().checks.filter((c) => c.id !== id), summaries })
  },
  runNow: (id) => window.infra.httpChecks.runNow(id),
  applySummary: (summary) => set((s) => ({ summaries: { ...s.summaries, [summary.checkId]: summary } }))
}))
