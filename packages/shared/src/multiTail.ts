/**
 * Tail gộp nhiều host — phần thuần: gán MÀU cố định cho từng host trong một phiên để prefix
 * `[app-01]` đọc được bằng mắt trước khi đọc chữ. Bảng 8 màu, quay vòng khi nhiều host hơn.
 *
 * Trả về tên lớp Tailwind (không phải mã màu) để đổi theme là đổi luôn — cùng lệ với chấm
 * trạng thái ở sidebar.
 */
export const HOST_TONES: readonly string[] = [
  'text-accent',
  'text-warning',
  'text-success',
  'text-danger',
  'text-[#c678dd]',
  'text-[#56b6c2]',
  'text-[#e5c07b]',
  'text-[#61afef]'
]

/** host id → lớp màu, theo THỨ TỰ user chọn — thêm host sau không đổi màu host trước. */
export function assignHostTones(hostIds: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  let i = 0
  for (const id of hostIds) {
    if (id in out) continue
    out[id] = HOST_TONES[i % HOST_TONES.length]!
    i += 1
  }
  return out
}

/** Bề rộng cột prefix = tên dài nhất, kẹp 4–16 ký tự để cột không nuốt hết chỗ của dòng log. */
export function prefixWidth(labels: readonly string[]): number {
  const longest = labels.reduce((m, l) => Math.max(m, l.length), 0)
  return Math.min(16, Math.max(4, longest))
}

/** Cắt/đệm nhãn về đúng bề rộng cột để các dòng thẳng hàng. */
export function padLabel(label: string, width: number): string {
  return label.length > width ? `${label.slice(0, width - 1)}…` : label.padEnd(width)
}
