import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, net, shell } from 'electron'
import {
  BLOB_NAME,
  DRIVE_FILES_URL,
  DRIVE_UPLOAD_URL,
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
  buildDriveListByNameUrl,
  buildDriveListContainsUrl,
  buildGoogleAuthUrl,
  buildMultipartUpload,
  emailFromIdToken,
  findNearMissBlobs,
  newOAuthState,
  newPkce,
  parseDriveFileList,
  parseLoopbackCallback,
  parseTokenResponse,
  type SyncBackend
} from '@infra/core'
import type { GdriveLoginResult, GdriveStatusDto } from '@infra/shared'
import { getVault } from '../ipc/vault'

/**
 * Google Drive sync — phần CÓ IO: đăng nhập OAuth (trình duyệt hệ thống + loopback + PKCE),
 * giữ access token, và `DriveBackend` cho SyncService. Phần thuần (dựng URL, parse) nằm ở
 * `@infra/core` và có test riêng.
 *
 * Token: refresh token mã hoá DEK trong meta của vault (khuôn ai_api_key), KHÔNG bao giờ qua
 * IPC — renderer chỉ thấy `{connected, email}`. Blob trên Drive vẫn mã hoá đầu-cuối bằng sync
 * passphrase: đăng nhập Google KHÔNG thay passphrase (xem docs/PLAN-GOOGLE-DRIVE-SYNC.md §1).
 */

/**
 * OAuth client loại "Desktop app". client_id/secret của installed app KHÔNG phải bí mật theo
 * chính tài liệu Google (app phát cho user thì trích ra được) — nằm trong repo public là đúng
 * thiết kế; lớp bảo vệ thật là PKCE + redirect chỉ về loopback trên máy user.
 *
 * Nguồn giá trị theo thứ tự ưu tiên:
 * 1. env `INFRA_GOOGLE_CLIENT_ID` / `INFRA_GOOGLE_CLIENT_SECRET` lúc CHẠY (cùng lệ
 *    INFRA_REGISTRY_URL — để dev thử client khác nhanh);
 * 2. file `.google-oauth.json` ở GỐC REPO — CHỈ bản dev, file đã gitignore: thả NGUYÊN file
 *    JSON tải từ Google Console (Credentials → ⬇ của client) vào là `pnpm dev` chạy được;
 * 3. `__GOOGLE_CLIENT_ID__`/`__GOOGLE_CLIENT_SECRET__` — hằng NHÚNG LÚC BUILD từ env
 *    (electron.vite.config.ts): đường của bản PHÁT HÀNH, CI đặt env từ **GitHub Variables**
 *    `INFRA_GOOGLE_CLIENT_ID`/`INFRA_GOOGLE_CLIENT_SECRET` (release.yml có guard chặn build
 *    thiếu biến) — không có giá trị nào phải dán vào source.
 */

/** Đọc `.google-oauth.json` (chỉ dev). Nhận cả định dạng Google tải về ({installed:{…}}) lẫn phẳng. */
function loadDevOAuthFile(): { id: string; secret: string } | null {
  if (app.isPackaged) return null
  // ⚠️ `pnpm dev` ở gốc chạy script BÊN TRONG apps/desktop (`pnpm --filter @infra/desktop dev`)
  // nên cwd KHÔNG phải gốc repo — file thì nằm ở gốc. Dò cả cwd, gốc repo tính từ cwd, và
  // appPath (tuỳ cách electron-vite spawn); chỗ nào trúng trước dùng chỗ đó.
  const candidates = [
    ...new Set([process.cwd(), join(process.cwd(), '..', '..'), app.getAppPath(), join(app.getAppPath(), '..', '..')])
  ]
  const found = candidates.map((dir) => join(dir, '.google-oauth.json')).find((path) => existsSync(path))
  if (!found) {
    // Nói rõ ĐÃ TÌM Ở ĐÂU — "file có mà app không thấy" nhìn y hệt "chưa cấu hình" (§8)
    console.log(`[gdrive] no .google-oauth.json found (looked in: ${candidates.join(' | ')}) - falling back to env/built-in`)
    return null
  }
  try {
    const raw = JSON.parse(readFileSync(found, 'utf8')) as {
      installed?: { client_id?: unknown; client_secret?: unknown }
      client_id?: unknown
      client_secret?: unknown
    }
    const id = raw.installed?.client_id ?? raw.client_id
    const secret = raw.installed?.client_secret ?? raw.client_secret
    if (typeof id === 'string' && id !== '' && typeof secret === 'string' && secret !== '') {
      console.log(`[gdrive] using OAuth client from ${found} (dev mode)`)
      return { id, secret }
    }
    console.error(`[gdrive] ${found} exists but has no client_id/client_secret`)
    return null
  } catch (error) {
    console.error(`[gdrive] cannot read ${found}:`, error instanceof Error ? error.message : error)
    return null
  }
}
const devOAuth = loadDevOAuthFile()
const GOOGLE_CLIENT_ID = process.env.INFRA_GOOGLE_CLIENT_ID || devOAuth?.id || __GOOGLE_CLIENT_ID__
const GOOGLE_CLIENT_SECRET = process.env.INFRA_GOOGLE_CLIENT_SECRET || devOAuth?.secret || __GOOGLE_CLIENT_SECRET__

