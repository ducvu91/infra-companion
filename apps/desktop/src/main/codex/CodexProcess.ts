import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import {
  INITIALIZE_TIMEOUT_MS,
  RpcPeer,
  buildInitializeParams,
  buildLoginParams,
  buildSpawnArgv,
  codexEnv,
  initialThreadState,
  parseAccount,
  parseLoginCompleted,
  parseModelList,
  parseRateLimit,
  reduceThreadEvent,
  validateInitializeResult,
  type CodexAccount,
  type CodexLoginKind,
  type CodexModel,
  type CodexRateLimit,
  type CodexThreadState,
  type InitializeInfo,
  type ServerRequest,
} from '@infra/core'

/**
 * Một tiến trình `codex app-server` + phiên JSON-RPC của nó.
 *
 * **Vì sao KHÔNG dùng `ProcessSupervisor`** dù nó có đủ 5 lớp chống orphan và `SpawnFn` inject:
 *
 * 1. `SpawnOptions.stdio` của nó ràng buộc cứng `['ignore','pipe','pipe']` — **không có stdin**,
 *    mà app-server nói chuyện qua stdin. Nới ràng buộc đó là đụng invariant của module rủi ro
 *    cao nhất repo (nó quản nginx/mariadb của user).
 * 2. Nó **auto-restart theo backoff** khi tiến trình chết. Với agent hội thoại thì restart là
 *    sai hoàn toàn: thread cũ mất, user không biết, và một turn đang chờ duyệt biến thành treo
 *    im lặng. Ở đây chết = phiên chết, UI hiện lý do + nút bắt đầu lại.
 * 3. `reconcile()` của nó diệt theo đường dẫn exe **trong `paths.runtimes`**; Codex nằm ngoài
 *    thư mục đó, mà cho vào thì có ngày diệt oan `codex.exe` user đang chạy tay ở terminal khác.
 *
 * Nên viết riêng, nhưng **mượn nguyên các bài học**: `shell:false`, env allowlist, giữ stderr
 * cuối để nói được lý do chết, và không bao giờ "nhận nuôi" tiến trình lạ.
 */

/** Số dòng stderr giữ lại để câu báo lỗi nói được nguyên nhân thật (khuôn `stderrTail`). */
const STDERR_TAIL = 20

export interface CodexProcessOptions {
  readonly binary: string
  readonly cwd: string
  readonly appVersion: string
  readonly platform: NodeJS.Platform
  /**
   * `CODEX_HOME` cho tiến trình này — nơi Codex đọc/ghi `auth.json` và `config.toml`.
   *
   * Bỏ trống = dùng mặc định của hệ thống (`~/.codex`), tức **cùng tài khoản** với `codex` user
   * chạy tay ở terminal. Đặt giá trị = một **profile riêng**: đăng nhập độc lập, và cũng là cách
   * duy nhất cô lập khỏi MCP server trong `config.toml` của user (xem R7).
   */
  readonly codexHome?: string
  /** Ghi thêm vào env sau bộ lọc — GĐ4 dùng cho token MCP bridge. */
  readonly extraEnv?: Readonly<Record<string, string>>
  /** Tắt bớt notification cao tần. `undefined` = mặc định (tắt reasoning chi tiết). */
  readonly optOut?: readonly string[]
  /** `-c key=value` truyền cho Codex — GĐ4 dùng để khai MCP server mà KHÔNG ghi config.toml. */
  readonly configOverrides?: readonly string[]
}

