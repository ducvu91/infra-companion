import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { saveTermSnapshot, subscribeTermData, takeTermSnapshot } from '../../lib/termBus'
import { matchGuard } from '../../lib/commandGuard'
import { matchesCombo } from '../../lib/shortcuts'
import { commandSucceeded, formatDuration, guardScope, parseOsc133, resolveProduction, stripPrompt, typePhraseMatches, type CommandTarget, type GuardScope } from '@infra/shared'
import { useShellMarksStore } from '../../stores/shellMarks'
import { useTabsStore, type Pane } from '../../stores/tabs'
import { useAiExplainStore } from '../../stores/aiExplain'
import { useDataStore } from '../../stores/data'
import { useSettingsStore, type CommandAlias } from '../../stores/settings'
import { useT } from '../../i18n'
import { Button, Modal, TextInput } from '../../components/ui'
import { terminalTheme } from './theme'

/**
 * Đọc lệnh đang gõ tại con trỏ, nối cả các dòng bị wrap (lệnh dài tràn nhiều dòng hiển thị).
 * Trả '' khi đang ở alt-screen (vim/less/htop…) — không phải prompt shell nên không guard.
 */
function readCurrentCommand(term: Terminal): string {
  const buf = term.buffer.active
  if (buf.type === 'alternate') return ''
  const cursorRow = buf.baseY + buf.cursorY
  let start = cursorRow
  while (start > 0 && buf.getLine(start)?.isWrapped) start--
  let text = ''
  for (let r = start; r <= cursorRow; r++) {
    // translateToString(false): giữ đủ bề rộng dòng để nối đúng chỗ wrap (không chèn thừa dấu cách)
    text += buf.getLine(r)?.translateToString(false) ?? ''
  }
  return text.replace(/\s+$/, '')
}

/**
 * Từ đang gõ NGAY TRƯỚC con trỏ (cho auto-complete). Trả '' khi ký tự trước con trỏ là khoảng
 * trắng (đã kết thúc 1 từ) hoặc đang ở alt-screen (vim/less). KHÔNG trim để biết ranh giới từ.
 */
function tokenBeforeCursor(term: Terminal): string {
  const buf = term.buffer.active
  if (buf.type === 'alternate') return ''
  const cursorRow = buf.baseY + buf.cursorY
  let start = cursorRow
  while (start > 0 && buf.getLine(start)?.isWrapped) start--
  let text = ''
  for (let r = start; r < cursorRow; r++) text += buf.getLine(r)?.translateToString(false) ?? ''
  const cur = buf.getLine(cursorRow)?.translateToString(false) ?? ''
  text += cur.slice(0, buf.cursorX)
  if (text === '' || /\s$/.test(text)) return ''
  return /(\S+)$/.exec(text)?.[1] ?? ''
}

/** Trạng thái dropdown auto-complete (toạ độ fixed để portal ra document.body, tránh overflow cắt). */
interface SuggestState {
  items: CommandAlias[]
  /** -1 = chưa chọn tường minh → Enter cho qua (submit); Tab vẫn chèn mục đầu. */
  index: number
  left: number
  top: number
  bottom: number
  above: boolean
}

/** sessionId HIỆN TẠI của pane trong store (null = pane đã đóng hẳn).
 *  Tra theo paneId thay vì sessionId: reconnectPane thay sessionId tại chỗ — cleanup phải
 *  chụp snapshot theo id MỚI để phiên mới nối tiếp scrollback cũ. */
function currentSessionIdOf(paneId: string): string | null {
  for (const tab of useTabsStore.getState().tabs) {
    const pane = tab.panes.find((p) => p.id === paneId)
    if (pane) return pane.sessionId
  }
  return null
}

interface TerminalPaneProps {
  tabId: string
  pane: Pane
  /** Pane này có đang được focus trong tab không. */
  paneActive: boolean
  /** Tab chứa pane có đang hiển thị không (để fit khi chuyển tab). */
  tabVisible: boolean
  /** Vị trí ô của pane trong lưới split — đổi khi user kéo-thả đổi chỗ pane. */
  slot: number
}

/**
 * Vẽ lại toàn bộ glyph: xoá texture atlas trên GPU rồi ép xterm render lại mọi dòng.
 *
 * WebGL renderer chỉ giữ TOẠ ĐỘ của glyph trong atlas, không giữ hình. Khi atlas bị cấp phát
 * lại mà bảng toạ độ cũ vẫn còn (canvas bị display:none, devicePixelRatio đổi, driver reset)
 * thì xterm vẽ đúng ô nhưng lấy sai mảnh ảnh → chữ méo, ghép từ nhiều ký tự khác nhau.
 * Đây đúng là việc mà tô chọn text bằng chuột làm bằng tay: đánh dấu dòng là dirty để
 * rasterize lại glyph. Không bật WebGL thì chỉ còn refresh() — vô hại với DOM renderer.
 */
function repaintGlyphs(term: Terminal | null, webgl: WebglAddon | null): void {
  if (!term) return
  webgl?.clearTextureAtlas()
  term.refresh(0, term.rows - 1)
}

/**
 * Một instance xterm.js gắn với một phiên terminal trong 1 pane.
 * Khi tab bật broadcast: phím gõ ở pane này được gửi tới MỌI pane trong tab.
 */