const LOGIN_TIMEOUT_MS = 5 * 60_000
const FETCH_TIMEOUT_MS = 15_000
/** Thông điệp khi kết nối Google không còn dùng được — SyncResult hiển thị nguyên văn. */
const AUTH_LOST_MSG = 'Kết nối Google hết hạn hoặc đã bị thu hồi — mở Sync và đăng nhập Google lại.'

/** Access token sống ~1h — giữ trong RAM, hết hạn thì tự refresh. Không ghi ra đĩa. */
let cachedAccess: { token: string; expiresAt: number } | null = null
/** Phiên đăng nhập đang chờ trình duyệt — mở phiên mới thì huỷ phiên cũ để khỏi kẹt cổng. */
let pendingLogin: Server | null = null

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    return await net.fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' })
  } finally {
    clearTimeout(timer)
  }
}

function closePendingLogin(): void {
  if (pendingLogin) {
    pendingLogin.close()
    pendingLogin = null
  }
}

/** Trang trả về trình duyệt sau redirect — phải trả lời để user biết đã xong, không treo tab. */
function loginDonePage(okMessage: boolean): string {
  const text = okMessage
    ? 'Đăng nhập xong — quay lại Infra Companion. Có thể đóng tab này.'
    : 'Đăng nhập không thành công — quay lại Infra Companion để thử lại.'
  return `<!doctype html><meta charset="utf-8"><title>Infra Companion</title><body style="font-family:system-ui;background:#0b0e14;color:#e6e6e6;display:grid;place-items:center;height:100vh;margin:0"><p>${text}</p></body>`
}

export function gdriveStatus(): GdriveStatusDto {
  const vault = getVault()
  // StatusBar hỏi ngay lúc boot — trên máy MỚI mà đụng readMeta là ensureDb() tạo vault.db
  // trước cả màn hình đặt master password (đúng cái bẫy applyAutoTimer đã dính ở v0.2.8)
  if (vault.state() === 'uninitialized') return { connected: false, email: null }
  return { connected: vault.hasGdriveToken(), email: vault.getGdriveEmail() }
}

/**
 * Đăng nhập Google: loopback + PKCE, trình duyệt HỆ THỐNG (Google chặn webview nhúng —
 * `disallowed_useragent`). Lỗi trả dạng MÃ để renderer dịch lúc render.
 */
