/**
 * Lõi JSON-RPC 2.0 hai chiều cho Codex App Server — **thuần, không biết gì về process**.
 *
 * Nhận chunk stdout qua `feed()`, ghi ra ngoài qua `deps.send()`. Cùng triết lý
 * `ProcessSupervisor.onOutput` gọi `splitLines`: tách I/O khỏi logic, nên test chỉ cần
 * `peer.feed('{"id":1,"result":{}}\n')` chứ không phải spawn `codex` thật (vitest không có nó,
 * và trên máy dev `codex` còn chẳng ở PATH).
 *
 * Bốn quyết định và lý do:
 *
 * 1. **`fail(reason)` là API BẮT BUỘC, không phải tiện ích.** Khi tiến trình chết giữa lúc đang
 *    `await request()`, không có gì đánh thức promise đó — UI đứng ở spinner vĩnh viễn và user
 *    không biết vì sao. Nơi gọi phải nối `child.on('exit')` → `fail()` với câu **nói được nguyên
 *    nhân** (kèm stderr cuối). Đúng mục 8 CLAUDE.md.
 * 2. **Id sinh trong peer**, và map giữ luôn `method` để câu timeout đọc được: "turn/start không
 *    phản hồi sau 60s" thay vì "request 7 timeout".
 * 3. **`onServerRequest` trả Promise, peer tự bọc thành response.** App-server *hỏi* client
 *    (`execCommandApproval`) và **đợi** id đó. Approval UI chỉ cần resolve một promise; peer
 *    không biết gì về UI, và ngược lại. Handler throw thì peer vẫn phải gửi `{id,error}` —
 *    im lặng là treo phía kia.
 * 4. **`schedule` inject** (khuôn `SupervisorDeps`) → test timeout không phải chờ thật.
 */

import { splitJsonl } from './jsonl'
import {
  isNotification,
  isResponse,
  isServerRequest,
  rpcErrorMessage,
  type CodexNotification,
  type CodexResponse,
  type RpcId,
  type ServerRequest,
} from './protocol'

/** Hẹn giờ, trả hàm huỷ. Khuôn của `SupervisorDeps.schedule`. */
export type ScheduleFn = (fn: () => void, ms: number) => () => void

export interface RpcPeerDeps {
  /** Ghi MỘT dòng (đã kèm '\n') sang phía kia — thực tế là `child.stdin.write`. */
  readonly send: (line: string) => void
  /** App-server hỏi ngược client. Trả về `result`; throw → peer gửi `{id,error}`. */
  readonly onServerRequest: (req: ServerRequest) => Promise<unknown>
  readonly onNotification: (n: CodexNotification) => void
  /**
   * Chuyện bất thường ở tầng giao thức: dòng không parse được, response không khớp id nào,
   * message không thuộc loại nào. KHÔNG throw — chỉ báo để log, vì một frame lạ (bản
   * app-server mới thêm field) không được quyền giết phiên.
   */
  readonly onProtocolWarning: (msg: string) => void
  readonly schedule?: ScheduleFn
}

interface Pending {
  readonly method: string
  readonly resolve: (v: unknown) => void
  readonly reject: (e: Error) => void
  readonly cancelTimer: () => void
}

