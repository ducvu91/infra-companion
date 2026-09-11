/**
 * State machine của một phiên Codex: gộp notification từ app-server thành trạng thái vẽ được.
 *
 * Thuần + immutable → test cả một chuỗi event bằng mảng fixture, không cần chạy `codex`.
 *
 * Hai điều dễ làm sai, cố ý xử lý ở đây:
 *
 * 1. **Delta phải nối theo `itemId`, không phải nối vào cuối danh sách.** Notification của nhiều
 *    item tới **xen kẽ** (reasoning của bước sau chảy trong khi message bước trước chưa xong).
 *    Nối vào cuối là chữ của hai việc khác nhau trộn vào một khối.
 * 2. **Method lạ phải bỏ qua, không throw.** Schema app-server còn `[experimental]` (R1): bản
 *    mới thêm một `item/…` là chuyện thường, và một notification không hiểu được không được
 *    quyền giết phiên đang chạy.
 */

import type { CodexNotification } from './protocol'

/**
 * `userMessage` là chữ CHÍNH USER vừa gõ — app-server phát lại nó như một item.
 *
 * Có kind riêng để UI **lọc bỏ**: hiện lại câu user vừa nhập trong khung trả lời là lặp vô ích,
 * mà để nó lẫn vào `'other'` thì sinh ra một dòng trống (item chưa có text lúc `item/started`).
 */
export type ItemKind = 'agentMessage' | 'reasoning' | 'command' | 'patch' | 'userMessage' | 'other'

export interface CodexItem {
  readonly id: string
  readonly kind: ItemKind
  /** Chữ đã gộp từ các delta. */
  readonly text: string
  /** `false` khi còn đang chảy delta. */
  readonly done: boolean
}

export type ThreadPhase = 'idle' | 'running' | 'awaiting-approval' | 'done' | 'failed'

export interface McpServerState {
  readonly name: string
  readonly status: string
  readonly error: string | null
}

export interface ThreadState {
  readonly threadId: string | null
  readonly turnId: string | null
  readonly phase: ThreadPhase
  readonly items: readonly CodexItem[]
  readonly error: string | null
  /**
   * MCP server nào đang có trong thread.
   *
   * Hiện ra UI là **cố ý** (R7): MCP server trong `~/.codex/config.toml` của user **tự nạp** vào
   * mọi thread và không tắt được từ dòng lệnh — đã kiểm chứng. Nghĩa là agent có thêm tool ngoài
   * ý muốn của app. Không cô lập được thì tối thiểu phải cho user **thấy**, thay vì im lặng.
   */
  readonly mcpServers: readonly McpServerState[]
}

