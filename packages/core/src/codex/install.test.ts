import { describe, expect, it } from 'vitest'
import { CODEX_NPM_PACKAGE, installedBinaryCandidates, isNewerVersion, npmInstallArgs } from './install'

describe('installedBinaryCandidates', () => {
  it('win32: tro thang vao binary trong vendor (da kiem chung duong dan that)', () => {
    const got = installedBinaryCandidates('C:\\app\\codex-cli', 'win32')
    expect(got[0]).toBe(
      'C:\\app\\codex-cli\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe',
    )
    // Không lẫn dấu `/` của POSIX vào đường dẫn Windows.
    expect(got.every((p) => !p.includes('/'))).toBe(true)
  })

  it('co duong DU PHONG (bin/ cua package chinh) — cau truc vendor doi theo ban', () => {
    const got = installedBinaryCandidates('C:\\app\\codex-cli', 'win32')
    expect(got[got.length - 1]).toContain('@openai\\codex\\bin\\codex.exe')
  })

  it('darwin: ca arm64 va x64', () => {
    const got = installedBinaryCandidates('/app/codex-cli', 'darwin')
    expect(got.some((p) => p.includes('aarch64-apple-darwin'))).toBe(true)
    expect(got.some((p) => p.includes('x86_64-apple-darwin'))).toBe(true)
    expect(got.every((p) => !p.includes('\\'))).toBe(true)
  })

  it('linux: musl (binary tinh, chay duoc tren nhieu distro)', () => {
    const got = installedBinaryCandidates('/app/codex-cli', 'linux')
    expect(got.some((p) => p.includes('x86_64-unknown-linux-musl'))).toBe(true)
  })

  it('POSIX khong co duoi .exe', () => {
    expect(installedBinaryCandidates('/app', 'linux').every((p) => !p.endsWith('.exe'))).toBe(true)
  })
})

describe('npmInstallArgs', () => {
  it('cai vao thu muc cua app, KHONG -g', () => {
    // `-g` sẽ đổi cả bản `codex` user gõ ở terminal — app không được tự ý làm thế.
    const got = npmInstallArgs('C:\\app\\codex-cli')
    expect(got).not.toContain('-g')
    expect(got).not.toContain('--global')
    expect(got).toContain('--prefix')
    expect(got[got.indexOf('--prefix') + 1]).toBe('C:\\app\\codex-cli')
  })

  it('mac dinh cai ban `latest`', () => {
    expect(npmInstallArgs('/x')).toContain(`${CODEX_NPM_PACKAGE}@latest`)
  })

  it('cai duoc ban chi dinh', () => {
    expect(npmInstallArgs('/x', '0.154.0')).toContain(`${CODEX_NPM_PACKAGE}@0.154.0`)
  })

  it('tat audit/fund — output ngan, khong goi mang cho viec khong lien quan', () => {
    const got = npmInstallArgs('/x')
    expect(got).toContain('--no-audit')
    expect(got).toContain('--no-fund')
    expect(got).toContain('--no-save')
  })
})

describe('isNewerVersion', () => {
  it('so dung ca ba so', () => {
    // Ca thật: máy có 0.142.4, npm có 0.154.0.
    expect(isNewerVersion('0.154.0', '0.142.4')).toBe(true)
    expect(isNewerVersion('0.142.4', '0.154.0')).toBe(false)
    expect(isNewerVersion('0.142.4', '0.142.4')).toBe(false)
    expect(isNewerVersion('0.142.5', '0.142.4')).toBe(true)
    expect(isNewerVersion('1.0.0', '0.999.999')).toBe(true)
  })

  it('so theo SO chu khong theo chuoi (9 < 10)', () => {
    expect(isNewerVersion('0.10.0', '0.9.0')).toBe(true)
  })

  it('bo qua hau to va tien to', () => {
    expect(isNewerVersion('codex-cli 0.154.0', '0.142.4')).toBe(true)
    expect(isNewerVersion('0.154.0-alpha.6', '0.142.4')).toBe(true)
  })

  it('khong parse duoc -> false (dung bao co ban moi khi khong hieu)', () => {
    expect(isNewerVersion('unknown', '0.142.4')).toBe(false)
    expect(isNewerVersion('0.154.0', '')).toBe(false)
  })
})
