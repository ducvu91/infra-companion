/**
 * F24 — Command history per host: phần QUYẾT ĐỊNH thuần.
 *
 * F23 (v0.2.24) đã cho app biết ranh giới từng lệnh qua OSC 133, nhưng bản ghi đó nằm trong RAM
 * theo `sessionId` và mất khi đóng pane. F24 biến nó thành lịch sử BỀN theo **host**, để trả lời
 * được câu hỏi thật của người vận hành: "cái lệnh dài dằng dặc tôi gõ trên con này tháng trước
 * là gì?" — kể cả khi `.bash_history` trên server đã bị xoá, hoặc khi lệnh được gõ từ một máy
 * khác của cùng người dùng.
 *
 * Ba nhóm hàm ở đây, và vì sao chúng là hàm thuần chứ không viết thẳng vào store/service:
 *
 *  · `shouldRecord` — lọc cái KHÔNG đáng lưu. Đây là phần dễ sai nhất và hậu quả nặng nhất:
 *    lưu bừa thì lịch sử đầy `ls`/`cd`, còn tệ hơn là **lưu cả mật khẩu** người ta gõ inline
 *    (`mysql -pXXX`, `curl -u user:pass`). Có test thì đọc là biết vì sao một lệnh bị bỏ.
 *  · `redactCommand` — che phần bí mật của những lệnh vẫn muốn giữ hình dáng.
 *  · `scoreCommand` / `searchCommandHistory` — xếp hạng cho ô tìm (Ctrl+Shift+R): khớp tiền tố
 *    ăn điểm hơn khớp giữa chuỗi, lệnh mới hơn và lệnh đúng host đứng trước.
 */

/** Một lệnh đã chạy, đã lưu bền. `hostId` null = phiên local shell (không gắn host nào). */
export interface CommandHistoryEntry {
  id: string
  hostId: string | null
  /** Tên host lúc chạy — giữ lại để lịch sử còn đọc được sau khi host bị xoá khỏi vault. */
  hostLabel: string
  command: string
  exitCode: number | null
  durationMs: number
  startedAt: number
  /**
   * Lệnh này đã bị che một phần khi lưu → KHÔNG chạy lại được nguyên văn.
   *
   * Là cờ lưu kèm chứ không phải suy ra bằng cách tìm {@link REDACTED} trong nội dung: đổi
   * chuỗi thay chỗ (hoặc dịch nó) sẽ làm cảnh báo lặng lẽ hết tác dụng với mọi bản ghi cũ.
   */
  redacted: boolean
}

/** Lệnh ngắn hơn mức này thì tìm lại còn lâu hơn gõ lại. */
export const MIN_COMMAND_LEN = 3

/** Trần độ dài một lệnh được lưu — dài hơn thì cắt (paste cả script vào terminal). */
export const MAX_COMMAND_LEN = 2000

/**
 * Lệnh quá tầm thường để chiếm chỗ trong lịch sử: gõ lại nhanh hơn tìm, và chúng chiếm hết
 * những dòng đầu của ô tìm nếu được lưu.
 */
const TRIVIAL = [
  /^\s*(ls|ll|la|l|cd|pwd|clear|exit|logout|reset|whoami|date|w|who|top|htop|history|h)\s*$/i,
  /^\s*cd\s+[-~.\w/]*\s*$/i,
  /^\s*(ls|ll)\s+-?[a-z]*\s*$/i
]

