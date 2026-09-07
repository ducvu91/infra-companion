/**
 * Dải "Cần chú ý" trên Dashboard — gom những thứ ĐANG HỎNG thành một chỗ.
 *
 * Dashboard hiện đếm tồn kho (bao nhiêu host, bao nhiêu nhóm) — số không đổi và không đòi
 * làm gì. Thứ thật sự cần biết lúc mở app là "có gì đang hỏng không". Dải này CHỈ hiện khi
 * có vấn đề: luôn hiện một khối, kể cả khi trống, thì mắt sẽ học cách bỏ qua nó.
 *
 * Hàm thuần ở `packages/shared` (không phải core) vì renderer không được import `@infra/core`.
 */

export type AttentionKind = 'host-down' | 'tunnel-error' | 'replication' | 'http-down'

export interface AttentionItem {
  kind: AttentionKind
  /** Khoá React + khử trùng lặp. */
  id: string
  /** Tên đối tượng (host / tunnel / cụm) — nơi gọi tự dịch phần mô tả quanh nó. */
  label: string
  /** Chi tiết ngắn: thông báo lỗi, số giây trễ… Rỗng thì nơi gọi bỏ qua. */
  detail?: string
}

export interface AttentionInput {
  /** Chỉ tính khi watcher ĐANG BẬT — tắt thì không có dữ liệu, im lặng khác với "đều ổn". */
  watcherEnabled: boolean
  hosts: Array<{ id: string; label: string }>
  hostStatus: Record<string, { ok: boolean } | undefined>
  tunnels: Array<{ id: string; label: string }>
  tunnelState: Record<string, { status: string; detail?: string } | undefined>
  /** Slave đang lệch: đã do nơi gọi lọc từ store replication. */
  replicaIssues: Array<{ id: string; label: string; detail?: string }>
  /** Theo dõi URL (tuỳ chọn — Dashboard cũ không truyền): danh sách check + tóm tắt theo id. */
  httpChecks?: Array<{ id: string; label: string }>
  httpState?: Record<string, { alerting: boolean; last?: { error: string | null } | null } | undefined>
}

/**
 * Gom các vấn đề đang mở. Thứ tự cố định host → tunnel → replication để dải không nhảy lung
 * tung giữa hai lần render khi một mục đổi trạng thái.
 *
 * Host CHƯA có kết quả check (`undefined`) KHÔNG tính là hỏng — "chưa biết" mà tô đỏ thì lần
 * nào mới bật watcher cũng thấy cả fleet đang cháy.
 */
export function collectAttention(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = []

  if (input.watcherEnabled) {
    for (const host of input.hosts) {
      const status = input.hostStatus[host.id]
      if (status !== undefined && !status.ok) {
        items.push({ kind: 'host-down', id: `host:${host.id}`, label: host.label })
      }
    }
  }

  for (const tunnel of input.tunnels) {
    const state = input.tunnelState[tunnel.id]
    // Chỉ 'error'; 'stopped' là do user tự tắt, không phải sự cố
    if (state?.status === 'error') {
      items.push({ kind: 'tunnel-error', id: `tunnel:${tunnel.id}`, label: tunnel.label, detail: state.detail })
    }
  }

  for (const replica of input.replicaIssues) {
    items.push({ kind: 'replication', id: `repl:${replica.id}`, label: replica.label, detail: replica.detail })
  }

  // URL: chỉ khi ĐANG BÁO (đã fail đủ số lần liên tiếp) — một lần nháy chưa đủ để lên dải
  for (const check of input.httpChecks ?? []) {
    const state = input.httpState?.[check.id]
    if (state?.alerting) {
      items.push({ kind: 'http-down', id: `http:${check.id}`, label: check.label, detail: state.last?.error ?? undefined })
    }
  }

  return items
}