export async function gdriveLogin(): Promise<GdriveLoginResult> {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return { ok: false, error: 'clientNotConfigured' }
  if (getVault().state() !== 'unlocked') return { ok: false, error: 'vaultLocked' }
  closePendingLogin()

  const { verifier, challenge } = newPkce()
  const state = newOAuthState()

  // 1) Chờ Google redirect về loopback. Cổng ephemeral: bind cổng 0 rồi hỏi lại.
  const outcome = await new Promise<GdriveLoginResult | { code: string; redirectUri: string }>((resolve) => {
    let redirectUri = ''
    const server = createServer((req, res) => {
      const parsed = parseLoopbackCallback(req.url ?? '/', state)
      // Request lạc (favicon…) trả 404 im lặng, KHÔNG kết thúc phiên chờ
      if (!parsed.ok && parsed.error === 'stateMismatch' && !(req.url ?? '').includes('code=')) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(loginDonePage(parsed.ok))
      finish(
        parsed.ok
          ? { code: parsed.code, redirectUri }
          : // 'noCode' = redirect thiếu code — phản hồi sai dạng, gộp về badResponse
            { ok: false, error: parsed.error === 'noCode' ? 'badResponse' : parsed.error }
      )
    })
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), LOGIN_TIMEOUT_MS)
    const finish = (result: GdriveLoginResult | { code: string; redirectUri: string }): void => {
      clearTimeout(timer)
      server.close()
      if (pendingLogin === server) pendingLogin = null
      resolve(result)
    }
    server.on('error', (err) => finish({ ok: false, error: 'network', detail: err.message }))
    server.listen(0, '127.0.0.1', () => {
      pendingLogin = server
      const address = server.address()
      if (address === null || typeof address === 'string') {
        finish({ ok: false, error: 'network', detail: 'Không mở được cổng loopback' })
        return
      }
      redirectUri = `http://127.0.0.1:${address.port}`
      void shell.openExternal(buildGoogleAuthUrl({ clientId: GOOGLE_CLIENT_ID, redirectUri, challenge, state }))
    })
  })
  if (!('code' in outcome)) return outcome

  // 2) Đổi code lấy token
  let json: unknown
  try {
    const res = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: outcome.code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: outcome.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier
      }).toString()
    })
    json = await res.json()
  } catch (error) {
    return { ok: false, error: 'network', detail: error instanceof Error ? error.message : String(error) }
  }
  const parsed = parseTokenResponse(json)
  if (!parsed.ok) return { ok: false, error: 'badResponse', detail: parsed.error }
  if (!parsed.tokens.refreshToken) {
    // prompt=consent lẽ ra luôn cấp refresh token — thiếu là bất thường, nói thẳng thay vì
    // "đăng nhập thành công" rồi chết im lặng sau một giờ (§8)
    return { ok: false, error: 'badResponse', detail: 'Google không cấp refresh token' }
  }

  const email = parsed.tokens.idToken ? emailFromIdToken(parsed.tokens.idToken) : null
  getVault().setGdriveAuth(parsed.tokens.refreshToken, email)
  cachedAccess = { token: parsed.tokens.accessToken, expiresAt: parsed.tokens.expiresAt }
  return { ok: true, email }
}

/** Huỷ phiên đăng nhập đang chờ (nếu có) — gọi khi user đóng modal giữa chừng. */
export function gdriveCancelLogin(): void {
  closePendingLogin()
}

