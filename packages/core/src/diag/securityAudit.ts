import type { SecurityFindingDto, SecurityFindingLevel, SecurityScanDto } from '@infra/shared'

/**
 * F38 — Kiểm an ninh nhanh cả fleet: MỘT lệnh chỉ-đọc mỗi host, rồi chấm thành danh sách việc
 * cần làm. Cùng khuôn với "Máy nào cần vá" (F37) và Kiểm kê fleet: lệnh một dòng, không `$(...)`,
 * không `sudo` bắt buộc, không heredoc (CLAUDE.md §4 — mỗi hop login-script bọc thêm một lớp quote).
 *
 * Biến sổ tay "Kiểm nhanh an ninh một máy" thành thứ chạy được trên cả fleet: điều đáng biết
 * không phải "máy này có gì" mà "máy NÀO trong 20 máy còn cho đăng nhập bằng mật khẩu".
 *
 * Mọi phát hiện đều là **đọc**: không có lệnh nào sửa cấu hình. Việc cần làm chỉ trỏ sang sổ tay
 * tương ứng để user tự làm với xác nhận.
 */

const SECTIONS: Array<[key: string, cmd: string]> = [
  // sshd -T in ra cấu hình HIỆU LỰC sau khi gộp mọi Include — thứ duy nhất đáng tin
  ['sshd', 'sshd -T 2>/dev/null || /usr/sbin/sshd -T 2>/dev/null'],
  ['ports', 'ss -tlnH 2>/dev/null || netstat -tln 2>/dev/null'],
  ['failed', 'lastb -n 200 2>/dev/null | head -200'],
  ['authfail', 'grep -c "Failed password" /var/log/auth.log /var/log/secure 2>/dev/null'],
  ['f2b', 'fail2ban-client status 2>/dev/null'],
  ['sudoers', 'getent group sudo wheel 2>/dev/null'],
  ['nopass', 'grep -rhE "^[^#]*NOPASSWD" /etc/sudoers /etc/sudoers.d/ 2>/dev/null'],
  ['emptypw', "awk -F: '($2 == \"\") { print $1 }' /etc/shadow 2>/dev/null"],
  ['uid0', "awk -F: '($3 == 0) { print $1 }' /etc/passwd 2>/dev/null"],
  ['authkeys', 'ls -l /root/.ssh/authorized_keys 2>/dev/null; wc -l < /root/.ssh/authorized_keys 2>/dev/null'],
  ['fw', 'systemctl is-active firewalld ufw nftables iptables 2>/dev/null; ufw status 2>/dev/null | head -1'],
  ['selinux', 'getenforce 2>/dev/null'],
  ['reboot', 'test -f /var/run/reboot-required && echo yes'],
  ['who', 'who 2>/dev/null']
]

export const SECURITY_COMMAND: string = SECTIONS.map(([key, cmd]) => `echo @@${key}; ${cmd}`).join('; ') + '; echo @@end'

/** Cắt output theo dấu `@@key` — cùng cách `inventory/facts.ts` làm. */
export function splitAuditSections(stdout: string): Record<string, string> {
  const out: Record<string, string> = {}
  let key: string | null = null
  let buf: string[] = []
  for (const raw of stdout.split(/\r?\n/)) {
    const m = raw.trim().match(/^@@([a-z0-9]+)$/)
    if (m) {
      if (key) out[key] = buf.join('\n').trim()
      key = m[1]!
      buf = []
      continue
    }
    if (key) buf.push(raw)
  }
  if (key && key !== 'end') out[key] = buf.join('\n').trim()
  return out
}

/** Giá trị của một khoá trong output `sshd -T` (đã lowercase khoá). */
function sshdValue(section: string, key: string): string | null {
  for (const line of section.split('\n')) {
    const m = line.trim().match(/^(\S+)\s+(.*)$/)
    if (m && m[1]!.toLowerCase() === key) return m[2]!.trim().toLowerCase()
  }
  return null
}

/** Cổng TCP đang lắng nghe trên địa chỉ CÔNG KHAI (0.0.0.0 / [::] / IP thật), bỏ loopback. */
export function parsePublicPorts(section: string): number[] {
  const ports = new Set<number>()
  for (const line of section.split('\n')) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 4) continue
    const local = cols[0] === 'LISTEN' || cols[0]?.startsWith('tcp') ? cols[3] : undefined
    if (!local) continue
    const m = local.match(/^(.*):(\d+)$/)
    if (!m) continue
    const addr = m[1]!
    if (addr === '127.0.0.1' || addr === '[::1]' || addr === 'localhost') continue
    ports.add(Number(m[2]))
  }
  return [...ports].sort((a, b) => a - b)
}

