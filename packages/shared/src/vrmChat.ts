/**
 * F70 — chat với trợ lý AI ngay trên đầu nhân vật.
 *
 * Dùng lại đúng `window.infra.ai.ask()` của Trợ lý AI (F09), **không** dựng đường gọi AI thứ
 * hai: cấu hình provider/model/API key chỉ có một chỗ, và hai đường song song là hai nơi phải
 * sửa mỗi khi đổi nhà cung cấp.
 *
 * Khác `AiModal` ở **hình thái**, không ở lõi: `AiModal` cố ý là cột dock chiếm chỗ thật vì việc
 * ở đó là *vừa hỏi vừa đọc output terminal*. Bong bóng này là hỏi nhanh một câu — nó nổi, nhỏ,
 * và biến mất; đổi lại không đọc được câu trả lời dài, nên có đường mở sang panel đầy đủ.
 */

/** Một lượt trong hội thoại ngắn trên đầu nhân vật. */
export interface VrmChatTurn {
  role: 'user' | 'assistant'
  text: string
  /** Lệnh trích ra được từ câu trả lời — để chèn thẳng vào terminal. */
  command?: string
}

/**
 * Số lượt giữ lại trong bong bóng.
 *
 * Nhỏ là chủ ý: bong bóng nổi trên đầu nhân vật, cao quá thì che mất chính nhân vật — mà thấy
 * nhân vật là lý do tồn tại của cả tính năng. Cần đọc lại nhiều thì mở Trợ lý AI đầy đủ.
 */
export const VRM_CHAT_MAX_TURNS = 8

/** Thêm một lượt, cắt bớt phần cũ nhất khi vượt giới hạn. */
export function appendTurn(history: readonly VrmChatTurn[], turn: VrmChatTurn): VrmChatTurn[] {
  return [...history, turn].slice(-VRM_CHAT_MAX_TURNS)
}

/**
 * Ghép ngữ cảnh gửi kèm câu hỏi.
 *
 * `ai.ask` nhận một chuỗi `context` rời, nên phải tự dựng. Chỉ lấy vài lượt gần nhất: hội thoại
 * dài làm prompt phình ra và câu trả lời lệch về chuyện cũ, trong khi ở đây gần như luôn là
 * "hỏi tiếp về câu vừa rồi".
 */
