/**
 * F23 — Shell integration (OSC 133) + F26 — báo khi lệnh dài chạy xong.
 *
 * Ý tưởng: shell trên máy remote in ra vài chuỗi điều khiển vô hình đánh dấu **ranh giới từng
 * lệnh**, app đọc chúng và biết được thứ trước giờ chỉ đoán được: lệnh nào vừa chạy, mất bao lâu,
 * exit code bao nhiêu, và prompt nào ở đâu trong scrollback.
 *
 * Chuẩn OSC 133 (VS Code, WezTerm, kitty… đều dùng):
 *  · `OSC 133;A ST` — bắt đầu prompt
 *  · `OSC 133;B ST` — hết prompt, bắt đầu chỗ user gõ
 *  · `OSC 133;C ST` — bắt đầu chạy lệnh (user vừa Enter)
 *  · `OSC 133;D;<code> ST` — lệnh xong, kèm exit code (có thể thiếu code)
 *
 * Ba lý do phần này là hàm thuần ở đây thay vì viết thẳng trong component:
 *  · quyết định "có nên báo không" (tab đang ẩn? lệnh đủ dài? lệnh có đáng báo?) là logic thật,
 *    cần test — báo sai chỗ thì người ta tắt thông báo và mất luôn cả tính năng;
 *  · script hook phải giống nhau ở mọi nơi dùng (terminal SSH, local shell);
 *  · main và renderer đều cần biết cùng một bộ khái niệm.
 */

/** Mã điều khiển: ESC ] 133 ; … ST — dùng khi tự sinh chuỗi (test, hook). */
export const OSC133_PREFIX = ']133;'
export const OSC133_ST = ''

export type ShellMarkKind = 'prompt-start' | 'prompt-end' | 'command-start' | 'command-done'

export interface ShellMark {
  kind: ShellMarkKind
  /** Chỉ có với `command-done`; null khi shell không gửi code. */
  exitCode: number | null
}

/** Đọc payload của một OSC 133 (phần sau `133;`) thành mốc. Trả null nếu không hiểu. */
export function parseOsc133(payload: string): ShellMark | null {
  const parts = payload.split(';')
  const letter = (parts[0] ?? '').trim().toUpperCase()
  if (letter === 'A') return { kind: 'prompt-start', exitCode: null }
  if (letter === 'B') return { kind: 'prompt-end', exitCode: null }
  if (letter === 'C') return { kind: 'command-start', exitCode: null }
  if (letter === 'D') {
    const raw = parts[1]
    const code = raw !== undefined && /^-?\d+$/.test(raw.trim()) ? Number(raw.trim()) : null
    return { kind: 'command-done', exitCode: code }
  }
  return null
}

/** Một lệnh đã chạy xong, dựng từ cặp mốc C…D. */
export interface CommandRecord {
  /** Dòng lệnh user gõ (app tự ghi lại từ input, shell không gửi). */
  command: string
  startedAt: number
  durationMs: number
  exitCode: number | null
}

export function commandSucceeded(record: Pick<CommandRecord, 'exitCode'>): boolean {
  return record.exitCode === null || record.exitCode === 0
}

/** Lệnh chạy lâu hơn ngưỡng này (ms) thì mới đáng báo — mặc định 20 giây. */
export const NOTIFY_MIN_DURATION_MS = 20_000

/**
 * Lệnh mà "chạy xong" không có nghĩa gì: phiên tương tác, editor, theo dõi log. Chúng luôn chạy
 * lâu và luôn kết thúc khi user tự thoát — báo là báo sai mỗi lần.
 */
const BORING = [
  /^\s*(vi|vim|nvim|nano|emacs|less|more|man|top|htop|btop|watch|tail\s+-f|tail\s+-F|journalctl\s+.*-f|tmux|screen|mysql|psql|redis-cli|mongosh|python3?|node|irb|php\s+-a|ssh|sftp|telnet)\b/i,
  /^\s*(exit|logout|clear|reset)\s*$/i
]

export interface NotifyDecision {
  notify: boolean
  /** Vì sao KHÔNG báo — để log/test đọc được ý định, không phải đoán từ boolean. */
  reason?: 'too-short' | 'interactive' | 'pane-visible' | 'disabled' | 'empty'
}

export interface NotifyInput {
  command: string
  durationMs: number
  /** Pane đang hiện trên màn hình (tab active và cửa sổ đang focus) → không cần báo. */
  paneVisible: boolean
  enabled: boolean
  minDurationMs?: number
}

/**
 * Có nên bật thông báo "lệnh xong" không.
 *
 * Thứ tự kiểm cố ý: tắt tính năng → lệnh rỗng → **pane đang hiện** → lệnh tương tác → quá ngắn.
 * "Pane đang hiện" đứng trước "tương tác" vì nó rẻ và đúng trong mọi ca: user đang nhìn thì
 * thông báo chỉ là tiếng ồn, bất kể lệnh gì.
 */
export function shouldNotify(input: NotifyInput): NotifyDecision {
  if (!input.enabled) return { notify: false, reason: 'disabled' }
  const cmd = input.command.trim()
  if (cmd === '') return { notify: false, reason: 'empty' }
  if (input.paneVisible) return { notify: false, reason: 'pane-visible' }
  if (BORING.some((re) => re.test(cmd))) return { notify: false, reason: 'interactive' }
  if (input.durationMs < (input.minDurationMs ?? NOTIFY_MIN_DURATION_MS)) return { notify: false, reason: 'too-short' }
  return { notify: true }
}

