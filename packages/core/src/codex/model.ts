/**
 * Đọc danh sách model từ `model/list` — để **hiển thị** và để chẩn đoán, KHÔNG để tự ghi đè.
 *
 * ⚠️ Bài học đắt: `model/list` **không đáng tin** trên bản CLI cũ. Đo thật trên codex-cli
 * 0.142.4 với gói `go`:
 *
 * | Model | Kết quả gọi thật |
 * |---|---|
 * | `gpt-5.6-terra` (config của user) | 400 — *"requires a newer version of Codex"* |
 * | `gpt-5.5` (chính cái `model/list` báo là dùng được) | **404 — *"does not exist or you do not have access"*** |
 * | `gpt-5.6`, `gpt-5.1-codex`, `gpt-5-codex` | 400 — *"not supported when using Codex with a ChatGPT account"* |
 *
 * Tức **không model nào chạy được**: CLI quá cũ so với server. Bản đầu tôi dùng `model/list` để
 * tự ghi đè model — hoá ra chỉ đổi một lỗi 400 thành một lỗi 404, và còn che mất nguyên nhân
 * thật (cần nâng cấp Codex). Nên giờ app **không tự đổi model của user**; nó chỉ dùng danh sách
 * này để nhận ra tình huống và **nói ra** việc cần làm.
 *
 * Cũng vì thế mà không sửa `config.toml`: sai chẩn đoán cộng với sửa file của công cụ khác thì
 * hỏng gấp đôi.
 */

/** Một model app-server báo là dùng được. */
export interface CodexModel {
  readonly id: string
  readonly displayName?: string
}

/**
 * Đọc kết quả `model/list`.
 *
 * Thử vài tên field vì shape đổi theo bản (`models` / `data` / mảng trần). Không đọc được thì
 * trả mảng rỗng — nơi gọi hiểu là "không biết" và **không ghi đè gì**, chứ đừng đoán một tên
 * model rồi làm hỏng phiên đang chạy tốt.
 */
export function parseModelList(raw: unknown): CodexModel[] {
  const pickArray = (v: unknown): unknown[] => {
    if (Array.isArray(v)) return v
    if (typeof v === 'object' && v !== null) {
      const r = v as Record<string, unknown>
      for (const k of ['models', 'data', 'items']) {
        if (Array.isArray(r[k])) return r[k] as unknown[]
      }
    }
    return []
  }

  const out: CodexModel[] = []
  for (const m of pickArray(raw)) {
    if (typeof m === 'string') {
      out.push({ id: m })
      continue
    }
    if (typeof m !== 'object' || m === null) continue
    const r = m as Record<string, unknown>
    const id = ['id', 'slug', 'name', 'model'].map((k) => r[k]).find((v): v is string => typeof v === 'string' && v !== '')
    if (!id) continue
    const dn = r['displayName']
    out.push({ id, displayName: typeof dn === 'string' && dn !== '' ? dn : undefined })
  }
  return out
}

/**
 * Nhận diện lỗi lượt để nói được **việc user phải làm**, thay vì đẩy nguyên câu JSON của server.
 *
 * Ba mẫu đã gặp thật, mỗi cái cần một hành động khác nhau — nên phải phân biệt:
 * - `outdated-cli`: *"requires a newer version of Codex"* → nâng cấp Codex
 * - `model-gone`: 404 *"does not exist or you do not have access"* → model đã bị server bỏ; hầu
 *   như luôn là hệ quả của CLI cũ (danh sách model của nó lạc hậu)
 * - `not-for-chatgpt`: *"not supported when using Codex with a ChatGPT account"* → model đó chỉ
 *   dùng được với API key, không dùng được bằng gói
 */
export type ModelIssue = 'outdated-cli' | 'model-gone' | 'not-for-chatgpt' | null

export function classifyModelError(message: string): ModelIssue {
  const t = message.toLowerCase()
  if (t.includes('requires a newer version')) return 'outdated-cli'
  if (t.includes('does not exist or you do not have access')) return 'model-gone'
  if (t.includes('not supported when using codex with a chatgpt account')) return 'not-for-chatgpt'
  return null
}

/** Model nào đang bị nói tới trong câu lỗi — để thông báo nêu đúng tên. */
export function modelFromError(message: string): string | undefined {
  // Server dùng nháy đơn (`The 'gpt-5.6-terra' model …`) hoặc backtick (``The model `gpt-5.5` …``).
  const m = message.match(/'([^']+)'\s+model|model\s+`([^`]+)`/i)
  return m ? (m[1] ?? m[2]) : undefined
}

