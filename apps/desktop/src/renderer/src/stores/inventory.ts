import { create } from 'zustand'
import type { InventoryCollectResultDto, InventoryProgressDto, InventoryRowDto } from '@infra/shared'

interface InventoryState {
  rows: InventoryRowDto[]
  loaded: boolean
  /** Đợt thu đang chạy: đã xong bao nhiêu / tổng. null = không chạy. */
  progress: InventoryProgressDto | null
  /** Kết quả đợt thu gần nhất (để hiện host lỗi). */
  lastResults: InventoryCollectResultDto[]
  load: () => Promise<void>
  collect: (hostIds: string[]) => Promise<void>
  remove: (hostId: string) => Promise<void>
  applyProgress: (p: InventoryProgressDto) => void
}

/** Kiểm kê fleet — store renderer; kho thật ở main (`inventory.db`). */
export const useInventoryStore = create<InventoryState>((set, get) => ({
  rows: [],
  loaded: false,
  progress: null,
  lastResults: [],
  load: async () => {
    const rows = await window.infra.inventory.list()
    set({ rows, loaded: true })
  },
  collect: async (hostIds) => {
    if (hostIds.length === 0) return
    set({ progress: { hostId: '', done: 0, total: hostIds.length } })
    try {
      const results = await window.infra.inventory.collect(hostIds)
      const byId = new Map(get().rows.map((r) => [r.hostId, r]))
      for (const r of results) if (r.ok && r.row) byId.set(r.hostId, r.row)
      set({ rows: [...byId.values()].sort((a, b) => a.hostId.localeCompare(b.hostId)), lastResults: results })
    } finally {
      set({ progress: null })
    }
  },
  remove: async (hostId) => {
    await window.infra.inventory.remove(hostId)
    set({ rows: get().rows.filter((r) => r.hostId !== hostId) })
  },
  applyProgress: (progress) => set((s) => (s.progress ? { progress } : {}))
}))