export interface CodexProcessEvents {
  /** State đã gộp đổi. */
  readonly onState: (state: CodexThreadState) => void
  /** stderr của chính Codex (không phải output của agent). */
  readonly onLog: (lines: string[]) => void
  /** App-server hỏi ngược: xin duyệt lệnh / duyệt patch. */
  readonly onApproval: (req: ServerRequest) => Promise<unknown>
  /** Tiến trình đã thoát. `error` là câu nói được nguyên nhân, nếu có. */
  readonly onExit: (code: number | null, error?: string) => void
  readonly onWarning: (msg: string) => void
  /**
   * Đăng nhập xong (thành công hay thất bại) — notification `account/login/completed`.
   *
   * Có riêng callback vì login là việc **user vừa bấm nút và mở cả browser**: kết quả phải về
   * đúng chỗ đang chờ, không lẫn vào state của thread.
   */
  readonly onLoginCompleted?: (r: { ok: boolean; error?: string }) => void
  /** `account/updated` — tài khoản/gói vừa đổi (sau login hoặc logout). */
  readonly onAccountChanged?: () => void
}

/**
 * Tìm khoá `model` trong kết quả `config/read`.
 *
 * Duyệt cây thay vì tra một đường dẫn cố định: shape của config đổi theo bản, và `model` có thể
 * nằm ở gốc hoặc lồng trong một nhóm. Lấy giá trị **đầu tiên** tìm được ở độ sâu nhỏ nhất —
 * khoá ở gốc là cái đang có hiệu lực.
 */
function findConfiguredModel(cfg: unknown): string | undefined {
  const queue: unknown[] = [cfg]
  let depth = 0
  while (queue.length > 0 && depth < 6) {
    const next: unknown[] = []
    for (const node of queue) {
      if (typeof node !== 'object' || node === null || Array.isArray(node)) continue
      const r = node as Record<string, unknown>
      const v = r['model']
      if (typeof v === 'string' && v !== '') return v
      for (const child of Object.values(r)) next.push(child)
    }
    queue.length = 0
    queue.push(...next)
    depth++
  }
  return undefined
}

export class CodexProcess {
  private child: ChildProcessWithoutNullStreams | null = null
  private peer: RpcPeer | null = null
  private state: CodexThreadState = initialThreadState()
  private readonly stderrTail: string[] = []
  /** Model trong `config.toml` và danh sách CLI báo — chỉ để chẩn đoán, xem `readModelInfo`. */
  private configuredModel: string | undefined
  private availableModels: CodexModel[] = []
  /** Model + mức suy luận USER chọn trong panel. `null` = dùng của config. */
  private chosen: { model?: string; effort?: string } | null = null
  /** `true` khi chính ta chủ động dừng — để không báo "Codex chết" cho việc user bấm Dừng. */
  private stopping = false
  private info: InitializeInfo | null = null

  constructor(
    private readonly opts: CodexProcessOptions,
    private readonly events: CodexProcessEvents,
  ) {}

  get threadState(): CodexThreadState {
    return this.state
  }

  get initializeInfo(): InitializeInfo | null {
    return this.info
  }

  get pid(): number | undefined {
    return this.child?.pid
  }

