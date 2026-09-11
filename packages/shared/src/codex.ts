/**
 * DTO cho agent Codex (nhúng `codex app-server` qua JSON-RPC/JSONL).
 *
 * File riêng chứ không nhồi vào `types.ts` (đã ~2600 dòng). Đặt ở `shared` chứ không `core` vì
 * renderer cần các kiểu này mà renderer **KHÔNG** import được `@infra/core` (CLAUDE.md §5).
 *
 * Kèm một bản `reduceCodexEvent` **rút gọn** cho renderer: main dùng `reduceThreadEvent` của
 * `@infra/core` để giữ state thật, renderer chỉ dựng lại bản chiếu từ event nhận được. Hai bản
 * khác nhau về đầu vào (notification thô vs patch đã gộp) nên không phải trùng lặp.
 *
 * **Xác thực**: Codex đọc `~/.codex/auth.json` do chính user tạo bằng `codex login` — app không
 * chạm file đó và không có API key nào ở đây. Vì vậy DTO này **không có** field bí mật nào, khác
 * `AiConfigDto` (có `hasApiKey`).
 */

// ── Trạng thái CLI ────────────────────────────────────────────────────────────

export type CodexReadinessKindDto =
  | 'not-installed'
  | 'found-broken'
  | 'needs-login'
  | 'installed-unverified'
  | 'ready'

export interface CodexReadinessDto {
  readonly kind: CodexReadinessKindDto
  /** Đường dẫn binary đang dùng (mọi kind trừ `not-installed`). */
  readonly path?: string
  readonly version?: string
  /** Thư mục config Codex — hiện ra để user biết auth lấy từ đâu. */
  readonly codexHome?: string
  /** Lý do đọc được khi `found-broken`. */
  readonly detail?: string
  /**
   * Những đường đã tìm khi `not-installed`.
   *
   * Có mặt vì "không tìm thấy codex" trần trụi là loại thông báo bắt user đoán — trên máy dev
   * này Codex **có cài** nhưng không ở PATH, nên câu trả lời đúng phải nói được đã tìm ở đâu.
   */
  readonly searched?: readonly string[]
  /** Tài khoản đang đăng nhập ở profile này. `null` = chưa đăng nhập. */
  readonly account?: CodexAccountDto | null
  /** Hạn mức gói — `undefined` khi không đọc được (đừng hiện 0% cho cái không biết). */
  readonly rateLimit?: CodexRateLimitDto
  /** Profile đang xem (`default` = `~/.codex` của hệ thống). */
  readonly profile?: string
}

// ── Tài khoản ─────────────────────────────────────────────────────────────────

export type CodexAuthModeDto = 'chatgpt' | 'apiKey' | 'unknown'

export interface CodexAccountDto {
  readonly authMode: CodexAuthModeDto
  readonly email?: string
  /** `plus` · `pro` · `go` · `team` … chuỗi thô vì OpenAI thêm gói mới liên tục. */
  readonly planType?: string
}

export interface CodexRateLimitDto {
  readonly usedPercent: number
  readonly resetsInDays?: number
  readonly reached?: boolean
}

/** Kiểu đăng nhập. Cố ý KHÔNG có `apiKey` — tính năng này để dùng GÓI thuê bao. */
export type CodexLoginKindDto = 'chatgpt' | 'deviceCode'

export type CodexLoginStartResultDto =
  | {
      readonly ok: true
      readonly loginId?: string
      /** Có khi Codex không tự mở được browser, hoặc khi dùng mã thiết bị. */
      readonly authUrl?: string
      readonly userCode?: string
    }
  | { readonly ok: false; readonly error: string }

/**
 * Profile = một `CODEX_HOME` riêng.
 *
 * Codex giữ **đúng một** tài khoản mỗi `CODEX_HOME`, nên muốn nhiều tài khoản song song thì phải
 * nhiều thư mục. Hai loại, đánh đổi khác nhau rõ rệt:
 *
 * - **`default`** → `~/.codex` của hệ thống: dùng chung tài khoản với `codex` chạy tay ở terminal,
 *   **và** thấy MCP server trong `config.toml` của user.
 * - **Profile riêng** → thư mục trong userData: đăng nhập độc lập, **không** thấy `config.toml`
 *   kia — nên nó cũng là cách duy nhất cô lập khỏi MCP server của user.
 */