/**
 * Lệnh mang bí mật ở NGAY dòng lệnh. Không lưu nguyên văn — `ps` đã cho mọi user trên máy đó
 * đọc được, nhưng đó là chuyện của một khoảnh khắc; lịch sử của app thì giữ mãi và **sync/xuất
 * ra file được**, nên lưu nguyên văn là biến một sơ hở tạm thời thành một tệp mật khẩu lâu dài.
 *
 * Mỗi mẫu có một nhóm bắt = đúng phần cần che, để `redactCommand` giữ được hình dáng lệnh
 * (người ta vẫn nhận ra "à, lệnh dump DB hôm đó") mà không giữ giá trị.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  // `-pXXX` của họ mysql — CHỈ khi dòng lệnh thật sự gọi một client mysql (xem MYSQL_FAMILY).
  // Không thể để mẫu `-p\S+` chạy tự do: `cp -pr`, `find -print`, `mkdir -p x` đều khớp và sẽ
  // bị che oan, biến lịch sử thành vô dụng.
  //
  // Hai nhánh vì mật khẩu có ký tự đặc biệt được gõ TRONG NHÁY — `-p"mat khau"`, `-p'x y'` —
  // tức đúng những mật khẩu mạnh sẽ lọt nếu chỉ khớp `[^\s'"]+`. Nhánh nháy đứng TRƯỚC để ăn
  // trước nhánh trần.
  /(?<=^|\s)(-p)(["'])[^"']*\2/gi,
  /(?<=^|\s)(-p)(?=\S)(?!\s)([^\s'"]+)/gi,
  /(--password[=\s])(["'])[^"']*\2/gi,
  /(--password[=\s])([^\s'"]+)/gi,
  // curl -u user:pass  (cả dạng trong nháy: -u "user:pass")
  /(-u\s+["']?[^\s:'"]+:)([^\s'"]*)/gi,
  // VAR=secret ở đầu lệnh — chỉ những tên nói rõ là bí mật
  /((?:PASSWORD|PASSWD|PASS|TOKEN|SECRET|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY|AUTH)[A-Z_]*=)(["'])[^"']*\2/gi,
  /((?:PASSWORD|PASSWD|PASS|TOKEN|SECRET|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY|AUTH)[A-Z_]*=)([^\s'"]+)/gi,
  // --token XXX / --api-key XXX / --secret XXX (cả trong nháy)
  /(--(?:token|api-?key|secret|auth)[=\s])(["'])[^"']*\2/gi,
  /(--(?:token|api-?key|secret|auth)[=\s])([^\s'"]+)/gi,
  // Header xác thực gõ thẳng trong `curl -H` — dạng phổ biến nhất hiện nay và không có `-p`
  // nào để bắt: `-H "Authorization: Bearer sk-…"`, `Basic dXNlcjpwYXNz`, `X-Api-Key: …`.
  // Giữ lại tên scheme để vẫn đọc được đó là lệnh gọi API có xác thực.
  /((?:Authorization|X-Api-Key|X-Auth-Token)\s*:\s*(?:Bearer|Basic|Token)?\s*)([^"'\s][^"']*)/gi
]

/**
 * `-pXXX` chỉ là mật khẩu khi lệnh là một client họ mysql. Ở mọi lệnh khác `-p` là cờ hoàn toàn
 * bình thường (`cp -pr`, `mkdir -p`, `find -print`, `docker run -p 80:80`) — che nó ở đó thì
 * lịch sử mất đúng phần người ta cần đọc.
 */
const MYSQL_FAMILY = /(?:^|\s|\/|;|&&|\|)(mysql|mysqldump|mysqladmin|mariadb|mariadb-dump|mysqlcheck|mysqlimport)\b/i

/**
 * Chuỗi thay chỗ phần bí mật.
 *
 * KHÔNG chứa khoảng trắng và KHÔNG chứa `<`/`>`: các mẫu chạy lần lượt trên cùng một chuỗi, nên
 * một chuỗi thay chỗ chứa ký tự mà mẫu sau còn khớp được sẽ bị che tiếp lần hai (`-p<đã che>`
 * hoá thành `-p<đã che> che>`). Dùng gạch dưới hai đầu để không mẫu nào ăn lại nó.
 */
export const REDACTED = '__đã_che__'

/**
 * Số mẫu ĐẦU danh sách dành riêng cho `-p` của họ mysql — chỉ áp khi dòng lệnh thật sự gọi một
 * client mysql. Đặt thành hằng thay vì so `index === 0`: thêm một biến thể `-p` nữa mà quên sửa
 * con số thì mẫu mới lặng lẽ áp cho MỌI lệnh và `cp -pr` bắt đầu bị che oan.
 */
const MYSQL_ONLY_PATTERN_COUNT = 2

/**
 * Che các đoạn bí mật, giữ nguyên phần còn lại. Trả về cả cờ `redacted` để nơi gọi biết là
 * lệnh này KHÔNG chạy lại được nguyên văn (ô tìm sẽ nói rõ thay vì để user dán vào rồi lỗi).
 */
export function redactCommand(command: string): { text: string; redacted: boolean } {
  let text = command
  let redacted = false
  const isMysql = MYSQL_FAMILY.test(command)
  for (const [index, pattern] of SECRET_PATTERNS.entries()) {
    if (index < MYSQL_ONLY_PATTERN_COUNT && !isMysql) continue
    text = text.replace(new RegExp(pattern.source, pattern.flags), (match, keep: string) => {
      // Đã che rồi thì để yên. Các mẫu chạy lần lượt và đi theo cặp (bản trong-nháy trước, bản
      // trần sau), nên không có chốt này thì bản trần sẽ khớp tiếp vào chính chuỗi thay chỗ mà
      // bản nháy vừa đặt và cho ra `-p__đã_che__đã_che__`.
      if (match.includes(REDACTED)) return match
      redacted = true
      return `${keep}${REDACTED}`
    })
  }
  return { text, redacted }
}

