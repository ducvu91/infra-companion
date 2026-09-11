import { create } from 'zustand'
import {
  CODEX_SETTINGS_DEFAULT,
  reduceCodexEvent,
  type CodexEventDto,
  type CodexItemDto,
  type CodexLoginEventDto,
  type CodexLoginKindDto,
  type CodexModelDto,
  type CodexProfileDto,
  type CodexReadinessDto,
  type CodexSessionStateDto,
  type CodexSettingsDto,
  type CodexThreadSummaryDto,
} from '@infra/shared'

/**
 * State của panel Codex ở renderer — **bản CHIẾU**, không phải nguồn sự thật.
 *
 * Nguồn thật ở main: phiên sống ở đó nên nó vẫn chạy khi renderer reload (giết một agent đang
 * chạy 20 phút vì user lỡ Ctrl+R là mất việc thật). Sau reload, `attach()` gọi
 * `codex.snapshot()` để lấy lại toàn bộ một phát rồi tiếp tục nhận stream — không phát lại
 * history.
 *
 * `sessionId` giữ ở **module scope** ngoài store để `subscribe()` không phải đăng ký lại mỗi
 * lần state đổi.
 */

const EMPTY_STATE: CodexSessionStateDto = {
  phase: 'idle',
  threadId: null,
  turnId: null,
  error: null,
  cwd: '',
  mcpServers: [],
}

interface CodexStore {
  readiness: CodexReadinessDto | null
  settings: CodexSettingsDto
  /** `null` = chưa mở phiên nào. */
  sessionId: string | null
  state: CodexSessionStateDto
  items: readonly CodexItemDto[]
  /** stderr của chính Codex — hiện trong khối "chi tiết", không lẫn vào hội thoại. */
  log: readonly string[]
  /** Đang gọi start/stop — để nút không bấm được hai lần. */
  busy: boolean
  /** Lỗi của lần start gần nhất (không phải lỗi trong phiên — cái đó ở `state.error`). */
  startError: string | null

  // ── Tài khoản ──────────────────────────────────────────────────────────────
  /** Đang chờ user bấm xong trong browser. */
  loggingIn: boolean
  /** Mã thiết bị / URL cần hiện khi Codex không tự mở được browser. */
  loginHint: { authUrl?: string; userCode?: string } | null
  loginError: string | null
  profiles: readonly CodexProfileDto[]

  refreshStatus: () => Promise<void>
  probe: () => Promise<void>
  loadSettings: () => Promise<void>
  saveSettings: (patch: Partial<CodexSettingsDto>) => Promise<void>
  pickBinary: () => Promise<void>
  /** Đang tải/cập nhật CLI. */
  installing: boolean
  /** Output npm trong lúc cài — hiện để user biết nó đang làm gì, không đứng im. */
  installLog: readonly string[]
  installError: string | null
  /** Version vừa cài xong — để UI nói "đã cập nhật" thay vì để user tự đọc dòng log. */
  installedVersion: string | null
  installCli: () => Promise<void>
  pickCwd: () => Promise<string | null>
  /** `keepItems` = giữ nhật ký lượt trước (dùng khi mở lại phiên sau cập nhật CLI). */
  start: (cwd: string, keepItems?: boolean) => Promise<boolean>
  stop: () => Promise<void>
  send: (text: string) => void
  cancel: () => void
  /** Nối lại vào phiên còn sống sau khi renderer mount lại. */
  attach: (sessionId: string) => Promise<void>
  /** Tự nối lại phiên đã nhớ (localStorage) — gọi lúc panel mở. */
  restore: () => Promise<void>

  // Model + mức suy luận (hiện trong khung chat, như Codex app)
  models: readonly CodexModelDto[]
  chosenModel: string | null
  chosenEffort: string | null
  loadModels: () => Promise<void>
  chooseModel: (model: string, effort?: string) => Promise<void>