// ── Mức suy luận ─────────────────────────────────────────────────────────────

/** Một model kèm các mức suy luận nó hỗ trợ (đọc từ `model/list`). */
export interface CodexModelFull {
  readonly id: string
  readonly displayName?: string
  readonly description?: string
  readonly reasoningEfforts: readonly string[]
  readonly defaultEffort?: string
}

/**
 * Đọc `model/list` ĐẦY ĐỦ — kèm `supportedReasoningEfforts`.
 *
 * `parseModelList` chỉ lấy id + tên (đủ cho việc chẩn đoán lỗi). Bản này thêm mức suy luận, thứ
 * Codex app hiện cạnh tên model ("5.6 Terra **High**") và đổi hẳn tốc độ lẫn chất lượng — nên
 * phải cho user chọn chứ không chôn trong config.
 */
export function parseModelListFull(raw: unknown): CodexModelFull[] {
  const arr = (() => {
    if (Array.isArray(raw)) return raw
    if (typeof raw === 'object' && raw !== null) {
      const r = raw as Record<string, unknown>
      for (const k of ['data', 'models', 'items']) if (Array.isArray(r[k])) return r[k] as unknown[]
    }
    return []
  })()

  const out: CodexModelFull[] = []
  for (const m of arr) {
    if (typeof m !== 'object' || m === null) continue
    const r = m as Record<string, unknown>
    const id = ['id', 'slug', 'model', 'name'].map((k) => r[k]).find((v): v is string => typeof v === 'string' && v !== '')
    if (!id) continue
    // Bỏ model ẩn: `codex-auto-review` chẳng hạn — nó là model nội bộ cho việc tự duyệt, đưa
    // vào dropdown chỉ làm user chọn nhầm.
    if (r['hidden'] === true) continue

    const efforts: string[] = []
    const raws = r['supportedReasoningEfforts']
    if (Array.isArray(raws)) {
      for (const e of raws) {
        if (typeof e === 'string') efforts.push(e)
        else if (typeof e === 'object' && e !== null) {
          const v = (e as Record<string, unknown>)['reasoningEffort']
          if (typeof v === 'string' && v !== '') efforts.push(v)
        }
      }
    }
    const str = (k: string): string | undefined =>
      typeof r[k] === 'string' && r[k] !== '' ? (r[k] as string) : undefined
    out.push({
      id,
      displayName: str('displayName'),
      description: str('description'),
      reasoningEfforts: efforts,
      defaultEffort: str('defaultReasoningEffort'),
    })
  }
  return out
}

// ── Phiên cũ ─────────────────────────────────────────────────────────────────

export interface CodexThreadSummary {
  readonly id: string
  readonly preview: string
  readonly cwd: string
  readonly model?: string
  /** Epoch **giây** — Codex trả giây, không phải mili. */
  readonly updatedAt: number
}

/**
 * Đọc `thread/list`.
 *
 * Bỏ phiên **không có preview** (chưa gửi câu nào): mở lại một phiên trống chẳng để làm gì, mà
 * nó lại chiếm chỗ trong danh sách và trông như một mục hỏng.
 */
export function parseThreadList(raw: unknown): CodexThreadSummary[] {
  const arr = (() => {
    if (Array.isArray(raw)) return raw
    if (typeof raw === 'object' && raw !== null) {
      const r = raw as Record<string, unknown>
      for (const k of ['data', 'threads', 'items']) if (Array.isArray(r[k])) return r[k] as unknown[]
    }
    return []
  })()

  const out: CodexThreadSummary[] = []
  for (const t of arr) {
    if (typeof t !== 'object' || t === null) continue
    const r = t as Record<string, unknown>
    const id = typeof r['id'] === 'string' ? (r['id'] as string) : undefined
    const preview = typeof r['preview'] === 'string' ? (r['preview'] as string).trim() : ''
    if (!id || preview === '') continue
    out.push({
      id,
      preview,
      cwd: typeof r['cwd'] === 'string' ? (r['cwd'] as string) : '',
      model: typeof r['model'] === 'string' && r['model'] !== '' ? (r['model'] as string) : undefined,
      updatedAt:
        typeof r['updatedAt'] === 'number'
          ? (r['updatedAt'] as number)
          : typeof r['recencyAt'] === 'number'
            ? (r['recencyAt'] as number)
            : 0,
    })
  }
  // Mới nhất trước — `thread/list` đã sắp sẵn nhưng đừng phụ thuộc vào đó.
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}