/** Cổng "quen" không đáng báo riêng — SSH và web là lý do máy tồn tại. */
const EXPECTED_PUBLIC_PORTS = new Set([22, 80, 443])
/** Cổng mở ra ngoài mà gần như luôn là cấu hình sai — dịch vụ nội bộ không nên ra Internet. */
const RISKY_PORTS: Record<number, string> = {
  3306: 'MySQL/MariaDB',
  5432: 'PostgreSQL',
  6379: 'Redis',
  27017: 'MongoDB',
  9200: 'Elasticsearch',
  11211: 'Memcached',
  2375: 'Docker API (không TLS)',
  5900: 'VNC',
  3389: 'RDP',
  25: 'SMTP',
  23: 'Telnet',
  21: 'FTP'
}

const f = (
  id: string,
  level: SecurityFindingLevel,
  title: string,
  detail: string | null = null,
  runbookId: string | null = null
): SecurityFindingDto => ({ id, level, title, detail, runbookId })

/**
 * Chấm output thành danh sách phát hiện, nặng trước. Chỉ báo thứ **đọc được chắc chắn**: mục nào
 * lệnh không chạy được (thiếu quyền, thiếu lệnh) thì im lặng thay vì đoán — một cảnh báo sai làm
 * người ta bỏ qua cả bảng.
 */
