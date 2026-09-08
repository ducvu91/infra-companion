import { create } from 'zustand'
import type { FolderPairDto, FolderPairInput, FolderScanDto, FolderSyncEventDto } from '@infra/shared'

/** Dòng "vừa xảy ra gì" hiện dưới bảng — giữ ít, đủ để thấy watcher có thật sự đẩy hay không. */
export interface SyncLogLine {
  at: number
  path?: string
  message: string
  ok: boolean
}

const LOG_KEEP = 40

interface FolderSyncState {
  pairs: FolderPairDto[]
  /** Kết quả quét gần nhất theo cặp — đổi cặp qua lại không phải quét lại. */
  scans: Record<string, FolderScanDto>
  /** Cặp nào đang quét / đang đẩy. */
  busy: Set<string>
  /** Cặp nào đang theo dõi (main là nguồn sự thật, đến qua sự kiện). */
  watching: Set<string>
  log: Record<string, SyncLogLine[]>
  loaded: boolean
  load: () => Promise<void>
  save: (input: FolderPairInput) => Promise<FolderPairDto>
  remove: (id: string) => Promise<void>
  scan: (id: string) => Promise<void>
  push: (id: string, paths?: string[]) => Promise<string>
  setWatch: (id: string, on: boolean) => Promise<void>
  applyEvent: (e: FolderSyncEventDto) => void
}

/**
 * F28/F29 — store renderer cho các cặp thư mục. Watcher chạy ở main nên nó vẫn đẩy khi user đóng
 * màn hình này; store chỉ chiếu lại trạng thái để vẽ.
 */
export const useFolderSyncStore = create<FolderSyncState>((set, get) => ({
  pairs: [],
  scans: {},
  busy: new Set(),
  watching: new Set(),
  log: {},
  loaded: false,
  load: async () => {
    const pairs = await window.infra.folderSync.list()
    set({ pairs, loaded: true, watching: new Set(pairs.filter((p) => p.watch).map((p) => p.id)) })
  },
  save: async (input) => {
    const saved = await window.infra.folderSync.save(input)
    const cur = get().pairs
    set({ pairs: cur.some((p) => p.id === saved.id) ? cur.map((p) => (p.id === saved.id ? saved : p)) : [...cur, saved] })
    return saved
  },
  remove: async (id) => {
    await window.infra.folderSync.remove(id)
    const scans = { ...get().scans }
    delete scans[id]
    const watching = new Set(get().watching)
    watching.delete(id)
    set({ pairs: get().pairs.filter((p) => p.id !== id), scans, watching })
  },
  scan: async (id) => {
    set((s) => ({ busy: new Set(s.busy).add(id) }))
    try {
      const scan = await window.infra.folderSync.scan(id)
      set((s) => ({ scans: { ...s.scans, [id]: scan } }))
    } finally {
      set((s) => {
        const busy = new Set(s.busy)
        busy.delete(id)
        return { busy }
      })
    }
  },
  push: async (id, paths) => {
    set((s) => ({ busy: new Set(s.busy).add(id) }))
    try {
      const res = await window.infra.folderSync.push(id, paths)
      // Đẩy xong thì bảng cũ đã sai (những dòng vừa đẩy nay là "same") → quét lại
      const scan = await window.infra.folderSync.scan(id)
      set((s) => ({ scans: { ...s.scans, [id]: scan } }))
      return res.message
    } finally {
      set((s) => {
        const busy = new Set(s.busy)
        busy.delete(id)
        return { busy }
      })
    }
  },
  setWatch: async (id, on) => {
    const watching = await window.infra.folderSync.watch(id, on)
    set((s) => {
      const next = new Set(s.watching)
      if (watching) next.add(id)
      else next.delete(id)
      return { watching: next, pairs: s.pairs.map((p) => (p.id === id ? { ...p, watch: watching } : p)) }
    })
  },
  applyEvent: (e) =>
    set((s) => {
      const watching = new Set(s.watching)
      if (e.type === 'watch') {
        if (e.watching) watching.add(e.pairId)
        else watching.delete(e.pairId)
      }
      const line: SyncLogLine | null =
        e.type === 'pushed'
          ? { at: e.at, path: e.path, message: 'đã đẩy', ok: true }
          : e.type === 'error'
            ? { at: Date.now(), path: e.path, message: e.message, ok: false }
            : e.message
              ? { at: Date.now(), message: e.message, ok: e.watching }
              : null
      const log = line ? { ...s.log, [e.pairId]: [line, ...(s.log[e.pairId] ?? [])].slice(0, LOG_KEEP) } : s.log
      return { watching, log }
    })
}))
