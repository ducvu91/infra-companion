import type {
  ClientImportDraftDto,
  ClientImportFormat,
  ClientImportPreviewDto,
  ClientImportResultDto,
  HostProtocol
} from '@infra/shared'
import type { VaultService } from '../vault/VaultService'

/**
 * Nhập host từ client SSH khác — bốn parser thuần (không đọc file, không đụng vault) + một hàm
 * ghi. Người chuyển từ PuTTY / MobaXterm / WinSCP / Termius sang sẽ vướng ngay bước đầu nếu phải
 * gõ lại vài chục host; đây là tính năng quyết định có ai dùng thử hay không.
 *
 * Nguyên tắc chung: parser KHÔNG ném — dòng lạ thì bỏ qua và ghi warning; user thấy bảng xem
 * trước rồi tick chọn, main chỉ ghi những gì được tick. Mật khẩu lưu trong client gốc (WinSCP mã
 * hoá riêng, MobaXterm mã hoá riêng) KHÔNG được đọc; đường dẫn key chỉ hiện để user biết mà tự
 * import (`.ppk` phải chuyển sang OpenSSH trước).
 */

const PUTTY_SESSIONS_KEY = /^\[HKEY_CURRENT_USER\\Software\\SimonTatham\\PuTTY\\Sessions\\(.+)\]$/i

/** Tệp .reg/.ini/.csv có thể là UTF-16 (Regedit xuất UTF-16LE có BOM). Đọc BOM rồi decode cho đúng. */
export function decodeTextFile(buf: Uint8Array): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2))
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2))
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return new TextDecoder('utf-8').decode(buf.subarray(3))
  return new TextDecoder('utf-8').decode(buf)
}

/** Nhận diện định dạng theo đuôi file trước, nội dung sau (file đổi tên vẫn nhận ra). */
export function detectClientFormat(fileName: string, text: string): ClientImportFormat | null {
  const lower = fileName.toLowerCase()
  const head = text.slice(0, 4000)
  if (lower.endsWith('.reg') || /Windows Registry Editor/i.test(head)) return /SimonTatham\\PuTTY/i.test(text) ? 'putty' : null
  if (lower.endsWith('.mxtsessions') || /^\[Bookmarks/m.test(head)) return 'mobaxterm'
  if (lower.endsWith('.ini') || /^\[Sessions\\/m.test(head)) return /^\[Sessions\\/m.test(text) ? 'winscp' : null
  if (lower.endsWith('.csv')) return 'termius'
  return null
}

export function parseClientFile(fileName: string, text: string): ClientImportPreviewDto | null {
  const format = detectClientFormat(fileName, text)
  if (format === null) return null
  const parsed =
    format === 'putty'
      ? parsePuttyReg(text)
      : format === 'mobaxterm'
        ? parseMobaXterm(text)
        : format === 'winscp'
          ? parseWinScpIni(text)
          : parseTermiusCsv(text)
  return { format, source: fileName, drafts: parsed.drafts, warnings: parsed.warnings }
}

interface Parsed {
  drafts: ClientImportDraftDto[]
  warnings: string[]
}

function decodePercent(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, '%2B'))
  } catch {
    return s
  }
}

function safePort(raw: string | number | undefined, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
  return Number.isInteger(n) && n >= 1 && n <= 65_535 ? n : fallback
}

/** `user@host` trong ô HostName (PuTTY cho phép) → tách ra. */
function splitUserHost(hostname: string, username: string | null): { hostname: string; username: string | null } {
  const at = hostname.lastIndexOf('@')
  if (at > 0) return { hostname: hostname.slice(at + 1), username: username ?? hostname.slice(0, at) }
  return { hostname, username }
}

// ── PuTTY (.reg export của HKCU\Software\SimonTatham\PuTTY\Sessions) ─────────

/**
 * `.reg`: mỗi session một section; giá trị `"Key"="chuỗi"` (backslash nhân đôi) hoặc
 * `"Key"=dword:hex`. Tên session được PuTTY mã hoá kiểu `%20`. Bỏ "Default Settings".
 */
