import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, parse as parsePath, resolve as resolvePath } from 'node:path'
import { BrowserWindow, app, dialog, ipcMain, shell, type IpcMainInvokeEvent, type WebContents } from 'electron'
import {
  CODEX_DEFAULT_PROFILE,
  WORKSPACE_DRIVE_ORDER,
  classifyModelError,
  classifyProbe,
  isValidProfileName,
  parseModelListFull,
  parseThreadList,
  rateLimitParts,
  workspaceCandidates,
  type CodexReadiness,
  type CodexThreadState,
} from '@infra/core'
import {
  CODEX_RECENT_CWD_CAP,
  CODEX_SETTINGS_DEFAULT,
  IPC,
  type CodexEventDto,
  type CodexInstallResultDto,
  type CodexItemDto,
  type CodexItemPatchDto,
  type CodexLoginEventDto,
  type CodexLoginKindDto,
  type CodexLoginStartResultDto,
  type CodexModelDto,
  type CodexProfileDto,
  type CodexReadinessDto,
  type CodexSessionStateDto,
  type CodexSettingsDto,
  type CodexSnapshotDto,
  type CodexStartResultDto,
  type CodexThreadSummaryDto,
} from '@infra/shared'
import { CodexProcess } from '../codex/CodexProcess'
import { codexVersion, detectCodexBinary } from '../codex/detect'
import { installCodexCli } from '../codex/install'

/**
 * Codex agent — nhúng `codex app-server` (JSON-RPC/JSONL qua stdio).
 *
 * **Xác thực bằng GÓI ChatGPT, không API key**: Codex tự đọc `~/.codex/auth.json` do user tạo
 * bằng `codex login`. App **không** đọc file đó (tồn tại file không có nghĩa token còn hạn, nên
 * đọc nó chỉ đổi lấy một tín hiệu sai mà phải trả bằng việc chạm vào nhà của công cụ khác) và
 * **không** truyền `OPENAI_API_KEY` sang tiến trình con — xem `codexEnv`.
 *
 * Khuôn từ `logTail.ts` (kênh chạy-dài đầu tiên ngoài terminal/tunnel): `Map` ở module scope,
 * START never-throw trả `{ok,id}`, event batch 100ms, dọn ở cả ba đường.
 *
 * **Một điểm KHÁC `logTail` có chủ ý**: ở đó renderer chết là dispose luôn (tail mở lại được).
 * Ở đây phiên phải **sống tiếp** khi renderer reload — giết một agent đang chạy 20 phút vì user
 * lỡ Ctrl+R là mất việc thật. Thay vào đó `owner = null` và có TTL: không ai quay lại trong 5
 * phút thì mới dọn, nếu không một lần reload rồi không mở lại panel là một `codex.exe` sống mãi.
 *
 * Settings để JSON trong userData chứ KHÔNG trong vault, cùng lập luận `localdev.ts`: vault tự
 * khoá sau 15 phút idle mà một phiên agent chạy lâu hơn thế. Ở đây còn dễ hơn — **không có bí
 * mật nào** để lưu.
 */

/** Gộp item trước khi bắn IPC. Delta bắn theo token; mỗi cái một message là renderer chết chìm. */
const FLUSH_MS = 100

/** Renderer đóng mà không ai quay lại trong khoảng này thì dọn phiên. */
const ORPHAN_TTL_MS = 5 * 60_000

const SETTINGS_FILE = 'codex-settings.json'

interface Session {
  readonly proc: CodexProcess
  readonly cwd: string
  /** `null` = renderer đã đóng, phiên VẪN chạy (xem chú thích đầu file). */
  owner: WebContents | null
  items: Map<string, CodexItemDto>
  pending: Map<string, CodexItemDto>
  timer: NodeJS.Timeout | null
  orphanTimer: NodeJS.Timeout | null
  lastState: CodexSessionStateDto
}

const sessions = new Map<string, Session>()

/**
 * Luồng đăng nhập đang chạy — **một lượt tại một thời điểm**.
 *
 * Tiến trình app-server phải sống tới khi có kết quả: nó giữ luồng OAuth và là nơi notification
 * `account/login/completed` đi qua. Cho phép hai lượt song song thì hai browser cùng mở và
 * không ai biết cái nào vừa xong.
 */
let loginProc: CodexProcess | null = null
let loginId: string | null = null
let loginTimer: NodeJS.Timeout | null = null

/** Trần chờ user bấm xong trong browser. Bỏ giữa chừng thì không để tiến trình sống mãi. */
const LOGIN_TTL_MS = 5 * 60_000

function endLogin(): void {
  if (loginTimer) clearTimeout(loginTimer)
  loginTimer = null
  const proc = loginProc
  loginProc = null
  loginId = null
  if (proc) void proc.stop(1_000)
}

/**
 * Gửi kết quả login về renderer.
 *
 * Gửi cho **mọi** cửa sổ chứ không riêng cái đã bấm: user có thể mở panel Codex ở cửa sổ tách
 * rời, và trạng thái tài khoản là thứ mọi chỗ đang hiển thị đều phải cập nhật.
 */