  // Phiên cũ
  threads: readonly CodexThreadSummaryDto[]
  loadingThreads: boolean
  loadThreads: () => Promise<void>
  resumeThread: (t: CodexThreadSummaryDto) => Promise<boolean>
  applyEvent: (e: CodexEventDto) => void

  login: (kind: CodexLoginKindDto) => Promise<void>
  cancelLogin: () => Promise<void>
  logout: () => Promise<void>
  applyLoginEvent: (e: CodexLoginEventDto) => void
  loadProfiles: () => Promise<void>
  addProfile: (name: string) => Promise<string | null>
  removeProfile: (name: string) => Promise<void>
  useProfile: (name: string) => Promise<void>
}

/** Trần dòng log giữ ở renderer — stderr của Codex có thể rất dài. */
const LOG_CAP = 500

/**
 * `sessionId` của phiên đang mở, nhớ qua localStorage.
 *
 * Cần vì phiên sống ở MAIN: sau khi renderer reload (Ctrl+R, hoặc đóng rồi mở lại tab Codex),
 * state của store mất nhưng `codex.exe` vẫn đang chạy dở một lượt. Không nhớ id thì UI hiện màn
 * hình "Bắt đầu phiên" trong khi một phiên đang chạy — và phiên đó chỉ bị dọn sau TTL 5 phút,
 * tức user không có cách nào quay lại việc của mình.
 */
const SESSION_KEY = 'infra.codex.sessionId'

function rememberSession(id: string | null): void {
  try {
    if (id) localStorage.setItem(SESSION_KEY, id)
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    /* localStorage lỗi — chỉ mất khả năng nối lại sau reload */
  }
}

function rememberedSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