  /**
   * Spawn + handshake. Throw khi không lên được, kèm câu nói được nguyên nhân.
   *
   * `initialize` **phải** xong trước mọi request khác — app-server từ chối hết cho tới lúc đó.
   */
  async start(): Promise<void> {
    const { file, args } = buildSpawnArgv(this.opts.binary, ['app-server', ...this.configArgs()], this.opts.platform)

    const child = spawn(file, args, {
      cwd: this.opts.cwd,
      env: codexEnv(process.env, {
        extra: {
          // Profile riêng: đặt CODEX_HOME để Codex đọc/ghi auth ở thư mục của app thay vì
          // ~/.codex. Đặt qua `extra` (áp SAU bộ lọc) nên nó ghi đè cả CODEX_HOME của user.
          ...(this.opts.codexHome ? { CODEX_HOME: this.opts.codexHome } : {}),
          ...this.opts.extraEnv,
        },
      }),
      // `shell:false` giữ nguyên kỷ luật của repo: đường dẫn có dấu cách sẽ phá lệnh nếu qua
      // shell. Shim `.cmd` đã được `buildSpawnArgv` bọc tường minh qua cmd.exe.
      shell: false,
      // KHÔNG detached: tiến trình phải chết cùng app, không sống sót thành orphan.
      detached: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.child = child

    const peer = new RpcPeer({
      send: (line) => {
        // stdin có thể đã đóng khi tiến trình vừa chết — throw để `request()` reject ngay
        // thay vì treo chờ timeout.
        if (!child.stdin.writable) throw new Error('codex app-server stdin closed')
        child.stdin.write(line)
      },
      onServerRequest: (req) => this.events.onApproval(req),
      onNotification: (n) => {
        // Notification về TÀI KHOẢN đi đường riêng, không qua `reduceThreadEvent`: chúng không
        // thuộc trạng thái của thread nào, và kết quả login phải về đúng chỗ đang chờ.
        if (n.method === 'account/login/completed') {
          const r = parseLoginCompleted(n.params)
          this.events.onLoginCompleted?.({ ok: r.ok, error: r.error })
          return
        }
        if (n.method === 'account/updated') {
          this.events.onAccountChanged?.()
          return
        }
        const next = reduceThreadEvent(this.state, n)
        // So sánh tham chiếu: `reduceThreadEvent` trả CHÍNH state khi không hiểu method, nên
        // frame lạ không sinh ra một lượt gửi IPC vô ích.
        if (next !== this.state) {
          this.state = next
          this.events.onState(next)
        }
      },
      onProtocolWarning: (m) => this.events.onWarning(m),
    })
    this.peer = peer

    // stdout: `setEncoding` để chunk luôn là chuỗi UTF-8 hợp lệ — chunk cắt giữa ký tự tiếng
    // Việt sẽ thành dấu hỏi nếu tự `toString()` từng chunk.
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => peer.feed(chunk))

    // stderr là log của Codex, không phải giao thức. Giữ đuôi để nói được lý do chết.
    const errDecoder = new StringDecoder('utf8')
    let errRest = ''
    child.stderr.on('data', (buf: Buffer) => {
      errRest += errDecoder.write(buf)
      const parts = errRest.split('\n')
      errRest = parts.pop() ?? ''
      const lines = parts.map((l) => l.replace(/\r$/, '')).filter((l) => l.trim() !== '')
      if (lines.length === 0) return
      for (const l of lines) {
        this.stderrTail.push(l)
        if (this.stderrTail.length > STDERR_TAIL) this.stderrTail.shift()
      }
      this.events.onLog(lines)
    })

    child.on('error', (err) => {
      // ENOENT ở đây = binary biến mất giữa lúc dò và lúc spawn.
      peer.fail(`khong chay duoc ${this.opts.binary}: ${err.message}`)
      this.events.onExit(null, err.message)
    })

    child.on('exit', (code, signal) => {
      this.child = null
      const why = this.describeExit(code, signal)
      // BẮT BUỘC: đánh thức mọi `await request()` đang chờ. Không có bước này thì UI đứng ở
      // spinner vĩnh viễn và user không biết vì sao (mục 8 CLAUDE.md).
      peer.fail(why)
      this.events.onExit(code, this.stopping ? undefined : why)
    })

    // Handshake. Lỗi ở đây là lỗi khởi động, phải throw để nơi gọi báo được cho user.
    const raw = await peer.request(
      'initialize',
      buildInitializeParams({
        name: 'infra-companion',
        title: 'Infra Companion',
        version: this.opts.appVersion,
        optOutNotificationMethods: this.opts.optOut,
      }),
      INITIALIZE_TIMEOUT_MS,
    )
    const info = validateInitializeResult(raw)
    if (!info) throw new Error('initialize tra ve du lieu khong doc duoc — ban codex nay co the qua cu')
    this.info = info
    peer.notify('initialized', {})
  }

  // ── Tài khoản ───────────────────────────────────────────────────────────────

  /**
   * Đọc tài khoản đang đăng nhập. `null` = chưa đăng nhập.
   *
   * **Không tốn token** (đã kiểm chứng): nó không gọi model. Nhờ vậy app trả lời được câu "đã
   * đăng nhập chưa" mà không phải chạy một turn thật — chỗ mà bản trước phải bỏ ngỏ và hiện
   * "chưa xác minh đăng nhập" cho cả máy đã login.
   */
  async readAccount(): Promise<CodexAccount | null> {
    return parseAccount(await this.request('account/read', {}, 15_000))
  }

  /** Hạn mức gói. `null` khi không đọc được — nơi gọi đừng hiện 0% cho cái mình không biết. */
  async readRateLimit(): Promise<CodexRateLimit | null> {
    try {
      return parseRateLimit(await this.request('account/rateLimits/read', {}, 15_000))
    } catch (error) {
      // Hạn mức là thông tin PHỤ: không đọc được thì thiếu một dòng, không được làm hỏng cả
      // luồng đang chạy.
      this.events.onWarning(`account/rateLimits/read: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  /**
   * Bắt đầu đăng nhập. Trả `loginId` (để huỷ được) + `authUrl`/`userCode`.
   *
   * ⚠️ **App-server KHÔNG tự mở browser** — đã kiểm chứng bằng cách gọi thật: nó trả `authUrl`
   * (`https://auth.openai.com/oauth/authorize?…&redirect_uri=http://localhost:1455/auth/callback`)
   * và mong client mở. Nơi gọi phải `shell.openExternal(authUrl)`, không thì UI đứng ở "đang chờ
   * ở trình duyệt" mà không có trình duyệt nào mở — đúng bug user đã gặp.
   *
   * Tên field khác nhau giữa hai kiểu (cũng đã kiểm chứng):
   * - `chatgpt` → `authUrl`
   * - `chatgptDeviceCode` → `verificationUrl` + `userCode`
   *
   * Kết quả về **không đồng bộ** qua notification `account/login/completed` →
   * `onLoginCompleted`, nên hàm này resolve NGAY sau khi luồng khởi động, không đợi user bấm
   * xong trong browser (họ có thể mất vài phút, hoặc bỏ giữa chừng).
   */
  async startLogin(kind: CodexLoginKind): Promise<{ loginId?: string; authUrl?: string; userCode?: string }> {
    const raw = await this.request<Record<string, unknown>>('account/login/start', buildLoginParams(kind), 30_000)
    const r = typeof raw === 'object' && raw !== null ? raw : {}
    const pick = (k: string): string | undefined => {
      const v = (r as Record<string, unknown>)[k]
      return typeof v === 'string' && v !== '' ? v : undefined
    }
    return {
      loginId: pick('loginId'),
      // Tên field có thể khác giữa các bản — thử vài tên thay vì tin đúng một.
      authUrl: pick('authUrl') ?? pick('url') ?? pick('verificationUri') ?? pick('verificationUrl'),
      userCode: pick('userCode') ?? pick('code'),
    }
  }

  async cancelLogin(loginId: string): Promise<void> {
    await this.request('account/login/cancel', { loginId }, 10_000)
  }

  /** Đăng xuất — xoá credential trong `CODEX_HOME` của phiên này. */
  async logout(): Promise<void> {
    await this.request('account/logout', null, 15_000)
  }

  // ── Model ───────────────────────────────────────────────────────────────────

  /**
   * Đọc model đang cấu hình + danh sách CLI báo — **chỉ để chẩn đoán**, không ghi đè.
   *
   * ⚠️ Bản đầu tôi dùng `model/list` để tự đổi model khi config trỏ một model CLI không hỗ trợ.
   * Đo thật thì hoá ra **sai chẩn đoán**: `model/list` báo `gpt-5.5` dùng được, nhưng gọi thật
   * ra **404 "does not exist or you do not have access"**. Tức việc ghi đè chỉ đổi một lỗi 400
   * thành một lỗi 404, và còn che mất nguyên nhân thật là **CLI quá cũ**.
   *
   * Nên giờ chỉ nhớ hai giá trị để câu thông báo lúc lỗi nói được việc cần làm. Không đổi gì của
   * user.
   */
  async readModelInfo(): Promise<void> {
    try {
      this.availableModels = parseModelList(await this.request('model/list', { includeHidden: false }, 15_000))
    } catch (error) {
      this.events.onWarning(`model/list: ${error instanceof Error ? error.message : String(error)}`)
    }
    try {
      this.configuredModel = findConfiguredModel(await this.request<unknown>('config/read', {}, 15_000))
    } catch (error) {
      this.events.onWarning(`config/read: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Model trong `config.toml` (để thông báo nêu đúng tên). */
  get configured(): string | undefined {
    return this.configuredModel
  }

  /** Model CLI báo là dùng được — nhớ là **không đáng tin**, xem `readModelInfo`. */
  get models(): readonly CodexModel[] {
    return this.availableModels
  }

  /** Mở thread mới. Trả `threadId`. */
  async startThread(): Promise<string> {
    const res = await this.request<Record<string, unknown>>('thread/start', {})
    return this.adoptThread(res, 'thread/start')
  }

  /**
   * Mở lại một phiên CŨ và chat tiếp (`thread/resume`).
   *
   * Codex tự lưu transcript ra `~/.codex/sessions/**.jsonl`, nên lịch sử đã có sẵn — app chỉ
   * cần liệt kê (`thread/list`) rồi resume. Cố ý **không** lưu bản thứ hai vào vault: hai nguồn
   * sự thật cho cùng một thứ thì sớm muộn lệch nhau, mà bản của Codex mới là bản resume được.
   */
  async resumeThread(threadId: string): Promise<string> {
    const res = await this.request<Record<string, unknown>>('thread/resume', { threadId }, 30_000)
    return this.adoptThread(res, 'thread/resume')
  }

  /** Đọc lại các item của một thread (để dựng lại hội thoại cũ trên UI). */
  async readThread(threadId: string): Promise<unknown> {
    return this.request('thread/read', { threadId, includeTurns: true }, 30_000)
  }

  /** Danh sách model + mức suy luận. Không gọi model nên **không tốn token**. */
  async listModels(): Promise<unknown> {
    return this.request('model/list', { includeHidden: false }, 15_000)
  }

  /** Liệt kê phiên cũ. `cwd` để chỉ lấy phiên của đúng thư mục đang làm. */
  async listThreads(limit: number, cwd?: string): Promise<unknown> {
    return this.request(
      'thread/list',
      { limit, ...(cwd ? { cwd: { paths: [cwd] } } : {}) },
      20_000,
    )
  }

  /** Dùng chung cho `thread/start` và `thread/resume` — cả hai trả `{thread:{id,…}}`. */
  private adoptThread(res: Record<string, unknown> | null, method: string): string {
    const thread = res && typeof res === 'object' ? (res['thread'] as Record<string, unknown> | undefined) : undefined
    const id = typeof thread?.['id'] === 'string' ? (thread['id'] as string) : null
    if (!id) throw new Error(`${method} khong tra ve threadId`)
    this.state = { ...this.state, threadId: id }
    this.events.onState(this.state)
    return id
  }

  /**
   * Gửi một lượt. **KHÔNG timeout**: agent suy nghĩ 30 phút là bình thường, và tự bỏ cuộc giữa
   * lúc model đang chạy là mất việc thật. Người dùng dừng bằng `cancelTurn()`.
   *
   * ⚠️ `threadId` là **BẮT BUỘC** (`TurnStartParams.required = ["input","threadId"]`). Bản đầu
   * chỉ gửi `input` nên mọi lượt fail ngay — và lỗi đó không lộ ra ở typecheck/test vì params là
   * `unknown`. Đọc schema (`codex app-server generate-json-schema`) là cách duy nhất biết chắc.
   */
  async startTurn(text: string): Promise<void> {
    const threadId = this.state.threadId
    if (!threadId) throw new Error('chua co thread — thu bat dau phien lai')
    // `model`/`effort` chỉ gửi khi USER đã chọn trong panel. Không tự đoán hộ — lần đoán đầu
    // (ghi đè theo `model/list`) đã sai và chỉ đổi một lỗi 400 thành một lỗi 404.
    await this.request(
      'turn/start',
      {
        threadId,
        input: [{ type: 'text', text }],
        ...(this.chosen?.model ? { model: this.chosen.model } : {}),
        ...(this.chosen?.effort ? { effort: this.chosen.effort } : {}),
      },
      0,
    )
  }

  /**
   * Model + mức suy luận user chọn trong panel, áp cho các lượt sau.
   *
   * Theo schema, `turn/start.model` và `.effort` **áp cho lượt này và các lượt sau** — nên chỉ
   * cần nhớ ở đây rồi gửi kèm, không phải gọi thêm API nào.
   */
  setModelChoice(model?: string, effort?: string): void {
    this.chosen = { model, effort }
  }

  get modelChoice(): { model?: string; effort?: string } | null {
    return this.chosen
  }

  /**
   * Huỷ lượt đang chạy.
   *
   * Method là **`turn/interrupt`**, không phải `turn/cancel` — `turn/cancel` KHÔNG tồn tại trong
   * giao thức (đã đối chiếu schema; bản đầu tôi đoán sai tên nên nút Dừng im lặng không làm gì).
   * Cần **cả** `threadId` và `turnId`.
   *
   * Thất bại thì báo warning chứ không throw: nơi gọi còn đường dừng cứng là `stop()`.
   */
  async cancelTurn(): Promise<void> {
    const { threadId, turnId } = this.state
    if (!threadId || !turnId) {
      // Không có lượt nào đang chạy — không phải lỗi, chỉ là không có gì để huỷ.
      this.events.onWarning('khong co luot nao dang chay de huy')
      return
    }
    try {
      await this.request('turn/interrupt', { threadId, turnId }, 5_000)
    } catch (error) {
      this.events.onWarning(`turn/interrupt khong duoc: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async request<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T> {
    const peer = this.peer
    if (!peer) throw new Error('phien codex chua khoi dong')
    return peer.request<T>(method, params, timeoutMs)
  }

  /**
   * Dừng: đóng stdin cho app-server thoát sạch, hết `graceMs` thì giết cây tiến trình.
   *
   * **Giết CẢ CÂY** là bắt buộc: Codex spawn tiến trình con (MCP server, và lệnh mà agent chạy).
   * Giết một mình tiến trình cha để lại cả cụm chạy tiếp.
   */
  async stop(graceMs = 3_000): Promise<void> {
    this.stopping = true
    const child = this.child
    if (!child) return

    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
    })

    try {
      child.stdin.end()
    } catch {
      /* stdin đã đóng — đi tiếp tới bước giết */
    }

    const timedOut = await Promise.race([
      exited.then(() => false),
      new Promise<boolean>((r) => setTimeout(() => r(true), graceMs)),
    ])
    if (!timedOut) return

    await this.killTree(child)
  }

  private async killTree(child: ChildProcessWithoutNullStreams): Promise<void> {
    const pid = child.pid
    if (pid === undefined) return
    if (this.opts.platform === 'win32') {
      // `/T` = cả cây con, `/F` = cứng. Cùng cách `WindowsAdapter.killTree` đang làm.
      await new Promise<void>((resolve) => {
        const k = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, shell: false })
        k.on('exit', () => resolve())
        k.on('error', () => resolve())
      })
      return
    }
    try {
      // Âm = giết cả process group.
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        child.kill('SIGKILL')
      } catch {
        /* đã chết */
      }
    }
  }

  /** Câu nói được nguyên nhân chết — dùng cho cả `peer.fail()` và thông báo UI. */
  private describeExit(code: number | null, signal: NodeJS.Signals | null): string {
    const head =
      signal !== null
        ? `codex app-server bi dung boi signal ${signal}`
        : `codex app-server thoat voi code ${code ?? 'null'}`
    const tail = this.stderrTail.length > 0 ? `: ${this.stderrTail.slice(-5).join(' | ')}` : ''
    return head + tail
  }

  private configArgs(): string[] {
    const out: string[] = []
    for (const kv of this.opts.configOverrides ?? []) {
      out.push('-c', kv)
    }
    return out
  }
}