function postLogin(preferred: WebContents | null, ev: CodexLoginEventDto): void {
  if (preferred && !preferred.isDestroyed()) preferred.send(IPC.CODEX_LOGIN_EVENT, ev)
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue
    if (preferred && win.webContents.id === preferred.id) continue
    win.webContents.send(IPC.CODEX_LOGIN_EVENT, ev)
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────

function settingsPath(): string {
  return join(app.getPath('userData'), SETTINGS_FILE)
}

function sanitizeSettings(raw: unknown): CodexSettingsDto {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const policy = r['approvalPolicy']
  return {
    binaryPath: typeof r['binaryPath'] === 'string' ? r['binaryPath'] : CODEX_SETTINGS_DEFAULT.binaryPath,
    // Giá trị lạ (file sửa tay, hoặc bản cũ) → rơi về mức CHẶT NHẤT, không phải mức tiện nhất.
    approvalPolicy:
      policy === 'ask-everything' || policy === 'ask-writes' || policy === 'auto'
        ? policy
        : CODEX_SETTINGS_DEFAULT.approvalPolicy,
    recentCwds: Array.isArray(r['recentCwds'])
      ? (r['recentCwds'] as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, CODEX_RECENT_CWD_CAP)
      : [],
    showReasoning: r['showReasoning'] === true,
    // Tên profile đi vào tên thư mục → phải qua `isValidProfileName` (chặn `..`, ký tự Windows
    // cấm). File settings sửa tay được nên KHÔNG tin nó.
    profiles: Array.isArray(r['profiles'])
      ? (r['profiles'] as unknown[]).filter((x): x is string => typeof x === 'string' && isValidProfileName(x))
      : [],
    activeProfile:
      typeof r['activeProfile'] === 'string' &&
      (r['activeProfile'] === CODEX_DEFAULT_PROFILE || isValidProfileName(r['activeProfile']))
        ? r['activeProfile']
        : CODEX_DEFAULT_PROFILE,
  }
}

/**
 * `CODEX_HOME` cho một profile. `null` = dùng mặc định hệ thống (`~/.codex`).
 *
 * Profile riêng nằm trong userData của app, KHÔNG cạnh `~/.codex`: thư mục đó là nhà của công cụ
 * khác và app đã cam kết không chạm vào.
 */
function profileHome(name: string): string | null {
  if (name === CODEX_DEFAULT_PROFILE) return null
  if (!isValidProfileName(name)) return null
  return join(app.getPath('userData'), 'codex-profiles', name)
}

async function loadSettings(): Promise<CodexSettingsDto> {
  try {
    return sanitizeSettings(JSON.parse(await readFile(settingsPath(), 'utf8')))
  } catch {
    // Chưa có file / JSON hỏng — dùng mặc định. Không phải lỗi cần báo user.
    return CODEX_SETTINGS_DEFAULT
  }
}

async function saveSettings(s: CodexSettingsDto): Promise<void> {
  await writeFile(settingsPath(), JSON.stringify(s, null, 2), 'utf8')
}

// ── Trạng thái CLI ────────────────────────────────────────────────────────────

function toReadinessDto(r: CodexReadiness): CodexReadinessDto {
  switch (r.kind) {
    case 'not-installed':
      return { kind: r.kind, searched: r.searched }
    case 'found-broken':
      return { kind: r.kind, path: r.path, detail: r.detail }
    case 'needs-login':
      return { kind: r.kind, path: r.path, version: r.version }
    case 'ready':
    case 'installed-unverified':
      return { kind: r.kind, path: r.path, version: r.version, codexHome: r.protocol.codexHome }
  }
}

/**
 * Mở một tiến trình app-server ngắn hạn để hỏi vài câu rồi tắt.
 *
 * Dùng cho probe, đọc tài khoản, login, logout — những việc **không thuộc phiên làm việc nào**.
 * Không tái dùng tiến trình của phiên đang chạy: phiên có thể chưa mở, hoặc đang giữa một turn
 * mà chen request vào là rủi ro không cần thiết cho một việc chỉ mất 2 giây.
 */
async function withShortLived<T>(
  profile: string,
  manual: string,
  fn: (proc: CodexProcess) => Promise<T>,
  events?: { onLoginCompleted?: (r: { ok: boolean; error?: string }) => void; onAccountChanged?: () => void },
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const detected = await detectCodexBinary(manual)
  if (!detected.binary) {
    return { ok: false, error: `khong tim thay codex (da tim ${detected.searched.length} duong)` }
  }
  const home = profileHome(profile)
  if (home) await mkdir(home, { recursive: true })

  const proc = new CodexProcess(
    {
      binary: detected.binary.path,
      // cwd trung tính: việc này không được chạm vào thư mục làm việc của user.
      cwd: app.getPath('temp'),
      appVersion: app.getVersion(),
      platform: process.platform,
      codexHome: home ?? undefined,
    },
    {
      onState: () => {},
      onLog: () => {},
      onApproval: async () => ({ decision: 'decline' }),
      onExit: () => {},
      onWarning: (m) => console.log(`[codex] ${m}`),
      onLoginCompleted: events?.onLoginCompleted,
      onAccountChanged: events?.onAccountChanged,
    },
  )
  try {
    await proc.start()
    return { ok: true, value: await fn(proc) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    await proc.stop(1_500)
  }
}

/**
 * Probe: dò binary → `--version` → handshake → **đọc tài khoản**.
 *
 * Bản trước dừng ở handshake và trả `installed-unverified` cho mọi máy, vì cách duy nhất nó biết
 * đã-đăng-nhập-chưa là chạy một turn thật (tốn token). Hoá ra app-server có `account/read` — và
 * nó **không gọi model nên không tốn token** (đã kiểm chứng). Vậy câu trả lời đúng lấy được miễn
 * phí, và `installed-unverified` chỉ còn dùng cho ca `account/read` lỗi.
 */
async function probeReadiness(manual: string, profile: string): Promise<CodexReadinessDto> {
  const detected = await detectCodexBinary(manual)
  if (!detected.binary) {
    return { kind: 'not-installed', searched: detected.searched, profile }
  }
  const binary = detected.binary.path
  const version = await codexVersion(binary)

  const res = await withShortLived(profile, manual, async (proc) => {
    const info = proc.initializeInfo
    // Hạn mức chỉ hỏi khi đã đăng nhập — chưa login thì nó vô nghĩa (và sẽ lỗi).
    const account = await proc.readAccount()
    const rateLimit = account ? await proc.readRateLimit() : null
    return { info, account, rateLimit }
  })

  if (!res.ok) {
    // Handshake thất bại = bản quá cũ (thiếu subcommand `app-server`) hoặc binary hỏng.
    const base = classifyProbe({
      binary: { path: binary },
      searched: detected.searched,
      version,
      handshake: { ok: false, detail: res.error },
    })
    return { ...toReadinessDto(base), profile }
  }

  const { info, account, rateLimit } = res.value
  const codexHome = info?.codexHome
  if (!account) {
    // Đây là ca user hỏi tới: chưa đăng nhập. Nay app biết CHẮC, và có nút đăng nhập ngay
    // trong app thay vì chỉ hiện chữ `codex login` rồi bắt họ tự mở terminal.
    return { kind: 'needs-login', path: binary, version: version ?? 'unknown', codexHome, profile }
  }
  return {
    kind: 'ready',
    path: binary,
    version: version ?? 'unknown',
    codexHome,
    profile,
    account: { authMode: account.authMode, email: account.email, planType: account.planType },
    rateLimit: rateLimit
      ? { ...rateLimitParts(rateLimit, Date.now()), reached: rateLimit.reached }
      : undefined,
  }
}

// ── Event ra renderer ─────────────────────────────────────────────────────────

function post(id: string, ev: CodexEventDto): void {
  const s = sessions.get(id)
  if (!s || !s.owner || s.owner.isDestroyed()) return
  s.owner.send(IPC.CODEX_EVENT, ev)
}

function flush(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  s.timer = null
  if (s.pending.size === 0) return
  const items: CodexItemPatchDto[] = [...s.pending.values()].map((item) => ({ item }))
  s.pending.clear()
  post(id, { sessionId: id, kind: 'items', items })
}

function toStateDto(state: CodexThreadState, cwd: string): CodexSessionStateDto {
  return {
    phase: state.phase,
    threadId: state.threadId,
    turnId: state.turnId,
    error: state.error,
    // Lỗi lượt THẬT đến qua `turn/completed` với `status: failed`, không phải qua throw — nên
    // phải phân loại ở đây nữa, không chỉ ở nhánh catch của `startTurn`.
    issue: state.error ? (classifyModelError(state.error) ?? undefined) : undefined,
    cwd,
    mcpServers: state.mcpServers.map((m) => ({ name: m.name, status: m.status, error: m.error })),
  }
}

/**
 * Gộp state đã đổi từ `CodexThreadState` sang DTO + hàng đợi item.
 *
 * `state` gửi NGAY, `items` gộp 100ms: phase đổi là thứ UI phải phản ứng tức thì (nút Dừng
 * hiện/ẩn), còn delta chữ thì 100ms không ai thấy chậm.
 */
function onProcState(id: string, state: CodexThreadState): void {
  const s = sessions.get(id)
  if (!s) return

  for (const item of state.items) {
    const prev = s.items.get(item.id)
    if (prev && prev.text === item.text && prev.done === item.done && prev.kind === item.kind) continue
    const dto: CodexItemDto = { id: item.id, kind: item.kind, text: item.text, done: item.done }
    s.items.set(item.id, dto)
    s.pending.set(item.id, dto)
  }
  s.timer ??= setTimeout(() => flush(id), FLUSH_MS)

  const next = toStateDto(state, s.cwd)
  const changed =
    next.phase !== s.lastState.phase ||
    next.threadId !== s.lastState.threadId ||
    next.turnId !== s.lastState.turnId ||
    next.error !== s.lastState.error ||
    next.issue !== s.lastState.issue ||
    next.mcpServers.length !== s.lastState.mcpServers.length ||
    next.mcpServers.some((m, i) => {
      const p = s.lastState.mcpServers[i]
      return !p || p.name !== m.name || p.status !== m.status || p.error !== m.error
    })
  if (!changed) return
  s.lastState = next
  post(id, { sessionId: id, kind: 'state', state: next })
}

/** Dọn phiên. `reason` có mặt = báo renderer biết vì sao. */
function dispose(id: string, reason?: { code: number | null; error?: string }): void {
  const s = sessions.get(id)
  if (!s) return
  if (s.timer) clearTimeout(s.timer)
  if (s.orphanTimer) clearTimeout(s.orphanTimer)
  flush(id)
  if (reason) post(id, { sessionId: id, kind: 'closed', code: reason.code, error: reason.error })
  sessions.delete(id)
  void s.proc.stop(2_000)
}

/**
 * Renderer đóng: KHÔNG dispose ngay (khác `logTail`) — nhưng cũng không để phiên sống mãi.
 *
 * Reload là chuyện thường; đóng panel rồi quên cũng là chuyện thường. TTL phân biệt hai ca đó
 * mà không cần đoán ý user.
 */
function detachOwner(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  s.owner = null
  if (s.orphanTimer) clearTimeout(s.orphanTimer)
  s.orphanTimer = setTimeout(() => {
    console.log(`[codex] session ${id} orphaned for ${ORPHAN_TTL_MS}ms, disposing`)
    dispose(id)
  }, ORPHAN_TTL_MS)
}

/**
 * cwd có an toàn để agent làm việc?
 *
 * Chặn ổ gốc và home trần: một agent làm việc ở `C:\` có bán kính nổ bằng cả máy. Chặn userData
 * vì đó là nơi giữ vault và cấu hình app — agent "dọn dẹp" ở đó là mất dữ liệu người dùng.
 */
function cwdRefusal(dir: string): string | null {
  if (!isAbsolute(dir)) return 'duong dan phai la tuyet doi'
  const norm = resolvePath(dir)
  const p = parsePath(norm)
  if (p.root === norm) return 'khong the lam viec ngay o o goc'
  for (const key of ['home', 'userData', 'appData'] as const) {
    let special: string
    try {
      special = resolvePath(app.getPath(key))
    } catch {
      continue
    }
    if (norm === special) return key === 'home' ? 'khong the lam viec ngay o thu muc nha' : 'khong the lam viec trong thu muc du lieu cua app'
  }
  return null
}

/** Ổ đĩa nào ĐANG CÓ trên máy, theo thứ tự ưu tiên D: rồi C:. */
async function existingDrives(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  const out: string[] = []
  for (const d of WORKSPACE_DRIVE_ORDER) {
    try {
      if ((await stat(d)).isDirectory()) out.push(d)
    } catch {
      // Ổ không tồn tại (máy chỉ có C:) — bỏ qua.
    }
  }
  return out
}

/**
 * Thư mục làm việc mặc định: thư mục vừa dùng, hoặc **một thư mục do app tạo** ở gốc ổ
 * (`D:\` trước, `C:\` sau). Không có ổ nào ghi được thì trả `''` để user tự chọn.
 *
 * `create=false` cho lúc chỉ cần biết đường dẫn (mở hộp thoại chọn thư mục): mở panel lên mà
 * đã tạo thư mục ở gốc ổ D thì đó là app tự ý để lại rác trên máy người ta trước khi họ đồng ý
 * dùng tính năng. Thư mục chỉ được tạo khi thật sự bắt đầu một phiên.
 */
async function pickDefaultCwd(recent: readonly string[], create: boolean): Promise<string> {
  const candidates = workspaceCandidates(
    recent,
    await existingDrives(),
    process.platform === 'win32' ? undefined : app.getPath('home'),
  )
  for (const dir of candidates) {
    // Ứng viên vẫn phải qua `cwdRefusal`: một `recent` cũ có thể là thư mục giờ đã thành chỗ
    // không cho phép, và mặc định không được là thứ mà chính app sẽ từ chối.
    if (cwdRefusal(dir)) continue
    try {
      if ((await stat(dir)).isDirectory()) return dir
    } catch {
      // Chưa có. Tạo được thì dùng — nhưng chỉ khi được phép (xem `create`).
      if (!create) return dir
      try {
        await mkdir(dir, { recursive: true })
        return dir
      } catch {
        // Không ghi được (ổ chỉ đọc, thiếu quyền ở gốc ổ) — thử ổ kế.
      }
    }
  }
  return ''
}

async function rememberCwd(dir: string): Promise<void> {
  const s = await loadSettings()
  const recentCwds = [dir, ...s.recentCwds.filter((x) => x !== dir)].slice(0, CODEX_RECENT_CWD_CAP)
  await saveSettings({ ...s, recentCwds })
}

// ── Đăng ký ───────────────────────────────────────────────────────────────────

export function registerCodexIpc(): void {
  ipcMain.handle(IPC.CODEX_GET_SETTINGS, async (): Promise<CodexSettingsDto> => loadSettings())

  ipcMain.handle(IPC.CODEX_SET_SETTINGS, async (_e, raw: unknown): Promise<CodexSettingsDto> => {
    const next = sanitizeSettings(raw)
    await saveSettings(next)
    return next
  })

  ipcMain.handle(IPC.CODEX_STATUS, async (): Promise<CodexReadinessDto> => {
    const s = await loadSettings()
    return probeReadiness(s.binaryPath, s.activeProfile)
  })

  // Cùng đường với STATUS: nhờ `account/read` không tốn token, không còn lý do tách một probe
  // "đầy đủ nhưng đắt". Giữ hai kênh vì renderer đã gọi hai chỗ khác nhau về ý nghĩa (mở panel
  // vs user bấm "Kiểm tra lại").
  ipcMain.handle(IPC.CODEX_PROBE, async (): Promise<CodexReadinessDto> => {
    const s = await loadSettings()
    return probeReadiness(s.binaryPath, s.activeProfile)
  })

  // ── Đăng nhập / đổi tài khoản ─────────────────────────────────────────────

  /**
   * Bắt đầu đăng nhập. Kết quả về **không đồng bộ** qua `CODEX_LOGIN_EVENT`.
   *
   * Tiến trình app-server phải **sống tới khi login xong** — nó là cái giữ luồng OAuth và là nơi
   * notification `account/login/completed` đi qua. Nên ở đây KHÔNG dùng `withShortLived`: giữ
   * riêng một tiến trình cho tới lúc có kết quả (hoặc quá hạn).
   */
  ipcMain.handle(
    IPC.CODEX_LOGIN_START,
    async (event: IpcMainInvokeEvent, kind: CodexLoginKindDto): Promise<CodexLoginStartResultDto> => {
      const s = await loadSettings()
      if (loginProc) return { ok: false, error: 'dang co mot luot dang nhap khac' }

      const detected = await detectCodexBinary(s.binaryPath)
      if (!detected.binary) {
        return { ok: false, error: `khong tim thay codex (da tim ${detected.searched.length} duong)` }
      }
      const home = profileHome(s.activeProfile)
      if (home) await mkdir(home, { recursive: true })

      const sender = event.sender
      const proc = new CodexProcess(
        {
          binary: detected.binary.path,
          cwd: app.getPath('temp'),
          appVersion: app.getVersion(),
          platform: process.platform,
          codexHome: home ?? undefined,
        },
        {
          onState: () => {},
          onLog: () => {},
          onApproval: async () => ({ decision: 'decline' }),
          onExit: () => {
            // Tiến trình chết trước khi login xong: phải báo, không để user ngồi chờ mãi một
            // browser đã không còn ai nghe kết quả.
            if (loginProc) {
              endLogin()
              postLogin(sender, { kind: 'completed', ok: false, error: 'codex app-server da thoat giua luc dang nhap' })
            }
          },
          onWarning: (m) => console.log(`[codex] ${m}`),
          onLoginCompleted: (r) => {
            endLogin()
            postLogin(sender, r.ok ? { kind: 'completed', ok: true } : { kind: 'completed', ok: false, error: r.error })
          },
          onAccountChanged: () => postLogin(sender, { kind: 'account-changed' }),
        },
      )

      try {
        await proc.start()
        const started = await proc.startLogin(kind === 'deviceCode' ? 'deviceCode' : 'chatgpt')
        loginProc = proc
        loginId = started.loginId ?? null
        // Trần thời gian: user bỏ giữa chừng trong browser thì không để một tiến trình sống mãi.
        loginTimer = setTimeout(() => {
          endLogin()
          postLogin(sender, { kind: 'completed', ok: false, error: 'het thoi gian cho dang nhap' })
        }, LOGIN_TTL_MS)

        /**
         * MỞ BROWSER — app-server KHÔNG tự làm việc này.
         *
         * Đã kiểm chứng bằng cách gọi thật: `account/login/start` chỉ trả `authUrl`
         * (`https://auth.openai.com/oauth/authorize?…&redirect_uri=http://localhost:1455/auth/callback`)
         * rồi đứng chờ callback. Không mở là UI đứng ở "đang chờ ở trình duyệt" mà chẳng có
         * trình duyệt nào mở — đúng bug user gặp. Cùng cách `googleDrive.ts` làm cho OAuth
         * loopback của Google.
         *
         * Với `deviceCode` thì user tự mở trang và nhập mã, nên KHÔNG mở hộ: mở một trang mà
         * họ chưa có mã trong tay chỉ làm rối.
         */
        let opened = false
        if (kind !== 'deviceCode' && started.authUrl) {
          try {
            await shell.openExternal(started.authUrl)
            opened = true
          } catch (error) {
            // Không mở được (máy không có browser mặc định, hoặc chính sách chặn) — KHÔNG coi là
            // thất bại: URL vẫn trả về cho renderer hiện ra để user tự mở. Nhưng phải log để
            // truy được, đừng im.
            console.log(`[codex] openExternal failed: ${error instanceof Error ? error.message : String(error)}`)
          }
        }

        return {
          ok: true,
          loginId: started.loginId,
          // Mở được rồi thì KHÔNG trả URL: hiện một link dài loằng ngoằng bên cạnh dòng "đang
          // chờ ở trình duyệt" chỉ làm user tưởng mình phải bấm thêm gì. Mở thất bại thì URL là
          // đường thoát duy nhất nên phải trả.
          authUrl: opened ? undefined : started.authUrl,
          userCode: started.userCode,
        }
      } catch (error) {
        await proc.stop(1_000)
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  )

  ipcMain.handle(IPC.CODEX_LOGIN_CANCEL, async (): Promise<void> => {
    const proc = loginProc
    const id = loginId
    endLogin()
    if (proc && id) {
      // Nói cho app-server biết là huỷ, rồi mới tắt — tắt thẳng để lại một luồng OAuth mồ côi
      // phía server.
      await proc.cancelLogin(id).catch(() => {})
    }
    await proc?.stop(1_000)
  })

  ipcMain.handle(IPC.CODEX_LOGOUT, async (): Promise<{ ok: boolean; error?: string }> => {
    const s = await loadSettings()
    const res = await withShortLived(s.activeProfile, s.binaryPath, async (proc) => {
      await proc.logout()
    })
    return res.ok ? { ok: true } : { ok: false, error: res.error }
  })

  // ── Profile (nhiều tài khoản song song) ───────────────────────────────────

  ipcMain.handle(IPC.CODEX_PROFILES, async (): Promise<readonly CodexProfileDto[]> => {
    const s = await loadSettings()
    // Cố ý KHÔNG đọc tài khoản của từng profile ở đây: mỗi cái là một lần spawn app-server
    // (~2s), nên 5 profile là 10 giây đứng UI. Tài khoản của profile ĐANG dùng đã có ở
    // `CODEX_STATUS`; các profile khác chỉ hiện tên cho tới khi user chuyển sang.
    return [
      { name: CODEX_DEFAULT_PROFILE, isSystem: true },
      ...s.profiles.map((name) => ({ name, isSystem: false })),
    ]
  })

  ipcMain.handle(IPC.CODEX_PROFILE_ADD, async (_e, name: unknown): Promise<{ ok: boolean; error?: string }> => {
    if (typeof name !== 'string' || !isValidProfileName(name.trim())) {
      return { ok: false, error: 'ten khong hop le' }
    }
    const clean = name.trim()
    const s = await loadSettings()
    if (s.profiles.includes(clean)) return { ok: false, error: 'ten da ton tai' }
    await saveSettings({ ...s, profiles: [...s.profiles, clean] })
    return { ok: true }
  })

  ipcMain.handle(IPC.CODEX_PROFILE_REMOVE, async (_e, name: unknown): Promise<{ ok: boolean; error?: string }> => {
    if (typeof name !== 'string') return { ok: false, error: 'ten khong hop le' }
    const home = profileHome(name)
    // `profileHome` trả null cho `default` và cho tên không hợp lệ — cả hai đều không được xoá.
    if (!home) return { ok: false, error: 'khong the xoa profile nay' }

    const s = await loadSettings()
    await saveSettings({
      ...s,
      profiles: s.profiles.filter((p) => p !== name),
      activeProfile: s.activeProfile === name ? CODEX_DEFAULT_PROFILE : s.activeProfile,
    })
    // Xoá cả thư mục: để lại là để lại credential của một tài khoản user vừa nói không dùng nữa.
    await rm(home, { recursive: true, force: true }).catch(() => {})
    return { ok: true }
  })

  ipcMain.handle(IPC.CODEX_PROFILE_USE, async (_e, name: unknown): Promise<{ ok: boolean; error?: string }> => {
    if (typeof name !== 'string') return { ok: false, error: 'ten khong hop le' }
    if (name !== CODEX_DEFAULT_PROFILE && !isValidProfileName(name)) return { ok: false, error: 'ten khong hop le' }
    const s = await loadSettings()
    if (name !== CODEX_DEFAULT_PROFILE && !s.profiles.includes(name)) return { ok: false, error: 'profile khong ton tai' }
    await saveSettings({ ...s, activeProfile: name })
    return { ok: true }
  })

  ipcMain.handle(IPC.CODEX_PICK_BINARY, async (): Promise<string | null> => {
    const res = await dialog.showOpenDialog({
      title: 'Chon file codex',
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [{ name: 'Codex', extensions: ['exe', 'cmd', 'bat'] }]
          : [{ name: 'All', extensions: ['*'] }],
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const picked = res.filePaths[0]!
    const s = await loadSettings()
    await saveSettings({ ...s, binaryPath: picked })
    return picked
  })

  /**
   * Tải/cập nhật Codex CLI vào thư mục app.
   *
   * Cần vì `codex update` của chính CLI không dùng được với bản do Codex desktop app quản (đo
   * thật: *"Could not detect the Codex installation method"*), mà bản cũ 0.142.4 thì làm **mọi
   * model đều lỗi** — 0.154.0 chạy được model user đang cấu hình.
   *
   * Sau khi cài, dò lại và **kiểm version tường minh**: npm exit 0 chưa chứng minh binary chạy
   * được (mục 8 CLAUDE.md).
   */
  ipcMain.handle(IPC.CODEX_INSTALL_CLI, async (event: IpcMainInvokeEvent): Promise<CodexInstallResultDto> => {
    const sender = event.sender
    const emit = (line: string): void => {
      if (!sender.isDestroyed()) sender.send(IPC.CODEX_INSTALL_EVENT, line)
      console.log(`[codex install] ${line}`)
    }

    const res = await installCodexCli(emit)
    if (!res.ok) return { ok: false, error: res.error ?? 'khong cai duoc' }

    const version = await codexVersion(res.binary!)
    if (!version) {
      return { ok: false, error: 'da tai xong nhung binary khong chay duoc (`codex --version` that bai)' }
    }
    emit(`version: ${version}`)
    return { ok: true, binary: res.binary!, version }
  })

  ipcMain.handle(IPC.CODEX_PICK_CWD, async (): Promise<string | null> => {
    const s = await loadSettings()
    // Mở hộp thoại NGAY tại thư mục hợp lý: mở ở ổ gốc rồi bắt user lội xuống 5 tầng là đúng
    // cái bất tiện mà mặc định này định bỏ. `''` = không tìm được gì → để OS tự chọn.
    // `create:false` — chỉ mở hộp thoại thì chưa được tạo gì trên máy user.
    const suggested = await pickDefaultCwd(s.recentCwds, false)
    const res = await dialog.showOpenDialog({
      title: 'Chon thu muc lam viec',
      properties: ['openDirectory'],
      ...(suggested === '' ? {} : { defaultPath: suggested }),
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]!
  })

  // ── Model & mức suy luận ──────────────────────────────────────────────────

  /**
   * Model dùng được + mức suy luận của từng cái.
   *
   * Đọc từ phiên đang mở nếu có (rẻ), không thì mở một tiến trình ngắn hạn. `model/list` không
   * gọi model nên **không tốn token**.
   */
  ipcMain.handle(IPC.CODEX_MODELS, async (_e, sessionId?: unknown): Promise<readonly CodexModelDto[]> => {
    const toDto = (raw: unknown): CodexModelDto[] =>
      parseModelListFull(raw).map((m) => ({
        id: m.id,
        displayName: m.displayName,
        description: m.description,
        reasoningEfforts: m.reasoningEfforts,
        defaultEffort: m.defaultEffort,
      }))

    if (typeof sessionId === 'string') {
      const s = sessions.get(sessionId)
      if (s) {
        try {
          return toDto(await s.proc.listModels())
        } catch (error) {
          console.log(`[codex] model/list: ${error instanceof Error ? error.message : String(error)}`)
          return []
        }
      }
    }
    const settings = await loadSettings()
    const res = await withShortLived(settings.activeProfile, settings.binaryPath, async (proc) =>
      toDto(await proc.listModels()),
    )
    return res.ok ? res.value : []
  })

  /** Đổi model/mức suy luận cho phiên đang mở — áp từ lượt kế tiếp. */
  ipcMain.handle(IPC.CODEX_SET_MODEL, (_e, sessionId: unknown, model?: unknown, effort?: unknown): void => {
    if (typeof sessionId !== 'string') return
    sessions
      .get(sessionId)
      ?.proc.setModelChoice(
        typeof model === 'string' && model !== '' ? model : undefined,
        typeof effort === 'string' && effort !== '' ? effort : undefined,
      )
  })

  // ── Phiên cũ ──────────────────────────────────────────────────────────────

  /**
   * Liệt kê phiên cũ. `cwd` để chỉ lấy phiên của đúng thư mục đang làm.
   *
   * Codex tự lưu transcript ra `~/.codex/sessions/**.jsonl` nên **không cần app lưu bản thứ
   * hai**: hai nguồn sự thật cho cùng một thứ thì sớm muộn lệch nhau, mà bản của Codex mới là
   * bản `thread/resume` đọc được.
   */
  ipcMain.handle(IPC.CODEX_THREADS, async (_e, cwd?: unknown): Promise<readonly CodexThreadSummaryDto[]> => {
    const settings = await loadSettings()
    const res = await withShortLived(settings.activeProfile, settings.binaryPath, async (proc) =>
      parseThreadList(await proc.listThreads(30, typeof cwd === 'string' && cwd !== '' ? cwd : undefined)),
    )
    if (!res.ok) {
      console.log(`[codex] thread/list failed: ${res.error}`)
      return []
    }
    return res.value.map((t) => ({
      id: t.id,
      preview: t.preview,
      cwd: t.cwd,
      model: t.model,
      updatedAt: t.updatedAt,
    }))
  })

  ipcMain.handle(IPC.CODEX_DEFAULT_CWD, async (): Promise<string> => {
    const s = await loadSettings()
    // `create:false` — panel gọi kênh này lúc MỞ ra để điền sẵn ô. Tạo thư mục ở đây là để rác
    // trên máy user trước khi họ dùng tính năng; thư mục sinh ra ở `SESSION_START`.
    return pickDefaultCwd(s.recentCwds, false)
  })

  /**
   * Mở phiên — dùng chung cho `CODEX_SESSION_START` (thread mới) và `CODEX_RESUME` (phiên cũ).
   *
   * Hai đường chỉ khác đúng một dòng: `startThread()` vs `resumeThread(id)`. Tách hàm thay vì
   * chép cả khối: chép thì một bên sửa, bên kia quên.
   */
  async function openSession(
    event: IpcMainInvokeEvent,
    cwd: string,
    resumeThreadId?: string,
  ): Promise<CodexStartResultDto> {
      try {
        if (typeof cwd !== 'string' || cwd.trim() === '') return { ok: false, error: 'chua chon thu muc lam viec' }
        const refusal = cwdRefusal(cwd)
        if (refusal) return { ok: false, error: refusal }

        // Tạo thư mục nếu chưa có — ĐÂY là chỗ được tạo, không phải lúc mở panel: user vừa bấm
        // "Bắt đầu phiên" nên họ đã đồng ý dùng tính năng. Cũng xử luôn ca user chọn tay một
        // thư mục vừa bị xoá/đổi tên. Không tạo được thì nói rõ, đừng để `spawn` báo ENOENT khó
        // hiểu (mục 8 CLAUDE.md).
        try {
          await mkdir(cwd, { recursive: true })
        } catch (error) {
          return {
            ok: false,
            error: `khong tao/mo duoc thu muc lam viec: ${error instanceof Error ? error.message : String(error)}`,
          }
        }

        const settings = await loadSettings()
        const detected = await detectCodexBinary(settings.binaryPath)
        if (!detected.binary) {
          return { ok: false, error: `khong tim thay codex (da tim ${detected.searched.length} duong)` }
        }

        const id = randomUUID()
        const sender = event.sender

        const home = profileHome(settings.activeProfile)
        if (home) await mkdir(home, { recursive: true })

        const proc = new CodexProcess(
          {
            binary: detected.binary.path,
            cwd,
            appVersion: app.getVersion(),
            platform: process.platform,
            // Profile riêng → CODEX_HOME riêng → tài khoản riêng. `undefined` = dùng ~/.codex.
            codexHome: home ?? undefined,
            // Reasoning chi tiết tắt mặc định: rất dài và là nguồn IPC nặng nhất.
            optOut: settings.showReasoning ? [] : undefined,
          },
          {
            onState: (state) => onProcState(id, state),
            onLog: (lines) => post(id, { sessionId: id, kind: 'log', lines }),
            // GĐ1 chưa có UI duyệt (GĐ3). Từ chối là mặc định AN TOÀN: agent bị chặn thì báo
            // lại và đi đường khác, còn tự duyệt hộ là chạy lệnh không ai xem trước.
            onApproval: async () => ({ decision: 'decline' }),
            onExit: (code, error) => {
              // `closed` phải đi NGAY, không đợi 100ms: hoãn nó sau `items` thì UI vẽ delta của
              // một tiến trình đã chết và nút Dừng hiện lại sau khi đã tắt.
              flush(id)
              const s = sessions.get(id)
              if (s) {
                if (s.timer) clearTimeout(s.timer)
                if (s.orphanTimer) clearTimeout(s.orphanTimer)
              }
              post(id, { sessionId: id, kind: 'closed', code, error })
              sessions.delete(id)
            },
            onWarning: (msg) => console.log(`[codex] protocol warning: ${msg}`),
          },
        )

        const initialState: CodexSessionStateDto = {
          phase: 'idle',
          threadId: null,
          turnId: null,
          error: null,
          cwd,
          mcpServers: [],
        }
        sessions.set(id, {
          proc,
          cwd,
          owner: sender,
          items: new Map(),
          pending: new Map(),
          timer: null,
          orphanTimer: null,
          lastState: initialState,
        })

        // Renderer đóng thì KHÔNG có sự kiện nào từ UI — nhưng ở đây chỉ tháo owner, phiên sống
        // tiếp (xem chú thích đầu file).
        sender.once('destroyed', () => detachOwner(id))

        try {
          await proc.start()
          // Đọc model đang cấu hình + danh sách CLI báo, CHỈ để câu thông báo lúc lỗi nói được
          // việc cần làm. Không ghi đè gì — lần đầu tôi ghi đè và nó chỉ đổi lỗi 400 thành 404.
          await proc.readModelInfo()
          if (resumeThreadId) await proc.resumeThread(resumeThreadId)
          else await proc.startThread()
        } catch (error) {
          dispose(id)
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }

        void rememberCwd(cwd)
        const s = sessions.get(id)
        return { ok: true, sessionId: id, state: s ? s.lastState : initialState }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
  }

  ipcMain.handle(IPC.CODEX_SESSION_START, (event: IpcMainInvokeEvent, cwd: string) => openSession(event, cwd))

  /**
   * Mở lại một phiên CŨ và chat tiếp.
   *
   * `cwd` phải là cwd của chính phiên đó (renderer lấy từ `thread/list`): agent làm việc trong
   * thư mục nào thì mở lại phải đúng thư mục ấy, không thì nó "tiếp tục" một cuộc trò chuyện về
   * dự án A trong khi đang đứng ở dự án B.
   */
  ipcMain.handle(
    IPC.CODEX_RESUME,
    (event: IpcMainInvokeEvent, threadId: unknown, cwd: unknown): Promise<CodexStartResultDto> => {
      if (typeof threadId !== 'string' || threadId === '') {
        return Promise.resolve({ ok: false, error: 'thieu threadId' })
      }
      return openSession(event, typeof cwd === 'string' ? cwd : '', threadId)
    },
  )

  ipcMain.handle(IPC.CODEX_SESSION_STOP, (_e, id: string): void => {
    dispose(id, { code: null })
  })

  /** Snapshot để renderer dựng lại UI sau reload — một phát, không phát lại history. */
  ipcMain.handle(IPC.CODEX_SNAPSHOT, (event: IpcMainInvokeEvent, id: string): CodexSnapshotDto | null => {
    const s = sessions.get(id)
    if (!s) return null
    // Renderer quay lại: nhận lại quyền sở hữu và huỷ hẹn dọn.
    s.owner = event.sender
    if (s.orphanTimer) {
      clearTimeout(s.orphanTimer)
      s.orphanTimer = null
    }
    event.sender.once('destroyed', () => detachOwner(id))
    return { sessionId: id, state: s.lastState, items: [...s.items.values()] }
  })

  ipcMain.on(IPC.CODEX_TURN_SEND, (_e, id: string, text: string) => {
    const s = sessions.get(id)
    if (!s || typeof text !== 'string' || text.trim() === '') return
    void s.proc.startTurn(text).catch((error: unknown) => {
      // `turn-error`, KHÔNG phải `closed`: lượt lỗi (chưa đăng nhập, hết quota, mất mạng, params
      // sai) **không** làm tiến trình chết — user thử lại được ngay. Dùng `closed` ở đây là bảo
      // renderer đóng phiên, và nó về màn hình bắt đầu mang theo cả lý do lỗi.
      const msg = error instanceof Error ? error.message : String(error)
      console.log(`[codex] turn failed: ${msg}`)
      post(id, { sessionId: id, kind: 'turn-error', error: msg, issue: classifyModelError(msg) ?? undefined })
    })
  })

  ipcMain.on(IPC.CODEX_TURN_CANCEL, (_e, id: string) => {
    const s = sessions.get(id)
    if (!s) return
    void s.proc.cancelTurn()
  })
}

/** Có phiên nào đang chạy một lượt? Dùng cho hộp xác nhận lúc thoát app. */
export function codexHasRunningTurn(): boolean {
  for (const s of sessions.values()) {
    if (s.lastState.phase === 'running' || s.lastState.phase === 'awaiting-approval') return true
  }
  return false
}

/** Dừng mọi phiên Codex — gọi lúc thoát app. */
export function disposeCodexSessions(): void {
  for (const id of [...sessions.keys()]) dispose(id)
  // Cả tiến trình đang giữ luồng đăng nhập: nó cũng là một `codex.exe` sống.
  endLogin()
}
