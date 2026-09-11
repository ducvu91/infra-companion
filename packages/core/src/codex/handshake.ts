/**
 * Handshake `initialize` với Codex App Server, và đọc năng lực giao thức từ kết quả.
 *
 * App-server **từ chối mọi request khác cho tới khi handshake xong**: gửi `initialize` (có id,
 * chờ result) rồi gửi ngay notification `initialized`.
 *
 * `clientInfo` khai **TRUNG THỰC** tên app. Đã kiểm chứng nó đi thẳng vào `userAgent` mà
 * app-server báo lại — nghĩa là đây chính là thứ OpenAI dùng để nhận diện client (tài liệu
 * khuyến nghị liên hệ để vào "known clients list" cho bối cảnh doanh nghiệp). Khai tên giả để
 * giống một client khác là gian, và cũng tự làm mình mất đường được hỗ trợ.
 */

export interface InitializeOptions {
  /** Tên máy (không đổi giữa các bản) — dùng để nhận diện client. */
  readonly name: string
  /** Tên hiển thị. */
  readonly title: string
  /** Version app, để OpenAI biết bản nào đang gọi. */
  readonly version: string
  /**
   * Notification muốn TẮT. Delta reasoning bắn theo token và rất dài; trong một cột hẹp thì
   * gần như vô dụng mà lại là nguồn IPC nặng nhất. Mặc định tắt `reasoning/textDelta`, GIỮ
   * `summaryTextDelta` (tóm tắt, ngắn, đáng đọc) và `agentMessage/delta` (chính là câu trả lời).
   */
  readonly optOutNotificationMethods?: readonly string[]
}

/** Delta reasoning chi tiết — dài nhất, ít giá trị nhất khi hiển thị. */
export const DEFAULT_OPT_OUT: readonly string[] = ['item/reasoning/textDelta']

/** `initialize` phải nhanh: nó chưa gọi model, chỉ dựng phiên. Chậm hơn thế là hỏng. */
export const INITIALIZE_TIMEOUT_MS = 10_000

export function buildInitializeParams(opts: InitializeOptions): Record<string, unknown> {
  return {
    clientInfo: {
      name: opts.name,
      title: opts.title,
      version: opts.version,
    },
    capabilities: {
      experimentalApi: false,
      optOutNotificationMethods: [...(opts.optOutNotificationMethods ?? DEFAULT_OPT_OUT)],
    },
  }
}

/**
 * Thông tin đọc được từ kết quả `initialize`.
 *
 * Mọi field đều optional: schema app-server còn `[experimental]`, bản khác nhau trả khác nhau.
 * Thiếu field thì mất một dòng hiển thị, chứ không được làm handshake thất bại.
 */
export interface InitializeInfo {
  /** Thư mục config Codex đang dùng — hiện ra để user biết auth lấy từ đâu. */
  readonly codexHome?: string
  readonly userAgent?: string
  readonly platformOs?: string
}

/**
 * Đọc kết quả `initialize` một cách phòng vệ.
 *
 * Trả `null` khi result **không phải object** — đó là dấu hiệu ta không nói cùng giao thức với
 * phía kia, và im lặng coi như thành công thì mọi lỗi sau đó sẽ khó truy. Còn object thiếu field
 * thì vẫn hợp lệ (xem `InitializeInfo`).
 */
export function validateInitializeResult(raw: unknown): InitializeInfo | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const str = (k: string): string | undefined => (typeof r[k] === 'string' ? (r[k] as string) : undefined)
  return {
    codexHome: str('codexHome'),
    userAgent: str('userAgent'),
    platformOs: str('platformOs'),
  }
}
