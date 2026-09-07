import { VERSION_KEYS, emptyFacts, type HostFactsDto } from '@infra/shared'

/**
 * Kiểm kê fleet — phần thuần: LỆNH thu facts (một dòng shell chạy qua kênh exec, xuyên được
 * login-script) và PARSER đọc kết quả thành `HostFactsDto`, cộng vài phép tính cho bảng (so lệch
 * hai lần thu, lọc, xuất CSV).
 *
 * Lệnh tuân quy tắc host có login script (CLAUDE.md §4): KHÔNG `$(...)`, `$?`, heredoc — mỗi hop
 * bọc thêm một lớp quote và bóc mất. Chỉ dùng `;`, `||`, `&&`, redirect. Mỗi mục bắt đầu bằng
 * dòng đánh dấu `@@key` để parser cắt được dù lệnh nào đó không tồn tại (stderr đã nuốt).
 */

/** Thứ tự = thứ tự xuất hiện trong output; parser tìm theo tên nên đổi thứ tự không sao. */
const SECTIONS: Array<[key: string, cmd: string]> = [
  ['hostname', 'hostname 2>/dev/null'],
  ['os', 'cat /etc/os-release 2>/dev/null'],
  ['kernel', 'uname -r 2>/dev/null'],
  ['arch', 'uname -m 2>/dev/null'],
  ['cpu', 'nproc 2>/dev/null'],
  ['mem', 'grep MemTotal /proc/meminfo 2>/dev/null'],
  ['disk', 'df -P / 2>/dev/null'],
  ['uptime', 'cat /proc/uptime 2>/dev/null'],
  ['ip', 'hostname -I 2>/dev/null'],
  ['ports', 'ss -tlnH 2>/dev/null || netstat -tln 2>/dev/null'],
  ['virt', 'systemd-detect-virt 2>/dev/null'],
  ['reboot', 'test -f /var/run/reboot-required && echo yes'],
  ['php', 'php -v 2>/dev/null'],
  ['nginx', 'nginx -v 2>&1'],
  ['apache', 'apache2 -v 2>/dev/null || httpd -v 2>/dev/null'],
  ['mysql', 'mysqld --version 2>/dev/null || mariadbd --version 2>/dev/null || mysql --version 2>/dev/null'],
  ['node', 'node -v 2>/dev/null'],
  ['docker', 'docker --version 2>/dev/null'],
  ['python', 'python3 --version 2>&1']
]

