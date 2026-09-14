import { create } from 'zustand'
import { appendTurn, type VrmChatTurn } from '@infra/shared'

/**
 * F70 — hội thoại với nhân vật, giữ NGOÀI component.
 *
 * Bong bóng chat bị unmount mỗi lần đóng, nên để `history`/`input` trong `useState` là **mất
 * sạch khi tắt rồi mở lại** — user gõ dở một câu hoặc vừa nhận câu trả lời, bấm ✕ là không còn
 * gì. Store sống theo phiên app nên đóng/mở bao nhiêu lần vẫn đúng chỗ cũ.
 *
 * **Không** ghi xuống đĩa: đây là hỏi nhanh trong lúc làm việc, không phải nhật ký cần giữ; và
 * nội dung chat hay dính tên host/đường dẫn thật nên không đáng nằm lại trong `userData`.
 */
interface VrmChatState {
  history: VrmChatTurn[]
  /** Câu đang gõ dở — giữ lại để đóng/mở không mất chữ. */
  draft: string
  busy: boolean
  /**
   * Đang thu nhỏ về bong bóng trên đầu nhân vật.
   *
   * Ở store chứ không `useState`: user thu nhỏ rồi đóng rồi mở lại thì phải vẫn thu nhỏ — bật
   * lại thành khung to là làm ngược ý họ vừa bày tỏ.
   */
  mini: boolean
  /**
   * Nhân vật đang hiện trên màn (stage đã dựng xong).
   *
   * Cho nút "thu về nhân vật" trên dock AI biết có chỗ để về — không có nhân vật thì không mời.
   * Đọc ở đây thay vì cờ `vrmPanelOpen` của `ui`: cờ đó bật từ lúc bấm mở, còn model 40 MB nạp
   * vài giây; bấm "thu về" vào một khung trống là bấm vào hư không.
   */
  attached: boolean
  /**
   * Bộ đếm yêu cầu mở bong bóng từ NGOÀI panel nhân vật (nút thu về ở dock AI). Mỗi lần tăng là
   * một lần mở; là bộ đếm chứ không phải cờ để hai yêu cầu liên tiếp không bị gộp thành một.
   */
  openRequest: number
  setDraft: (v: string) => void
  setBusy: (v: boolean) => void
  setMini: (v: boolean) => void
  setAttached: (v: boolean) => void
  requestOpen: () => void
  push: (turn: VrmChatTurn) => void
  /** Trả lịch sử về một mốc đã biết (dùng khi lượt hỏi thất bại). */
  restore: (history: VrmChatTurn[], draft: string) => void
  clear: () => void
}

export const useVrmChatStore = create<VrmChatState>((set) => ({
  history: [],
  draft: '',
  busy: false,
  mini: false,
  attached: false,
  openRequest: 0,
  setDraft: (draft) => set({ draft }),
  setBusy: (busy) => set({ busy }),
  setMini: (mini) => set({ mini }),
  setAttached: (attached) => set({ attached }),
  requestOpen: () => set((s) => ({ openRequest: s.openRequest + 1 })),
  push: (turn) => set((s) => ({ history: appendTurn(s.history, turn) })),
  restore: (history, draft) => set({ history, draft }),
  clear: () => set({ history: [], draft: '' })
}))