export const useCodexStore = create<CodexStore>((set, get) => ({
  readiness: null,
  settings: CODEX_SETTINGS_DEFAULT,
  sessionId: null,
  state: EMPTY_STATE,
  items: [],
  log: [],
  busy: false,
  startError: null,
  loggingIn: false,
  loginHint: null,
  loginError: null,
  profiles: [],

  refreshStatus: async () => {
    set({ readiness: await window.infra.codex.status() })
  },

  probe: async () => {
    set({ busy: true })
    try {
      set({ readiness: await window.infra.codex.probe() })
    } finally {
      set({ busy: false })
    }
  },

  loadSettings: async () => {
    set({ settings: await window.infra.codex.getSettings() })
  },

  saveSettings: async (patch) => {
    const next = await window.infra.codex.setSettings({ ...get().settings, ...patch })
    set({ settings: next })
  },

  pickBinary: async () => {
    const picked = await window.infra.codex.pickBinary()
    if (!picked) return
    // Đổi binary thì trạng thái cũ vô nghĩa — dò lại ngay để user thấy kết quả của việc mình vừa làm.
    await get().loadSettings()
    await get().refreshStatus()
  },

  installing: false,
  installLog: [],
  installError: null,
  installedVersion: null,

  installCli: async () => {
    set({ installing: true, installError: null, installLog: [], installedVersion: null })
    try {
      const res = await window.infra.codex.installCli()
      if (!res.ok) {
        set({ installError: res.error })
        return
      }
      // Giữ version để UI nói "đã cập nhật xong" bằng một câu, không phải một dòng log.
      set({ installedVersion: res.version ?? null })
      // Cài xong thì dò lại ngay: bản mới phải được dùng liền, không bắt user bấm thêm.
      await get().refreshStatus()

      /**
       * Phiên đang chạy phải MỞ LẠI, không chỉ xoá lỗi.
       *
       * Hai lý do, cái thứ hai mới là cái quan trọng:
       *
       * 1. Câu lỗi cũ ("cần bản Codex mới hơn") nằm cạnh dòng `version: 0.154.0` làm user đọc ra
       *    là *cập nhật thất bại* — đúng ngược sự thật. Đã gặp thật.
       * 2. **Tiến trình đang chạy vẫn là binary CŨ.** Cập nhật file trên đĩa không đổi tiến
       *    trình đã spawn, nên chỉ xoá lỗi rồi để user gửi lại là họ gặp **đúng lỗi đó lần
       *    nữa** — và lần này còn khó hiểu hơn vì "vừa cập nhật xong mà".
       *
       * Chỉ làm khi lỗi thuộc loại **cập nhật giải quyết được** (`issue` có giá trị): lỗi khác
       * (mất mạng, hết quota) thì đóng phiên của user là mất việc vô ích.
       */
      const s = get().state
      const cwd = s.cwd
      if (s.issue && get().sessionId !== null) {
        await get().stop()
        // `keepItems: true` — giữ nhật ký lượt trước, user chỉ yêu cầu cập nhật chứ không
        // yêu cầu xoá việc đã làm.
        if (cwd !== '') await get().start(cwd, true)
      }
    } catch (error) {
      set({ installError: error instanceof Error ? error.message : String(error) })
    } finally {
      set({ installing: false })
    }
  },

  pickCwd: async () => window.infra.codex.pickCwd(),

  start: async (cwd, keepItems = false) => {
    set({ busy: true, startError: null })
    try {
      const res = await window.infra.codex.start(cwd)
      if (!res.ok) {
        set({ startError: res.error })
        return false
      }
      rememberSession(res.sessionId)
      // `keepItems` cho ca mở lại phiên sau khi cập nhật CLI: những gì đã chạy vẫn đáng đọc,
      // xoá đi là mất việc mà user không yêu cầu. Phiên mới hoàn toàn thì bắt đầu từ trắng.
      set({
        sessionId: res.sessionId,
        state: res.state,
        items: keepItems ? get().items : [],
        log: keepItems ? get().log : [],
      })
      // Áp lại model user đã chọn ở lần trước — lựa chọn đó nằm trong store (renderer), còn
      // tiến trình thì vừa mới sinh nên nó chưa biết gì.
      const { chosenModel, chosenEffort } = get()
      if (chosenModel) {
        await window.infra.codex.setModel(res.sessionId, chosenModel, chosenEffort ?? undefined)
      }
      void get().loadModels()
      // cwd vừa dùng được lưu ở main → nạp lại để danh sách "gần đây" đúng ngay.
      await get().loadSettings()
      return true
    } catch (error) {
      set({ startError: error instanceof Error ? error.message : String(error) })
      return false
    } finally {
      set({ busy: false })
    }
  },

  stop: async () => {
    const id = get().sessionId
    if (!id) return
    set({ busy: true })
    try {
      await window.infra.codex.stop(id)
    } finally {
      rememberSession(null)
      set({ busy: false, sessionId: null, state: EMPTY_STATE })
    }
  },

  send: (text) => {
    const id = get().sessionId
    if (!id || text.trim() === '') return
    window.infra.codex.send(id, text)
    // KHÔNG tự đặt phase='running': main mới biết lượt có bắt đầu được hay không (chưa đăng nhập
    // thì nó thất bại ngay). Đặt lạc quan là hiện spinner cho một việc không chạy.
    //
    // NHƯNG phải xoá lỗi của lượt TRƯỚC: để nguyên thì gửi lại xong vẫn thấy câu lỗi cũ đỏ trên
    // màn hình, và không biết nó là của lần này hay lần trước.
    const s = get().state
    if (s.error !== null || s.phase === 'failed') {
      set({ state: { ...s, error: null, phase: 'idle' } })
    }
  },

  cancel: () => {
    const id = get().sessionId
    if (id) window.infra.codex.cancel(id)
  },

  attach: async (sessionId) => {
    const snap = await window.infra.codex.snapshot(sessionId)
    if (!snap) {
      // Phiên đã hết (bị dọn vì quá TTL, hoặc tiến trình đã thoát) — quên nó đi thay vì hiện
      // một panel trông như đang chạy.
      rememberSession(null)
      set({ sessionId: null, state: EMPTY_STATE, items: [] })
      return
    }
    rememberSession(snap.sessionId)
    set({ sessionId: snap.sessionId, state: snap.state, items: snap.items })
  },

  /**
   * Nối lại phiên còn sống sau khi renderer mount lại. Gọi một lần lúc panel mở.
   *
   * Không có id đã nhớ = chưa từng mở phiên → không làm gì (đừng gọi IPC vô ích).
   */
  restore: async () => {
    if (get().sessionId !== null) return
    const id = rememberedSession()
    if (!id) return
    await get().attach(id)
  },

  // ── Model + mức suy luận ──────────────────────────────────────────────────
  models: [],
  chosenModel: null,
  chosenEffort: null,

  loadModels: async () => {
    // Truyền sessionId để main dùng lại tiến trình đang mở (rẻ hơn spawn một cái mới).
    const models = await window.infra.codex.models(get().sessionId ?? undefined)
    set({ models })
    // Chưa chọn gì thì lấy model đầu + mức mặc định của nó làm hiển thị ban đầu. Chỉ để user
    // THẤY cái đang dùng — không tự gửi lựa chọn nào xuống main.
    if (!get().chosenModel && models.length > 0) {
      const first = models[0]!
      set({ chosenModel: first.id, chosenEffort: first.defaultEffort ?? null })
    }
  },

  chooseModel: async (model, effort) => {
    set({ chosenModel: model, chosenEffort: effort ?? null })
    const id = get().sessionId
    // Chưa mở phiên thì chỉ nhớ lựa chọn — nó được áp khi phiên mở.
    if (id) await window.infra.codex.setModel(id, model, effort)
  },

  // ── Phiên cũ ──────────────────────────────────────────────────────────────
  threads: [],
  loadingThreads: false,

  loadThreads: async () => {
    set({ loadingThreads: true })
    try {
      // KHÔNG lọc theo cwd: user thường muốn thấy mọi phiên cũ để tìm lại việc, và mỗi dòng đã
      // hiện cwd của nó nên không nhầm được.
      set({ threads: await window.infra.codex.threads() })
    } finally {
      set({ loadingThreads: false })
    }
  },

  resumeThread: async (t) => {
    set({ busy: true, startError: null })
    try {
      // Đóng phiên đang mở trước: một tiến trình mỗi phiên, để lại cái cũ là một `codex.exe`
      // mồ côi.
      if (get().sessionId) await get().stop()
      const res = await window.infra.codex.resume(t.id, t.cwd)
      if (!res.ok) {
        set({ startError: res.error })
        return false
      }
      rememberSession(res.sessionId)
      // `items` rỗng: hội thoại cũ nằm trong transcript của Codex — agent VẪN NHỚ nó (đó là ý
      // nghĩa của resume) nhưng UI chưa dựng lại được. Panel nói rõ điều đó thay vì để user
      // tưởng phiên trống.
      set({ sessionId: res.sessionId, state: res.state, items: [], log: [] })
      void get().loadModels()
      return true
    } finally {
      set({ busy: false })
    }
  },

  applyEvent: (e) => {
    const cur = get().sessionId
    // Event của phiên khác (phiên cũ vừa đóng) — bỏ, không ghi đè phiên đang xem.
    if (!cur || e.sessionId !== cur) return

    if (e.kind === 'log') {
      const log = [...get().log, ...e.lines]
      set({ log: log.length > LOG_CAP ? log.slice(log.length - LOG_CAP) : log })
      return
    }

    const next = reduceCodexEvent({ state: get().state, items: get().items }, e)
    set({ state: next.state, items: next.items })

    if (e.kind === 'closed') {
      // Tiến trình đã thoát: phiên không còn dùng được, nhưng GIỮ items để user đọc lại những gì
      // đã chạy (và đọc được lý do chết). Quên id để lần mở sau không đi nối vào một phiên chết.
      rememberSession(null)
      set({ sessionId: null })
    }
  },

  // ── Tài khoản ──────────────────────────────────────────────────────────────

  login: async (kind) => {
    set({ loggingIn: true, loginError: null, loginHint: null })
    const res = await window.infra.codex.loginStart(kind)
    if (!res.ok) {
      set({ loggingIn: false, loginError: res.error })
      return
    }
    // Giữ `loggingIn` — luồng chưa xong, kết quả về qua `applyLoginEvent`. `authUrl`/`userCode`
    // chỉ có khi Codex không tự mở được browser, hoặc khi dùng mã thiết bị.
    if (res.authUrl || res.userCode) set({ loginHint: { authUrl: res.authUrl, userCode: res.userCode } })
  },

  cancelLogin: async () => {
    await window.infra.codex.loginCancel()
    set({ loggingIn: false, loginHint: null, loginError: null })
  },

  logout: async () => {
    set({ busy: true, loginError: null })
    try {
      const r = await window.infra.codex.logout()
      if (!r.ok) set({ loginError: r.error ?? null })
      await get().refreshStatus()
    } finally {
      set({ busy: false })
    }
  },

  applyLoginEvent: (e) => {
    if (e.kind === 'account-changed') {
      void get().refreshStatus()
      return
    }
    set({ loggingIn: false, loginHint: null, loginError: e.ok ? null : (e.error ?? 'dang nhap that bai') })
    // Login xong (kể cả thất bại) thì trạng thái phải nạp lại: thành công là có tài khoản mới,
    // thất bại cũng cần thấy lại trạng thái thật thay vì đứng ở spinner.
    void get().refreshStatus()
  },

  loadProfiles: async () => {
    set({ profiles: await window.infra.codex.profiles() })
  },

  addProfile: async (name) => {
    const r = await window.infra.codex.profileAdd(name)
    if (!r.ok) return r.error ?? 'khong them duoc'
    await get().loadProfiles()
    await get().loadSettings()
    return null
  },

  removeProfile: async (name) => {
    await window.infra.codex.profileRemove(name)
    await get().loadProfiles()
    await get().loadSettings()
    await get().refreshStatus()
  },

  useProfile: async (name) => {
    set({ busy: true })
    try {
      await window.infra.codex.profileUse(name)
      await get().loadSettings()
      // Đổi profile = đổi tài khoản → trạng thái cũ vô nghĩa, phải dò lại ngay.
      await get().refreshStatus()
    } finally {
      set({ busy: false })
    }
  },
}))

/**
 * Đăng ký nhận event — gọi MỘT lần lúc app khởi động.
 *
 * Ở đây chứ không trong component: panel Codex có thể chưa mount (tab chưa mở) trong khi phiên
 * vẫn đang chạy, mà bỏ event trong lúc đó là state ở renderer lệch hẳn khỏi main.
 */
export function subscribeCodexEvents(): () => void {
  const offEvent = window.infra.codex.onEvent((e) => useCodexStore.getState().applyEvent(e))
  // Kênh login RIÊNG: nó xảy ra ngoài phiên (chưa có sessionId nào) nên không nhồi vào
  // `CodexEventDto` được — xem chú thích ở `CodexLoginEventDto`.
  const offLogin = window.infra.codex.onLoginEvent((e) => useCodexStore.getState().applyLoginEvent(e))
  // Output npm lúc cài CLI — tải mất chục giây, không hiện gì thì UI trông như treo.
  const offInstall = window.infra.codex.onInstallLine((line) => {
    const log = [...useCodexStore.getState().installLog, line]
    useCodexStore.setState({ installLog: log.length > 200 ? log.slice(log.length - 200) : log })
  })
  return () => {
    offEvent()
    offLogin()
    offInstall()
  }
}