export function TerminalPane({ tabId, pane, paneActive, tabVisible, slot }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  /**
   * Số cột prompt chiếm, chốt ở mốc OSC 133;B — dùng để cắt prompt ra khỏi dòng lệnh khi thấy
   * mốc C. null = shell chưa dán snippet shell integration, lúc đó `stripPrompt` tự đoán.
   */
  const promptColRef = useRef<number | null>(null)
  /**
   * F24 — dòng lệnh chốt lúc user bấm Enter, chờ mốc OSC 133;C tới để bắt đầu tính thời gian.
   * Phải chốt ở Enter chứ không ở mốc C: lúc C tới thì tty đã echo CR+LF và con trỏ ở dòng
   * trống, đọc buffer trả ''.
   */
  const pendingCommandRef = useRef<string | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const webglRef = useRef<WebglAddon | null>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [hasSelection, setHasSelection] = useState(false)
  const [copied, setCopied] = useState(false)
  /** Lệnh nhạy cảm đang chờ xác nhận (guard đã chặn Enter); null = không có. */
  const [guardPrompt, setGuardPrompt] = useState<{ command: string; pattern: string; scope: GuardScope } | null>(null)
  /** F27: chuỗi user gõ lại để xác nhận khi đích có máy production. */
  const [guardTyped, setGuardTyped] = useState('')
  const [suggest, setSuggest] = useState<SuggestState | null>(null)
  const suggestRef = useRef<SuggestState | null>(null)
  const paneActiveRef = useRef(paneActive)
  const suggestRafRef = useRef<number | null>(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const findInputRef = useRef<HTMLInputElement>(null)
  const closePane = useTabsStore((s) => s.closePane)
  const reconnectPane = useTabsStore((s) => s.reconnectPane)
  const themeMode = useSettingsStore((s) => s.theme)
  const hasBackground = useSettingsStore((s) => s.backgroundImage !== null)
  const fontFamily = useSettingsStore((s) => s.termFontFamily)
  const fontSize = useSettingsStore((s) => s.termFontSize)
  const lineHeight = useSettingsStore((s) => s.termLineHeight)
  const cursorStyle = useSettingsStore((s) => s.termCursor)
  const webglOn = useSettingsStore((s) => s.termWebgl)
  const t = useT()

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // Phiên MỚI (reconnect đổi `sessionId` tại chỗ, có thể sang host khác với prompt khác):
    // hai ref này thuộc về phiên cũ. Ref sống ngoài effect nên không tự reset — để lại thì
    // `stripPrompt` làm việc với cột của phiên trước.
    promptColRef.current = null
    pendingCommandRef.current = null

    const s0 = useSettingsStore.getState()
    const term = new Terminal({
      theme: terminalTheme(s0.theme, s0.backgroundImage !== null),
      fontFamily: s0.termFontFamily,
      fontSize: s0.termFontSize,
      lineHeight: s0.termLineHeight,
      cursorStyle: s0.termCursor,
      cursorBlink: true,
      scrollback: 10_000,
      allowProposedApi: true,
      // Luôn bật để có thể đổi nền trong suốt khi bật/tắt ảnh nền mà không phải tạo lại terminal
      allowTransparency: true
    })

    const fit = new FitAddon()
    const search = new SearchAddon()
    const serialize = new SerializeAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(serialize)
    term.loadAddon(new Unicode11Addon())
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        event.preventDefault()
        window.open(uri)
      })
    )
    term.unicode.activeVersion = '11'

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      // Auto-complete: dropdown đang mở → ưu tiên phím điều hướng/chèn (↑↓ chọn, Tab/Enter chèn, Esc bỏ).
      const sug = suggestRef.current
      if (sug && sug.items.length > 0) {
        const k = event.key
        // Enter chỉ CHÈN khi user đã chọn tường minh bằng mũi tên (index>=0); chưa chọn thì cho qua để chạy lệnh.
        const handled = k === 'Escape' || k === 'ArrowDown' || k === 'ArrowUp' || k === 'Tab' || (k === 'Enter' && sug.index >= 0)
        if (handled) {
          // BẮT BUỘC preventDefault: attachCustomKeyEventHandler trả false chỉ ngăn xterm xử lý,
          // KHÔNG chặn hành vi mặc định của trình duyệt → Tab sẽ nhảy focus (sang nút khoá vault →
          // Enter kế tiếp khoá màn hình), mũi tên cuộn trang. Chặn tại đây để giữ focus ở terminal.
          event.preventDefault()
          event.stopPropagation()
          if (k === 'Escape') setSuggest(null)
          else if (k === 'ArrowDown') setSuggest({ ...sug, index: Math.min(sug.index + 1, sug.items.length - 1) })
          else if (k === 'ArrowUp') setSuggest({ ...sug, index: sug.index <= 0 ? sug.items.length - 1 : sug.index - 1 })
          else if (k === 'Tab') acceptSuggestion(sug.items[Math.max(sug.index, 0)]!)
          else if (k === 'Enter') acceptSuggestion(sug.items[sug.index]!)
          return false
        }
      }
      // Phím tắt tuỳ biến — đọc LIVE từ store nên đổi trong Settings ăn ngay (không cần remount)
      const sc = useSettingsStore.getState().shortcuts
      if (matchesCombo(event, sc.copy)) {
        const selection = term.getSelection()
        if (selection) void navigator.clipboard.writeText(selection)
        return false
      }
      if (matchesCombo(event, sc.paste)) {
        void navigator.clipboard.readText().then((text) => {
          // paste() của xterm (không phải handleInput thô): chuẩn hoá \r\n & \n → \r — clipboard
          // Windows mang \r\n, gửi thô thì vim/nano tính CR và LF là 2 lần xuống dòng → chèn thêm
          // dòng trống giữa các dòng; kèm bracketed-paste nếu app trên remote có bật.
          // Broadcast vẫn ăn: paste() đi qua onData → handleInput như gõ phím.
          if (text) term.paste(text)
        })
        return false
      }
      if (matchesCombo(event, sc.find)) {
        setFindOpen(true)
        setTimeout(() => findInputRef.current?.focus(), 0)
        return false
      }
      // F46: AI giải thích đoạn output đang bôi chọn
      if (matchesCombo(event, sc.explain)) {
        const selection = term.getSelection().trim()
        if (selection) void useAiExplainStore.getState().explain(selection)
        return false
      }
      return true
    })

    term.open(host)
    // Renderer: WebglAddon nạp/gỡ ở effect riêng theo setting termWebgl (GPU mượt hơn hẳn
    // DOM renderer khi gõ/cuộn). Vụ "khung đen" WebGL cache nền khi đổi theme ngày trước
    // được xử lý bằng clearTextureAtlas() trong effect đổi theme. Gỡ addon = tự về DOM renderer.

    fit.fit()
    window.infra.terminal.resize(pane.sessionId, term.cols, term.rows)

    // Pane bị remount khi gộp/tách tab → ghi lại buffer đã chụp TRƯỚC khi subscribe
    // (data mới đến trong lúc unmount nằm ở hàng đợi pending, flush sau snapshot là đúng thứ tự)
    const snapshot = takeTermSnapshot(pane.sessionId)
    if (snapshot) term.write(snapshot)

    // F23 — Shell integration: đọc OSC 133 (A/B/C/D) do shell trên remote gửi để biết ranh giới
    // từng lệnh + exit code. `registerOscHandler` trả true = đã xử lý, xterm không in ra màn hình.
    // Không có shell nào gửi thì phần này im lặng hoàn toàn (không tốn gì, không hiện gì).
    const oscDisposable = term.parser.registerOscHandler(133, (payload) => {
      if (!useSettingsStore.getState().shellMarksEnabled) return true
      const mark = parseOsc133(payload)
      if (!mark) return true
      const marks = useShellMarksStore.getState()
      if (mark.kind === 'prompt-start') {
        // Prompt MỚI bắt đầu in → cột của prompt cũ hết giá trị. Không xoá thì `PS1` chứa `\w`
        // (mặc định gần như mọi distro) sẽ để lại cột dài hơn prompt mới sau một `cd /`, và
        // `stripPrompt` cắt mất đầu lệnh — `echo rm -rf /` thành `-rf /`.
        promptColRef.current = null
      } else if (mark.kind === 'prompt-end') {
        // Cột con trỏ tại mốc B = độ dài prompt VỪA in. Dùng để cắt prompt ra khỏi dòng lệnh
        // lúc user bấm Enter (F24 chèn lệnh này ngược ra terminal nên phải sạch prompt).
        promptColRef.current = term.buffer.active.cursorX
      } else if (mark.kind === 'command-start') {
        // Lệnh đã được chốt trong `handleInput` lúc user bấm Enter — xem ghi chú ở đó. Mốc C
        // chỉ dùng để bắt đầu tính thời gian. `trap DEBUG` của bash phát C cho TỪNG lệnh con
        // trong pipeline, nên chỉ nhận lệnh đang chờ MỘT lần rồi xoá: nếu không, `a | b | c`
        // sẽ ghi lại `a | b | c` ba lần với thời lượng của từng đoạn.
        const pending = pendingCommandRef.current
        pendingCommandRef.current = null
        marks.onCommandStart(pane.sessionId, pending ?? undefined)
      } else if (mark.kind === 'command-done') {
        marks.onCommandDone(
          pane.sessionId,
          mark.exitCode,
          pane.subtitle ?? pane.title,
          pane.origin?.kind === 'host' ? pane.origin.hostId : null
        )
      }
      return true
    })

    const unsubscribeData = subscribeTermData(pane.sessionId, (data) => term.write(data))
    const dataDisposable = term.onData((data) => {
      // Theo dõi dòng đang gõ để biết TÊN lệnh vừa chạy (marker OSC 133 không gửi kèm lệnh)
      if (useSettingsStore.getState().shellMarksEnabled) useShellMarksStore.getState().onInput(pane.sessionId, data)
      handleInput(data)
    })
    const resizeDisposable = term.onResize(({ cols, rows }) =>
      window.infra.terminal.resize(pane.sessionId, cols, rows)
    )
    // F46: nút ✨ Giải thích chỉ hiện khi đang có selection
    const selectionDisposable = term.onSelectionChange(() =>
      setHasSelection(term.getSelection().trim().length > 0)
    )

    // Auto-complete: mỗi khi con trỏ dịch (gõ/echo về), tính lại gợi ý — rAF gộp nhiều lần liên tiếp.
    const computeSuggest = (): void => {
      const st = useSettingsStore.getState()
      if (!st.autoCompleteEnabled || st.commandAliases.length === 0 || !paneActiveRef.current) {
        setSuggest(null)
        return
      }
      const token = tokenBeforeCursor(term)
      if (token.length < 1) {
        setSuggest(null)
        return
      }
      const low = token.toLowerCase()
      const items = st.commandAliases
        .filter((a) => a.trigger && a.trigger.toLowerCase().startsWith(low))
        .slice(0, 8)
      if (items.length === 0) {
        setSuggest(null)
        return
      }
      const screen = host.querySelector('.xterm-screen') as HTMLElement | null
      if (!screen) {
        setSuggest(null)
        return
      }
      const rect = screen.getBoundingClientRect()
      const buf = term.buffer.active
      const cellW = rect.width / term.cols
      const cellH = rect.height / term.rows
      const cursorLineTop = rect.top + buf.cursorY * cellH
      const belowY = cursorLineTop + cellH
      setSuggest({
        items,
        index: -1,
        left: Math.max(8, Math.min(rect.left + buf.cursorX * cellW, window.innerWidth - 340)),
        top: belowY,
        bottom: window.innerHeight - cursorLineTop,
        above: belowY + 240 > window.innerHeight
      })
    }
    const scheduleSuggest = (): void => {
      if (suggestRafRef.current !== null) cancelAnimationFrame(suggestRafRef.current)
      suggestRafRef.current = requestAnimationFrame(() => {
        suggestRafRef.current = null
        computeSuggest()
      })
    }
    const cursorMoveDisposable = term.onCursorMove(scheduleSuggest)

    const resizeObserver = new ResizeObserver(() => {
      if (host.offsetParent !== null) fit.fit()
    })
    resizeObserver.observe(host)

    // ── Copy bằng click trái vào vùng đã tô khối; dán bằng click phải ──────────
    // Mọi handler chuột đặt ở pha capture: mousedown chạy TRƯỚC khi xterm xoá
    // selection (đọc được đoạn đang bôi đen), và không bị xterm stopPropagation.
    const mouseEl = term.element
    let downSel = ''
    let downX = 0
    let downY = 0
    let downInSel = false

    /** Quy toạ độ pixel của con trỏ về ô (col, row tuyệt đối trong buffer). */
    const cellFromEvent = (ev: MouseEvent): { col: number; row: number } | null => {
      const screen = mouseEl?.querySelector('.xterm-screen') as HTMLElement | null
      if (!screen || term.cols < 1 || term.rows < 1) return null
      const rect = screen.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return null
      const col = Math.floor((ev.clientX - rect.left) / (rect.width / term.cols))
      const vrow = Math.floor((ev.clientY - rect.top) / (rect.height / term.rows))
      if (col < 0 || col >= term.cols || vrow < 0 || vrow >= term.rows) return null
      return { col, row: vrow + term.buffer.active.viewportY }
    }

    /** Con trỏ có rơi trong vùng đang được tô khối không. */
    const pointInSelection = (ev: MouseEvent): boolean => {
      const pos = term.getSelectionPosition()
      if (!pos) return false
      const cell = cellFromEvent(ev)
      if (!cell) return true // không tính được toạ độ → cứ coi như nằm trong vùng
      // Toạ độ trả về là 0-based, tuyệt đối trong buffer, end.x exclusive;
      // start/end có thể đảo chiều nếu bôi từ dưới lên → chuẩn hoá trước.
      let [sX, sY, eX, eY] = [pos.start.x, pos.start.y, pos.end.x, pos.end.y]
      if (sY > eY || (sY === eY && sX > eX)) [sX, sY, eX, eY] = [eX, eY, sX, sY]
      const { col: c, row: r } = cell
      if (r < sY || r > eY) return false
      if (sY === eY) return c >= sX && c < eX
      if (r === sY) return c >= sX
      if (r === eY) return c < eX
      return true
    }

    const flashCopied = (): void => {
      setCopied(true)
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = setTimeout(() => setCopied(false), 900)
    }

    const onMouseDown = (ev: MouseEvent): void => {
      if (ev.button !== 0) return
      downSel = term.getSelection()
      downX = ev.clientX
      downY = ev.clientY
      downInSel = downSel.length > 0 && pointInSelection(ev)
    }

    const onMouseUp = (ev: MouseEvent): void => {
      if (ev.button !== 0) return
      const moved = Math.abs(ev.clientX - downX) > 3 || Math.abs(ev.clientY - downY) > 3
      if (!moved && downInSel && downSel) {
        void navigator.clipboard.writeText(downSel)
        flashCopied()
      }
      downSel = ''
      downInSel = false
    }

    const onContextMenu = (ev: MouseEvent): void => {
      ev.preventDefault()
      void navigator.clipboard.readText().then((text) => {
        // term.paste thay vì handleInput thô — như Ctrl+Shift+V (chuẩn hoá \r\n, bracketed paste)
        if (text) term.paste(text)
      })
    }

    // Chặn paste GỐC của trình duyệt mà xterm tự nghe trên textarea nội bộ (Ctrl+V, Ctrl+Shift+V,
    // Shift+Insert, menu Edit…). Nếu để nguyên: (1) phím tắt paste tuỳ biến gọi term.paste() sẽ dán
    // CHỒNG lên paste gốc → double-paste; (2) Ctrl+Shift+V vẫn dán KỂ CẢ khi user đã đổi phím (paste gốc
    // không phụ thuộc phím đã gán). Bắt ở pha capture trên term.element (tổ tiên của textarea) nên chặn
    // trước listener của xterm. Dán giờ CHỈ qua phím tắt tuỳ biến + chuột phải — cả hai đều gọi term.paste().
    const onNativePaste = (ev: ClipboardEvent): void => {
      ev.preventDefault()
      ev.stopImmediatePropagation()
    }
    mouseEl?.addEventListener('paste', onNativePaste, true)
    mouseEl?.addEventListener('mousedown', onMouseDown, true)
    mouseEl?.addEventListener('mouseup', onMouseUp, true)
    mouseEl?.addEventListener('contextmenu', onContextMenu, true)

    termRef.current = term
    fitRef.current = fit
    searchRef.current = search

    return () => {
      unsubscribeData()
      dataDisposable.dispose()
      oscDisposable.dispose()
      resizeDisposable.dispose()
      selectionDisposable.dispose()
      cursorMoveDisposable.dispose()
      if (suggestRafRef.current !== null) cancelAnimationFrame(suggestRafRef.current)
      resizeObserver.disconnect()
      mouseEl?.removeEventListener('paste', onNativePaste, true)
      mouseEl?.removeEventListener('mousedown', onMouseDown, true)
      mouseEl?.removeEventListener('mouseup', onMouseUp, true)
      mouseEl?.removeEventListener('contextmenu', onContextMenu, true)
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      // Chỉ chụp buffer khi pane còn sống trong store (gộp/tách tab: sessionId giữ nguyên;
      // reconnect: sessionId ĐÃ đổi → chụp theo id mới để phiên mới viết tiếp buffer cũ);
      // pane đã đóng thì clearTermSession dọn rồi — chụp lại sẽ rò bộ nhớ
      const liveSessionId = currentSessionIdOf(pane.id)
      if (liveSessionId) saveTermSnapshot(liveSessionId, serialize.serialize())
      term.dispose() // dispose cả WebglAddon đã nạp
      termRef.current = null
      fitRef.current = null
      searchRef.current = null
      webglRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.sessionId])

  /** Gửi input thô: broadcast → mọi pane trong tab; không thì chỉ pane này. */
  function sendData(data: string): void {
    const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)
    if (tab?.broadcast && tab.panes.length > 1) {
      for (const p of tab.panes) {
        if (p.status !== 'exited') window.infra.terminal.write(p.sessionId, data)
      }
    } else {
      window.infra.terminal.write(pane.sessionId, data)
    }
  }

  /** Chèn alias: xoá từ đang gõ (DEL 0x7f = xoá lùi trong readline) rồi gõ lệnh đầy đủ (CHƯA Enter). */
  function acceptSuggestion(alias: CommandAlias): void {
    const term = termRef.current
    if (!term) return
    const token = tokenBeforeCursor(term)
    if (token.length > 0) sendData('\x7f'.repeat(token.length))
    sendData(alias.command)
    setSuggest(null)
    term.focus()
  }

  /**
   * F27 — những pane THẬT SỰ sẽ nhận lệnh này, kèm cờ production đã kế thừa từ chuỗi group.
   *
   * Phải tính đúng lúc bấm Enter chứ không phải lúc mở pane: Broadcast bật/tắt được giữa
   * chừng, và một pane có thể đã thoát. Đây là khác biệt giữa "xác nhận chạy trên 1 máy" và
   * "xác nhận chạy trên 5 máy, trong đó 2 con là production".
   */
  function commandTargets(): CommandTarget[] {
    const tab = useTabsStore.getState().tabs.find((x) => x.id === tabId)
    const broadcasting = tab?.broadcast === true && tab.panes.length > 1
    const targetPanes = broadcasting ? tab.panes.filter((p) => p.status !== 'exited') : [pane]
    const { hosts, groups } = useDataStore.getState()
    const groupById = new Map(groups.map((g) => [g.id, g]))
    return targetPanes.map((p) => {
      const hostId = p.origin?.kind === 'host' ? p.origin.hostId : null
      const host = hostId ? hosts.find((h) => h.id === hostId) : undefined
      return {
        // Không phải pane nào cũng là host đã lưu (local shell, quick-connect) → dùng tiêu đề pane
        label: host?.label ?? p.title,
        production: host
          ? resolveProduction(
              host.groupId,
              (id) => groupById.get(id)?.production === true,
              (id) => groupById.get(id)?.parentId ?? null
            )
          : false
      }
    })
  }

  /** Input từ xterm. Guard lệnh nhạy cảm chặn Enter đơn (\r) nếu dòng lệnh khớp whitelist. */
  function handleInput(data: string): void {
    if (data === '\r') {
      const { commandGuardEnabled, commandGuardPatterns } = useSettingsStore.getState()
      const term = termRef.current
      // F24 — chốt dòng lệnh NGAY ĐÂY, không đợi mốc OSC 133;C.
      //
      // Đây là thời điểm DUY NHẤT con trỏ còn nằm trên dòng lệnh: bấm Enter thì tty echo CR+LF
      // ngay (echo là việc của kernel, không đợi shell), nên tới lúc shell chạy `preexec`/
      // `trap DEBUG` và phát mốc C thì con trỏ đã ở dòng mới TRỐNG — đọc buffer ở đó trả ''.
      // Guard lệnh nguy hiểm ngay dưới đã đọc đúng chỗ này từ trước; F24 dùng cùng thời điểm.
      if (term) {
        pendingCommandRef.current = stripPrompt(readCurrentCommand(term), promptColRef.current ?? undefined)
      }
      if (commandGuardEnabled && term) {
        const command = readCurrentCommand(term)
        const matched = command ? matchGuard(command, commandGuardPatterns) : null
        if (matched) {
          // Chưa gửi \r — server chưa nhận Enter, lệnh còn nguyên ở prompt để user sửa nếu huỷ
          setGuardTyped('')
          setGuardPrompt({ command: command.trim(), pattern: matched, scope: guardScope(commandTargets()) })
          return
        }
      }
    }
    sendData(data)
  }

  /** Xác nhận chạy lệnh nhạy cảm: gửi Enter đã bị hoãn rồi trả focus về terminal. */
  function confirmGuard(): void {
    setGuardPrompt(null)
    sendData('\r')
    termRef.current?.focus()
  }

  /** Huỷ: không gửi gì, lệnh vẫn ở prompt để user chỉnh; trả focus về terminal. */
  function cancelGuard(): void {
    setGuardPrompt(null)
    termRef.current?.focus()
  }

  useEffect(() => {
    if (!tabVisible || !paneActive) return
    const frame = requestAnimationFrame(() => {
      fitRef.current?.fit()
      termRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [tabVisible, paneActive])

  // Tab không active bị display:none (TerminalTabView) → canvas WebGL kích thước 0 và Chromium
  // được phép thả drawing buffer. Lúc quay lại, fit() thường là no-op (cols/rows không đổi) nên
  // KHÔNG có gì vẽ lại → atlas hỏng nằm nguyên đó cho tới khi user tô chuột. Vẽ lại mỗi lần hiện.
  // Bám tabVisible chứ không phải paneActive: pane không focus trong split vẫn đang hiển thị.
  // rAF để chạy sau fit() của effect trên (cùng frame, đúng thứ tự đăng ký) và sau khi có layout.
  useEffect(() => {
    if (!tabVisible) return
    const frame = requestAnimationFrame(() => repaintGlyphs(termRef.current, webglRef.current))
    return () => cancelAnimationFrame(frame)
  }, [tabVisible])

  // Đổi chỗ pane (kéo-thả trong lưới split) làm React MOVE node DOM sang vị trí khác — canvas rời
  // DOM trong khoảnh khắc nên Chromium được phép thả drawing buffer, mà hai ô đổi chỗ thường CÙNG
  // kích thước → fit() là no-op và không có gì vẽ lại. Đúng cơ chế đã gây lỗi chữ méo khi chuyển
  // tab, nên xử lý y hệt: đổi `slot` là vẽ lại.
  useEffect(() => {
    if (!tabVisible) return
    const frame = requestAnimationFrame(() => repaintGlyphs(termRef.current, webglRef.current))
    return () => cancelAnimationFrame(frame)
  }, [slot, tabVisible])

  // Đổi devicePixelRatio (kéo cửa sổ sang màn hình scale khác, đổi scale trong Windows) cũng làm
  // atlas được cấp phát lại → cùng lỗi glyph méo. Query matchMedia ghim đúng một giá trị dppx nên
  // sau mỗi lần đổi phải tạo query mới cho lần kế tiếp.
  useEffect(() => {
    let media: MediaQueryList | null = null
    function attach(): void {
      media = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
      media.addEventListener('change', onChange)
    }
    function onChange(): void {
      media?.removeEventListener('change', onChange)
      repaintGlyphs(termRef.current, webglRef.current)
      attach()
    }
    attach()
    return () => media?.removeEventListener('change', onChange)
  }, [])

  // Đồng bộ ref cho key handler (đọc LIVE trong closure gắn 1 lần) + đóng gợi ý khi pane mất focus.
  useEffect(() => {
    suggestRef.current = suggest
  }, [suggest])
  useEffect(() => {
    paneActiveRef.current = paneActive
    if (!paneActive) setSuggest(null)
  }, [paneActive])

  // GPU render (WebGL): nạp/gỡ addon theo setting — áp LIVE cho terminal đang mở
  // (gỡ addon là xterm tự quay về DOM renderer). Deps có pane.sessionId để terminal
  // TẠO LẠI (reconnect) cũng được nạp lại addon (effect chính chạy trước theo thứ tự khai báo).
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    if (webglOn && !webglRef.current) {
      try {
        const addon = new WebglAddon()
        term.loadAddon(addon)
        // GPU context bị thu hồi (driver reset, quá nhiều context WebGL…) → gỡ addon,
        // terminal tự quay về DOM renderer thay vì đơ khung trắng
        addon.onContextLoss(() => {
          addon.dispose()
          if (webglRef.current === addon) webglRef.current = null
        })
        webglRef.current = addon
      } catch {
        webglRef.current = null // máy không có WebGL → giữ DOM renderer như cũ
      }
    } else if (!webglOn && webglRef.current) {
      webglRef.current.dispose()
      webglRef.current = null
    }
  }, [webglOn, pane.sessionId])

  // Đổi theme khi user chuyển light/dark hoặc bật/tắt ảnh nền
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.theme = terminalTheme(themeMode, hasBackground)
    // WebGL cache glyph theo màu cũ — không xoá atlas thì đổi theme dính "khung đen"/màu cũ
    // (chính là lý do ngày trước phải bỏ WebGL; giờ xử lý đúng cách ở đây)
    webglRef.current?.clearTextureAtlas()
  }, [themeMode, hasBackground])

  // Áp font/cỡ chữ/giãn dòng/con trỏ ngay khi đổi trong Settings; fit lại để PTY nhận cols/rows mới
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontFamily = fontFamily
    term.options.fontSize = fontSize
    term.options.lineHeight = lineHeight
    term.options.cursorStyle = cursorStyle
    const frame = requestAnimationFrame(() => {
      const fit = fitRef.current
      if (fit && hostRef.current?.offsetParent !== null) fit.fit()
    })
    return () => cancelAnimationFrame(frame)
  }, [fontFamily, fontSize, lineHeight, cursorStyle])

  const findNext = (backward: boolean): void => {
    if (!findText) return
    if (backward) searchRef.current?.findPrevious(findText)
    else searchRef.current?.findNext(findText)
  }

  const closeFind = (): void => {
    setFindOpen(false)
    setFindText('')
    termRef.current?.clearSelection()
    termRef.current?.focus()
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={hostRef} className="terminal-host h-full w-full" />

      {copied && (
        <div className="pointer-events-none absolute bottom-3 right-3 z-30 rounded border border-edge-strong bg-elevated/95 px-2.5 py-1 text-xs text-content shadow-lg">
          {t('terminal.copied')}
        </div>
      )}

      {/* F23 — dải nhỏ góc trên phải: lệnh đang chạy (kèm đồng hồ) hoặc kết quả lệnh vừa xong.
          Chỉ hiện khi shell trên remote thật sự gửi OSC 133 — không có thì im lặng, không quảng cáo. */}
      <ShellMarkBadge sessionId={pane.sessionId} />

      {/* Auto-complete dropdown: portal ra body + fixed để không bị overflow-hidden của pane cắt.
          Xổ lên (above) khi con trỏ ở nửa dưới màn hình. */}
      {suggest &&
        suggest.items.length > 0 &&
        createPortal(
          <div
            className="border-edge-strong bg-elevated fixed z-[200] max-h-60 w-80 overflow-y-auto rounded-md border py-1 text-xs shadow-2xl"
            style={suggest.above ? { left: suggest.left, bottom: suggest.bottom } : { left: suggest.left, top: suggest.top }}
          >
            {suggest.items.map((a, i) => (
              <button
                key={i}
                // onMouseDown + preventDefault: chèn TRƯỚC khi terminal mất focus
                onMouseDown={(e) => {
                  e.preventDefault()
                  acceptSuggestion(a)
                }}
                className={`block w-full px-2.5 py-1 text-left ${
                  i === suggest.index ? 'bg-accent-soft/60 text-accent-fg' : 'text-content hover:bg-hover'
                }`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 font-mono font-semibold">{a.trigger}</span>
                  <span className="text-subtle min-w-0 flex-1 truncate font-mono">{a.command}</span>
                </div>
                {a.note && <div className="text-subtle truncate text-[10px]">{a.note}</div>}
              </button>
            ))}
            <div className="text-subtle border-edge/60 mt-1 border-t px-2.5 pt-1 text-[10px]">{t('terminal.acHint')}</div>
          </div>,
          document.body
        )}

      {/* Guard lệnh nhạy cảm: Enter đã bị hoãn, chờ user xác nhận. Nút Huỷ autoFocus →
          bấm Enter theo phản xạ sẽ HUỶ (an toàn), muốn chạy phải chủ động chọn "Vẫn chạy". */}
      {guardPrompt && (
        <Modal title={t('guard.title')} danger onClose={cancelGuard} closeOnBackdrop={false}>
          <p className="text-muted mb-2 max-w-96 text-xs leading-relaxed">{t('guard.desc')}</p>
          <div className="border-danger/50 bg-input text-content mb-2 max-w-96 rounded border px-3 py-2 font-mono text-xs break-all">
            {guardPrompt.command}
          </div>
          <p className="text-subtle mb-2 text-[11px]">{t('guard.matched', { pattern: guardPrompt.pattern })}</p>

          {/* F27 — PHẠM VI. Broadcast biến một lần gõ thành N máy; hộp thoại cũ không nói gì
              về chuyện đó nên nhìn y hệt nhau dù đích là 1 máy nháp hay 5 con production. */}
          {guardPrompt.scope.targetCount > 1 && (
            <p className="text-warning mb-2 max-w-96 text-[11px]">
              ⚠ {t('guard.scopeMany', { n: guardPrompt.scope.targetCount })}
            </p>
          )}
          {guardPrompt.scope.productionLabels.length > 0 && (
            <div className="border-danger/50 bg-danger/10 mb-3 max-w-96 rounded border px-3 py-2">
              <p className="text-danger mb-1 text-[11px] font-medium">
                {t('guard.prodWarn', { list: guardPrompt.scope.productionLabels.join(', ') })}
              </p>
              <p className="text-muted mb-1.5 text-[11px]">
                {t('guard.typeToConfirm', { name: guardPrompt.scope.typePhrase ?? '' })}
              </p>
              <TextInput
                autoFocus
                value={guardTyped}
                onChange={(e) => setGuardTyped(e.target.value)}
                placeholder={guardPrompt.scope.typePhrase ?? ''}
              />
            </div>
          )}

          <div className="flex justify-end gap-2">
            {/* Nút Huỷ autoFocus khi KHÔNG phải gõ xác nhận → bấm Enter theo phản xạ sẽ huỷ
                (an toàn). Có ô gõ thì ô đó giữ focus, nên bỏ autoFocus ở đây. */}
            <Button autoFocus={guardPrompt.scope.level === 'confirm'} onClick={cancelGuard}>
              {t('guard.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={!typePhraseMatches(guardTyped, guardPrompt.scope.typePhrase)}
              onClick={confirmGuard}
            >
              {t('guard.run')}
            </Button>
          </div>
        </Modal>
      )}

      {/* F46: nút giải thích selection — cùng slot với thanh Tìm, Tìm mở thì nhường chỗ */}
      {hasSelection && !findOpen && (
        <button
          className="border-edge-strong bg-elevated/95 text-content hover:bg-hover absolute top-2 right-3 z-30 rounded border px-2.5 py-1 text-xs shadow-lg"
          onClick={() => {
            const selection = termRef.current?.getSelection().trim()
            if (selection) void useAiExplainStore.getState().explain(selection)
          }}
        >
          ✨ {t('terminal.explainSelection')}
        </button>
      )}

      {findOpen && (
        <div className="absolute top-2 right-3 z-30 flex items-center gap-1 rounded border border-edge-strong bg-elevated px-2 py-1 shadow-lg">
          <input
            ref={findInputRef}
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') findNext(e.shiftKey)
              if (e.key === 'Escape') closeFind()
            }}
            placeholder={t('terminal.findPlaceholder')}
            className="w-36 bg-transparent text-xs text-content placeholder-subtle outline-none"
          />
          <button className="px-1 text-xs text-muted hover:text-content" onClick={() => findNext(true)}>↑</button>
          <button className="px-1 text-xs text-muted hover:text-content" onClick={() => findNext(false)}>↓</button>
          <button className="px-1 text-xs text-subtle hover:text-content" onClick={closeFind}>✕</button>
        </div>
      )}

      {pane.status === 'connecting' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-app/80">
          <div className="flex items-center gap-3 text-sm text-muted">
            <span className="size-2 animate-pulse rounded-full bg-warning" />
            {pane.subtitle ?? pane.title}…
          </div>
        </div>
      )}

      {pane.status === 'exited' && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60">
          <div className="bg-elevated border-edge-strong max-w-[90%] rounded-lg border px-5 py-3 text-center shadow-xl">
            <p className="text-content text-xs">
              {pane.exitReason ?? `exit code ${pane.exitCode ?? '?'}`}
            </p>
            <div className="mt-2.5 flex items-center justify-center gap-2">
              {/* Thử lại thủ công sau khi auto-retry 3 lần thất bại — mở phiên mới vào cùng pane */}
              {pane.origin && (
                <button
                  className="bg-accent hover:bg-accent-hover rounded px-4 py-1 text-xs text-white"
                  onClick={() => void reconnectPane(tabId, pane.id)}
                >
                  ↻ {t('terminal.reconnect')}
                </button>
              )}
              <button
                className="bg-hover text-content hover:bg-edge-strong rounded px-4 py-1 text-xs"
                onClick={() => closePane(tabId, pane.id)}
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * F23 — nhãn kết quả lệnh cuối / lệnh đang chạy, dựng từ marker OSC 133.
 *
 * Tách thành component riêng để đồng hồ đếm giây (một `setInterval` khi đang chạy) không kéo cả
 * TerminalPane render lại — pane có xterm bên trong, render lại là việc đắt.
 *
 * Không có shell nào gửi marker (`integrated === false`) thì KHÔNG hiện gì: một nhãn "chưa bật
 * shell integration" nằm mãi ở góc mọi terminal là thứ người ta chỉ muốn tắt đi.
 */
function ShellMarkBadge({ sessionId }: { readonly sessionId: string }) {
  const t = useT()
  const enabled = useSettingsStore((s) => s.shellMarksEnabled)
  const paneState = useShellMarksStore((s) => s.panes[sessionId])
  const [now, setNow] = useState(Date.now())
  const runningSince = paneState?.runningSince ?? null

  useEffect(() => {
    if (runningSince === null) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [runningSince])

  if (!enabled || !paneState?.integrated) return null

  if (runningSince !== null) {
    return (
      <div className="border-edge-strong bg-elevated/90 text-muted pointer-events-none absolute top-2 right-2 z-30 flex max-w-64 items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] shadow">
        <span className="bg-warning size-1.5 shrink-0 animate-pulse rounded-full" />
        <span className="shrink-0">{formatDuration(Math.max(0, now - runningSince))}</span>
        {paneState.runningCommand && <span className="text-subtle min-w-0 truncate">{paneState.runningCommand}</span>}
      </div>
    )
  }

  const last = paneState.records[0]
  if (!last) return null
  const ok = commandSucceeded(last)
  return (
    <div
      className={`border-edge-strong bg-elevated/90 pointer-events-none absolute top-2 right-2 z-30 flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[10px] shadow ${ok ? 'text-success' : 'text-danger'}`}
      title={t('terminal.lastCommand', { command: last.command || '—' })}
    >
      <span>{ok ? '✓' : `✕ ${last.exitCode}`}</span>
      <span className="text-muted">{formatDuration(last.durationMs)}</span>
    </div>
  )
}