export interface CodexProfileDto {
  /** `default` hoặc tên user đặt. */
  readonly name: string
  /** `true` cho `default` — dùng `~/.codex`, không phải thư mục của app. */
  readonly isSystem: boolean
  /** Đã đăng nhập chưa (đọc lúc liệt kê). `undefined` = chưa kiểm. */
  readonly account?: CodexAccountDto | null
}

// ── Cấu hình (ngoài vault, ở userData/codex-settings.json) ───────────────────

/**
 * Mức duyệt lệnh.
 *
 * Mặc định là mức CHẶT NHẤT. `auto` để Codex tự quyết (`ApprovalsReviewer`) — nhanh hơn nhiều
 * nhưng phải có cảnh báo tường minh trên UI, vì lúc đó không ai xem trước lệnh nào chạy.
 */
export type CodexApprovalPolicyDto = 'ask-everything' | 'ask-writes' | 'auto'

export interface CodexSettingsDto {
  /** Đường dẫn binary user chọn tay — rỗng = để app tự dò. */
  readonly binaryPath: string
  readonly approvalPolicy: CodexApprovalPolicyDto
  /** Thư mục làm việc gần đây (mới nhất trước) để chọn lại nhanh. */
  readonly recentCwds: readonly string[]
  /** Hiện cả dòng suy luận chi tiết. Tắt mặc định: nó rất dài và là nguồn IPC nặng nhất. */
  readonly showReasoning: boolean
  /**
   * Profile đang dùng. `default` = `~/.codex` của hệ thống.
   *
   * Mặc định là `default` có chủ ý: đa số người chỉ có một tài khoản, và dùng `~/.codex` nghĩa là
   * họ đã `codex login` ở terminal thì app dùng được ngay, không phải đăng nhập lần hai.
   */
  readonly activeProfile: string
  /** Tên các profile riêng user đã tạo (không gồm `default`). */
  readonly profiles: readonly string[]
}

export const CODEX_SETTINGS_DEFAULT: CodexSettingsDto = {
  binaryPath: '',
  approvalPolicy: 'ask-everything',
  recentCwds: [],
  showReasoning: false,
  activeProfile: 'default',
  profiles: [],
}

export const CODEX_RECENT_CWD_CAP = 8

// ── Phiên & item ──────────────────────────────────────────────────────────────

export type CodexPhaseDto = 'idle' | 'running' | 'awaiting-approval' | 'done' | 'failed'
/** `userMessage` = câu user vừa gõ (app-server phát lại) — UI lọc bỏ, xem `CodexPanel`. */
export type CodexItemKindDto = 'agentMessage' | 'reasoning' | 'command' | 'patch' | 'userMessage' | 'other'

export interface CodexItemDto {
  readonly id: string
  readonly kind: CodexItemKindDto
  readonly text: string
  readonly done: boolean
}

export interface CodexMcpServerDto {
  readonly name: string
  readonly status: string
  readonly error: string | null
}

/**
 * Vấn đề đã nhận diện được từ câu lỗi — mỗi loại cần một **hành động khác nhau**, nên UI phải
 * phân biệt thay vì dán nguyên JSON của server.
 *
 * Đo thật trên codex-cli 0.142.4 + gói `go`: **không model nào chạy được** (config `gpt-5.6-terra`
 * → 400 "cần Codex mới hơn"; `gpt-5.5` mà `model/list` báo dùng được → 404 "does not exist";
 * `gpt-5.6`/`*-codex` → 400 "không hỗ trợ với tài khoản ChatGPT"). Cả ba đều dẫn về **một việc**:
 * nâng cấp Codex CLI. Nhưng câu chữ phải khác nhau để user tin là app hiểu tình huống của mình.
 */
export type CodexIssueDto = 'outdated-cli' | 'model-gone' | 'not-for-chatgpt'

export interface CodexSessionStateDto {
  readonly phase: CodexPhaseDto
  readonly threadId: string | null
  readonly turnId: string | null
  readonly error: string | null
  /** Vấn đề nhận diện được từ `error` — UI dùng để hiện việc cần làm thay vì chỉ dán câu lỗi. */
  readonly issue?: CodexIssueDto
  /** Thư mục làm việc đã chốt lúc mở phiên — không đổi được giữa phiên. */
  readonly cwd: string
  /**
   * MCP server đang có trong thread.
   *
   * Hiện ra UI là **cố ý**: MCP server trong `~/.codex/config.toml` của user **tự nạp** vào mọi
   * thread và không tắt được từ dòng lệnh (đã kiểm chứng) — nghĩa là agent có thêm tool ngoài ý
   * muốn của app. Không cô lập được thì tối thiểu phải cho user THẤY, thay vì im lặng.
   */
  readonly mcpServers: readonly CodexMcpServerDto[]
}