export function parsePuttyReg(text: string): Parsed {
  const drafts: ClientImportDraftDto[] = []
  const warnings: string[] = []
  let current: { name: string; values: Record<string, string> } | null = null

  const flush = (): void => {
    if (!current) return
    const { name, values } = current
    current = null
    if (name === 'Default Settings') return
    const rawHost = (values['HostName'] ?? '').trim()
    if (!rawHost) {
      warnings.push(`PuTTY "${name}": không có HostName — bỏ qua`)
      return
    }
    const proto = (values['Protocol'] ?? 'ssh').toLowerCase()
    const protocol = puttyProtocol(proto)
    if (!protocol) {
      warnings.push(`PuTTY "${name}": giao thức "${proto}" không hỗ trợ — bỏ qua`)
      return
    }
    const { hostname, username } = splitUserHost(rawHost, values['UserName']?.trim() || null)
    drafts.push({
      label: name,
      hostname,
      port: safePort(values['PortNumber'], protocol === 'telnet' ? 23 : 22),
      username,
      groupPath: null,
      protocol,
      keyPath: values['PublicKeyFile']?.trim() || null
    })
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const section = line.match(PUTTY_SESSIONS_KEY)
    if (section) {
      flush()
      current = { name: decodePercent(section[1]!), values: {} }
      continue
    }
    if (line.startsWith('[')) {
      flush() // section khác (không phải Sessions) → kết thúc session đang đọc
      continue
    }
    if (!current) continue
    const kv = line.match(/^"([^"]+)"=(.*)$/)
    if (!kv) continue
    const key = kv[1]!
    const value = kv[2]!
    const dword = value.match(/^dword:([0-9a-f]+)$/i)
    if (dword) {
      current.values[key] = String(parseInt(dword[1]!, 16))
    } else if (value.startsWith('"') && value.endsWith('"')) {
      current.values[key] = value.slice(1, -1).replace(/\\\\/g, '\\').replace(/\\"/g, '"')
    }
  }
  flush()
  return { drafts, warnings }
}

function puttyProtocol(proto: string): HostProtocol | null {
  if (proto === 'ssh') return 'ssh'
  if (proto === 'telnet') return 'telnet'
  if (proto === 'serial') return 'serial'
  return null
}

// ── MobaXterm (.mxtsessions) ─────────────────────────────────────────────────

/** Mã loại session của MobaXterm ở đầu chuỗi `#<type>#`. */
const MOBA_TYPES: Record<string, HostProtocol> = { '109': 'ssh', '98': 'telnet', '91': 'rdp', '128': 'vnc' }

/**
 * Định dạng INI: `[Bookmarks]`, `[Bookmarks_1]`… mỗi section một thư mục (`SubRep=Prod\Web`),
 * mỗi dòng `Tên=#type#icon%host%port%user%…`. Chỉ lấy 3 trường đầu sau icon.
 */
export function parseMobaXterm(text: string): Parsed {
  const drafts: ClientImportDraftDto[] = []
  const warnings: string[] = []
  let groupPath: string | null = null
  let inBookmarks = false

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';')) continue
    const section = line.match(/^\[(.+)\]$/)
    if (section) {
      inBookmarks = /^Bookmarks(_\d+)?$/i.test(section[1]!)
      groupPath = null
      continue
    }
    if (!inBookmarks) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1)
    if (key === 'SubRep') {
      const p = value.trim().replace(/\\/g, '/')
      groupPath = p ? p : null
      continue
    }
    if (key === 'ImgNum') continue
    const m = value.match(/^#(\d+)#(\d+)%(.*)$/)
    if (!m) continue
    const protocol = MOBA_TYPES[m[1]!]
    if (!protocol) {
      warnings.push(`MobaXterm "${key}": loại session #${m[1]} không hỗ trợ — bỏ qua`)
      continue
    }
    const fields = m[3]!.split('%')
    const hostname = (fields[0] ?? '').trim()
    if (!hostname) {
      warnings.push(`MobaXterm "${key}": không có host — bỏ qua`)
      continue
    }
    const defaultPort = protocol === 'rdp' ? 3389 : protocol === 'vnc' ? 5900 : protocol === 'telnet' ? 23 : 22
    drafts.push({
      label: key,
      hostname,
      port: safePort(fields[1], defaultPort),
      username: (fields[2] ?? '').trim() || null,
      groupPath,
      protocol,
      keyPath: null
    })
  }
  return { drafts, warnings }
}

