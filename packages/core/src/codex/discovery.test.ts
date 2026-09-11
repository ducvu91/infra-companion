import { describe, expect, it } from 'vitest'
import {
  buildSpawnArgv,
  classifyProbe,
  codexCandidates,
  isShimPath,
  looksLikeAuthError,
  pickNewestBinDir,
  windowsBinRoot,
  type ProbeInput,
} from './discovery'

describe('codexCandidates — Windows', () => {
  const winEnv: NodeJS.ProcessEnv = {
    PATH: 'C:\\bin;C:\\Program Files\\tools',
    LOCALAPPDATA: 'C:\\Users\\deploy\\AppData\\Local',
    APPDATA: 'C:\\Users\\deploy\\AppData\\Roaming',
  }

  it('manual dung DAU — user chi tay thi dung doan lai giup ho', () => {
    const c = codexCandidates(winEnv, 'win32', 'D:\\tools\\codex.exe')
    expect(c[0]).toEqual({ path: 'D:\\tools\\codex.exe', source: 'manual' })
  })

  it('bo qua manual khi la chuoi rong/trang', () => {
    expect(codexCandidates(winEnv, 'win32', '   ')[0]!.source).toBe('path')
  })

  it('thu ca .exe, .cmd, .bat tren PATH (ban npm la shim script)', () => {
    const paths = codexCandidates(winEnv, 'win32').map((c) => c.path)
    expect(paths).toContain('C:\\bin\\codex.exe')
    expect(paths).toContain('C:\\bin\\codex.cmd')
    expect(paths).toContain('C:\\bin\\codex.bat')
  })

  it('xu ly duong dan PATH co dau cach', () => {
    const paths = codexCandidates(winEnv, 'win32').map((c) => c.path)
    expect(paths).toContain('C:\\Program Files\\tools\\codex.exe')
  })

  it('bo cap ngoac kep quanh muc PATH (Windows hay co)', () => {
    const paths = codexCandidates({ PATH: '"C:\\co ngoac"' }, 'win32').map((c) => c.path)
    expect(paths).toContain('C:\\co ngoac\\codex.exe')
  })

  it('co ung vien npm global', () => {
    const c = codexCandidates(winEnv, 'win32')
    expect(c.some((x) => x.source === 'npm-global' && x.path.endsWith('npm\\codex.cmd'))).toBe(true)
  })

  it('PATH rong thi khong crash', () => {
    expect(() => codexCandidates({}, 'win32')).not.toThrow()
    expect(codexCandidates({}, 'win32')).toEqual([])
  })

  it('doc PATH tu `Path` khi khong co `PATH`', () => {
    const paths = codexCandidates({ Path: 'C:\\x' }, 'win32').map((p) => p.path)
    expect(paths).toContain('C:\\x\\codex.exe')
  })
})

describe('codexCandidates — POSIX', () => {
  it('chi thu ten `codex`, khong .exe', () => {
    const c = codexCandidates({ PATH: '/usr/bin:/usr/local/bin', HOME: '/home/deploy' }, 'linux')
    const paths = c.map((x) => x.path)
    expect(paths).toContain('/usr/bin/codex')
    expect(paths).toContain('/usr/local/bin/codex')
    expect(paths.some((p) => p.endsWith('.exe'))).toBe(false)
  })

  it('co cac cho well-known cua macOS/Linux', () => {
    const paths = codexCandidates({ HOME: '/home/deploy' }, 'darwin').map((x) => x.path)
    expect(paths).toContain('/home/deploy/.local/bin/codex')
    expect(paths).toContain('/opt/homebrew/bin/codex')
    expect(paths).toContain('/usr/local/bin/codex')
  })
})

