/**
 * Tài khoản Codex: đọc trạng thái đăng nhập, đăng nhập, đổi tài khoản, hạn mức gói.
 *
 * **Điểm quan trọng nhất**: app-server có sẵn cả bộ `account/*` qua JSON-RPC nên **không cần bắt
 * user mở terminal chạy `codex login`**. Đã kiểm chứng trên codex-cli 0.142.4 — `account/read`
 * và `account/rateLimits/read` chạy được và **không tốn token** (chúng không gọi model).
 *
 * Nhờ vậy sửa được một chỗ báo sai của bản trước: panel hiện *"chưa xác minh đăng nhập"* cho một
 * máy đã đăng nhập rồi, vì cách duy nhất nó biết là chạy một turn thật (tốn token) nên nó không
 * chạy. `account/read` trả lời đúng câu hỏi đó miễn phí.
 *
 * Mọi hàm ở đây **thuần** — parse kết quả JSON-RPC, không gọi ai.
 */

export type CodexAuthMode = 'chatgpt' | 'apiKey' | 'unknown'

export interface CodexAccount {
  readonly authMode: CodexAuthMode
  /** Email tài khoản. `undefined` khi đăng nhập bằng API key. */
  readonly email?: string
  /** Gói: `plus`, `pro`, `go`, `team`, `enterprise`… Chuỗi thô vì OpenAI thêm gói mới liên tục. */
  readonly planType?: string
}

/** Hạn mức của gói — nói được "còn bao nhiêu" mà không cần user vào web. */
export interface CodexRateLimit {
  /** Đã dùng bao nhiêu % cửa sổ hiện tại. */
  readonly usedPercent: number
  /** Độ dài cửa sổ tính theo phút (43200 = 30 ngày). */
  readonly windowMins?: number
  /** Epoch giây khi hạn mức reset. */
  readonly resetsAt?: number
  /** Đã đụng trần chưa — có thì UI phải nói ra trước khi user gõ một prompt dài. */
  readonly reached?: boolean
}

function rec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function str(r: Record<string, unknown>, key: string): string | undefined {
  const v = r[key]
  return typeof v === 'string' && v !== '' ? v : undefined
}