// ── WinSCP (WinSCP.ini) ──────────────────────────────────────────────────────

/**
 * `[Sessions\<tên đã %-encode>]`, thư mục phân bằng `/` (mã `%2F`). Mọi FSProtocol đều là SSH
 * (SFTP/SCP) trừ FTP/WebDAV/S3 (5 = SFTP, 0 = SCP, 2 = FTP, 3 = WebDAV, 4 = S3) → bỏ non-SSH.
 */
export function parseWinScpIni(text: string): Parsed {
  const drafts: ClientImportDraftDto[] = []
  const warnings: string[] = []
  let current: { name: string; values: Record<string, string> } | null = null

  const flush = (): void => {
    if (!current) return
    const { name, values } = current
    current = null
    if (name === 'Default Settings') return
    const hostname = (values['HostName'] ?? '').trim()
    if (!hostname) {
      warnings.push(`WinSCP "${name}": không có HostName — bỏ qua`)
      return
    }
    const fs = (values['FSProtocol'] ?? '5').trim()
    if (fs === '2' || fs === '3' || fs === '4') {
      warnings.push(`WinSCP "${name}": không phải SSH (FSProtocol=${fs}) — bỏ qua`)
      return
    }
    const slash = name.lastIndexOf('/')
    drafts.push({
      label: slash >= 0 ? name.slice(slash + 1) : name,
      hostname,
      port: safePort(values['PortNumber'], 22),
      username: values['UserName']?.trim() || null,
      groupPath: slash > 0 ? name.slice(0, slash) : null,
      protocol: 'ssh',
      keyPath: values['PublicKeyFile'] ? decodePercent(values['PublicKeyFile']) : null
    })
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';')) continue
    const section = line.match(/^\[Sessions\\(.+)\]$/i)
    if (section) {
      flush()
      current = { name: decodePercent(section[1]!), values: {} }
      continue
    }
    if (line.startsWith('[')) {
      flush()
      continue
    }
    if (!current) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    current.values[line.slice(0, eq).trim()] = line.slice(eq + 1)
  }
  flush()
  return { drafts, warnings }
}

// ── Termius / CSV chung ──────────────────────────────────────────────────────

const CSV_ALIASES: Record<'label' | 'host' | 'port' | 'user' | 'group' | 'protocol', string[]> = {
  label: ['label', 'name', 'alias', 'title'],
  host: ['hostname/ip', 'hostname', 'host', 'address', 'ip', 'ip address'],
  port: ['port'],
  user: ['username', 'user', 'login'],
  group: ['groups', 'group', 'folder', 'path'],
  protocol: ['protocol', 'type']
}

/** CSV RFC 4180: dấu phẩy, nháy kép với `""` escape, xuống dòng trong ô có nháy. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 1
        } else quoted = false
      } else cell += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** CSV của Termius (`Groups,Label,Tags,Hostname/IP,Protocol,Port,Username,…`) hoặc CSV bất kỳ có cột host. */