/** Mặc định cho request thường. `initialize` dùng ngắn hơn, turn thì không giới hạn. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000

const defaultSchedule: ScheduleFn = (fn, ms) => {
  const t = setTimeout(fn, ms)
  return () => clearTimeout(t)
}

export class RpcPeer {
  private readonly deps: RpcPeerDeps
  private readonly schedule: ScheduleFn
  private readonly pending = new Map<RpcId, Pending>()
  private nextId = 1
  private rest = ''
  /** Đã `fail()` rồi thì mọi request sau đó reject ngay, không xếp hàng chờ vô vọng. */
  private failure: string | null = null

  constructor(deps: RpcPeerDeps) {
    this.deps = deps
    this.schedule = deps.schedule ?? defaultSchedule
  }

  /** Đẩy chunk stdout thô vào. Tự framing, tự dispatch. Chunk phải là chuỗi UTF-8 hợp lệ. */
  feed(chunk: string): void {
    const { frames, rest, dropped } = splitJsonl(this.rest, chunk)
    this.rest = rest
    for (const line of dropped) {
      this.deps.onProtocolWarning(`dong khong parse duoc: ${line}`)
    }
    for (const frame of frames) this.dispatch(frame)
  }

  /**
   * Gửi request và chờ response khớp id.
   *
   * `timeoutMs <= 0` = chờ không giới hạn — dùng cho `turn/start`: một agent suy nghĩ 30 phút là
   * bình thường, và tự bỏ cuộc giữa lúc model đang chạy thì mất việc thật. Chỗ đó bảo vệ bằng
   * heartbeat + nút Dừng ở tầng trên, không phải bằng timeout ở đây.
   */
  request<T = unknown>(method: string, params?: unknown, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS): Promise<T> {
    if (this.failure) return Promise.reject(new Error(this.failure))

    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const cancelTimer =
        timeoutMs > 0
          ? this.schedule(() => {
              // Xoá TRƯỚC khi reject: response về muộn sau đó chỉ là warning, không phải
              // "resolve một promise đã reject" (im lặng và rất khó truy).
              this.pending.delete(id)
              reject(new Error(`${method} khong phan hoi sau ${Math.round(timeoutMs / 1000)}s`))
            }, timeoutMs)
          : () => {}

      this.pending.set(id, {
        method,
        resolve: resolve as (v: unknown) => void,
        reject,
        cancelTimer,
      })

      try {
        this.write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })
      } catch (error) {
        // stdin đã đóng: dọn ngay chứ đừng để pending mồ côi chờ timeout.
        this.pending.delete(id)
        cancelTimer()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /** Notification (không id, không chờ) — `initialized`, và các thông báo một chiều khác. */
  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) })
  }

  /**
   * Phía kia đã chết / stdin đóng → reject MỌI promise đang chờ với lý do nói được.
   *
   * Gọi nhiều lần là vô hại (lần sau không còn pending nào). Lý do đầu tiên được giữ: nó là
   * nguyên nhân gốc, còn những lần sau thường chỉ là hệ quả ("stdin closed" sau khi process đã
   * exit vì lỗi thật).
   */
  fail(reason: string): void {
    if (!this.failure) this.failure = reason
    const err = new Error(this.failure)
    const waiting = [...this.pending.values()]
    this.pending.clear()
    for (const p of waiting) {
      p.cancelTimer()
      p.reject(err)
    }
  }

  get pendingCount(): number {
    return this.pending.size
  }

  private write(msg: unknown): void {
    this.deps.send(`${JSON.stringify(msg)}\n`)
  }

  private dispatch(frame: unknown): void {
    // THỨ TỰ QUAN TRỌNG: request (id+method) phải kiểm trước response (id, không method),
    // vì cả hai đều có `id`.
    if (isServerRequest(frame)) {
      this.handleServerRequest(frame)
      return
    }
    if (isResponse(frame)) {
      this.handleResponse(frame)
      return
    }
    if (isNotification(frame)) {
      this.deps.onNotification(frame)
      return
    }
    this.deps.onProtocolWarning(`message khong thuoc loai nao: ${JSON.stringify(frame).slice(0, 200)}`)
  }

  private handleResponse(res: CodexResponse): void {
    const p = this.pending.get(res.id)
    if (!p) {
      // Response về sau khi đã timeout, hoặc app-server trả id ta chưa từng gửi.
      this.deps.onProtocolWarning(`response cho id la hoac da timeout: ${String(res.id)}`)
      return
    }
    this.pending.delete(res.id)
    p.cancelTimer()
    if (res.error) {
      p.reject(new Error(`${p.method}: ${rpcErrorMessage(res.error)}`))
    } else {
      p.resolve(res.result)
    }
  }

  private handleServerRequest(req: ServerRequest): void {
    // `void` có chủ ý: handler tự bọc lỗi bên dưới, không có đường nào rò ra unhandled rejection.
    void this.deps
      .onServerRequest(req)
      .then((result) => {
        this.write({ jsonrpc: '2.0', id: req.id, result: result === undefined ? {} : result })
      })
      .catch((error: unknown) => {
        // BẮT BUỘC trả lời dù handler lỗi: app-server đang đợi đúng id này. Im lặng = treo phiên.
        const message = error instanceof Error ? error.message : String(error)
        this.write({ jsonrpc: '2.0', id: req.id, error: { code: -32603, message } })
      })
  }
}
