/**
 * Dựng env cho tiến trình con `codex app-server` — **allowlist tường minh, không `...process.env`**.
 *
 * Hai thái cực đã có trong repo, và cái nào cũng không vừa:
 * - `ProcessSupervisor` dùng env **trắng** (`spec.env`) để *"không rò token AI/AWS sang con"* —
 *   Codex thì cần `PATH`/`HOME` mới chạy nổi.
 * - `LocalSession.cleanEnv` **kế thừa cả `process.env`** — đúng cho shell của user (họ mong có
 *   env của mình), nhưng ở đây là đưa mọi token trong môi trường app cho một tiến trình gọi mạng.
 *
 * Nên ở giữa: giữ đúng những gì Codex cần, và **chủ động bỏ** những gì không được rò. Hai biến
 * đáng nói vì lý do không hiển nhiên:
 *
 * - **`OPENAI_API_KEY`** — user đã chốt dùng **gói ChatGPT**. Để biến này lọt vào thì Codex im
 *   lặng chuyển sang tính tiền theo API key: tính năng vẫn "chạy", hoá đơn mới nói ra sự thật.
 *   Đúng loại lỗi mục 8 CLAUDE.md nói tới — xanh nhưng sai.
 * - **`ELECTRON_RUN_AS_NODE`** — biến này đang được set sẵn trên máy dev để chạy vitest bằng
 *   Electron (CLAUDE.md mục 7). Rò sang tiến trình con làm nó xử sự lạ theo cách rất khó truy;
 *   đã mất thời gian vì đúng biến này một lần khi chụp ảnh bằng Electron.
 */

/**
 * Biến Codex CẦN. Thiếu một cái ở đây là nó không chạy hoặc chạy sai, nên đừng cắt cho gọn.
 *
 * Windows có cả `PATH` và `Path` vì Node không chuẩn hoá hoàn toàn nhất quán qua các bản —
 * giữ cả hai thì không phải đoán bản nào đang dùng.
 */
const KEEP: readonly string[] = [
  // Tìm được binary con (node, git, shell mà agent gọi)
  'PATH',
  'Path',
  'PATHEXT',
  // Thư mục nhà — Codex đọc ~/.codex/auth.json từ đây
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  // Windows: nơi Codex desktop cài binary + config app
  'LOCALAPPDATA',
  'APPDATA',
  'ProgramData',
  // File tạm
  'TEMP',
  'TMP',
  'TMPDIR',
  // Windows cần để chạy được tiến trình con
  'SystemRoot',
  'SystemDrive',
  'ComSpec',
  'windir',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'USERNAME',
  'USERDOMAIN',
  // Ngôn ngữ/encoding — sai cái này là output tiếng Việt thành ký tự rác
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  // Mạng qua proxy công ty
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  // Cho user trỏ CODEX_HOME sang chỗ khác nếu họ đã cấu hình vậy
  'CODEX_HOME',
  // Terminal của agent
  'TERM',
  'COLORTERM',
]

/**
 * Bị bỏ dù có trong `KEEP` hay không — bí mật của app hoặc biến gây hành vi lạ.
 *
 * Tiền tố, khớp không phân biệt hoa thường: một biến `aws_secret_access_key` viết thường vẫn
 * là bí mật.
 */
const DROP_PREFIXES: readonly string[] = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'ANTHROPIC_',
  'AWS_',
  'GOOGLE_',
  'GCP_',
  'AZURE_',
  'DO_TOKEN',
  'DIGITALOCEAN_',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITLAB_TOKEN',
  'NPM_TOKEN',
  'INFRA_',
  'ELECTRON_RUN_AS_NODE',
]

function isDropped(key: string): boolean {
  const upper = key.toUpperCase()
  return DROP_PREFIXES.some((p) => upper.startsWith(p))
}

export interface CodexEnvOptions {
  /** Ghi thêm/ghi đè sau khi lọc — ví dụ `INFRA_MCP_TOKEN` cho MCP bridge ở GĐ4. */
  readonly extra?: Readonly<Record<string, string>>
}

/**
 * Lọc env của app thành env cho `codex app-server`.
 *
 * `extra` được áp **sau** bộ lọc và cố ý **không** bị `DROP_PREFIXES` chặn: token của MCP bridge
 * mang tiền tố `INFRA_` (đang nằm trong danh sách bỏ để không rò biến nội bộ của app), nhưng
 * cái token đó là thứ ta chủ động muốn đưa vào.
 */
export function codexEnv(src: NodeJS.ProcessEnv, opts: CodexEnvOptions = {}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of KEEP) {
    if (isDropped(key)) continue
    const v = src[key]
    if (typeof v === 'string' && v !== '') out[key] = v
  }
  // Đánh dấu để lệnh agent chạy biết mình đang ở trong app (khuôn `LocalSession.cleanEnv`).
  out['TERM_PROGRAM'] = 'InfraCompanion'
  for (const [k, v] of Object.entries(opts.extra ?? {})) out[k] = v
  return out
}
