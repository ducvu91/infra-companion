/**
 * Sổ tay vận hành — phần thuần: kiểu dữ liệu, biến `{{x}}` trong lệnh, tìm kiếm, và định dạng
 * văn bản để user tự viết sổ tay của mình (parse ↔ render).
 *
 * Vì sao có tính năng này: những việc làm vài tháng một lần (whitelist IP theo iptables, thêm
 * cron, chặn IP ở nginx, cấp SSL…) lần nào cũng phải tra lại từ đầu, và lần nào cũng có một chỗ
 * dễ tự khoá mình khỏi SSH. Sổ tay có sẵn giữ các bước + lệnh + chỗ cần cẩn thận ở ngay trong
 * app; sổ tay riêng để user ghi lại cách làm của chính hạ tầng mình.
 */

export type RunbookCategory =
  | 'firewall'
  | 'web'
  | 'ssl'
  | 'ssh'
  | 'users'
  | 'cron'
  | 'disk'
  | 'services'
  | 'database'
  | 'logs'
  | 'network'
  | 'docker'
  | 'other'

export const RUNBOOK_CATEGORIES: readonly RunbookCategory[] = [
  'firewall',
  'web',
  'ssl',
  'ssh',
  'users',
  'cron',
  'disk',
  'services',
  'database',
  'logs',
  'network',
  'docker',
  'other'
]

export const RUNBOOK_CATEGORY_ICON: Record<RunbookCategory, string> = {
  firewall: '🧱',
  web: '🌐',
  ssl: '🔒',
  ssh: '🔑',
  users: '👤',
  cron: '⏰',
  disk: '💾',
  services: '⚙',
  database: '🗄',
  logs: '🪵',
  network: '📡',
  docker: '🐳',
  other: '📄'
}

export interface RunbookStep {
  title: string
  /** Lệnh (có thể nhiều dòng). Biến `{{ip}}`, `{{port}}`… điền trước khi chép. */
  command?: string
  /** Ghi chú ngắn: vì sao, cái gì cần cẩn thận, kiểm bằng gì. */
  note?: string
  /** Lệnh có thể làm mất kết nối / xoá dữ liệu → chép phải xác nhận. */
  danger?: boolean
}

/** Một cách làm theo hệ (vd whitelist IP: iptables-services / firewalld / ufw). */
export interface RunbookVariant {
  id: string
  label: string
  steps: RunbookStep[]
}

export interface Runbook {
  id: string
  title: string
  category: RunbookCategory
  tags: string[]
  summary: string
  /** Cảnh báo đọc TRƯỚC khi làm (tô đỏ). */
  warnings: string[]
  /** Luôn ≥ 1. Sổ tay không phân hệ dùng một variant `default`. */
  variants: RunbookVariant[]
  builtin: boolean
  updatedAt?: number
}

export const DEFAULT_VARIANT_ID = 'default'

const VAR_RE = /\{\{\s*([\w.-]+)\s*\}\}/g

/** Biến `{{x}}` trong một chuỗi, theo thứ tự xuất hiện, không trùng. */
export function extractVars(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(VAR_RE)) {
    const name = m[1]!
    if (!out.includes(name)) out.push(name)
  }
  return out
}

/** Biến của cả một variant (mọi lệnh) — form "Điền biến" hiện đúng danh sách này. */
export function variantVars(variant: RunbookVariant): string[] {
  const out: string[] = []
  for (const step of variant.steps) {
    if (!step.command) continue
    for (const v of extractVars(step.command)) if (!out.includes(v)) out.push(v)
  }
  return out
}

/** Điền biến; biến chưa có giá trị GIỮ NGUYÊN `{{x}}` để người chép còn thấy chỗ phải sửa. */
export function fillVars(text: string, values: Record<string, string>): string {
  return text.replace(VAR_RE, (whole, name: string) => {
    const v = values[name]
    return v !== undefined && v !== '' ? v : whole
  })
}

/** Lệnh nào còn `{{x}}` chưa điền — nút Gửi vào terminal phải chặn để không gửi placeholder lên server. */
export function hasUnfilledVars(text: string, values: Record<string, string>): boolean {
  return extractVars(fillVars(text, values)).length > 0
}

