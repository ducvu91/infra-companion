/**
 * Dò binary `codex` và phân loại trạng thái sẵn sàng — **thuần**, nhận env + kết quả probe làm
 * tham số nên test được trên cả 3 OS.
 *
 * Vì sao không chỉ tra PATH: trên chính máy dev này `where codex` trả về rỗng, nhưng Codex **có
 * cài** — `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe` (layout của Codex desktop app: mỗi
 * bản một thư mục hash, không symlink ra PATH). Chỉ tra PATH là báo "chưa cài" cho một máy đã
 * cài xong và đăng nhập rồi.
 *
 * Vì sao **KHÔNG** đọc `CODEX_CLI_PATH` trong `~/.codex/config.toml` dù nó có sẵn đường dẫn:
 * (a) app cam kết không chạm `~/.codex` — đó là nhà của công cụ khác; (b) đã kiểm chứng giá trị
 * trong đó trỏ tới một thư mục hash **đã bị xoá**. Một đường dẫn đọc được không có nghĩa là một
 * file chạy được, nên dù lấy từ đâu cũng phải `access(X_OK)` — và nếu đã phải kiểm thì tự duyệt
 * thư mục còn đáng tin hơn.
 *
 * Ghép đường dẫn Windows literal bằng `win32.join` (CLAUDE.md mục 7): CI chạy test trên cả 3 OS,
 * dùng `join` của nền tảng đang chạy thì test Windows-only đỏ trên Linux.
 */

import { win32, posix } from 'node:path'

/** `app-managed` = bản chính app tải về (nút "Cập nhật Codex"), nằm trong userData. */
export type CodexSource = 'manual' | 'app-managed' | 'path' | 'well-known' | 'npm-global'

export interface CodexCandidate {
  readonly path: string
  readonly source: CodexSource
}

/** Thư mục chứa các bản Codex desktop trên Windows, tương đối với `%LOCALAPPDATA%`. */
export const WINDOWS_BIN_SUBDIR = ['OpenAI', 'Codex', 'bin'] as const

/**
 * Ứng viên trên PATH, theo thứ tự thử.
 *
 * Trên Windows phải thử cả `.cmd`/`.bat`: bản cài bằng npm là shim script chứ không phải exe.
 * ⚠️ Shim `.cmd` **không spawn trực tiếp được** khi `shell:false` — nơi gọi phải bọc qua
 * `cmd.exe /d /s /c` (xem `isShimPath`).
 */
function pathCandidates(env: NodeJS.ProcessEnv, isWin: boolean): CodexCandidate[] {
  const raw = env['PATH'] ?? env['Path'] ?? ''
  if (raw === '') return []
  const sep = isWin ? ';' : ':'
  const names = isWin ? ['codex.exe', 'codex.cmd', 'codex.bat'] : ['codex']
  const join = isWin ? win32.join : posix.join

  const out: CodexCandidate[] = []
  for (const dir of raw.split(sep)) {
    const d = dir.trim().replace(/^"|"$/g, '')
    if (d === '') continue
    for (const n of names) out.push({ path: join(d, n), source: 'path' })
  }
  return out
}

/**
 * Ứng viên well-known.
 *
 * Windows: **không** ghép sẵn đường dẫn hash (nó đổi theo bản) — trả về thư mục `bin` để nơi gọi
 * duyệt và chọn bản mtime mới nhất. Chỗ đó cần `fs` nên không thuộc file thuần này; xem
 * `pickNewestBinDir`.
 */
function wellKnownCandidates(env: NodeJS.ProcessEnv, isWin: boolean): CodexCandidate[] {
  if (isWin) return [] // xử lý riêng qua windowsBinRoot() + pickNewestBinDir()
  const home = env['HOME'] ?? ''
  const out: CodexCandidate[] = []
  if (home !== '') out.push({ path: posix.join(home, '.local', 'bin', 'codex'), source: 'well-known' })
  out.push({ path: '/usr/local/bin/codex', source: 'well-known' })
  out.push({ path: '/opt/homebrew/bin/codex', source: 'well-known' })
  return out
}

