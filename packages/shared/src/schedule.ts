/**
 * Lịch chạy tự động — phần thuần: parse biểu thức cron 5 trường và tính **lần chạy kế tiếp**.
 *
 * Vì sao tự viết thay vì kéo `cron-parser`: app đã có bộ diễn giải cron sang lời (`diag/crontab.ts`)
 * cho tính năng đọc crontab của server; ở đây chỉ cần một phép "mốc kế tiếp sau thời điểm T",
 * và một thư viện nữa là thêm một thứ phải theo dõi bản vá. Bộ này cố tình hỗ trợ ĐÚNG những gì
 * lịch trong app cần: dấu sao, số, danh sách `a,b`, dải `a-b`, bước (dạng sao-gạch-chéo-n và
 * `a-b/n`), cộng các bí danh `@hourly` `@daily` `@weekly` `@monthly`.
 * Không hỗ trợ tên thứ/tháng bằng chữ (`MON`, `JAN`) và
 * `@reboot` — lịch của app không có khái niệm "lúc máy khởi động" theo cron.
 *
 * Giờ luôn theo **múi giờ máy đang chạy** (đồng hồ local), giống crontab của server: người ta đặt
 * "3h sáng" là 3h sáng ở nơi mình ngồi, không phải UTC.
 */

export interface CronFields {
  minutes: number[]
  hours: number[]
  /** 1–31. */
  daysOfMonth: number[]
  /** 1–12. */
  months: number[]
  /** 0–6, 0 = Chủ nhật. */
  daysOfWeek: number[]
  /** `*` ở cả hai cột ngày → mọi ngày; chỉ MỘT cột là `*` thì cron dùng phép HOẶC giữa hai cột. */
  domRestricted: boolean
  dowRestricted: boolean
}

const ALIASES: Record<string, string> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *'
}

/** Một trường: dấu sao, `5`, `1,15`, `1-5`, sao-gạch-chéo-10, `0-30/5`. Trả null nếu không hiểu. */
function parseField(raw: string, min: number, max: number): number[] | null {
  const out = new Set<number>()
  for (const part of raw.split(',')) {
    const piece = part.trim()
    if (piece === '') return null
    const [rangePart, stepPart] = piece.split('/')
    let step = 1
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart)) return null
      step = Number(stepPart)
      if (step < 1) return null
    }
    let lo: number
    let hi: number
    if (rangePart === '*') {
      lo = min
      hi = max
    } else {
      const range = rangePart!.match(/^(\d{1,2})(?:-(\d{1,2}))?$/)
      if (!range) return null
      lo = Number(range[1])
      hi = range[2] !== undefined ? Number(range[2]) : lo
      // `5/10` (không phải dải) trong cron nghĩa là từ 5 tới hết cột, bước 10
      if (range[2] === undefined && stepPart !== undefined) hi = max
    }
    if (lo < min || hi > max || lo > hi) return null
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out.size > 0 ? [...out].sort((a, b) => a - b) : null
}

export function parseCronExpression(expr: string): CronFields | null {
  const trimmed = expr.trim().toLowerCase()
  const source = ALIASES[trimmed] ?? trimmed
  if (source.startsWith('@')) return null // @reboot và bí danh lạ: lịch của app không có khái niệm đó
  const parts = source.split(/\s+/)
  if (parts.length !== 5) return null
  const minutes = parseField(parts[0]!, 0, 59)
  const hours = parseField(parts[1]!, 0, 23)
  const daysOfMonth = parseField(parts[2]!, 1, 31)
  const months = parseField(parts[3]!, 1, 12)
  const rawDow = parseField(parts[4]!, 0, 7)
  if (!minutes || !hours || !daysOfMonth || !months || !rawDow) return null
  // Cron nhận cả 7 = Chủ nhật; quy về 0 để so với Date.getDay()
  const daysOfWeek = [...new Set(rawDow.map((d) => (d === 7 ? 0 : d)))].sort((a, b) => a - b)
  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    domRestricted: parts[2] !== '*',
    dowRestricted: parts[4] !== '*'
  }
}