export function parseTermiusCsv(text: string): Parsed {
  const drafts: ClientImportDraftDto[] = []
  const warnings: string[] = []
  const rows = parseCsv(text.replace(/^﻿/, ''))
  if (rows.length === 0) return { drafts, warnings: ['CSV trống'] }
  const header = rows[0]!.map((h) => h.trim().toLowerCase())
  const col = (key: keyof typeof CSV_ALIASES): number => header.findIndex((h) => CSV_ALIASES[key].includes(h))
  const iHost = col('host')
  if (iHost < 0) return { drafts, warnings: ['CSV không có cột Hostname/IP (hoặc host / address)'] }
  const iLabel = col('label')
  const iPort = col('port')
  const iUser = col('user')
  const iGroup = col('group')
  const iProto = col('protocol')

  for (const [n, r] of rows.slice(1).entries()) {
    const hostname = (r[iHost] ?? '').trim()
    if (!hostname) {
      warnings.push(`CSV dòng ${n + 2}: không có host — bỏ qua`)
      continue
    }
    const protoRaw = iProto >= 0 ? (r[iProto] ?? '').trim().toLowerCase() : 'ssh'
    const protocol = csvProtocol(protoRaw)
    if (!protocol) {
      warnings.push(`CSV dòng ${n + 2}: giao thức "${protoRaw}" không hỗ trợ — bỏ qua`)
      continue
    }
    const group = iGroup >= 0 ? (r[iGroup] ?? '').trim().replace(/\\/g, '/') : ''
    drafts.push({
      label: (iLabel >= 0 ? (r[iLabel] ?? '').trim() : '') || hostname,
      hostname,
      port: safePort(iPort >= 0 ? r[iPort] : undefined, protocol === 'telnet' ? 23 : 22),
      username: iUser >= 0 ? (r[iUser] ?? '').trim() || null : null,
      groupPath: group || null,
      protocol,
      keyPath: null
    })
  }
  return { drafts, warnings }
}

function csvProtocol(raw: string): HostProtocol | null {
  if (raw === '' || raw === 'ssh' || raw === 'sftp') return 'ssh'
  if (raw === 'telnet') return 'telnet'
  if (raw === 'rdp') return 'rdp'
  if (raw === 'vnc') return 'vnc'
  return null
}

// ── Ghi vào vault ────────────────────────────────────────────────────────────

/**
 * Ghi các draft đã tick. Nhóm theo `groupPath` (tạo mới nếu chưa có nhóm cùng tên — nhập lần
 * hai không tạo nhóm trùng); draft không có thư mục vào nhóm `"<source> (ngày)"`. Host trùng
 * (cùng hostname + port + user, không phân biệt hoa thường) với host đã có thì BỎ QUA — user
 * nhập lại file cũ không được ra hai bản.
 */
export function importClientHosts(vault: VaultService, drafts: readonly ClientImportDraftDto[], source: string): ClientImportResultDto {
  const warnings: string[] = []
  const existingGroups = new Map(vault.listGroups().map((g) => [g.name.toLowerCase(), g.id]))
  const existingHosts = new Set(vault.listHosts().map((h) => hostKey(h.hostname, h.port, h.username)))
  const groupNames: string[] = []
  const defaultGroupName = `${source} (${new Date().toISOString().slice(0, 10)})`

  const groupIdFor = (path: string | null): string => {
    const name = path ?? defaultGroupName
    const found = existingGroups.get(name.toLowerCase())
    if (found) return found
    const g = vault.saveGroup({ name })
    existingGroups.set(name.toLowerCase(), g.id)
    groupNames.push(name)
    return g.id
  }

  let hostsImported = 0
  let skipped = 0
  for (const d of drafts) {
    const key = hostKey(d.hostname, d.port, d.username)
    if (existingHosts.has(key)) {
      skipped += 1
      continue
    }
    vault.saveHost({
      groupId: groupIdFor(d.groupPath),
      label: d.label || d.hostname,
      protocol: d.protocol,
      hostname: d.hostname,
      port: d.port,
      username: d.username,
      authType: null
    })
    existingHosts.add(key)
    hostsImported += 1
    if (d.keyPath) warnings.push(`"${d.label}": key ${d.keyPath} — import thủ công vào mục Keys (.ppk cần chuyển sang OpenSSH)`)
  }
  return { hostsImported, skipped, groupNames, warnings }
}

function hostKey(hostname: string, port: number, username: string | null): string {
  return `${hostname.toLowerCase()}:${port}:${(username ?? '').toLowerCase()}`
}