/** Thư mục chứa các bản Codex desktop (Windows). `null` nếu không có `%LOCALAPPDATA%`. */
export function windowsBinRoot(env: NodeJS.ProcessEnv): string | null {
  const local = env['LOCALAPPDATA']
  if (typeof local !== 'string' || local === '') return null
  return win32.join(local, ...WINDOWS_BIN_SUBDIR)
}

/**
 * Chọn bản mới nhất trong các thư mục hash.
 *
 * Nhận danh sách `{dir, mtimeMs, hasExe}` để nơi gọi lo phần `fs`. Bỏ thư mục **không có exe** —
 * đã kiểm chứng trên máy dev có 3/4 thư mục hash rỗng (bản cũ đã dọn nhưng thư mục còn lại).
 */
export function pickNewestBinDir(
  entries: readonly { readonly dir: string; readonly mtimeMs: number; readonly hasExe: boolean }[],
): string | null {
  const usable = entries.filter((e) => e.hasExe)
  if (usable.length === 0) return null
  let best = usable[0]!
  for (const e of usable) if (e.mtimeMs > best.mtimeMs) best = e
  return win32.join(best.dir, 'codex.exe')
}

function npmGlobalCandidates(env: NodeJS.ProcessEnv, isWin: boolean): CodexCandidate[] {
  if (isWin) {
    const appdata = env['APPDATA']
    if (typeof appdata !== 'string' || appdata === '') return []
    return [{ path: win32.join(appdata, 'npm', 'codex.cmd'), source: 'npm-global' }]
  }
  return []
}

/**
 * Danh sách ứng viên theo thứ tự thử. Nơi gọi kiểm từng cái bằng `access(X_OK)` và dừng ở cái
 * đầu tiên chạy được.
 *
 * `manual` đứng đầu: user đã chỉ tay thì đừng đoán lại giúp họ.
 */
export function codexCandidates(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  manual?: string,
): CodexCandidate[] {
  const isWin = platform === 'win32'
  const out: CodexCandidate[] = []
  if (typeof manual === 'string' && manual.trim() !== '') {
    out.push({ path: manual.trim(), source: 'manual' })
  }
  out.push(...pathCandidates(env, isWin))
  out.push(...wellKnownCandidates(env, isWin))
  out.push(...npmGlobalCandidates(env, isWin))
  return out
}

/**
 * Đường dẫn này là shim script cần shell để chạy?
 *
 * `shell: true` là thứ repo cấm (`SpawnOptions` của `ProcessSupervisor`: *"chạy qua shell là mở
 * cửa cho path có dấu cách phá lệnh"*). Nên với `.cmd`/`.bat` thì bọc tường minh qua
 * `cmd.exe /d /s /c "<path>" app-server` — ta kiểm soát quoting thay vì nhờ shell parse một
 * chuỗi do mình ghép.
 */
export function isShimPath(p: string): boolean {
  const lower = p.toLowerCase()
  return lower.endsWith('.cmd') || lower.endsWith('.bat')
}

/**
 * Dựng argv để spawn, xử lý sẵn ca shim.
 *
 * `/d` bỏ AutoRun của registry (không để lệnh lạ của máy chen vào), `/s` cho cmd.exe hiểu đúng
 * cặp ngoặc kép ngoài cùng khi đường dẫn có dấu cách.
 */
export function buildSpawnArgv(
  binary: string,
  args: readonly string[],
  platform: NodeJS.Platform,
): { readonly file: string; readonly args: string[] } {
  if (platform === 'win32' && isShimPath(binary)) {
    const comspec = 'cmd.exe'
    return { file: comspec, args: ['/d', '/s', '/c', `"${binary}" ${args.join(' ')}`] }
  }
  return { file: binary, args: [...args] }
}

// ── Phân loại trạng thái ──────────────────────────────────────────────────────

export interface ProtocolCaps {
  /** Thư mục config Codex đang dùng, đọc từ `initialize` — hiện ra để user biết auth ở đâu. */
  readonly codexHome?: string
  readonly userAgent?: string
}

export type CodexReadiness =
  | { readonly kind: 'not-installed'; readonly searched: readonly string[] }
  | { readonly kind: 'found-broken'; readonly path: string; readonly detail: string }
  | { readonly kind: 'needs-login'; readonly path: string; readonly version: string }
  | {
      readonly kind: 'ready'
      readonly path: string
      readonly version: string
      readonly protocol: ProtocolCaps
    }
  /** Đã cài + handshake xong, nhưng CHƯA xác minh đăng nhập (probe đó tốn token nên không tự chạy). */
  | {
      readonly kind: 'installed-unverified'
      readonly path: string
      readonly version: string
      readonly protocol: ProtocolCaps
    }