describe('windowsBinRoot & pickNewestBinDir', () => {
  it('dung duoc duong dan bin cua Codex desktop', () => {
    expect(windowsBinRoot({ LOCALAPPDATA: 'C:\\U\\d\\AppData\\Local' })).toBe(
      'C:\\U\\d\\AppData\\Local\\OpenAI\\Codex\\bin',
    )
  })

  it('khong co LOCALAPPDATA thi tra null', () => {
    expect(windowsBinRoot({})).toBeNull()
  })

  it('BO thu muc hash KHONG co exe (da gap that: 3/4 thu muc rong)', () => {
    const got = pickNewestBinDir([
      { dir: 'C:\\bin\\aaaa1111', mtimeMs: 5000, hasExe: false },
      { dir: 'C:\\bin\\bbbb2222', mtimeMs: 4000, hasExe: false },
      { dir: 'C:\\bin\\cccc3333', mtimeMs: 1000, hasExe: true },
    ])
    // Thư mục mtime mới nhất lại rỗng — phải chọn cái CÓ exe.
    expect(got).toBe('C:\\bin\\cccc3333\\codex.exe')
  })

  it('chon ban mtime moi nhat trong nhung cai co exe', () => {
    const got = pickNewestBinDir([
      { dir: 'C:\\bin\\a', mtimeMs: 1000, hasExe: true },
      { dir: 'C:\\bin\\b', mtimeMs: 9000, hasExe: true },
    ])
    expect(got).toBe('C:\\bin\\b\\codex.exe')
  })

  it('khong co thu muc nao dung duoc thi tra null', () => {
    expect(pickNewestBinDir([])).toBeNull()
    expect(pickNewestBinDir([{ dir: 'C:\\x', mtimeMs: 1, hasExe: false }])).toBeNull()
  })
})

describe('isShimPath & buildSpawnArgv', () => {
  it('nhan dien shim .cmd/.bat', () => {
    expect(isShimPath('C:\\npm\\codex.cmd')).toBe(true)
    expect(isShimPath('C:\\npm\\CODEX.CMD')).toBe(true)
    expect(isShimPath('C:\\npm\\codex.bat')).toBe(true)
    expect(isShimPath('C:\\bin\\codex.exe')).toBe(false)
    expect(isShimPath('/usr/bin/codex')).toBe(false)
  })

  it('exe thi spawn truc tiep', () => {
    expect(buildSpawnArgv('C:\\bin\\codex.exe', ['app-server'], 'win32')).toEqual({
      file: 'C:\\bin\\codex.exe',
      args: ['app-server'],
    })
  })

  it('shim thi boc qua cmd.exe voi path DA QUOTE (path co dau cach)', () => {
    // shell:true là thứ repo cấm; bọc tường minh thì ta kiểm soát quoting.
    const got = buildSpawnArgv('C:\\Program Files\\npm\\codex.cmd', ['app-server'], 'win32')
    expect(got.file).toBe('cmd.exe')
    expect(got.args[0]).toBe('/d') // bỏ AutoRun của registry
    expect(got.args[1]).toBe('/s')
    expect(got.args[2]).toBe('/c')
    expect(got.args[3]).toBe('"C:\\Program Files\\npm\\codex.cmd" app-server')
  })

  it('POSIX khong bao gio boc shell', () => {
    expect(buildSpawnArgv('/usr/bin/codex', ['app-server'], 'linux').file).toBe('/usr/bin/codex')
  })
})

describe('looksLikeAuthError', () => {
  it('nhan dien loi chua dang nhap', () => {
    for (const s of [
      'Unauthorized',
      'HTTP 401 error',
      'error 403 forbidden',
      'You are not logged in',
      'please log in with codex login',
      'invalid_grant',
      'refresh token expired',
      'auth.json not found',
    ]) {
      expect(looksLikeAuthError(s), s).toBe(true)
    }
  })

  it('503 KHONG phai loi auth (da gap that trong probe)', () => {
    // `failed to connect to websocket: HTTP error: 503 … wss://chatgpt.com/…`
    // Gán nhãn "chưa đăng nhập" cho lỗi này là bắt user đi làm việc vô ích.
    expect(
      looksLikeAuthError('failed to connect to websocket: HTTP error: 503 Service Unavailable, url: wss://chatgpt.com/backend-api/codex/responses'),
    ).toBe(false)
  })

  it('loi mang thuong khong bi nhan sai', () => {
    expect(looksLikeAuthError('ECONNREFUSED')).toBe(false)
    expect(looksLikeAuthError('rate limit exceeded')).toBe(false)
  })
})

