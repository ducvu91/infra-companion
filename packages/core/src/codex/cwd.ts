/**
 * Thư mục làm việc mặc định cho phiên Codex — **thuần**, nơi gọi lo phần `fs`.
 *
 * Vì sao cần: bắt user chọn thư mục trước khi làm được gì là rào chắn vô nghĩa — mở panel lên là
 * muốn thử ngay.
 *
 * Vì sao **tạo một thư mục riêng** thay vì dò tìm thư mục code có sẵn: đã thử dò (theo tên hay
 * gặp dưới `~`, rồi quét thư mục chứa nhiều git repo) và cả hai đều sai kiểu khó chấp nhận —
 * trên máy dev thật thì 12 ứng viên dưới `~` **không cái nào tồn tại**, còn quét repo thì đoán ra
 * một dự án **ngẫu nhiên** của user. Đưa agent vào một dự án nó chưa được mời là tệ hơn để trống.
 *
 * Một thư mục cố định thì ngược lại: **đoán được** (luôn cùng chỗ), **an toàn** (rỗng, do app
 * tạo, không lẫn vào dự án nào), và user muốn khác thì bấm "Chọn…" — đúng như yêu cầu.
 */

import { win32 } from 'node:path'

/**
 * Tên thư mục app tạo ở gốc ổ. Có tiền tố tên app để người ta biết ai tạo nó khi thấy ở
 * `D:\` — một thư mục tên `codex` trần trơ ở gốc ổ thì không ai đoán được của gì.
 */
export const CODEX_WORKSPACE_DIR = 'InfraCompanion-Codex'

/**
 * Ổ đĩa thử theo thứ tự: **D: trước, C: sau**.
 *
 * D: trước vì trên Windows nó thường là ổ dữ liệu — viết vào đó không đụng ổ hệ thống, và ổ hệ
 * thống hay bị chính sách/Defender can thiệp hơn. Không có D: thì rơi về C:.
 */
export const WORKSPACE_DRIVE_ORDER: readonly string[] = ['D:\\', 'C:\\']

/**
 * Ứng viên thư mục làm việc, theo thứ tự ưu tiên. Nơi gọi lấy cái đầu tiên **dùng được** (tồn
 * tại, hoặc tạo được).
 *
 * `recent` đứng trước tất cả: user đã làm ở đó thì đừng đoán lại giúp họ.
 *
 * `drives` là danh sách ổ **đang có thật** (nơi gọi liệt kê) — POSIX thì truyền `[]` và dùng
 * `homeFallback`.
 */
export function workspaceCandidates(
  recent: readonly string[],
  drives: readonly string[],
  /** Dùng cho macOS/Linux, nơi không có khái niệm ổ đĩa: thường là `~`. */
  homeFallback?: string,
): string[] {
  const out: string[] = []
  for (const r of recent) {
    if (r.trim() !== '') out.push(r)
  }
  for (const d of drives) {
    if (d.trim() === '') continue
    out.push(win32.join(d, CODEX_WORKSPACE_DIR))
  }
  if (homeFallback && homeFallback.trim() !== '') {
    // POSIX: thư mục ẩn dưới `~` chứ không phải ở `/` — ghi vào gốc filesystem cần quyền root
    // và là chỗ không ai để dự án.
    out.push(`${homeFallback.replace(/\/+$/, '')}/${CODEX_WORKSPACE_DIR}`)
  }
  return out.filter((p, i) => out.indexOf(p) === i)
}