export const FACTS_COMMAND: string = SECTIONS.map(([key, cmd]) => `echo @@${key}; ${cmd}`).join('; ') + '; echo @@end'

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** Cắt output thành từng mục theo dấu `@@key`. Dòng trước dấu đầu tiên (banner login) bị bỏ. */
export function splitSections(stdout: string): Record<string, string> {
  const out: Record<string, string> = {}
  let key: string | null = null
  let buf: string[] = []
  for (const raw of stdout.split(/\r?\n/)) {
    const m = raw.trim().match(/^@@([a-z]+)$/)
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

function firstLine(s: string | undefined): string | null {
  const line = (s ?? '').split('\n').map((l) => l.trim()).find((l) => l.length > 0)
  return line && !/not found|No such file|command not found/i.test(line) ? line : null
}

/** Phiên bản dạng 1.2 / 1.2.3 / 8.0.36-0ubuntu0 — số đầu tiên trông giống version. */
function pickVersion(s: string | null): string | null {
  if (!s) return null
  const m = s.match(/\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?/)
  return m ? m[0] : null
}

export function parseFacts(stdout: string): HostFactsDto {
  const sec = splitSections(stdout)
  const facts = emptyFacts()

  facts.hostname = firstLine(sec['hostname'])
  facts.kernel = firstLine(sec['kernel'])
  facts.arch = firstLine(sec['arch'])

  const pretty = (sec['os'] ?? '').match(/^PRETTY_NAME="?([^"\n]+)"?/m)
  if (pretty) facts.os = pretty[1]!.trim()
  else {
    const name = (sec['os'] ?? '').match(/^NAME="?([^"\n]+)"?/m)?.[1]
    const ver = (sec['os'] ?? '').match(/^VERSION_ID="?([^"\n]+)"?/m)?.[1]
    facts.os = name ? [name, ver].filter(Boolean).join(' ').trim() : null
  }

  const cpu = Number(firstLine(sec['cpu']))
  facts.cpuCount = Number.isInteger(cpu) && cpu > 0 ? cpu : null

  const mem = (sec['mem'] ?? '').match(/MemTotal:\s+(\d+)\s*kB/i)
  facts.memTotalMb = mem ? Math.round(Number(mem[1]) / 1024) : null

  // df -P: dòng 2, cột 5 là "45%"
  const dfLine = (sec['disk'] ?? '').split('\n').slice(1).find((l) => l.trim().length > 0)
  const dfCols = dfLine?.trim().split(/\s+/) ?? []
  const pct = dfCols.find((c) => /^\d+%$/.test(c))
  facts.diskRootPct = pct ? Number(pct.slice(0, -1)) : null

  const up = Number((sec['uptime'] ?? '').trim().split(/\s+/)[0])
  facts.uptimeSec = Number.isFinite(up) && up > 0 ? Math.floor(up) : null

  facts.ipv4 = (sec['ip'] ?? '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => IPV4.test(s) && !s.startsWith('127.'))

  const ports = new Set<number>()
  for (const line of (sec['ports'] ?? '').split('\n')) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 4) continue
    // ss -tlnH: LISTEN 0 128 0.0.0.0:22 …  (cột 4) · netstat -tln: tcp 0 0 0.0.0.0:22 … (cột 4)
    const local = cols[0] === 'LISTEN' || cols[0]?.startsWith('tcp') ? cols[3] : undefined
    if (!local) continue
    const m = local.match(/:(\d+)$/)
    if (m) ports.add(Number(m[1]))
  }
  facts.listenPorts = [...ports].sort((a, b) => a - b)

  const virt = firstLine(sec['virt'])
  facts.virt = virt && virt !== 'none' ? virt : null
  facts.rebootRequired = (sec['reboot'] ?? '').trim() === 'yes'

  const versions: Record<string, string> = {}
  const php = pickVersion(firstLine(sec['php']))
  if (php) versions['php'] = php
  const nginx = pickVersion(firstLine(sec['nginx']))
  if (nginx) versions['nginx'] = nginx
  const apache = pickVersion(firstLine(sec['apache']))
  if (apache) versions['apache'] = apache
  const mysqlLine = firstLine(sec['mysql'])
  if (mysqlLine) {
    // "mysql  Ver 15.1 Distrib 10.11.6-MariaDB" → 10.11.6-MariaDB (số 15.1 là của client, không phải server)
    const distrib = mysqlLine.match(/Distrib\s+([\w.\-]+)/)
    const ver = mysqlLine.match(/Ver\s+([\w.\-]+)/)
    const v = distrib?.[1] ?? ver?.[1] ?? pickVersion(mysqlLine)
    if (v) versions['mysql'] = v
  }
  const node = pickVersion(firstLine(sec['node']))
  if (node) versions['node'] = node
  const docker = pickVersion(firstLine(sec['docker']))
  if (docker) versions['docker'] = docker
  const py = pickVersion(firstLine(sec['python']))
  if (py) versions['python'] = py
  facts.versions = versions

  return facts
}

function show(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.join(' ')
  return String(v)
}

function csvCell(v: unknown): string {
  const s = show(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Bảng CSV: một host một dòng, cột cố định + mỗi phần mềm một cột. */
export function factsToCsv(rows: ReadonlyArray<{ label: string; hostId: string; collectedAt: number; facts: HostFactsDto }>): string {
  const header = [
    'label',
    'hostname',
    'os',
    'kernel',
    'arch',
    'cpu',
    'mem_mb',
    'disk_root_pct',
    'uptime_sec',
    'ipv4',
    'listen_ports',
    'virt',
    'reboot_required',
    ...VERSION_KEYS,
    'collected_at'
  ]
  const lines = [header.join(',')]
  for (const r of rows) {
    const f = r.facts
    lines.push(
      [
        r.label,
        f.hostname,
        f.os,
        f.kernel,
        f.arch,
        f.cpuCount,
        f.memTotalMb,
        f.diskRootPct,
        f.uptimeSec,
        f.ipv4.join(' '),
        f.listenPorts.join(' '),
        f.virt,
        f.rebootRequired ? 'yes' : 'no',
        ...VERSION_KEYS.map((k) => f.versions[k] ?? ''),
        new Date(r.collectedAt).toISOString()
      ]
        .map(csvCell)
        .join(',')
    )
  }
  return lines.join('\n') + '\n'
}
