/**
 * Kiểu & phân loại message của giao thức Codex App Server (JSON-RPC 2.0 qua JSONL/stdio).
 *
 * Chỉ mô hình hoá **lớp vận chuyển** — cái gì là request, response, hay notification. Nội dung
 * `params`/`result` để `unknown`: schema app-server còn nhãn `[experimental]` và đổi theo bản
 * (có `codex app-server generate-json-schema --out <DIR>` để đối chiếu khi nâng cấp). Buộc kiểu
 * chặt ở đây thì mỗi lần OpenAI thêm một field là app vỡ; nơi nào cần đọc field thì tự đọc
 * phòng vệ tại đó.
 *
 * Ba loại message, phân biệt bằng sự có mặt của `id` và `method` — đúng chuẩn JSON-RPC:
 *
 * | | `id` | `method` | Ai gửi |
 * |---|---|---|---|
 * | Request  | có | có | cả hai chiều |
 * | Response | có | không | trả lời một request |
 * | Notification | không | có | cả hai chiều, không cần trả lời |
 *
 * **Chiều server→client có request thật**, không chỉ notification: `execCommandApproval` và
 * `applyPatchApproval` là app-server *hỏi* client cho phép chạy lệnh / sửa file, và nó **đợi**
 * response có cùng `id`. Không trả lời là treo phiên vĩnh viễn — lý do `RpcPeer` bắt buộc có
 * `onServerRequest` và vì sao approval phải có timeout auto-decline.
 *
 * Quan sát từ chạy thật (codex-cli 0.142.4): app-server trả response **KHÔNG kèm** `"jsonrpc"`
 * (`{"id":1,"result":{…}}`), nên type guard ở đây **không** được đòi field đó.
 */

/** Id của JSON-RPC: chuẩn cho phép cả số và chuỗi. */
export type RpcId = number | string

export interface CodexRequest {
  readonly id: RpcId
  readonly method: string
  readonly params?: unknown
}

export interface CodexNotification {
  readonly method: string
  readonly params?: unknown
}

export interface CodexRpcError {
  readonly code: number
  readonly message: string
  readonly data?: unknown
}

export interface CodexResponse {
  readonly id: RpcId
  readonly result?: unknown
  readonly error?: CodexRpcError
}

/** Request do app-server gửi NGƯỢC về client (approval). Cùng shape request, tên riêng cho rõ. */
export type ServerRequest = CodexRequest

export type CodexMessage = CodexRequest | CodexNotification | CodexResponse

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function hasId(v: Record<string, unknown>): boolean {
  return typeof v['id'] === 'number' || typeof v['id'] === 'string'
}

function hasMethod(v: Record<string, unknown>): boolean {
  return typeof v['method'] === 'string'
}

/** Có `id` + có `method` = phía kia đang HỎI và chờ ta trả lời. */
export function isServerRequest(msg: unknown): msg is ServerRequest {
  return isRecord(msg) && hasId(msg) && hasMethod(msg)
}

/** Có `method`, KHÔNG `id` = thông báo một chiều, không phải trả lời. */
export function isNotification(msg: unknown): msg is CodexNotification {
  return isRecord(msg) && !hasId(msg) && hasMethod(msg)
}

/** Có `id`, KHÔNG `method` = trả lời cho request ta đã gửi. */
export function isResponse(msg: unknown): msg is CodexResponse {
  return isRecord(msg) && hasId(msg) && !hasMethod(msg)
}

/**
 * Lấy câu lỗi đọc được từ `error` của response.
 *
 * Để ở đây vì mọi nơi hiển thị lỗi đều cần đúng một câu: `error.message` là thứ user đọc, còn
 * `code`/`data` chỉ có ích khi debug. Không có message thì phải nói được là "không có message"
 * chứ đừng ra `[object Object]` hay chuỗi rỗng — một hộp lỗi trống còn khó hiểu hơn không hiện.
 */
export function rpcErrorMessage(err: CodexRpcError | undefined): string {
  if (!err) return 'unknown error'
  const msg = typeof err.message === 'string' && err.message.trim() !== '' ? err.message : `code ${err.code}`
  return msg
}
