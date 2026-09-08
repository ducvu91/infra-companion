import { describe, expect, test } from 'vitest'
import { SECURITY_COMMAND, auditFindings, auditScore, buildScan, parsePublicPorts, splitAuditSections } from './securityAudit'

/** Fixture: output giả lập — CHỈ địa chỉ/tên tài liệu (CLAUDE.md §3). */

const ids = (out: ReturnType<typeof auditFindings>): string[] => out.map((f) => f.id)

const SSHD_SAFE = `port 2222
passwordauthentication no
permitrootlogin no
kbdinteractiveauthentication no
maxauthtries 4`

const SSHD_BAD = `port 22
passwordauthentication yes
permitrootlogin yes
kbdinteractiveauthentication yes
maxauthtries 10`

const build = (sections: Record<string, string>): string =>
  Object.entries(sections)
    .map(([k, v]) => `@@${k}\n${v}`)
    .join('\n') + '\n@@end'

describe('SECURITY_COMMAND', () => {
  test('một dòng, không $(...) / heredoc, có @@end', () => {
    expect(SECURITY_COMMAND.split('\n')).toHaveLength(1)
    expect(SECURITY_COMMAND).not.toMatch(/\$\(|<</)
    expect(SECURITY_COMMAND.endsWith('echo @@end')).toBe(true)
    expect(SECURITY_COMMAND).toContain('sshd -T')
  })

  test('KHÔNG gọi sudo: kênh exec không có TTY nên sudo sẽ treo tới timeout (§4)', () => {
    // `getent group sudo wheel` có chữ "sudo" nhưng đó là TÊN NHÓM, không phải lệnh sudo —
    // nên chỉ cấm sudo ở vị trí một lệnh (đầu chuỗi hoặc sau `;` / `|` / `&&` / `||`).
    expect(SECURITY_COMMAND).not.toMatch(/(^|[;|&]\s*)sudo\s/)
  })
})

describe('splitAuditSections', () => {
  test('cắt theo dấu, bỏ banner trước dấu đầu, không giữ @@end', () => {
    const sec = splitAuditSections('banner login\n@@sshd\nport 22\n@@ports\nLISTEN 0 128 0.0.0.0:22\n@@end')
    expect(sec['sshd']).toBe('port 22')
    expect(sec['ports']).toContain('0.0.0.0:22')
    expect(sec['end']).toBeUndefined()
  })
})

describe('parsePublicPorts', () => {
  test('bỏ loopback, giữ 0.0.0.0 / [::] / IP thật, tăng dần, không trùng', () => {
    const out = parsePublicPorts(`LISTEN 0 128 0.0.0.0:22 0.0.0.0:*
LISTEN 0 511 0.0.0.0:443 0.0.0.0:*
LISTEN 0 80 127.0.0.1:3306 0.0.0.0:*
LISTEN 0 128 [::]:22 [::]:*
LISTEN 0 70 10.20.30.40:6379 0.0.0.0:*
LISTEN 0 1 [::1]:8080 [::]:*`)
    expect(out).toEqual([22, 443, 6379])
  })

  test('định dạng netstat cũng đọc được', () => {
    expect(parsePublicPorts('tcp 0 0 0.0.0.0:3306 0.0.0.0:* LISTEN')).toEqual([3306])
  })

  test('rỗng → rỗng', () => {
    expect(parsePublicPorts('')).toEqual([])
  })
})

describe('auditFindings — sshd', () => {
  test('cấu hình siết rồi → chỉ ghi nhận info về cổng, không có mục high', () => {
    const out = auditFindings(build({ sshd: SSHD_SAFE, ports: 'LISTEN 0 128 0.0.0.0:2222', fw: 'active' }))
    expect(out.filter((f) => f.level === 'high')).toEqual([])
    expect(ids(out)).not.toContain('ssh-password')
    expect(ids(out)).not.toContain('ssh-port')
  })

  test('mật khẩu + root + cổng 22 + maxauth cao đều bị bắt, nặng lên đầu', () => {
    const out = auditFindings(build({ sshd: SSHD_BAD, fw: 'active' }))
    expect(out[0]!.level).toBe('high')
    expect(ids(out)).toContain('ssh-password')
    expect(ids(out)).toContain('ssh-root')
    expect(ids(out)).toContain('ssh-port')
    expect(ids(out)).toContain('ssh-maxauth')
    // Mật khẩu đã bật thì không báo thêm keyboard-interactive (cùng một chuyện)
    expect(ids(out)).not.toContain('ssh-kbd')
    expect(out.find((f) => f.id === 'ssh-password')!.runbookId).toBe('ssh-hardening')
  })

  test('root vào được bằng key → chỉ là info', () => {
    const out = auditFindings(build({ sshd: 'permitrootlogin prohibit-password\npasswordauthentication no\nport 2222' }))
    expect(out.find((f) => f.id === 'ssh-root-key')!.level).toBe('info')
  })

  test('không đọc được sshd -T → im lặng, không đoán', () => {
    const out = auditFindings(build({ sshd: '', ports: '', fw: '' }))
    expect(ids(out).filter((id) => id.startsWith('ssh-'))).toEqual([])
  })
})

describe('auditFindings — cổng, brute-force, sudo, firewall', () => {
  test('DB/Redis mở ra ngoài là high và trỏ sang sổ tay firewall', () => {
    const out = auditFindings(
      build({ sshd: SSHD_SAFE, ports: 'LISTEN 0 80 0.0.0.0:3306\nLISTEN 0 70 0.0.0.0:6379\nLISTEN 0 128 0.0.0.0:443', fw: 'active' })
    )
    const risky = out.find((f) => f.id === 'ports-risky')!
    expect(risky.level).toBe('high')
    expect(risky.title).toContain('3306')
    expect(risky.detail).toContain('Redis')
    expect(risky.runbookId).toBe('fw-whitelist-ip')
    // 443 là cổng quen → không vào mục "cổng khác"
    expect(ids(out)).not.toContain('ports-other')
  })

  test('cổng lạ khác → chỉ info', () => {
    const out = auditFindings(build({ sshd: SSHD_SAFE, ports: 'LISTEN 0 1 0.0.0.0:8123', fw: 'active' }))
    expect(out.find((f) => f.id === 'ports-other')!.level).toBe('info')
  })

  test('nhiều lần đăng nhập thất bại → medium; có fail2ban thì không báo thiếu fail2ban', () => {
    const failed = Array.from({ length: 60 }, (_, i) => `admin ssh:notty 203.0.113.${i % 200} Mon Sep 7 10:0${i % 10}`).join('\n')
    const withoutF2b = auditFindings(build({ sshd: SSHD_SAFE, fw: 'active', failed }))
    expect(ids(withoutF2b)).toContain('bruteforce')
    expect(ids(withoutF2b)).toContain('no-fail2ban')
    const withF2b = auditFindings(build({ sshd: SSHD_SAFE, fw: 'active', failed, f2b: 'Status\n|- Number of jail: 1\n`- Jail list: sshd' }))
    expect(ids(withF2b)).toContain('bruteforce')
    expect(ids(withF2b)).not.toContain('no-fail2ban')
  })

  test('ít lần thất bại → không báo gì', () => {
    const out = auditFindings(build({ sshd: SSHD_SAFE, fw: 'active', failed: 'btmp begins Mon Sep 1\nadmin ssh:notty 203.0.113.5' }))
    expect(ids(out)).not.toContain('bruteforce')
    expect(ids(out)).not.toContain('no-fail2ban')
  })

  test('đếm "Failed password" lớn cũng tính là bị dò', () => {
    const out = auditFindings(build({ sshd: SSHD_SAFE, fw: 'active', authfail: '/var/log/auth.log:1234\n/var/log/secure:0' }))
    expect(ids(out)).toContain('authlog-fail')
  })

  test('NOPASSWD, user không mật khẩu, nhiều UID 0', () => {
    const out = auditFindings(
      build({
        sshd: SSHD_SAFE,
        fw: 'active',
        nopass: '# bình luận bị bỏ\ndeploy ALL=(ALL) NOPASSWD: ALL',
        emptypw: 'guest',
        uid0: 'root\nbackdoor'
      })
    )
    expect(out.find((f) => f.id === 'sudo-nopasswd')!.level).toBe('medium')
    expect(out.find((f) => f.id === 'empty-password')!.level).toBe('high')
    expect(out.find((f) => f.id === 'multi-uid0')!.title).toContain('backdoor')
  })

  test('chỉ có root với UID 0 là bình thường', () => {
    const out = auditFindings(build({ sshd: SSHD_SAFE, fw: 'active', uid0: 'root' }))
    expect(ids(out)).not.toContain('multi-uid0')
  })

  test('không firewall nào chạy → medium; ufw active thì không báo', () => {
    expect(ids(auditFindings(build({ sshd: SSHD_SAFE, fw: 'inactive\ninactive\ninactive\ninactive' })))).toContain('no-firewall')
    expect(ids(auditFindings(build({ sshd: SSHD_SAFE, fw: 'inactive\nactive\ninactive\ninactive\nStatus: active' })))).not.toContain('no-firewall')
  })

  test('cần reboot và SELinux permissive', () => {
    const out = auditFindings(build({ sshd: SSHD_SAFE, fw: 'active', reboot: 'yes', selinux: 'Permissive' }))
    expect(out.find((f) => f.id === 'reboot-required')!.level).toBe('medium')
    expect(out.find((f) => f.id === 'selinux-permissive')!.level).toBe('low')
  })
})

describe('auditScore / buildScan', () => {
  test('máy sạch = 100; info không trừ điểm', () => {
    expect(auditScore([])).toBe(100)
    expect(auditScore([{ id: 'x', level: 'info', title: 't', detail: null, runbookId: null }])).toBe(100)
  })

  test('trừ theo mức, không xuống dưới 0', () => {
    expect(auditScore([{ id: 'a', level: 'high', title: '', detail: null, runbookId: null }])).toBe(75)
    expect(auditScore([{ id: 'a', level: 'medium', title: '', detail: null, runbookId: null }])).toBe(90)
    expect(auditScore([{ id: 'a', level: 'low', title: '', detail: null, runbookId: null }])).toBe(96)
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `h${i}`, level: 'high' as const, title: '', detail: null, runbookId: null }))
    expect(auditScore(many)).toBe(0)
  })

  test('buildScan gói đủ host, thời điểm, điểm và phát hiện', () => {
    const scan = buildScan('h1', build({ sshd: SSHD_BAD, fw: 'active' }), 1234)
    expect(scan).toMatchObject({ hostId: 'h1', collectedAt: 1234, ok: true, error: null })
    expect(scan.score).toBeLessThan(60)
    expect(scan.findings.length).toBeGreaterThan(2)
  })
})