/** Tìm AND theo từ, không phân biệt hoa thường, trên tiêu đề / tag / tóm tắt / tên bước / lệnh. */
export function searchRunbooks<T extends Runbook>(list: readonly T[], query: string): T[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...list]
  return list.filter((rb) => {
    const blob = [
      rb.title,
      rb.category,
      rb.tags.join(' '),
      rb.summary,
      ...rb.variants.flatMap((v) => [v.label, ...v.steps.flatMap((s) => [s.title, s.command ?? '', s.note ?? ''])])
    ]
      .join('\n')
      .toLowerCase()
    return terms.every((t) => blob.includes(t))
  })
}

/**
 * Định dạng văn bản cho sổ tay tự viết — đủ đơn giản để gõ trong một ô textarea:
 *
 * ```
 * ## Tiêu đề bước
 * $ lệnh
 * $ lệnh tiếp (nhiều dòng $ liền nhau = một khối lệnh)
 * ghi chú tự do, nhiều dòng cũng được
 * !! Bước nguy hiểm: dòng "!!" ở đầu bước đánh dấu danger
 * ```
 * Dòng trước `##` đầu tiên bị bỏ. Bước không có `$` chỉ là hướng dẫn chữ.
 */
export function parseRunbookText(text: string): RunbookStep[] {
  const steps: RunbookStep[] = []
  let cur: { title: string; cmd: string[]; note: string[]; danger: boolean } | null = null
  const flush = (): void => {
    if (!cur) return
    const step: RunbookStep = { title: cur.title }
    if (cur.cmd.length > 0) step.command = cur.cmd.join('\n')
    if (cur.note.length > 0) step.note = cur.note.join('\n').trim()
    if (cur.danger) step.danger = true
    steps.push(step)
    cur = null
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd()
    const heading = line.match(/^##\s*(.*)$/)
    if (heading) {
      flush()
      cur = { title: heading[1]!.trim() || `Bước ${steps.length + 1}`, cmd: [], note: [], danger: false }
      continue
    }
    if (!cur) continue
    if (line.startsWith('!!')) {
      cur.danger = true
      const rest = line.slice(2).trim()
      if (rest) cur.note.push(rest)
      continue
    }
    if (line.startsWith('$ ')) {
      cur.cmd.push(line.slice(2))
      continue
    }
    if (line === '$') {
      cur.cmd.push('')
      continue
    }
    if (line.trim() === '' && cur.note.length === 0) continue
    cur.note.push(line)
  }
  flush()
  return steps
}

/** Ngược của {@link parseRunbookText} — mở sổ tay có sẵn ra để sửa thành bản của mình. */
export function renderRunbookText(steps: readonly RunbookStep[]): string {
  const blocks = steps.map((s) => {
    const lines = [`## ${s.title}`]
    if (s.danger) lines.push('!!')
    if (s.command) for (const l of s.command.split('\n')) lines.push(l === '' ? '$' : `$ ${l}`)
    if (s.note) lines.push(s.note)
    return lines.join('\n')
  })
  return blocks.join('\n\n')
}

/** Chuẩn hoá một sổ tay từ JSON (vault meta) — bỏ bản hỏng thay vì ném. */
export function sanitizeRunbook(raw: unknown): Runbook | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<Runbook>
  if (typeof r.id !== 'string' || !r.id || typeof r.title !== 'string' || !r.title.trim()) return null
  const category = (RUNBOOK_CATEGORIES as readonly string[]).includes(r.category ?? '') ? (r.category as RunbookCategory) : 'other'
  const variants = Array.isArray(r.variants)
    ? r.variants
        .filter((v): v is RunbookVariant => !!v && typeof v === 'object' && Array.isArray((v as RunbookVariant).steps))
        .map((v) => ({
          id: typeof v.id === 'string' && v.id ? v.id : DEFAULT_VARIANT_ID,
          label: typeof v.label === 'string' ? v.label : '',
          steps: v.steps
            .filter((s): s is RunbookStep => !!s && typeof s === 'object' && typeof (s as RunbookStep).title === 'string')
            .map((s) => ({
              title: s.title,
              ...(typeof s.command === 'string' && s.command ? { command: s.command } : {}),
              ...(typeof s.note === 'string' && s.note ? { note: s.note } : {}),
              ...(s.danger ? { danger: true } : {})
            }))
        }))
    : []
  if (variants.length === 0) variants.push({ id: DEFAULT_VARIANT_ID, label: '', steps: [] })
  return {
    id: r.id,
    title: r.title.trim(),
    category,
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean) : [],
    summary: typeof r.summary === 'string' ? r.summary : '',
    warnings: Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === 'string' && w.trim() !== '') : [],
    variants,
    builtin: false,
    ...(typeof r.updatedAt === 'number' ? { updatedAt: r.updatedAt } : {})
  }
}