export function buildContext(history: readonly VrmChatTurn[], maxTurns = 4): string | undefined {
  const recent = history.slice(-maxTurns)
  if (recent.length === 0) return undefined
  return recent.map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`).join('\n')
}

/**
 * Nhận ra câu "mở giúp tôi <tính năng>" trước khi hỏi AI.
 *
 * Làm bằng **so khớp từ khoá, không gọi AI**: mở một panel là việc chắc chắn đúng hoặc chắc
 * chắn sai, gửi qua AI chỉ thêm độ trễ và một chỗ để nó đoán sai. Ngoài ra còn chạy được khi
 * user chưa cấu hình AI.
 *
 * Chỉ khớp khi câu có **động từ mở** — thiếu bước này thì "tunnel bị lỗi thì sửa sao" cũng bị
 * hiểu là lệnh mở tunnel, và câu hỏi thật không bao giờ tới được AI.
 */
/**
 * ⚠️ **Không dùng `\b`** trong các mẫu dưới đây.
 *
 * `\b` của JS chỉ biết `[A-Za-z0-9_]`, nên `\bmở\b` **không bao giờ khớp** chữ tiếng Việt có
 * dấu: "ở" nằm ngoài bảng ASCII nên vị trí giữa "m" và "ở" đã bị coi là một ranh giới. Không có
 * lỗi nào báo — chỉ là mọi câu tiếng Việt có dấu lặng lẽ không được nhận ra.
 *
 * Thay bằng ranh giới tự viết: hai đầu phải là đầu/cuối chuỗi hoặc một ký tự **không phải chữ**
 * (khoảng trắng, dấu câu). `\p{L}` cần cờ `u`.
 */
const EDGE_L = '(?<![\\p{L}\\p{N}])'
const EDGE_R = '(?![\\p{L}\\p{N}])'
const word = (alts: string): RegExp => new RegExp(`${EDGE_L}(?:${alts})${EDGE_R}`, 'iu')

const OPEN_VERBS = word('mở|mo|open|bật|bat|hiện|hien|show|xem|vào|vao')

/** Từ khoá → id công cụ trong `TOOLS`. Nhiều cách gọi cho một tính năng, kể cả không dấu. */
const TOOL_KEYWORDS: ReadonlyArray<readonly [RegExp, string]> = [
  // Cụm dài đứng TRƯỚC cụm ngắn chứa nó: "lịch sử lệnh" phải thắng "lịch"
  [word('lịch sử lệnh|lich su lenh|command history'), 'cmd-history'],
  [word('tunnel|tunnels|đường hầm|duong ham'), 'tunnels'],
  [word('monitor|monitoring|theo dõi|theo doi|giám sát|giam sat'), 'monitor'],
  [word('sftp|file|files|tệp|tep'), 'sftp'],
  [word('snippet|snippets|đoạn lệnh|doan lenh'), 'snippets'],
  [word('workspace|workspaces|không gian|khong gian'), 'workspaces'],
  [word('setting|settings|cài đặt|cai dat|cấu hình|cau hinh'), 'settings'],
  [word('log|logs|nhật ký|nhat ky|tail'), 'log-tail'],
  [word('key|keys|khoá|khoa'), 'keys'],
  [word('chẩn đoán|chan doan|diagnose|chuẩn đoán|chuan doan'), 'ai-diagnose'],
  [word('so sánh|so sanh|compare|diff'), 'compare'],
  [word('thông báo|thong bao|notification|notifications'), 'notifications'],
  [word('kiểm kê|kiem ke|inventory'), 'inventory'],
  [word('sổ tay|so tay|runbook|runbooks'), 'runbooks'],
  [word('tiến trình|tien trinh|process|processes'), 'processes'],
  [word('dịch vụ|dich vu|service|services'), 'services'],
  [word('ổ đĩa|o dia|dung lượng|dung luong|disk'), 'disk-usage'],
  [word('an ninh|bảo mật|bao mat|security'), 'security'],
  [word('lịch|lich|cron|hẹn giờ|hen gio|job|jobs'), 'jobs']
]

/**
 * Id công cụ mà câu này muốn mở, `null` nếu không phải lệnh mở gì cả.
 *
 * Nơi gọi tự tra id đó trong `TOOLS` — ở đây không biết gì về catalog để `shared` không phụ
 * thuộc ngược vào renderer.
 */
export function matchOpenIntent(text: string): string | null {
  if (!OPEN_VERBS.test(text)) return null
  for (const [re, id] of TOOL_KEYWORDS) if (re.test(text)) return id
  return null
}

/**
 * Câu nhân vật nói khi vừa mở một tính năng hộ user.
 *
 * Nhiều mẫu và bốc ngẫu nhiên: một câu cố định nghe như thông báo hệ thống ngay lần thứ ba, mà
 * điểm của cả tính năng là *có ai đó vừa làm giúp mình*, không phải một cái toast.
 *
 * `{name}` = tên tính năng. Giữ ở `shared` để test được và để đổi lời không phải mở component.
 */
export const OPENED_LINES: readonly string[] = [
  'Onii~ vừa mở {name} rồi nè ~:)',
  'Đã mở {name} cho Onii~ đó!',
  '{name} đây, Onii~ xem thử nhé ~',
  'Onii~ đợi chút… {name} mở xong rồi!',
  'Mở {name} giúp Onii~ nè ~:)'
]

/** Một câu ngẫu nhiên báo vừa mở tính năng `name`. `rng` truyền vào để test cố định được. */
export function openedLine(name: string, rng: () => number = Math.random): string {
  const i = Math.min(OPENED_LINES.length - 1, Math.floor(rng() * OPENED_LINES.length))
  return OPENED_LINES[i]!.replace('{name}', name)
}

/**
 * Cắt bớt câu trả lời quá dài cho vừa bong bóng.
 *
 * Trả về phần cắt + cờ báo còn nữa, để UI mời user mở panel đầy đủ thay vì **im lặng** giấu mất
 * một nửa câu trả lời — im lặng cắt là kiểu hỏng user không bao giờ đoán ra.
 */
export function clampAnswer(text: string, maxChars = 600): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false }
  // Cắt ở ranh giới dòng gần nhất cho đỡ đứt giữa câu
  const cut = text.slice(0, maxChars)
  const at = cut.lastIndexOf('\n')
  return { text: at > maxChars * 0.5 ? cut.slice(0, at) : cut, truncated: true }
}

/** Một gợi ý thao tác nhân vật nói ra — `id` cũng là tên thao tác để đánh dấu "đã làm". */
export interface VrmHint {
  id: 'hold' | 'menu' | 'rotate' | 'zoom' | 'move' | 'tug' | 'poke' | 'outfit'
  text: string
}

/**
 * Gợi ý cách tương tác, nhân vật tự nói lúc rảnh.
 *
 * Mọi thao tác ở đây đều **vô hình** (nhấn giữ, Shift+kéo, Ctrl+lăn, click phải) — không có nút
 * nào để phát hiện, nên không nói thì user không bao giờ biết. Nói qua bong bóng thoại của chính
 * nhân vật, giọng của nó, thay vì một tooltip: đây là thứ nó *muốn* kể, không phải hướng dẫn.
 */
export const VRM_HINTS: readonly VrmHint[] = [
  { id: 'hold', text: 'Onii~ nhấn giữ vào em một chút là mở khung chat đó nha~ 💬' },
  { id: 'menu', text: 'Click phải vào em để mở menu nè~ có đủ thứ để nghịch đó ⚙' },
  { id: 'rotate', text: 'Giữ Shift rồi kéo em là em xoay người cho Onii~ xem~ 🔄' },
  { id: 'zoom', text: 'Ctrl + lăn chuột là em to nhỏ theo ý Onii~ đó 🔍' },
  { id: 'move', text: 'Ctrl + kéo là dời em đi chỗ khác được đó~ ✨' },
  { id: 'tug', text: 'Kéo nhẹ em xem, buông ra em bật về liền à~ 🤏' },
  { id: 'poke', text: 'Chạm nhẹ vào em xem em phản ứng sao nè~ 👉' },
  { id: 'outfit', text: 'Click phải rồi chọn 👗 là đổi đồ cho em được đó nha~' }
]

/** Gợi ý đầu sau khi nạp model (ms) — đủ để user nhìn nhân vật trước, chưa bị nói ngay. */
export const HINT_FIRST_MS = 25_000
/** Giữa hai gợi ý: 3–6 phút. "Lâu lâu" đúng nghĩa — dày hơn là thành nhắc việc. */
export const HINT_EVERY_MIN_MS = 180_000
export const HINT_EVERY_MAX_MS = 360_000
/** Đang bận (chat/menu mở, đang có bong bóng khác) thì thử lại sau chừng này. */
export const HINT_RETRY_MS = 30_000

export function hintDelayMs(rng: () => number): number {
  return HINT_EVERY_MIN_MS + rng() * (HINT_EVERY_MAX_MS - HINT_EVERY_MIN_MS)
}

/**
 * Chọn gợi ý kế: **chỉ những thao tác chưa làm**, tránh lặp cái vừa nói; làm hết thì `null` —
 * nhân vật im hẳn, không lải nhải thứ user đã biết.
 */
export function pickHint(done: readonly string[], lastId: string | null, rng: () => number): VrmHint | null {
  const undone = VRM_HINTS.filter((h) => !done.includes(h.id))
  if (undone.length === 0) return null
  const pool = undone.filter((h) => h.id !== lastId)
  const list = pool.length > 0 ? pool : undone
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))]!
}