describe('classifyProbe', () => {
  const base: ProbeInput = { binary: null, searched: [], version: null, handshake: null }

  it('khong tim thay binary -> not-installed KEM danh sach da tim', () => {
    // Thông báo phải nói được "đã tìm ở đâu" thay vì bắt user đoán (R2).
    const r = classifyProbe({ ...base, searched: ['C:\\bin\\codex.exe', 'C:\\npm\\codex.cmd'] })
    expect(r.kind).toBe('not-installed')
    if (r.kind === 'not-installed') expect(r.searched).toHaveLength(2)
  })

  it('co binary nhung handshake that bai -> found-broken kem stderr', () => {
    const r = classifyProbe({
      ...base,
      binary: { path: 'C:\\bin\\codex.exe' },
      version: 'codex-cli 0.90.0',
      handshake: { ok: false, detail: "error: unrecognized subcommand 'app-server'" },
    })
    expect(r.kind).toBe('found-broken')
    if (r.kind === 'found-broken') expect(r.detail).toContain('app-server')
  })

  it('chua thu handshake -> found-broken, KHONG phai ready', () => {
    const r = classifyProbe({ ...base, binary: { path: 'C:\\bin\\codex.exe' }, version: '0.142.4' })
    expect(r.kind).toBe('found-broken')
  })

  it('handshake xong nhung CHUA thu turn -> installed-unverified (KHONG phai ready)', () => {
    // Đã kiểm chứng: initialize + thread/start đều xanh trong khi không gọi nổi model.
    const r = classifyProbe({
      ...base,
      binary: { path: 'C:\\bin\\codex.exe' },
      version: 'codex-cli 0.142.4',
      handshake: { ok: true, caps: { codexHome: 'C:\\Users\\deploy\\.codex' } },
    })
    expect(r.kind).toBe('installed-unverified')
    if (r.kind === 'installed-unverified') {
      expect(r.protocol.codexHome).toBe('C:\\Users\\deploy\\.codex')
      expect(r.version).toBe('codex-cli 0.142.4')
    }
  })

  it('turn probe xanh -> ready', () => {
    const r = classifyProbe({
      ...base,
      binary: { path: '/usr/bin/codex' },
      version: '0.142.4',
      handshake: { ok: true, caps: {} },
      turnProbe: { ok: true },
    })
    expect(r.kind).toBe('ready')
  })

  it('turn probe loi AUTH -> needs-login', () => {
    const r = classifyProbe({
      ...base,
      binary: { path: '/usr/bin/codex' },
      version: '0.142.4',
      handshake: { ok: true, caps: {} },
      turnProbe: { ok: false, detail: 'Unauthorized: please run codex login' },
    })
    expect(r.kind).toBe('needs-login')
  })

  it('turn probe loi KHAC (503) -> found-broken voi nguyen nhan THAT, khong gan nhan sai', () => {
    const r = classifyProbe({
      ...base,
      binary: { path: '/usr/bin/codex' },
      version: '0.142.4',
      handshake: { ok: true, caps: {} },
      turnProbe: { ok: false, detail: 'HTTP error: 503 Service Unavailable' },
    })
    expect(r.kind).toBe('found-broken')
    if (r.kind === 'found-broken') expect(r.detail).toContain('503')
  })

  it('version null nhung handshake xong thi van dung duoc (bao unknown)', () => {
    const r = classifyProbe({
      ...base,
      binary: { path: '/usr/bin/codex' },
      version: null,
      handshake: { ok: true, caps: {} },
      turnProbe: { ok: true },
    })
    expect(r.kind).toBe('ready')
    if (r.kind === 'ready') expect(r.version).toBe('unknown')
  })
})