export function initialThreadState(): ThreadState {
  return {
    threadId: null,
    turnId: null,
    phase: 'idle',
    items: [],
    error: null,
    mcpServers: [],
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function str(r: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = r[k]
    if (typeof v === 'string' && v !== '') return v
  }
  return undefined
}

/**
 * Suy ra loại item từ tên method.
 *
 * Khớp theo chuỗi con chứ không so bằng tên đầy đủ: app-server có nhiều biến thể
 * (`item/agentMessage/delta`, `item/reasoning/summaryTextDelta`…) và bản mới còn thêm nữa.
 */
function itemKindOf(method: string): ItemKind {
  if (method.includes('agentMessage')) return 'agentMessage'
  if (method.includes('reasoning')) return 'reasoning'
  if (method.includes('command') || method.includes('exec')) return 'command'
  if (method.includes('patch') || method.includes('diff') || method.includes('fileChange')) return 'patch'
  return 'other'
}

/**
 * Loại item từ `item.type` của `ThreadItem` — **chính xác hơn** đoán theo tên method, vì
 * `item/started` và `item/completed` dùng chung một method cho mọi loại item.
 *
 * Danh sách `type` lấy từ schema thật: `userMessage`, `agentMessage`, `reasoning`, `plan`,
 * `commandExecution`, `fileChange`, `mcpToolCall`, `webSearch`… (18 loại, còn thêm ở bản mới).
 */
function itemKindFromType(type: string | undefined): ItemKind | null {
  if (!type) return null
  if (type === 'agentMessage') return 'agentMessage'
  if (type === 'reasoning') return 'reasoning'
  if (type === 'commandExecution') return 'command'
  if (type === 'fileChange') return 'patch'
  if (type === 'userMessage') return 'userMessage'
  return 'other'
}

/**
 * Chữ đọc được từ một `ThreadItem` (dùng cho `item/completed`, khi text đầy đủ về một lần).
 *
 * Mỗi loại item giữ chữ ở field khác nhau — schema thật: `agentMessage.text`, `plan.text`,
 * `reasoning.summary`, `commandExecution.command` + `.aggregatedOutput`. Không có field nào
 * chung, nên phải tra theo loại chứ đừng đoán một tên duy nhất.
 */
function itemText(item: Record<string, unknown>): string | undefined {
  const type = typeof item['type'] === 'string' ? (item['type'] as string) : undefined
  const s = (k: string): string | undefined => (typeof item[k] === 'string' && item[k] !== '' ? (item[k] as string) : undefined)

  if (type === 'userMessage') {
    // `content` là MẢNG `UserInput` (`[{type:'text',text:'…'}]`), không phải chuỗi — đọc nó như
    // chuỗi thì ra `undefined`, item rỗng, và câu hỏi của user không bao giờ hiện.
    const parts = Array.isArray(item['content']) ? (item['content'] as unknown[]) : []
    const texts: string[] = []
    for (const p of parts) {
      if (typeof p !== 'object' || p === null) continue
      const r = p as Record<string, unknown>
      // Chỉ phần `text`; ảnh/file thì bỏ (UI này không vẽ ảnh).
      if (typeof r['text'] === 'string' && r['text'] !== '') texts.push(r['text'] as string)
    }
    return texts.length > 0 ? texts.join('\n') : undefined
  }

  if (type === 'commandExecution') {
    const cmd = s('command')
    const out = s('aggregatedOutput')
    const code = typeof item['exitCode'] === 'number' ? (item['exitCode'] as number) : undefined
    if (!cmd && !out) return undefined
    const head = cmd ? `$ ${cmd}` : ''
    const tail = out ? `\n${out}` : ''
    const status = code !== undefined && code !== 0 ? `\n[exit ${code}]` : ''
    return `${head}${tail}${status}`
  }
  if (type === 'fileChange') {
    // `changes` là mảng/đối tượng mô tả patch — không dựng lại diff ở đây (việc của UI), chỉ
    // nói có thay đổi để dòng không trống.
    return s('status') ? `fileChange: ${s('status')}` : undefined
  }
  return s('text') ?? s('summary') ?? s('content')
}

/** Thêm hoặc sửa một item theo id, giữ nguyên thứ tự xuất hiện. */
function upsertItem(
  items: readonly CodexItem[],
  id: string,
  patch: (prev: CodexItem | undefined) => CodexItem,
): CodexItem[] {
  const idx = items.findIndex((i) => i.id === id)
  if (idx === -1) return [...items, patch(undefined)]
  const next = [...items]
  next[idx] = patch(items[idx])
  return next
}

/** Trần chữ mỗi item — agent `cat` một file lớn thì delta có thể vài MB (R4). */
const MAX_ITEM_TEXT = 200_000

function appendText(prev: string, add: string): string {
  const joined = prev + add
  if (joined.length <= MAX_ITEM_TEXT) return joined
  // Giữ ĐUÔI (khuôn `clip()` của aiDiagnose): phần cuối là kết luận, phần đầu là dẫn nhập.
  return `…(da cat phan dau)…\n${joined.slice(joined.length - MAX_ITEM_TEXT)}`
}

/**
 * Gộp một notification vào state.
 *
 * Trả về **chính** `state` khi không hiểu method — nơi gọi so sánh tham chiếu được để bỏ qua
 * việc gửi IPC vô ích.
 */
export function reduceThreadEvent(state: ThreadState, n: CodexNotification): ThreadState {
  const p = asRecord(n.params)
  const method = n.method

  // ── Thread ────────────────────────────────────────────────────────────────
  if (method === 'thread/started') {
    const thread = asRecord(p['thread'])
    const id = str(thread, 'id', 'sessionId') ?? state.threadId
    return { ...state, threadId: id ?? null }
  }

  // ── Turn ──────────────────────────────────────────────────────────────────
  // Shape thật: `{threadId, turn: Turn}` với `Turn = {id, status, items, error?}`.
  // `turn/failed` KHÔNG tồn tại — thất bại về qua `turn/completed` với `turn.status = 'failed'`
  // (TurnStatus = completed | interrupted | failed | inProgress). Đã đối chiếu schema.
  if (method === 'turn/started') {
    const turn = asRecord(p['turn'])
    return { ...state, turnId: str(turn, 'id') ?? state.turnId, phase: 'running', error: null }
  }
  if (method === 'turn/completed') {
    const turn = asRecord(p['turn'])
    const status = str(turn, 'status')
    // Đóng mọi item còn đang chảy: để `done:false` thì UI hiện con trỏ nhấp nháy vĩnh viễn.
    const items = state.items.map((i) => (i.done ? i : { ...i, done: true }))
    if (status === 'failed') {
      const err = asRecord(turn['error'])
      return {
        ...state,
        phase: 'failed',
        error: str(err, 'message') ?? str(err, 'reason') ?? 'luot chay that bai',
        items,
      }
    }
    // `interrupted` = user bấm Dừng → không phải lỗi, và cũng không phải 'done' trọn vẹn;
    // 'done' là đúng nhất vì lượt đã kết thúc và không còn gì chạy.
    return { ...state, phase: 'done', items }
  }
  // Lỗi ở tầng thread (không thuộc lượt nào): `thread/status/changed` với `status.type`.
  if (method === 'thread/status/changed') {
    const st = asRecord(p['status'])
    if (str(st, 'type') === 'systemError') {
      return { ...state, phase: 'failed', error: str(st, 'message') ?? 'loi he thong' }
    }
    return state
  }

  // ── MCP server ────────────────────────────────────────────────────────────
  if (method === 'mcpServer/startupStatus/updated') {
    const name = str(p, 'name')
    if (!name) return state
    const status = str(p, 'status') ?? 'unknown'
    const error = str(p, 'error') ?? null
    const idx = state.mcpServers.findIndex((s) => s.name === name)
    const entry: McpServerState = { name, status, error }
    const mcpServers = idx === -1 ? [...state.mcpServers, entry] : state.mcpServers.map((s, i) => (i === idx ? entry : s))
    return { ...state, mcpServers }
  }

  // ── Item ──────────────────────────────────────────────────────────────────
  if (method.startsWith('item/')) {
    /**
     * ⚠️ Id nằm ở HAI chỗ khác nhau tuỳ method (đã đối chiếu schema — bản đầu chỉ đọc
     * `params.itemId` nên `item/started`/`item/completed` bị bỏ qua sạch):
     * - `item/started` · `item/completed` → `params.item.id` (kèm `params.turnId` riêng)
     * - mọi `*Delta` → `params.itemId`
     */
    const itemObj = asRecord(p['item'])
    const id = str(p, 'itemId') ?? str(itemObj, 'id')
    if (!id) return state

    // Loại lấy từ `item.type` khi có (chính xác), không thì suy từ tên method.
    const kind = itemKindFromType(str(itemObj, 'type')) ?? itemKindOf(method)

    if (method.endsWith('Delta') || method.endsWith('/delta')) {
      const add = str(p, 'delta', 'text') ?? ''
      if (add === '') return state
      return {
        ...state,
        items: upsertItem(state.items, id, (prev) =>
          prev
            ? // NÂNG CẤP `kind` nếu trước đó chưa biết: `item/started` có thể tới trước với một
              // loại chung, còn delta mới nói rõ đây là message hay reasoning.
              { ...prev, kind: prev.kind === 'other' ? kind : prev.kind, text: appendText(prev.text, add) }
            : { id, kind, text: add, done: false },
        ),
      }
    }

    if (method === 'item/started') {
      // `item` đã có thể mang text sẵn (vd `userMessage`, hoặc `commandExecution` có `command`).
      const initial = itemText(itemObj) ?? ''
      return {
        ...state,
        items: upsertItem(state.items, id, (prev) =>
          prev ? { ...prev, kind: prev.kind === 'other' ? kind : prev.kind } : { id, kind, text: initial, done: false },
        ),
      }
    }

    if (method === 'item/completed') {
      // Text đầy đủ về trong chính event này. Bắt buộc dùng khi đã opt-out delta — không thì
      // item hiện rỗng dù đã xong.
      const full = itemText(itemObj)
      return {
        ...state,
        items: upsertItem(state.items, id, (prev) => ({
          id,
          kind: prev && prev.kind !== 'other' ? prev.kind : kind,
          // Giữ text dài hơn: delta có thể đã gom đủ, mà `item.text` cũng có thể đầy đủ hơn.
          // Lấy cái dài hơn tránh mất chữ ở cả hai chiều.
          text: (full?.length ?? 0) >= (prev?.text.length ?? 0) ? (full ?? prev?.text ?? '') : prev!.text,
          done: true,
        })),
      }
    }

    // `item/…` khác (bản mới thêm): ghi nhận item tồn tại, không đoán nội dung.
    return {
      ...state,
      items: upsertItem(state.items, id, (prev) => prev ?? { id, kind, text: itemText(itemObj) ?? '', done: false }),
    }
  }

  // Không hiểu → trả nguyên state (R1: frame lạ không được giết phiên).
  return state
}

/** Gộp một chuỗi notification — tiện cho test và cho việc dựng lại state từ log. */
export function reduceAll(state: ThreadState, events: readonly CodexNotification[]): ThreadState {
  let s = state
  for (const e of events) s = reduceThreadEvent(s, e)
  return s
}