export interface RecordDecision {
  record: boolean
  /** Vì sao KHÔNG lưu — để test và log đọc được ý định thay vì đoán từ boolean. */
  reason?: 'empty' | 'too-short' | 'trivial'
}

/**
 * Có nên lưu lệnh này vào lịch sử bền?
 *
 * Cố ý KHÔNG loại lệnh có bí mật ở đây: lệnh `mysqldump -pXXX` là đúng thứ người ta cần tìm
 * lại nhất, chỉ có giá trị mật khẩu là không được giữ. Việc che do `redactCommand` làm.
 */
export function shouldRecord(command: string): RecordDecision {
  const trimmed = command.trim()
  if (trimmed === '') return { record: false, reason: 'empty' }
  if (trimmed.length < MIN_COMMAND_LEN) return { record: false, reason: 'too-short' }
  if (TRIVIAL.some((re) => re.test(trimmed))) return { record: false, reason: 'trivial' }
  return { record: true }
}

/** Chuẩn hoá trước khi lưu: cắt trần, gộp khoảng trắng cuối dòng, che bí mật. */
export function prepareForStore(command: string): { command: string; redacted: boolean } {
  const { text, redacted } = redactCommand(command.trim().slice(0, MAX_COMMAND_LEN))
  return { command: text, redacted }
}

/**
 * Bỏ phần PROMPT ra khỏi dòng đọc từ buffer terminal.
 *
 * Đọc dòng ở con trỏ cho ra CẢ prompt: `[root@app-01 ~]# systemctl restart nginx`. Guard lệnh
 * nguy hiểm sống được với chuỗi đó vì nó chỉ khớp mẫu, nhưng lịch sử để **chạy lại** thì không:
 * lưu nguyên prompt vào rồi chèn ngược ra terminal là gửi rác.
 *
 * `promptCol` = số cột prompt chiếm, biết được từ mốc OSC 133;B (shell báo "hết prompt, chỗ user
 * gõ bắt đầu từ đây"). Có nó thì cắt chính xác; không có (shell chưa dán snippet, hoặc lệnh do
 * script gửi) thì lùi về đoán theo ký tự prompt cuối cùng — `#`, `$`, `%`, `>` kèm khoảng trắng.
 * Đoán có thể sai với prompt lạ, nên khi không chắc thì **trả nguyên chuỗi** thay vì cắt bừa:
 * một dòng có thừa prompt còn đọc được, một dòng bị cắt mất `sudo` thì nguy hiểm.
 */