/** Snapshot đầy đủ để renderer dựng lại UI sau khi reload (phiên vẫn sống ở main). */
export interface CodexSnapshotDto {
  readonly sessionId: string
  readonly state: CodexSessionStateDto
  readonly items: readonly CodexItemDto[]
}

// ── Event main → renderer ─────────────────────────────────────────────────────

/**
 * Một item bị thay/thêm. Gửi **cả item** chứ không gửi delta thô: main đã gộp rồi, gửi delta là
 * bắt renderer gộp lại lần hai và mở đường cho hai bên lệch nhau.
 */
export interface CodexItemPatchDto {
  readonly item: CodexItemDto
}

export type CodexEventDto =
  | { readonly sessionId: string; readonly kind: 'state'; readonly state: CodexSessionStateDto }
  | { readonly sessionId: string; readonly kind: 'items'; readonly items: readonly CodexItemPatchDto[] }
  | { readonly sessionId: string; readonly kind: 'log'; readonly lines: readonly string[] }
  /**
   * Một LƯỢT lỗi — phiên **vẫn sống**, user thử lại được.
   *
   * Phải tách khỏi `closed`: dùng `closed` cho lỗi lượt thì renderer đóng phiên và về màn hình
   * bắt đầu, mất cả câu vừa gõ lẫn lý do lỗi. Đó đúng là bug "gửi xong quay về màn hình ban đầu".
   */
  | {
      readonly sessionId: string
      readonly kind: 'turn-error'
      readonly error: string
      /** Loại vấn đề đã nhận diện được — để UI nói việc cần làm, không chỉ dán câu lỗi. */
      readonly issue?: CodexIssueDto
    }
  /** Tiến trình đã thoát — phiên KHÔNG dùng được nữa. */
  | {
      readonly sessionId: string
      readonly kind: 'closed'
      readonly code: number | null
      readonly error?: string
    }

/**
 * Kết quả đăng nhập — kênh RIÊNG, không dùng `CodexEventDto`.
 *
 * Login xảy ra **ngoài phiên làm việc**: user bấm nút ở màn hình bắt đầu, khi chưa có
 * `sessionId` nào. Nhồi nó vào `CodexEventDto` là phải bịa một sessionId giả, rồi renderer lại
 * phải lọc ra — hai chỗ đều sai theo cách khó thấy.
 */
export type CodexLoginEventDto =
  | { readonly kind: 'completed'; readonly ok: true }
  | { readonly kind: 'completed'; readonly ok: false; readonly error?: string }
  /** `account/updated` — tài khoản/gói vừa đổi; renderer nạp lại trạng thái. */
  | { readonly kind: 'account-changed' }

/** Trần item renderer giữ — agent `cat` một file lớn thì item có thể rất nhiều. */
export const CODEX_ITEMS_CAP = 400

// ── Kết quả các lời gọi (never-throw, khuôn LOG_TAIL_START) ──────────────────

export type CodexStartResultDto =
  | { readonly ok: true; readonly sessionId: string; readonly state: CodexSessionStateDto }
  | { readonly ok: false; readonly error: string }

/** Kết quả cài/cập nhật Codex CLI. */
export type CodexInstallResultDto =
  | { readonly ok: true; readonly binary: string; readonly version?: string }
  | { readonly ok: false; readonly error: string }

// ── Bản chiếu ở renderer ─────────────────────────────────────────────────────

export interface CodexViewState {
  readonly state: CodexSessionStateDto
  readonly items: readonly CodexItemDto[]
}

/**
 * Gộp event vào bản chiếu của renderer.
 *
 * Ở `shared` chứ không `core` vì renderer cần nó mà renderer **không import được `@infra/core`**
 * (CLAUDE.md §5 — kéo `ssh2` vào bundle web là vỡ build). Cùng lý do `logView.ts` nằm ở đây.
 *
 * ⚠️ Đánh đổi phải biết: vitest chỉ quét `packages/core/src/**` nên hàm này **không có test tự
 * động**. Đó là lý do nó được giữ đơn giản hết mức — mọi quyết định phức tạp (state machine của
 * turn) nằm ở `core/codex/events.ts` và có test đầy đủ; ở đây chỉ là gộp patch vào danh sách.
 * Một hàm dùng cho cả tool tab lẫn cột dock nên hai chỗ không thể lệch nhau.
 */
