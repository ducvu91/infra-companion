import { create } from 'zustand'
import { shortenCommand, shouldNotify, type CommandRecord } from '@infra/shared'
import { useEventsStore } from './events'
import { useSettingsStore } from './settings'
import { useTabsStore } from './tabs'
import { useToastsStore } from './toasts'

/** Số bản ghi lệnh giữ mỗi pane — đủ để hiện lịch sử gần đây, không phình bộ nhớ. */
const MAX_PER_PANE = 200

interface PaneState {
  /** Lệnh đang chạy (đã thấy mốc C, chưa thấy D) — null khi đang ở prompt. */
  runningSince: number | null
  runningCommand: string
  /** Dòng user đang gõ, app tự ghép từ input để biết lệnh gì vừa chạy (shell không gửi kèm). */
  typing: string
  /** Lệnh đã chạy xong, mới → cũ. */
  records: CommandRecord[]
  /** Pane này có shell gửi OSC 133 không — dùng để hiện gợi ý "bật shell integration". */
  integrated: boolean
}

const emptyPane = (): PaneState => ({ runningSince: null, runningCommand: '', typing: '', records: [], integrated: false })

interface ShellMarksState {
  panes: Record<string, PaneState>
  /** Gõ ký tự vào pane (từ `onData`) — theo dõi dòng đang gõ để biết tên lệnh. */
  onInput: (sessionId: string, data: string) => void
  /** Mốc bắt đầu lệnh (OSC 133;C). */
  onCommandStart: (sessionId: string) => void
  /** Mốc lệnh xong (OSC 133;D) — chốt bản ghi và cân nhắc thông báo. */
  onCommandDone: (sessionId: string, exitCode: number | null, paneTitle: string) => void
  reset: (sessionId: string) => void
}

/**
 * F23/F26 — trạng thái shell integration theo pane.
 *
 * Marker OSC 133 nói "lệnh bắt đầu / lệnh xong + exit code" nhưng KHÔNG nói lệnh là gì, nên app
 * tự ghép dòng đang gõ từ `onData`. Cách này không hoàn hảo (dán nhiều dòng, sửa bằng mũi tên, hay
 * lệnh do script gửi đều làm nó lệch) — nên nó CHỈ dùng cho nhãn và thông báo, không bao giờ
 * dùng để chạy lại. Ranh giới và exit code thì lấy từ marker nên luôn đúng.
 */
export const useShellMarksStore = create<ShellMarksState>((set, get) => ({
  panes: {},

  onInput: (sessionId, data) =>
    set((s) => {
      const pane = s.panes[sessionId] ?? emptyPane()
      let typing = pane.typing
      for (const ch of data) {
        if (ch === '\r' || ch === '\n') typing = ''
        else if (ch === '\x7f' || ch === '\b') typing = typing.slice(0, -1)
        else if (ch === '\x03' || ch === '\x15') typing = '' // Ctrl+C / Ctrl+U
        else if (ch >= ' ') typing += ch
      }
      // Trần độ dài: một lần dán 1MB không được giữ nguyên trong state
      if (typing.length > 4000) typing = typing.slice(-4000)
      return { panes: { ...s.panes, [sessionId]: { ...pane, typing } } }
    }),

  onCommandStart: (sessionId) =>
    set((s) => {
      const pane = s.panes[sessionId] ?? emptyPane()
      return {
        panes: {
          ...s.panes,
          [sessionId]: { ...pane, integrated: true, runningSince: Date.now(), runningCommand: pane.typing.trim(), typing: '' }
        }
      }
    }),

  onCommandDone: (sessionId, exitCode, paneTitle) => {
    const pane = get().panes[sessionId]
    const startedAt = pane?.runningSince ?? null
    const command = pane?.runningCommand ?? ''
    const durationMs = startedAt !== null ? Date.now() - startedAt : 0
    set((s) => {
      const cur = s.panes[sessionId] ?? emptyPane()
      const records =
        startedAt !== null
          ? [{ command, startedAt, durationMs, exitCode }, ...cur.records].slice(0, MAX_PER_PANE)
          : cur.records
      return { panes: { ...s.panes, [sessionId]: { ...cur, integrated: true, runningSince: null, runningCommand: '', records } } }
    })
    if (startedAt === null) return

    // F26 — báo khi lệnh dài xong. "Pane đang hiện" = tab của nó active VÀ cửa sổ đang focus:
    // đang nhìn thì thông báo chỉ là tiếng ồn.
    const settings = useSettingsStore.getState()
    const tabs = useTabsStore.getState()
    const activeTab = tabs.tabs.find((t) => t.id === tabs.activeId)
    const paneVisible = document.hasFocus() && !!activeTab?.panes.some((p) => p.sessionId === sessionId)
    const decision = shouldNotify({ command, durationMs, paneVisible, enabled: settings.notifyLongCommands })
    if (!decision.notify) return

    const ok = exitCode === null || exitCode === 0
    const text = `${ok ? '✅' : '❌'} [${paneTitle}] ${shortenCommand(command)} — ${Math.round(durationMs / 1000)}s${exitCode !== null && exitCode !== 0 ? ` · exit ${exitCode}` : ''}`
    useToastsStore.getState().push(text, ok ? 'info' : 'error')
    // Vào trung tâm thông báo để sáng mai còn thấy: lệnh chạy 40 phút xong lúc nửa đêm là thứ
    // đáng có bản ghi, không chỉ một toast trôi qua.
    useEventsStore.getState()
    void window.infra.events
      .addMarker({ hostId: null, title: text })
      .catch(() => {
        /* vault khoá — bỏ, toast đã hiện */
      })
  },

  reset: (sessionId) =>
    set((s) => {
      const panes = { ...s.panes }
      delete panes[sessionId]
      return { panes }
    })
}))
