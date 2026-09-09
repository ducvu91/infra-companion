import { create } from 'zustand'
import { prepareForStore, shortenCommand, shouldNotify, shouldRecord, type CommandRecord } from '@infra/shared'
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
  /**
   * F24 — đã có lệnh KHÔNG ghi được vào lịch sử (gần như luôn là vault đã auto-lock giữa lúc
   * làm việc: ghi lịch sử cố ý không `touchActivity()` nên đồng hồ khoá vẫn chạy).
   *
   * Tồn tại để ô tìm nói ĐÚNG nguyên nhân. Không có cờ này thì danh sách rỗng hiện thông báo
   * "cần shell integration" — chỉ đường sai hoàn toàn khi shell integration vẫn đang chạy tốt,
   * đúng loại "xanh nhưng không hoạt động" mà CLAUDE.md §8 cảnh báo.
   */
  writeBlocked: boolean
  clearWriteBlocked: () => void
  /** Gõ ký tự vào pane (từ `onData`) — theo dõi dòng đang gõ để biết tên lệnh. */
  onInput: (sessionId: string, data: string) => void
  /**
   * Mốc bắt đầu lệnh (OSC 133;C). `command` = dòng lệnh đọc từ BUFFER terminal (đã bỏ prompt) —
   * pane truyền vào vì chỉ nó có `Terminal`. Thiếu thì lùi về `typing` ghép từ input.
   */
  onCommandStart: (sessionId: string, command?: string) => void
  /**
   * Mốc lệnh xong (OSC 133;D) — chốt bản ghi, lưu bền (F24) và cân nhắc thông báo (F26).
   * `hostId` null = phiên local shell; nó quyết định lệnh này thuộc lịch sử của máy nào.
   */
  onCommandDone: (sessionId: string, exitCode: number | null, paneTitle: string, hostId?: string | null) => void
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
  writeBlocked: false,
  clearWriteBlocked: () => set({ writeBlocked: false }),

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

  onCommandStart: (sessionId, command) =>
    set((s) => {
      const pane = s.panes[sessionId] ?? emptyPane()
      // Ưu tiên dòng đọc từ BUFFER (pane chốt lúc user bấm Enter): `typing` ghép từ `onData`
      // lệch ngay khi user sửa bằng mũi tên, dán nhiều dòng, hoặc gọi lại lệnh cũ bằng Ctrl+R
      // của chính bash — mà F24 chèn lệnh này ngược ra terminal, nên một chuỗi lệch là gửi rác
      // vào máy production.
      //
      // `trap DEBUG` của bash phát mốc C cho TỪNG lệnh con của một pipeline. Lần đầu có lệnh
      // đã chốt, các lần sau `command` là undefined — lúc đó GIỮ lệnh đang chạy thay vì rơi về
      // `typing` (đã bị xoá thành '' ở lần đầu) và cũng KHÔNG dựng lại mốc thời gian, để thời
      // lượng đo được là của cả dòng chứ không phải của đoạn cuối pipeline.
      const incoming = (command ?? '').trim()
      if (incoming === '' && pane.runningSince !== null) {
        return { panes: { ...s.panes, [sessionId]: { ...pane, integrated: true } } }
      }
      const resolved = incoming || pane.typing.trim()
      return {
        panes: {
          ...s.panes,
          [sessionId]: { ...pane, integrated: true, runningSince: Date.now(), runningCommand: resolved, typing: '' }
        }
      }
    }),

  onCommandDone: (sessionId, exitCode, paneTitle, hostId) => {
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

    /**
     * Bản đã CHE mật khẩu gõ inline (`mysql -pXXX`, `curl -u u:p`, `--token …`).
     *
     * Che MỘT LẦN ở đây rồi dùng cho MỌI đường ra khỏi hàm này — cố ý không che riêng cho F24.
     * Lý do: F26 bên dưới đẩy dòng lệnh vào trung tâm thông báo, và `events.db` là SQLite
     * **không mã hoá, nằm ngoài vault** (`EventStore.add` ghi `title` thẳng vào cột thường).
     * Che cho vault mà để nguyên văn cho events.db thì lớp mã hoá của vault thành vô nghĩa:
     * cùng một mật khẩu, một file mở bằng `sqlite3` là đọc được.
     */
    const prepared = prepareForStore(command)
    const safeCommand = prepared.command

    // F24 — lưu bền vào vault để tìm lại được sau nhiều tháng, kể cả khi `.bash_history` trên
    // server đã bị xoá. `shouldRecord` bỏ `ls`/`cd`/lệnh quá ngắn.
    if (useSettingsStore.getState().commandHistoryEnabled && shouldRecord(command).record) {
      void window.infra.commandHistory
        .add({
          hostId: hostId ?? null,
          hostLabel: paneTitle,
          command: safeCommand,
          exitCode,
          durationMs,
          startedAt,
          redacted: prepared.redacted
        })
        .then((saved) => {
          // Ghi thất bại (gần như luôn là vault đã auto-lock) KHÔNG bật hộp lỗi — người ta đang
          // gõ việc khác. Nhưng cũng không được im hoàn toàn: ô tìm sẽ nói "chưa có lệnh nào,
          // cần shell integration", tức chỉ đường SAI khi shell integration vẫn chạy tốt. Nhớ
          // lại đây để ô tìm nói đúng nguyên nhân.
          if (!saved) set({ writeBlocked: true })
        })
        .catch(() => {
          set({ writeBlocked: true })
        })
    }

    // F26 — báo khi lệnh dài xong. "Pane đang hiện" = tab của nó active VÀ cửa sổ đang focus:
    // đang nhìn thì thông báo chỉ là tiếng ồn.
    const settings = useSettingsStore.getState()
    const tabs = useTabsStore.getState()
    const activeTab = tabs.tabs.find((t) => t.id === tabs.activeId)
    const paneVisible = document.hasFocus() && !!activeTab?.panes.some((p) => p.sessionId === sessionId)
    const decision = shouldNotify({ command, durationMs, paneVisible, enabled: settings.notifyLongCommands })
    if (!decision.notify) return

    const ok = exitCode === null || exitCode === 0
    // `safeCommand`, KHÔNG phải `command`: chuỗi này đi vào events.db (không mã hoá, ngoài vault).
    const text = `${ok ? '✅' : '❌'} [${paneTitle}] ${shortenCommand(safeCommand)} — ${Math.round(durationMs / 1000)}s${exitCode !== null && exitCode !== 0 ? ` · exit ${exitCode}` : ''}`
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