export function stripPrompt(line: string, promptCol?: number): string {
  // `promptCol` là cột con trỏ lúc thấy mốc B — nhưng nó có thể là của một prompt KHÁC: `PS1`
  // chứa `\w` thì `cd /` làm prompt ngắn lại, pane reconnect sang host khác, hay user tắt rồi
  // bật lại shell integration đều để lại một cột cũ dài hơn prompt thật. Tin nó vô điều kiện
  // thì `[app-01 ~]$ echo rm -rf /` với cột cũ 20 ra `-rf /` — một lệnh KHÁC HẲN, và F24 sẽ
  // chèn đúng chuỗi đó vào terminal production.
  //
  // Nên chỉ nhận `promptCol` khi phần bị cắt bỏ THẬT SỰ trông như một prompt: kết thúc bằng
  // một ký tự prompt (`#$%>`) rồi khoảng trắng. Sai thì bỏ qua và đoán như khi không có cột —
  // một dòng còn thừa prompt vẫn đọc được, một dòng mất `sudo`/`echo` thì nguy hiểm.
  if (promptCol !== undefined && promptCol > 0 && promptCol <= line.length) {
    const head = line.slice(0, promptCol)
    if (/[#$%>]\s*$/.test(head)) return line.slice(promptCol).trim()
  }
  // Ký tự prompt cuối cùng có khoảng trắng theo sau — quét từ phải để prompt chứa `$` (như
  // `[user@host $dir]$ `) không cắt sai chỗ.
  const match = /^.*[#$%>]\s+/.exec(line)
  if (match && match[0].length < line.length) return line.slice(match[0].length).trim()
  return line.trim()
}

/**
 * Điểm khớp của một lệnh với truy vấn. `null` = không khớp (nơi gọi lọc bỏ).
 *
 * Thang điểm cố ý thô — mục tiêu là thứ tự đọc được, không phải một mô hình xếp hạng:
 *  · khớp từ đầu chuỗi (300) hơn khớp đầu một từ (200) hơn khớp giữa chuỗi (100);
 *  · cùng host +80 — đang đứng trên máy nào thì lệnh của máy đó gần như luôn là cái muốn tìm;
 *  · mới hơn thì cộng thêm tối đa 60 theo thang giảm dần trong 30 ngày.
 */
export function scoreCommand(
  entry: CommandHistoryEntry,
  query: string,
  context: { hostId?: string | null; now?: number } = {}
): number | null {
  const needle = query.trim().toLowerCase()
  const haystack = entry.command.toLowerCase()
  let score: number
  if (needle === '') {
    score = 0
  } else {
    const at = haystack.indexOf(needle)
    if (at === -1) return null
    if (at === 0) score = 300
    else if (/\s/.test(haystack[at - 1] ?? '')) score = 200
    else score = 100
  }
  if (context.hostId !== undefined && context.hostId !== null && entry.hostId === context.hostId) score += 80
  const now = context.now ?? Date.now()
  const ageDays = Math.max(0, (now - entry.startedAt) / 86_400_000)
  score += Math.round(Math.max(0, 60 - ageDays * 2))
  return score
}

/**
 * Lọc + xếp hạng cho ô tìm. Gộp trùng theo NỘI DUNG lệnh (giữ lần chạy mới nhất): một lệnh gõ
 * hai mươi lần trên năm máy sẽ ngốn hết danh sách nếu không gộp, mà thứ user tìm là *lệnh*, không
 * phải từng lần chạy. `hostCount` cho UI nói được "đã dùng trên 3 máy".
 */
export interface CommandSearchResult extends CommandHistoryEntry {
  score: number
  /** Số host khác nhau từng chạy lệnh này (trong phạm vi dữ liệu truyền vào). */
  hostCount: number
  /** Số lần chạy đã gộp vào dòng này. */
  runCount: number
}

export function searchCommandHistory(
  entries: readonly CommandHistoryEntry[],
  query: string,
  context: {
    hostId?: string | null
    now?: number
    limit?: number
    /**
     * Chỉ giữ lệnh của host này trong KẾT QUẢ, nhưng vẫn đếm `hostCount` trên toàn bộ dữ liệu.
     *
     * Lọc mảng trước khi gọi hàm này thì `hostCount` luôn ra 1 và huy hiệu "+2 máy nữa" biến
     * mất — đúng thông tin hữu ích nhất khi đang đứng trên một máy và muốn biết lệnh này còn
     * dùng ở đâu.
     */
    onlyHostId?: string | null
  } = {}
): CommandSearchResult[] {
  const byCommand = new Map<string, CommandSearchResult>()
  const hostsSeen = new Map<string, Set<string>>()
  for (const entry of entries) {
    const score = scoreCommand(entry, query, context)
    if (score === null) continue
    const key = entry.command
    const hosts = hostsSeen.get(key) ?? new Set<string>()
    hosts.add(entry.hostId ?? '__local__')
    hostsSeen.set(key, hosts)
    const existing = byCommand.get(key)
    if (existing === undefined) {
      byCommand.set(key, { ...entry, score, hostCount: 1, runCount: 1 })
      continue
    }
    existing.runCount += 1
    // Giữ lần chạy MỚI NHẤT làm đại diện (exit code / thời lượng của lần gần nhất là cái đáng tin),
    // nhưng điểm thì lấy cao nhất — một lệnh từng chạy trên host đang mở vẫn nên nổi lên.
    if (entry.startedAt > existing.startedAt) {
      existing.hostId = entry.hostId
      existing.hostLabel = entry.hostLabel
      existing.exitCode = entry.exitCode
      existing.durationMs = entry.durationMs
      existing.startedAt = entry.startedAt
      existing.id = entry.id
    }
    if (score > existing.score) existing.score = score
  }
  let results = [...byCommand.values()]
  // `hostCount` tính trên TOÀN BỘ dữ liệu (kể cả khi đang lọc theo một host) — xem `onlyHostId`.
  for (const result of results) result.hostCount = hostsSeen.get(result.command)?.size ?? 1
  const only = context.onlyHostId
  if (only !== undefined && only !== null) {
    // Lọc SAU khi đếm: một lệnh từng chạy ở đây thì giữ lại, và số máy vẫn đúng.
    const onHost = new Set(entries.filter((e) => e.hostId === only).map((e) => e.command))
    results = results.filter((r) => onHost.has(r.command))
  }
  results.sort((a, b) => b.score - a.score || b.startedAt - a.startedAt)
  return context.limit === undefined ? results : results.slice(0, context.limit)
}
