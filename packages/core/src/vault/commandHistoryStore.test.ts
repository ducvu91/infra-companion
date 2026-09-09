import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import type { VaultService as VaultServiceType } from './VaultService'

/**
 * F24 — lịch sử lệnh trong vault (v19). Cần `node:sqlite` (Node >= 22.5) → chạy bằng Electron:
 *   Set-Location packages\core
 *   $env:ELECTRON_RUN_AS_NODE=1
 *   ..\..\node_modules\.bin\electron.cmd ..\..\node_modules\vitest\vitest.mjs run
 *
 * MỘT vault dùng chung cho cả file: `setup()` là argon2id 19 MiB pure-JS ≈ 1 giây, gọi lại mỗi
 * test là tự làm suite chậm gấp mười lần mà chẳng kiểm thêm được gì. Test nào cần trạng thái
 * riêng thì tự xoá sạch ở đầu bằng `clearCommandHistory()`.
 */
let VaultService: typeof VaultServiceType | null = null
try {
  await import('node:sqlite')
  VaultService = (await import('./VaultService')).VaultService
} catch {
  // node:sqlite không có trên runtime này
}

const tmpRoots: string[] = []
let shared: VaultServiceType | null = null

afterAll(() => {
  shared?.close() // SQLite còn mở thì rmSync dính EPERM trên Windows
  for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true })
})

function sharedVault(): VaultServiceType {
  if (shared) return shared
  const dir = mkdtempSync(join(tmpdir(), 'infra-cmdhist-'))
  tmpRoots.push(dir)
  const vault = new VaultService!(join(dir, 'vault.db'))
  vault.setup('master-cmdhist-12345678')
  shared = vault
  return vault
}

const suite = VaultService ? describe : describe.skip