export function auditFindings(stdout: string): SecurityFindingDto[] {
  const sec = splitAuditSections(stdout)
  const out: SecurityFindingDto[] = []

  // --- sshd: nguồn của phần lớn sự cố thật ---
  const sshd = sec['sshd'] ?? ''
  if (sshd) {
    const passwordAuth = sshdValue(sshd, 'passwordauthentication')
    const permitRoot = sshdValue(sshd, 'permitrootlogin')
    const kbd = sshdValue(sshd, 'kbdinteractiveauthentication') ?? sshdValue(sshd, 'challengeresponseauthentication')
    const port = sshdValue(sshd, 'port')
    const maxAuth = sshdValue(sshd, 'maxauthtries')
    if (passwordAuth === 'yes') out.push(f('ssh-password', 'high', 'SSH còn cho đăng nhập bằng mật khẩu', 'sshd -T: PasswordAuthentication yes', 'ssh-hardening'))
    if (kbd === 'yes' && passwordAuth !== 'yes') {
      out.push(f('ssh-kbd', 'medium', 'SSH cho keyboard-interactive (mật khẩu đi đường khác)', 'sshd -T: KbdInteractiveAuthentication yes', 'ssh-hardening'))
    }
    if (permitRoot === 'yes') out.push(f('ssh-root', 'high', 'SSH cho đăng nhập root bằng mật khẩu', 'sshd -T: PermitRootLogin yes', 'ssh-hardening'))
    if (permitRoot === 'prohibit-password' || permitRoot === 'without-password') {
      out.push(f('ssh-root-key', 'info', 'Root đăng nhập được bằng key', `sshd -T: PermitRootLogin ${permitRoot}`, 'ssh-hardening'))
    }
    if (port === '22') out.push(f('ssh-port', 'info', 'SSH ở cổng 22 (mặc định)', 'Đổi cổng chỉ giảm ồn log, không phải bảo mật thật', 'ssh-hardening'))
    const maxAuthNum = Number(maxAuth)
    if (Number.isFinite(maxAuthNum) && maxAuthNum > 6) out.push(f('ssh-maxauth', 'low', `MaxAuthTries cao (${maxAuthNum})`, null, 'ssh-hardening'))
  }

  // --- Cổng mở ra ngoài ---
  const ports = parsePublicPorts(sec['ports'] ?? '')
  const risky = ports.filter((p) => p in RISKY_PORTS)
  if (risky.length > 0) {
    out.push(
      f(
        'ports-risky',
        'high',
        `Dịch vụ nội bộ mở ra ngoài: ${risky.join(', ')}`,
        risky.map((p) => `${p} (${RISKY_PORTS[p]})`).join(' · '),
        'fw-whitelist-ip'
      )
    )
  }
  const others = ports.filter((p) => !EXPECTED_PUBLIC_PORTS.has(p) && !(p in RISKY_PORTS))
  if (others.length > 0) {
    out.push(f('ports-other', 'info', `Cổng khác đang mở ra ngoài: ${others.slice(0, 12).join(', ')}${others.length > 12 ? '…' : ''}`, null, 'ports-listening'))
  }

  // --- Đăng nhập thất bại ---
  const failedLines = (sec['failed'] ?? '').split('\n').filter((l) => l.trim() && !/^btmp begins/i.test(l.trim()))
  if (failedLines.length >= 50) {
    out.push(f('bruteforce', 'medium', `${failedLines.length}+ lần đăng nhập thất bại gần đây`, 'lastb: có dấu hiệu brute-force', 'fw-block-ip'))
  }
  const authFailNum = Math.max(
    0,
    ...(sec['authfail'] ?? '')
      .split('\n')
      .map((l) => Number(l.split(':').pop()))
      .filter((n) => Number.isFinite(n))
  )
  if (authFailNum >= 500) out.push(f('authlog-fail', 'medium', `${authFailNum} dòng "Failed password" trong log auth`, null, 'fw-block-ip'))

  // --- fail2ban: chỉ báo khi CÓ dấu hiệu bị dò mà KHÔNG có fail2ban ---
  const hasF2b = (sec['f2b'] ?? '').includes('Jail list')
  if (!hasF2b && (failedLines.length >= 50 || authFailNum >= 500)) {
    out.push(f('no-fail2ban', 'medium', 'Bị dò mật khẩu nhưng không thấy fail2ban', 'fail2ban-client status không trả về jail nào', 'fw-block-ip'))
  }

  // --- sudo / user ---
  const nopass = (sec['nopass'] ?? '').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))
  if (nopass.length > 0) {
    out.push(f('sudo-nopasswd', 'medium', `${nopass.length} dòng sudo NOPASSWD`, nopass.slice(0, 3).join(' · '), 'users-add-sudo'))
  }
  const emptypw = (sec['emptypw'] ?? '').split('\n').filter((l) => l.trim())
  if (emptypw.length > 0) out.push(f('empty-password', 'high', `User không có mật khẩu: ${emptypw.join(', ')}`, null, 'users-add-sudo'))
  const uid0 = (sec['uid0'] ?? '').split('\n').filter((l) => l.trim())
  if (uid0.length > 1) out.push(f('multi-uid0', 'high', `Nhiều user có UID 0: ${uid0.join(', ')}`, 'Chỉ nên có root', 'users-add-sudo'))

  // --- Firewall ---
  const fw = sec['fw'] ?? ''
  const fwActive = /(^|\n)active/i.test(fw) || /Status: active/i.test(fw)
  if (fw && !fwActive) out.push(f('no-firewall', 'medium', 'Không có firewall nào đang chạy', 'firewalld/ufw/nftables/iptables đều không active', 'fw-whitelist-ip'))

  // --- Vá & SELinux ---
  if ((sec['reboot'] ?? '').trim() === 'yes') out.push(f('reboot-required', 'medium', 'Cần khởi động lại để áp bản vá', null, 'services-systemd'))
  const selinux = (sec['selinux'] ?? '').trim().toLowerCase()
  if (selinux === 'permissive') out.push(f('selinux-permissive', 'low', 'SELinux đang ở chế độ permissive', null, null))
  if (selinux === 'disabled') out.push(f('selinux-disabled', 'info', 'SELinux đã tắt', null, null))

  const order: Record<SecurityFindingLevel, number> = { high: 0, medium: 1, low: 2, info: 3 }
  return out.sort((a, b) => order[a.level] - order[b.level])
}

/** Điểm 0–100: trừ theo mức nặng của từng phát hiện. `info` không trừ — nó là ghi nhận, không phải lỗi. */
export function auditScore(findings: readonly SecurityFindingDto[]): number {
  const cost: Record<SecurityFindingLevel, number> = { high: 25, medium: 10, low: 4, info: 0 }
  const total = findings.reduce((sum, x) => sum + cost[x.level], 0)
  return Math.max(0, 100 - total)
}

/** Gom kết quả một host thành bản ghi hoàn chỉnh. */
export function buildScan(hostId: string, stdout: string, collectedAt: number): SecurityScanDto {
  const findings = auditFindings(stdout)
  return { hostId, collectedAt, ok: true, error: null, score: auditScore(findings), findings }
}
