import { create } from 'zustand'
import type { AppEventDto, AppEventQuery, MarkerInput } from '@infra/shared'

/** Trần số sự kiện giữ trong renderer — trung tâm thông báo là chỗ xem gần đây. */
const MAX_EVENTS = 1000

interface EventsState {
  /** Danh sách theo bộ lọc lần `load` gần nhất, mới → cũ. */
  events: AppEventDto[]
  /** Số chưa đọc TOÀN kho (không theo bộ lọc) — hiện trên chuông StatusBar. */
  unread: number
  loaded: boolean
  load: (query?: AppEventQuery) => Promise<void>
  refreshUnread: () => Promise<void>
  ack: (id: number) => Promise<void>
  ackAll: () => Promise<void>
  remove: (id: number) => Promise<void>
  addMarker: (input: MarkerInput) => Promise<AppEventDto | null>
  /** Sự kiện mới từ main (EVENTS_NEW) — chèn lên đầu, cộng chưa đọc nếu không phải marker. */
  applyNew: (event: AppEventDto) => void
  setUnread: (n: number) => void
}

/**
 * Trung tâm thông báo — store renderer, nguồn sự thật là `events.db` ở main. App.tsx đăng ký
 * `onNew`/`onChanged` một lần; mọi cửa sổ (kể cả cửa sổ tách rời) cùng nhận.
 */
export const useEventsStore = create<EventsState>((set, get) => ({
  events: [],
  unread: 0,
  loaded: false,
  load: async (query) => {
    const events = await window.infra.events.list(query)
    set({ events, loaded: true })
  },
  refreshUnread: async () => {
    set({ unread: await window.infra.events.unread() })
  },
  ack: async (id) => {
    await window.infra.events.ack(id)
    const now = Date.now()
    set({ events: get().events.map((e) => (e.id === id && e.ackedAt === null ? { ...e, ackedAt: now } : e)) })
  },
  ackAll: async () => {
    await window.infra.events.ackAll()
    const now = Date.now()
    set({ events: get().events.map((e) => (e.ackedAt === null ? { ...e, ackedAt: now } : e)), unread: 0 })
  },
  remove: async (id) => {
    await window.infra.events.remove(id)
    set({ events: get().events.filter((e) => e.id !== id) })
  },
  addMarker: async (input) => {
    // Sự kiện mới quay về qua EVENTS_NEW → applyNew chèn vào danh sách; không chèn tay để khỏi trùng
    return window.infra.events.addMarker(input)
  },
  applyNew: (event) =>
    set((s) => ({
      events: s.events.some((e) => e.id === event.id) ? s.events : [event, ...s.events].slice(0, MAX_EVENTS),
      unread: event.kind === 'marker' || event.ackedAt !== null ? s.unread : s.unread + 1
    })),
  setUnread: (unread) => set({ unread })
}))