export async function gdriveLogout(): Promise<GdriveStatusDto> {
  const vault = getVault()
  try {
    const refresh = vault.getGdriveRefreshToken()
    if (refresh) {
      // Thu hồi phía Google là best-effort: mạng hỏng thì vẫn phải quên token phía mình
      await fetchWithTimeout(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(refresh)}`, { method: 'POST' })
    }
  } catch {
    // bỏ qua — dòng dưới mới là phần bắt buộc
  }
  vault.clearGdriveAuth()
  cachedAccess = null
  return gdriveStatus()
}

/** Access token còn hạn — tự refresh khi hết. Ném Error(AUTH_LOST_MSG) khi không cứu được. */
async function getAccessToken(force = false): Promise<string> {
  if (!force && cachedAccess && cachedAccess.expiresAt > Date.now()) return cachedAccess.token
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) throw new Error('Bản build này chưa cấu hình Google client')
  const refresh = getVault().getGdriveRefreshToken()
  if (!refresh) throw new Error(AUTH_LOST_MSG)

  const res = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: 'refresh_token'
    }).toString()
  })
  const parsed = parseTokenResponse(await res.json())
  if (!parsed.ok) {
    if (parsed.error.startsWith('invalid_grant')) {
      // Token bị thu hồi / hết hạn 7 ngày (app còn ở Testing) — quên đi để UI hiện "đăng nhập lại"
      getVault().clearGdriveAuth()
      cachedAccess = null
      throw new Error(AUTH_LOST_MSG)
    }
    throw new Error(`Google từ chối refresh token: ${parsed.error}`)
  }
  // Google có thể xoay refresh token — nhận bản mới thì lưu lại ngay
  if (parsed.tokens.refreshToken && parsed.tokens.refreshToken !== refresh) {
    getVault().setGdriveAuth(parsed.tokens.refreshToken, getVault().getGdriveEmail())
  }
  cachedAccess = { token: parsed.tokens.accessToken, expiresAt: parsed.tokens.expiresAt }
  return cachedAccess.token
}

/**
 * Lỗi HTTP của Drive kèm NGUYÊN NHÂN từ body — "403" trần không phân biệt được hai ca hoàn
 * toàn khác nhau: project chưa bật Drive API (message của Google kèm luôn link bật) và token
 * thiếu scope (user BỎ TICK ô Drive trên màn hình consent dạng granular của Google).
 */
async function driveHttpError(res: Response, action: string): Promise<Error> {
  let detail = ''
  let reason = ''
  try {
    const body = (await res.json()) as { error?: { message?: string; errors?: Array<{ reason?: string }> } }
    reason = body.error?.errors?.[0]?.reason ?? ''
    if (body.error?.message) detail = ` — ${body.error.message}${reason ? ` (${reason})` : ''}`
  } catch {
    // body không phải JSON — đành chịu, giữ mã số
  }
  const hint =
    res.status === 403 && /insufficient|SCOPE/i.test(`${detail}${reason}`)
      ? '\nToken thiếu quyền Drive: đăng nhập Google lại và nhớ TICK ô cho phép truy cập file trên màn hình consent.'
      : ''
  return new Error(`Google Drive: HTTP ${res.status} khi ${action}${detail}${hint}`)
}

/**
 * Backend Drive cho SyncService — cùng interface 4 hàm với FolderBackend nên toàn bộ guard
 * chống ghi đè (near-miss + seenRemoteAt) dùng lại nguyên trạng.
 *
 * `fileId` được nhớ lại (qua onFileId → SyncConfig) để update ĐÚNG file cũ; Drive cho phép
 * nhiều file trùng tên nên cứ create mới là ra một rừng bản sao.
 */
export class DriveBackend implements SyncBackend {
  private fileId: string | undefined

  constructor(
    private readonly opts: {
      initialFileId?: string
      email: string | null
      onFileId?: (id: string) => void
    }
  ) {
    this.fileId = opts.initialFileId
  }

  private rememberFileId(id: string): void {
    this.fileId = id
    this.opts.onFileId?.(id)
  }

  /** fetch kèm access token; 401 thì ép refresh MỘT lần rồi thử lại (token vừa bị thu hồi ngắn hạn). */
  private async authed(url: string, init: RequestInit = {}, retried = false): Promise<Response> {
    const token = await getAccessToken(retried)
    const res = await fetchWithTimeout(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` }
    })
    if (res.status === 401 && !retried) return this.authed(url, init, true)
    return res
  }

  async read(): Promise<string | null> {
    if (this.fileId) {
      const res = await this.authed(`${DRIVE_FILES_URL}/${this.fileId}?alt=media`)
      if (res.ok) return res.text()
      // 404 = file bị xoá/đổi chỗ trên Drive → quên id, tìm lại theo tên bên dưới
      if (res.status !== 404) throw await driveHttpError(res, 'đọc blob')
      this.fileId = undefined
    }
    const listRes = await this.authed(buildDriveListByNameUrl(BLOB_NAME))
    if (!listRes.ok) throw await driveHttpError(listRes, 'tìm blob')
    const parsed = parseDriveFileList(await listRes.json())
    if (!parsed.ok) throw new Error(parsed.error)
    const hit = parsed.files.find((f) => f.name === BLOB_NAME)
    if (!hit) return null
    this.rememberFileId(hit.id)
    const res = await this.authed(`${DRIVE_FILES_URL}/${hit.id}?alt=media`)
    if (!res.ok) throw await driveHttpError(res, 'đọc blob')
    return res.text()
  }

  async write(blob: string): Promise<void> {
    if (this.fileId) {
      const res = await this.authed(`${DRIVE_UPLOAD_URL}/${this.fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
        body: blob
      })
      if (res.ok) return
      if (res.status !== 404) throw await driveHttpError(res, 'ghi blob')
      this.fileId = undefined // file cũ bị xoá → tạo mới bên dưới
    }
    const boundary = `ic${randomBytes(12).toString('hex')}`
    const { body, contentType } = buildMultipartUpload(boundary, { name: BLOB_NAME }, blob)
    const res = await this.authed(`${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body
    })
    if (!res.ok) throw await driveHttpError(res, 'tạo blob')
    const created = (await res.json()) as { id?: unknown }
    if (typeof created.id === 'string') this.rememberFileId(created.id)
  }

  async listNearMisses(): Promise<string[]> {
    const res = await this.authed(buildDriveListContainsUrl('infra-companion-vault'))
    if (!res.ok) throw await driveHttpError(res, 'liệt kê file')
    const parsed = parseDriveFileList(await res.json())
    if (!parsed.ok) throw new Error(parsed.error)
    return findNearMissBlobs(parsed.files.map((f) => f.name))
  }

  describe(): string {
    return this.opts.email ? `Google Drive (${this.opts.email})` : 'Google Drive'
  }
}