suite('F24 — command_history trong vault', () => {
  const add = (
    vault: VaultServiceType,
    over: Partial<Parameters<VaultServiceType['addCommandHistory']>[0]> = {}
  ): string =>
    vault.addCommandHistory({
      hostId: 'h1',
      hostLabel: 'app-01',
      command: 'systemctl restart nginx',
      exitCode: 0,
      durationMs: 1500,
      startedAt: 1_700_000_000_000,
      ...over
    })

  test('lưu rồi đọc lại đúng nội dung và metadata', () => {
    const vault = sharedVault()
    vault.clearCommandHistory()
    add(vault, { command: 'tail -n 100 /var/log/nginx/error.log', exitCode: 1, durationMs: 42 })
    const rows = vault.listCommandHistory()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.command).toBe('tail -n 100 /var/log/nginx/error.log')
    expect(rows[0]!.exitCode).toBe(1)
    expect(rows[0]!.durationMs).toBe(42)
    expect(rows[0]!.hostLabel).toBe('app-01')
  })

  test('nội dung lệnh nằm trong DB ở dạng ĐÃ MÃ HOÁ, không phải chữ thường', () => {
    const vault = sharedVault()
    vault.clearCommandHistory()
    add(vault, { command: 'mysqldump --all-databases > /root/all.sql' })
    // Đọc cột thô: nếu lệnh nằm plaintext thì một lỗi đọc file vault là lộ cả lịch sử vận hành.
    const raw = (
      vault as unknown as {
        db: { prepare: (sql: string) => { get: () => { command_enc: string } } }
      }
    ).db
      .prepare('SELECT command_enc FROM command_history LIMIT 1')
      .get()
    expect(raw.command_enc).not.toContain('mysqldump')
    expect(raw.command_enc).not.toContain('all.sql')
  })

  test('lọc theo host, và null = mọi host', () => {
    const vault = sharedVault()
    vault.clearCommandHistory()
    add(vault, { hostId: 'h1', hostLabel: 'app-01', command: 'nginx -t', startedAt: 1000 })
    add(vault, { hostId: 'h2', hostLabel: 'app-02', command: 'psql -l', startedAt: 2000 })
    expect(vault.listCommandHistory({ hostId: 'h1' }).map((r) => r.command)).toEqual(['nginx -t'])
    expect(vault.listCommandHistory({ hostId: null })).toHaveLength(2)
    expect(vault.listCommandHistory()).toHaveLength(2)
  })

  test('sắp xếp mới nhất trước', () => {
    const vault = sharedVault()
    vault.clearCommandHistory()
    add(vault, { command: 'cũ', startedAt: 1000 })
    add(vault, { command: 'mới', startedAt: 9000 })
    expect(vault.listCommandHistory().map((r) => r.command)).toEqual(['mới', 'cũ'])
  })

  test('lệnh local (hostId null) lưu và đọc được', () => {
    const vault = sharedVault()
    vault.clearCommandHistory()
    add(vault, { hostId: null, hostLabel: 'Local', command: 'pnpm build' })
    const rows = vault.listCommandHistory()
    expect(rows[0]!.hostId).toBeNull()
    expect(rows[0]!.command).toBe('pnpm build')
  })

  test('xoá một dòng', () => {
    const vault = sharedVault()
    vault.clearCommandHistory()
    const id = add(vault, { command: 'lệnh sẽ xoá' })
    add(vault, { command: 'lệnh còn lại' })
    vault.deleteCommandHistory(id)
    expect(vault.listCommandHistory().map((r) => r.command)).toEqual(['lệnh còn lại'])
  })

  test('xoá sạch theo host KHÔNG đụng host khác', () => {
    const vault = sharedVault()
    vault.clearCommandHistory()
    add(vault, { hostId: 'h1', command: 'của h1' })
    add(vault, { hostId: 'h2', command: 'của h2' })
    expect(vault.clearCommandHistory('h1')).toBe(1)
    expect(vault.listCommandHistory().map((r) => r.command)).toEqual(['của h2'])
  })

  test('cờ redacted được lưu và đọc lại — cảnh báo không dựa vào việc so chuỗi', () => {
    const vault = sharedVault()
    vault.clearCommandHistory()
    add(vault, { command: 'mysql -p__đã_che__ db', redacted: true, startedAt: 2000 })
    add(vault, { command: 'systemctl restart nginx', startedAt: 1000 })
    const rows = vault.listCommandHistory()
    expect(rows.find((r) => r.command.startsWith('mysql'))!.redacted).toBe(true)
    expect(rows.find((r) => r.command.startsWith('systemctl'))!.redacted).toBe(false)
  })

  test('xoá sạch toàn bộ trả về số dòng đã xoá', () => {
    const vault = sharedVault()
    vault.clearCommandHistory()
    add(vault, { command: 'một' })
    add(vault, { command: 'hai' })
    expect(vault.clearCommandHistory()).toBe(2)
    expect(vault.listCommandHistory()).toEqual([])
  })

  test('limit cắt số dòng đọc về', () => {
    const vault = sharedVault()
    vault.clearCommandHistory()
    for (let i = 0; i < 5; i += 1) add(vault, { command: `lệnh ${i}`, startedAt: 1000 + i })
    expect(vault.listCommandHistory({ limit: 2 })).toHaveLength(2)
  })

  test('nhập lại ĐÚNG file vừa xuất thì không nhân đôi', () => {
    const vault = sharedVault()
    vault.clearCommandHistory()
    add(vault, { command: 'nginx -t', startedAt: 5000 })
    add(vault, { command: 'psql -l', startedAt: 6000 })
    const exported = vault.listCommandHistory().map(({ id: _id, ...rest }) => rest)

    expect(vault.importCommandHistory(exported)).toBe(0)
    expect(vault.listCommandHistory()).toHaveLength(2)
  })

  test('nhập dòng mới thì thêm, dòng đã có thì bỏ qua', () => {
    const vault = sharedVault()
    vault.clearCommandHistory()
    add(vault, { command: 'đã có', startedAt: 5000 })
    const added = vault.importCommandHistory([
      { hostId: 'h1', hostLabel: 'app-01', command: 'đã có', exitCode: 0, durationMs: 1500, startedAt: 5000 },
      { hostId: 'h1', hostLabel: 'app-01', command: 'mới toanh', exitCode: 0, durationMs: 10, startedAt: 7000 }
    ])
    expect(added).toBe(1)
    expect(vault.listCommandHistory().map((r) => r.command).sort()).toEqual(['mới toanh', 'đã có'].sort())
  })

  test('cùng lệnh nhưng KHÁC mốc giờ thì là hai lần chạy, không phải trùng', () => {
    const vault = sharedVault()
    vault.clearCommandHistory()
    add(vault, { command: 'deploy.sh', startedAt: 1000 })
    const added = vault.importCommandHistory([
      { hostId: 'h1', hostLabel: 'app-01', command: 'deploy.sh', exitCode: 0, durationMs: 5, startedAt: 2000 }
    ])
    expect(added).toBe(1)
    expect(vault.listCommandHistory()).toHaveLength(2)
  })

  test('KHÔNG nằm trong snapshot sync — log chỉ-thêm không merge được theo updated_at', () => {
    const vault = sharedVault()
    vault.clearCommandHistory()
    add(vault, { command: 'lệnh bí mật không được rời máy này' })
    const snapshot = vault.exportSnapshot() as unknown as Record<string, unknown>
    expect(Object.keys(snapshot)).not.toContain('commandHistory')
    expect(JSON.stringify(snapshot)).not.toContain('lệnh bí mật')
  })
})
