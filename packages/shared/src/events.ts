import type { AppEventDto, AppEventKind, AppEventSeverity, AppEventSource } from './types'

/**
 * Trung tâm thông báo + đánh dấu sự kiện — phần thuần dùng ở renderer (gom theo ngày, đếm chưa
 * đọc, đổi sự kiện thành vạch trên biểu đồ). Kho lưu (`EventStore`, SQLite) nằm ở core; renderer
 * không import được core nên các phép tính hiển thị đặt ở đây.
 */

export const EVENT_SOURCES: readonly AppEventSource[] = ['monitor', 'replication', 'watcher', 'tunnel', 'http', 'user', 'app']

/** Khoá ngày THEO GIỜ MÁY, dạng YYYY-MM-DD — để gom "hôm nay / hôm qua / ngày cụ thể". */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Gom sự kiện theo ngày, GIỮ thứ tự đầu vào (danh sách đến từ store đã xếp mới → cũ). Một ngày
 * chỉ xuất hiện một lần dù sự kiện của nó nằm rải rác trong đầu vào.
 */
export function groupEventsByDay<T extends { ts: number }>(events: readonly T[]): Array<{ day: string; items: T[] }> {
  const byDay = new Map<string, T[]>()
  for (const ev of events) {
    const key = dayKey(ev.ts)
    const bucket = byDay.get(key)
    if (bucket) bucket.push(ev)
    else byDay.set(key, [ev])
  }
  return [...byDay.entries()].map(([day, items]) => ({ day, items }))
}

/** Số chưa đọc = sự kiện chưa ack, KHÔNG tính marker (marker là thứ user tự ghi, không cần "đọc"). */
export function countUnread(events: readonly Pick<AppEventDto, 'kind' | 'ackedAt'>[]): number {
  let n = 0
  for (const ev of events) if (ev.kind !== 'marker' && ev.ackedAt === null) n += 1
  return n
}

/** Mức nghiêm trọng mặc định theo loại — nơi ghi sự kiện có thể ghi đè (vd offline = critical). */
export function defaultSeverity(kind: AppEventKind): AppEventSeverity {
  return kind === 'alert' ? 'warning' : 'info'
}

/** Một vạch trên biểu đồ: marker của user (accent), alert (danger/warning), recover (success). */
export interface ChartMarker {
  ts: number
  label: string
  tone: 'accent' | 'warning' | 'danger' | 'success'
}

/** Đổi sự kiện thành vạch: `info` không vẽ (không phải mốc đáng nhìn), marker/alert/recover thì có. */
export function toChartMarkers(events: readonly AppEventDto[]): ChartMarker[] {
  const out: ChartMarker[] = []
  for (const ev of events) {
    if (ev.kind === 'marker') out.push({ ts: ev.ts, label: ev.title, tone: 'accent' })
    else if (ev.kind === 'alert') out.push({ ts: ev.ts, label: ev.title, tone: ev.severity === 'critical' ? 'danger' : 'warning' })
    else if (ev.kind === 'recover') out.push({ ts: ev.ts, label: ev.title, tone: 'success' })
  }
  return out
}

/** Vị trí X (0–100) của một mốc trên trục thời gian `from…to`; null nếu nằm ngoài khoảng. */
export function markerX(ts: number, from: number, to: number): number | null {
  if (to <= from || ts < from || ts > to) return null
  return ((ts - from) / (to - from)) * 100
}
