/**
 * Tách frame JSON-RPC từ stdout của `codex app-server`.
 *
 * Giao thức là **JSONL**: mỗi dòng một message JSON. Cùng bài toán chunk-cắt-giữa-dòng như
 * `logLines.splitLines`, nhưng khác ở hai điểm nên không dùng lại được:
 *
 * 1. **Phải `JSON.parse` từng dòng**, và dòng hỏng thì KHÔNG được throw — một dòng rác không
 *    được quyền giết cả phiên đang chạy. Nó đi vào `dropped` để nơi gọi log lại (đúng mục 8
 *    CLAUDE.md: API im lặng phải kiểm tường minh, nhưng "tường minh" ở đây là *báo*, không phải
 *    *chết*).
 * 2. **KHÔNG chuẩn hoá CRLF → LF.** `splitLines` làm vậy vì nginx/mariadb trên Windows ghi
 *    `\r\n`. Ở đây một `\r` lọt vào GIỮA chuỗi JSON là dữ liệu thật của message (ví dụ output
 *    lệnh mà agent đang thuật lại), đổi nó đi là làm sai nội dung. `JSON.parse` tự bỏ qua `\r`
 *    thừa ở cuối dòng nên không cần xử lý.
 *
 * Chunk cắt giữa ký tự UTF-8 (rất dễ gặp: tin nhắn agent có tiếng Việt) **không** giải ở đây —
 * nơi gọi phải dùng `StringDecoder` hoặc `setEncoding('utf8')` để chunk luôn là chuỗi hợp lệ,
 * cùng cách `execOnce` đang làm.
 */

export interface JsonlSplit {
  /** Frame đã parse xong, theo đúng thứ tự đến. */
  readonly frames: unknown[]
  /** Phần dư chưa có '\n' — truyền lại vào lần gọi sau. */
  readonly rest: string
  /** Dòng không parse được (đã cắt bớt cho log). Bình thường luôn rỗng. */
  readonly dropped: string[]
}

/** Cắt dòng rác trước khi log — một dòng hỏng có thể dài vài MB. */
const DROPPED_PREVIEW = 200

export function splitJsonl(rest: string, chunk: string): JsonlSplit {
  const buf = rest + chunk
  const parts = buf.split('\n')
  // Phần tử cuối là đoạn CHƯA có '\n' → giữ lại cho lần sau nối tiếp.
  const tail = parts.pop() ?? ''

  const frames: unknown[] = []
  const dropped: string[] = []
  for (const line of parts) {
    // Dòng trắng là hợp lệ trong JSONL (và app-server có phát) — bỏ qua, không tính là lỗi.
    if (line.trim() === '') continue
    try {
      frames.push(JSON.parse(line))
    } catch {
      dropped.push(line.length > DROPPED_PREVIEW ? `${line.slice(0, DROPPED_PREVIEW)}…` : line)
    }
  }
  return { frames, rest: tail, dropped }
}
