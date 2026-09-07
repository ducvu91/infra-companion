import type { HostFactsDto } from './types'

/**
 * Kiểm kê fleet — phần thuần mà RENDERER cần (lọc bảng, so lệch hai lần thu, định dạng uptime).
 * Lệnh thu và parser nằm ở core (`inventory/facts.ts`) vì chỉ main chạy chúng; renderer không
 * import được core (CLAUDE.md §5) nên phần dùng chung hai bên đặt ở đây.
 */

/** Khoá phiên bản phần mềm theo thứ tự hiện trong bảng. */
export const VERSION_KEYS: readonly string[] = ['php', 'nginx', 'apache', 'mysql', 'node', 'docker', 'python']

export function emptyFacts(): HostFactsDto {
  return {
    hostname: null,
    os: null,
    kernel: null,
    arch: null,
    cpuCount: null,
    memTotalMb: null,
    diskRootPct: null,
    uptimeSec: null,
    ipv4: [],
    listenPorts: [],
    virt: null,
    rebootRequired: false,
    versions: {}
  }
}

/** Một ô đã đổi giữa hai lần thu. `field` dạng `os`, `kernel`, `versions.php`, `listenPorts`… */
export interface FactChange {
  field: string
  before: string
  after: string
}

function show(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.join(' ')
  return String(v)
}

/** So hai bản facts: chỉ trả các trường KHÁC nhau (uptime bỏ qua — nó luôn đổi). */
export function diffFacts(prev: HostFactsDto | null, next: HostFactsDto): FactChange[] {
  if (!prev) return []
  const out: FactChange[] = []
  const scalar: Array<keyof HostFactsDto> = ['hostname', 'os', 'kernel', 'arch', 'cpuCount', 'memTotalMb', 'diskRootPct', 'ipv4', 'listenPorts', 'virt', 'rebootRequired']
  for (const key of scalar) {
    const a = show(prev[key])
    const b = show(next[key])
    if (a !== b) out.push({ field: key, before: a, after: b })
  }
  const keys = new Set([...Object.keys(prev.versions), ...Object.keys(next.versions)])
  for (const k of [...keys].sort()) {
    const a = prev.versions[k] ?? ''
    const b = next.versions[k] ?? ''
    if (a !== b) out.push({ field: `versions.${k}`, before: a, after: b })
  }
  return out
}

/** Chuỗi để tìm: mọi trường + "php 8.3.6" để gõ `php 7.4` là ra máy còn PHP 7.4. */
export function factsSearchBlob(label: string, facts: HostFactsDto): string {
  const parts = [
    label,
    facts.hostname ?? '',
    facts.os ?? '',
    facts.kernel ?? '',
    facts.arch ?? '',
    facts.virt ?? '',
    facts.rebootRequired ? 'reboot' : '',
    facts.ipv4.join(' '),
    facts.listenPorts.map((p) => `:${p}`).join(' '),
    ...Object.entries(facts.versions).map(([k, v]) => `${k} ${v}`)
  ]
  return parts.join(' ').toLowerCase()
}

/** Lọc AND theo từng từ (không phân biệt hoa thường). Chuỗi rỗng → giữ hết. */
export function filterFactsRows<T extends { label: string; facts: HostFactsDto }>(rows: readonly T[], query: string): T[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...rows]
  return rows.filter((r) => {
    const blob = factsSearchBlob(r.label, r.facts)
    return terms.every((t) => blob.includes(t))
  })
}

/** Uptime → "12d 5h" / "3h 20m". */
export function formatUptime(sec: number | null): string {
  if (sec === null) return ''
  const d = Math.floor(sec / 86_400)
  const h = Math.floor((sec % 86_400) / 3600)
  if (d > 0) return `${d}d ${h}h`
  const m = Math.floor((sec % 3600) / 60)
  return `${h}h ${m}m`
}