export function isValidCronExpression(expr: string): boolean {
  return parseCronExpression(expr) !== null
}

/**
 * Ngày này có khớp lịch không. Quy tắc cron gốc: nếu CẢ HAI cột ngày đều bị hạn chế thì lấy phép
 * HOẶC (`0 0 13 * 5` = ngày 13 **hoặc** thứ Sáu), còn lại là phép VÀ như bình thường.
 */
function dayMatches(fields: CronFields, date: Date): boolean {
  const dom = fields.daysOfMonth.includes(date.getDate())
  const dow = fields.daysOfWeek.includes(date.getDay())
  if (fields.domRestricted && fields.dowRestricted) return dom || dow
  if (fields.domRestricted) return dom
  if (fields.dowRestricted) return dow
  return true
}

/**
 * Trần dò tới: **5 năm** tính theo NGÀY (không theo phút).
 *
 * Phải hơn 4 năm vì `0 0 29 2 *` (29 tháng 2) chỉ khớp mỗi năm nhuận — trần một năm sẽ trả null
 * cho một lịch hoàn toàn hợp lệ; test đã bắt đúng ca này. Lịch không bao giờ khớp (30/2) vẫn dừng
 * sau chừng ấy ngày thay vì lặp vô hạn.
 */
const MAX_LOOKAHEAD_DAYS = 5 * 366

/**
 * Mốc chạy kế tiếp SAU `after` (không bao gồm chính phút của `after`), theo đồng hồ local.
 * Trả null khi biểu thức sai hoặc không bao giờ khớp.
 */
export function nextCronRun(expr: string, after: number): number | null {
  const fields = parseCronExpression(expr)
  if (!fields) return null
  const cursor = new Date(after)
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)
  // Đếm theo NGÀY đã đi qua: ngày không khớp thì nhảy cả ngày, ngày khớp thì dò trong ngày đó.
  // `setDate` tự xử lý cuối tháng và giờ mùa hè, nên không tính tay số ngày trong tháng.
  for (let day = 0; day <= MAX_LOOKAHEAD_DAYS; day += 1) {
    if (fields.months.includes(cursor.getMonth() + 1) && dayMatches(fields, cursor)) {
      // Dò từng phút CHỈ trong phần còn lại của ngày này
      const endOfDay = new Date(cursor)
      endOfDay.setHours(23, 59, 0, 0)
      while (cursor.getTime() <= endOfDay.getTime()) {
        if (fields.hours.includes(cursor.getHours()) && fields.minutes.includes(cursor.getMinutes())) return cursor.getTime()
        cursor.setMinutes(cursor.getMinutes() + 1)
      }
      // Hết ngày mà không khớp giờ/phút → `cursor` đã sang 00:00 ngày sau, đi tiếp
      cursor.setHours(0, 0, 0, 0)
      continue
    }
    cursor.setHours(0, 0, 0, 0)
    cursor.setDate(cursor.getDate() + 1)
  }
  return null
}

/**
 * Lịch có đến hạn tại `now` không, biết lần chạy trước là `lastRunAt`.
 *
 * Dùng `nextCronRun(lastRunAt ?? enabledAt)` chứ không so khớp phút hiện tại: app có thể đang ngủ,
 * máy vừa thức, hoặc vòng kiểm chạy chậm một nhịp — so khớp phút sẽ **bỏ lượt** trong mọi ca đó.
 * Đổi lại, một lịch quá hạn lâu chỉ chạy MỘT lần bù (không chạy dồn 20 lần cho 20 giờ máy tắt).
 */
export function isDue(expr: string, now: number, lastRunAt: number | null, enabledAt: number): boolean {
  const next = nextCronRun(expr, lastRunAt ?? enabledAt)
  return next !== null && next <= now
}