/**
 * Lỗi này là do chưa đăng nhập?
 *
 * Cố ý khớp theo **mẫu chuỗi**, vì app-server không trả mã lỗi riêng cho ca đó. Nhận diện sai
 * theo hướng "tưởng chưa login" thì hại nhẹ (hiện thêm một hướng dẫn không cần thiết); còn bỏ
 * sót thì user nhìn một lỗi mạng vô nghĩa và không biết phải chạy `codex login`.
 *
 * Bằng chứng từ probe thật khi chưa gọi được model:
 *   `failed to connect to websocket: HTTP error: 503 … wss://chatgpt.com/backend-api/codex/responses`
 * — 503 KHÔNG phải lỗi auth, nên cố ý không nhận nó là `needs-login`.
 */
export function looksLikeAuthError(text: string): boolean {
  const t = text.toLowerCase()
  return (
    t.includes('unauthorized') ||
    t.includes('401') ||
    t.includes('403') ||
    t.includes('not logged in') ||
    t.includes('not authenticated') ||
    t.includes('please log in') ||
    t.includes('please login') ||
    t.includes('codex login') ||
    t.includes('no auth') ||
    t.includes('auth.json') ||
    t.includes('login required') ||
    t.includes('invalid_grant') ||
    t.includes('token expired') ||
    t.includes('refresh token')
  )
}

export interface ProbeInput {
  /** Tìm được binary chạy được không, và ở đâu. */
  readonly binary: { readonly path: string } | null
  /** Mọi đường đã thử — để thông báo nói được "đã tìm ở đâu" thay vì bắt user đoán. */
  readonly searched: readonly string[]
  /** `codex --version` — `null` nếu không chạy được. */
  readonly version: string | null
  /** Handshake `initialize` thành công? */
  readonly handshake: { readonly ok: true; readonly caps: ProtocolCaps } | { readonly ok: false; readonly detail: string } | null
  /** Kết quả turn probe (chỉ khi user chủ động bấm Kiểm tra, vì nó tốn token). */
  readonly turnProbe?: { readonly ok: true } | { readonly ok: false; readonly detail: string }
}

/**
 * Ghép các mảnh probe thành một trạng thái.
 *
 * Tách khỏi phần chạy tiến trình để test được đủ tổ hợp mà không cần có `codex` — vitest không
 * có nó, và trên máy dev nó còn chẳng ở PATH nên CI càng không.
 */
export function classifyProbe(input: ProbeInput): CodexReadiness {
  if (!input.binary) {
    return { kind: 'not-installed', searched: input.searched }
  }
  const path = input.binary.path

  // Chạy được `--version` nhưng handshake thất bại = bản quá cũ (không có subcommand
  // `app-server`) hoặc binary hỏng. Version có thể null mà handshake vẫn xong — không chặn.
  if (input.handshake && !input.handshake.ok) {
    return { kind: 'found-broken', path, detail: input.handshake.detail }
  }
  if (!input.handshake) {
    return {
      kind: 'found-broken',
      path,
      detail: input.version === null ? 'khong chay duoc `codex --version`' : 'chua thu handshake',
    }
  }

  const version = input.version ?? 'unknown'
  const protocol = input.handshake.caps

  if (input.turnProbe) {
    if (input.turnProbe.ok) return { kind: 'ready', path, version, protocol }
    if (looksLikeAuthError(input.turnProbe.detail)) return { kind: 'needs-login', path, version }
    // Lỗi khác (mạng, 503, quota) — KHÔNG phải chưa đăng nhập, và cũng không phải binary hỏng.
    // Nói rõ nguyên nhân thật thay vì gán nhãn sai.
    return { kind: 'found-broken', path, detail: input.turnProbe.detail }
  }

  // Handshake xong nhưng chưa gọi model: KHÔNG được kết luận là `ready`. Đã kiểm chứng
  // `initialize` + `thread/start` đều xanh trong khi không gọi nổi model.
  return { kind: 'installed-unverified', path, version, protocol }
}
