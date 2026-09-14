import { create } from 'zustand'

/**
 * F70 — thao tác với nhân vật mà user ĐÃ tự làm (nhấn giữ, click phải, Shift+kéo…).
 *
 * Nhân vật chỉ gợi những thao tác chưa làm; làm hết thì im. Nhớ qua `localStorage` vì đây là
 * tiện ích theo người xem: mở app lần sau mà bị nhắc lại "nhấn giữ để chat" khi đã chat cả tuần
 * là loại nhắc việc khiến người ta tắt luôn nhân vật. Không đưa vào settings — không phải cấu
 * hình, không cần sync, mất cũng vô hại (chỉ được nhắc lại vài câu).
 */
const KEY = 'infra.vrm.hintsDone'

function readDone(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    const arr: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return [] // private window / JSON hỏng → coi như chưa làm gì, chỉ tốn vài câu nhắc
  }
}

interface VrmHintsState {
  done: string[]
  markDone: (id: string) => void
}

export const useVrmHintsStore = create<VrmHintsState>((set, get) => ({
  done: readDone(),
  markDone: (id) => {
    if (get().done.includes(id)) return
    const done = [...get().done, id]
    try {
      localStorage.setItem(KEY, JSON.stringify(done))
    } catch {
      // storage bị chặn → vẫn nhớ trong phiên
    }
    set({ done })
  }
}))
