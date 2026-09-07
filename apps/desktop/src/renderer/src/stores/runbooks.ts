import { create } from 'zustand'
import type { Runbook } from '@infra/shared'

interface RunbooksState {
  /** Sổ tay RIÊNG của user (từ vault meta). Sổ tay có sẵn là hằng `RUNBOOK_LIBRARY`, không qua store. */
  custom: Runbook[]
  loaded: boolean
  /** Lý do không nạp được (vault khoá) — UI hiện dòng nhắc thay vì danh sách rỗng câm. */
  error: string | null
  load: () => Promise<void>
  save: (runbook: Runbook) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useRunbooksStore = create<RunbooksState>((set) => ({
  custom: [],
  loaded: false,
  error: null,
  load: async () => {
    try {
      const custom = await window.infra.runbooks.listCustom()
      set({ custom, loaded: true, error: null })
    } catch (err) {
      set({ loaded: true, error: err instanceof Error ? err.message : String(err) })
    }
  },
  save: async (runbook) => {
    const custom = await window.infra.runbooks.saveCustom(runbook)
    set({ custom, error: null })
  },
  remove: async (id) => {
    const custom = await window.infra.runbooks.deleteCustom(id)
    set({ custom })
  }
}))