export function reduceCodexEvent(prev: CodexViewState, ev: CodexEventDto): CodexViewState {
  if (ev.kind === 'state') return { ...prev, state: ev.state }

  if (ev.kind === 'items') {
    let items = [...prev.items]
    for (const patch of ev.items) {
      const idx = items.findIndex((i) => i.id === patch.item.id)
      if (idx === -1) items.push(patch.item)
      else items[idx] = patch.item
    }
    // Cắt phần ĐẦU khi quá nhiều: phần cuối là việc đang diễn ra.
    if (items.length > CODEX_ITEMS_CAP) items = items.slice(items.length - CODEX_ITEMS_CAP)
    return { ...prev, items }
  }

  if (ev.kind === 'turn-error') {
    // Lượt thất bại: phiên vẫn sống nên chỉ đổi phase + ghi lý do. `sessionId` KHÔNG bị xoá.
    return { ...prev, state: { ...prev.state, phase: 'failed', error: ev.error, issue: ev.issue } }
  }

  if (ev.kind === 'closed') {
    return {
      ...prev,
      state: {
        ...prev.state,
        // `closed` không có lỗi = tiến trình thoát bình thường; giữ phase cũ nếu đã 'done'
        // để không biến một turn xong thành thất bại.
        phase: ev.error || (ev.code !== null && ev.code !== 0) ? 'failed' : prev.state.phase === 'done' ? 'done' : 'idle',
        error: ev.error ?? prev.state.error,
      },
    }
  }

  // 'log' không vào bản chiếu — stderr của Codex là việc của panel log, không phải hội thoại.
  return prev
}

/** Câu mô tả trạng thái CLI, để renderer khỏi tự ghép chuỗi ở nhiều chỗ. */
export function codexReadinessSummary(r: CodexReadinessDto): { readonly ok: boolean; readonly detail: string } {
  switch (r.kind) {
    case 'ready':
      return { ok: true, detail: r.version ?? '' }
    case 'installed-unverified':
      return { ok: true, detail: r.version ?? '' }
    case 'needs-login':
      return { ok: false, detail: r.path ?? '' }
    case 'found-broken':
      return { ok: false, detail: r.detail ?? '' }
    case 'not-installed':
      return { ok: false, detail: (r.searched ?? []).length > 0 ? `${(r.searched ?? []).length}` : '0' }
  }
}

// ── Model & mức suy luận ─────────────────────────────────────────────────────

/**
 * Một model dùng được, kèm các mức suy luận nó hỗ trợ.
 *
 * `reasoningEfforts` lấy từ `model/list` (`low`/`medium`/`high`/`xhigh`/`max` tuỳ model) — đây
 * là thứ Codex app hiện cạnh tên model ("5.6 Terra **High**"), và nó đổi hẳn tốc độ lẫn chất
 * lượng nên phải cho user chọn chứ không chôn trong config.
 */
export interface CodexModelDto {
  readonly id: string
  readonly displayName?: string
  readonly description?: string
  readonly reasoningEfforts: readonly string[]
  readonly defaultEffort?: string
}

/** Model + mức suy luận đang dùng cho phiên. */
export interface CodexModelChoiceDto {
  readonly model: string
  readonly effort?: string
}

// ── Session cũ ───────────────────────────────────────────────────────────────

/**
 * Một phiên trò chuyện cũ (Codex gọi là *thread*), đọc từ `thread/list`.
 *
 * Codex lưu transcript ra `~/.codex/sessions/**.jsonl` nên lịch sử **đã có sẵn** — app chỉ cần
 * liệt kê và `thread/resume`. Cố ý không tự lưu bản thứ hai vào vault: hai nguồn sự thật cho
 * cùng một thứ thì sớm muộn lệch nhau, mà bản của Codex mới là bản `resume` đọc được.
 */
export interface CodexThreadSummaryDto {
  readonly id: string
  /** Dòng đầu của câu hỏi đầu tiên — Codex tự cắt sẵn. */
  readonly preview: string
  /** Thư mục làm việc của phiên đó. */
  readonly cwd: string
  readonly model?: string
  /** Epoch **giây** (Codex trả giây, không phải mili). */
  readonly updatedAt: number
}