function num(r: Record<string, unknown>, key: string): number | undefined {
  const v = r[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/**
 * Đọc kết quả `account/read`.
 *
 * Trả `null` khi **chưa đăng nhập** — phân biệt được với "lỗi đọc" ở nơi gọi vì lỗi thì
 * `request()` đã throw. Shape thật (đã kiểm chứng):
 * `{ account: { type: 'chatgpt', email: '…', planType: 'go' }, requiresOpenaiAuth: true }`
 */
export function parseAccount(raw: unknown): CodexAccount | null {
  const r = rec(raw)
  const acc = rec(r['account'])
  // Không có object `account` = chưa đăng nhập. `requiresOpenaiAuth` không dùng để kết luận:
  // nó nói về việc *cần* auth hay không, không nói đã *có* auth.
  if (Object.keys(acc).length === 0) return null

  const type = str(acc, 'type') ?? str(r, 'authMode')
  const authMode: CodexAuthMode = type === 'chatgpt' ? 'chatgpt' : type === 'apiKey' ? 'apiKey' : 'unknown'
  return {
    authMode,
    email: str(acc, 'email'),
    planType: str(acc, 'planType') ?? str(r, 'planType'),
  }
}

/**
 * Đọc kết quả `account/rateLimits/read`.
 *
 * Lấy `primary` (cửa sổ chính). `secondary` bỏ qua có chủ ý: hai con số trên một dòng UI thì
 * không ai đọc, mà cái quyết định được-hay-không-được-gõ là cửa sổ chính.
 */
export function parseRateLimit(raw: unknown): CodexRateLimit | null {
  const r = rec(raw)
  const rl = rec(r['rateLimits'])
  const primary = rec(rl['primary'])
  const used = num(primary, 'usedPercent')
  if (used === undefined) return null
  return {
    usedPercent: used,
    windowMins: num(primary, 'windowDurationMins'),
    resetsAt: num(primary, 'resetsAt'),
    reached: typeof rl['rateLimitReachedType'] === 'string',
  }
}

/**
 * Đọc notification `account/login/completed`.
 *
 * Shape: `{ success: boolean, loginId: string|null, error: string|null }`. Login thất bại thì
 * **phải** có câu nói được nguyên nhân — user vừa bấm một nút và mở cả browser, im lặng là tệ
 * nhất ở đây.
 */
export function parseLoginCompleted(raw: unknown): { readonly ok: boolean; readonly loginId?: string; readonly error?: string } {
  const r = rec(raw)
  return {
    ok: r['success'] === true,
    loginId: str(r, 'loginId'),
    error: str(r, 'error'),
  }
}

/** Params cho `account/login/start`. */
export type CodexLoginKind = 'chatgpt' | 'deviceCode'

export function buildLoginParams(kind: CodexLoginKind): Record<string, unknown> {
  // Tên `type` theo schema thật: 'chatgpt' | 'chatgptDeviceCode' | 'apiKey'.
  // Cố ý KHÔNG expose 'apiKey': cả tính năng này tồn tại để dùng GÓI thuê bao, và một ô nhập
  // key ở đây sẽ mời người ta đi đường tính tiền theo lượt mà không nhận ra.
  return kind === 'chatgpt' ? { type: 'chatgpt' } : { type: 'chatgptDeviceCode' }
}

/**
 * Câu mô tả hạn mức đủ ngắn cho một dòng UI.
 *
 * Trả về các mảnh chứ không phải chuỗi đã ghép: chuỗi phải do i18n ghép, không thì `packages/core`
 * sẽ chứa tiếng Việt và không dịch được.
 */
export function rateLimitParts(rl: CodexRateLimit, now: number): {
  readonly usedPercent: number
  /** Số ngày tới khi reset — `undefined` nếu không biết. */
  readonly resetsInDays?: number
} {
  if (rl.resetsAt === undefined) return { usedPercent: rl.usedPercent }
  const secs = rl.resetsAt - Math.floor(now / 1000)
  if (secs <= 0) return { usedPercent: rl.usedPercent }
  return { usedPercent: rl.usedPercent, resetsInDays: Math.max(1, Math.ceil(secs / 86_400)) }
}

// ── Profile (nhiều tài khoản song song) ──────────────────────────────────────

/**
 * Codex giữ **đúng một** tài khoản trong `CODEX_HOME` (mặc định `~/.codex`). Muốn nhiều tài khoản
 * song song thì phải nhiều `CODEX_HOME`.
 *
 * Đánh đổi phải nói rõ với user, vì nó không hiển nhiên. **Đã kiểm chứng bằng cách chạy thật**
 * (codex-cli 0.142.4, hai tiến trình cạnh nhau):
 *
 * | | Mặc định (`~/.codex`) | Profile riêng |
 * |---|---|---|
 * | Tài khoản | dùng chung với `codex` chạy tay ở terminal | **độc lập** (phải login riêng) |
 * | MCP server trong `config.toml` của user | **nạp hết** | **không nạp cái nào** |
 *
 * Dòng thứ hai là câu trả lời cho R7: MCP server user khai trong `~/.codex/config.toml` tự nạp
 * vào mọi thread, và `-c mcp_servers.<name>=false` bị Codex từ chối — nên **profile riêng là
 * cách cô lập duy nhất**. Nghĩa là "không dùng được config.toml sẵn có" vừa là nhược điểm (mất
 * tool user đã cấu hình) vừa là ưu điểm (agent không có tool ngoài ý muốn của app).
 */
export const CODEX_DEFAULT_PROFILE = 'default'

/** Tên profile hợp lệ: đi vào tên thư mục nên phải chặn path traversal và ký tự Windows cấm. */
export function isValidProfileName(name: string): boolean {
  if (name === CODEX_DEFAULT_PROFILE) return false // tên dành riêng
  if (name.length === 0 || name.length > 40) return false
  // Chỉ chữ/số/gạch — không dấu chấm (chặn `.` và `..`), không ký tự Windows cấm.
  return /^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(name)
}