/** Thời gian chạy → chuỗi ngắn cạnh prompt: `1.2s`, `45s`, `3m20s`, `1h04m`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const total = Math.round(ms / 1000)
  if (total < 60) return total < 10 ? `${(ms / 1000).toFixed(1)}s` : `${total}s`
  const m = Math.floor(total / 60)
  const s = total % 60
  if (m < 60) return s === 0 ? `${m}m` : `${m}m${String(s).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h${String(m % 60).padStart(2, '0')}m`
}

/** Cắt lệnh cho tiêu đề thông báo (thông báo OS không hiện nổi một dòng dài). */
export function shortenCommand(command: string, max = 60): string {
  const one = command.trim().replace(/\s+/g, ' ')
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

/**
 * Script bật OSC 133 cho **bash / zsh**, chạy được khi dán vào một phiên đang mở hoặc thêm vào
 * `~/.bashrc`. Viết một dòng-một-lệnh, KHÔNG dùng `$(...)` ở tầng ngoài để đi qua được các hop
 * login-script (CLAUDE.md §4).
 *
 * Bash: dùng `PROMPT_COMMAND` + `trap DEBUG`; zsh: dùng `precmd`/`preexec`. Có guard `__ic_osc133`
 * để dán hai lần không nhân đôi hook.
 */
export const OSC133_BASH_SNIPPET = [
  '# Infra Companion — shell integration (OSC 133)',
  'if [ -z "$__ic_osc133" ]; then',
  '  __ic_osc133=1',
  "  __ic_pre() { printf '\\033]133;C\\007'; }",
  '  __ic_post() { printf \'\\033]133;D;%s\\007\' "$?"; }',
  '  if [ -n "$ZSH_VERSION" ]; then',
  '    precmd_functions+=(__ic_post)',
  '    preexec_functions+=(__ic_pre)',
  "    PS1='%{'$'\\033]133;A\\007''%}'$PS1'%{'$'\\033]133;B\\007''%}'",
  '  elif [ -n "$BASH_VERSION" ]; then',
  // Nối vào PROMPT_COMMAND cũ nếu có (`${VAR:+…}`) — viết bằng nối chuỗi JS chứ không template
  // literal, vì `${…}` trong template literal là nội suy của TypeScript, không phải của shell.
  "    PROMPT_COMMAND='__ic_post'" + '${PROMPT_COMMAND:+;$PROMPT_COMMAND}',
  "    trap '__ic_pre' DEBUG",
  "    PS1='\\[\\033]133;A\\007\\]'$PS1'\\[\\033]133;B\\007\\]'",
  '  fi',
  'fi'
].join('\n')

/** Dòng đánh dấu trong `~/.bashrc` — để biết đã cài rồi hay chưa (bấm cài lại không nhân đôi). */
export const OSC133_MARKER = '# >>> Infra Companion shell integration >>>'

/**
 * Lệnh **cài bền** đoạn OSC 133 vào `~/.bashrc` của máy remote, gửi thẳng vào terminal đang mở.
 *
 * Vì sao cần hàm này bên cạnh {@link OSC133_BASH_SNIPPET}: dán snippet vào một phiên chỉ có hiệu
 * lực cho **phiên đó**, đóng tab là mất — mà lịch sử lệnh (F24) chỉ có giá trị khi nó ghi liên tục
 * qua nhiều tuần. Nên UI cho cả hai đường: gửi-để-thử-ngay, và cài-một-lần-cho-mãi.
 *
 * Ba quyết định trong cách dựng lệnh, mỗi cái có lý do:
 *  · **Heredoc `<<'IC_EOF'`** (có quote) để shell KHÔNG nội suy `$?`/`$PS1` trên đường truyền.
 *    Đây là ngoại lệ CÓ Ý THỨC với "không dùng heredoc" ở CLAUDE.md §4: quy tắc đó nhắm những
 *    lệnh chạy **qua nhiều hop login-script** (mỗi hop bọc thêm một lớp quote rồi bóc mất), còn
 *    lệnh này gửi thẳng vào một phiên ĐÃ MỞ nên không đi qua lớp bọc nào.
 *  · **Kiểm marker trước khi ghi** (`grep -q`) — bấm nút hai lần không được nhân đôi hook trong
 *    `.bashrc`; bản thân snippet có guard `__ic_osc133` nhưng file thì vẫn phình ra.
 *  · **`.bashrc` chứ không `.bash_profile`**: phiên SSH không-đăng-nhập chỉ đọc `.bashrc`.
 *
 * Thông báo echo cố ý viết KHÔNG DẤU: nó in ra terminal remote, mà locale ở đó thường là C/POSIX
 * nên tiếng Việt có dấu sẽ ra ký tự hỏng.
 */
export function osc133InstallCommand(): string {
  return [
    `if grep -q '${OSC133_MARKER}' ~/.bashrc 2>/dev/null; then`,
    "  echo 'Infra Companion: shell integration da co san trong ~/.bashrc'",
    'else',
    "  cat >> ~/.bashrc <<'IC_EOF'",
    '',
    OSC133_MARKER,
    OSC133_BASH_SNIPPET,
    '# <<< Infra Companion shell integration <<<',
    'IC_EOF',
    "  echo 'Infra Companion: da them vao ~/.bashrc - mo phien moi hoac chay: source ~/.bashrc'",
    'fi'
  ].join('\n')
}
