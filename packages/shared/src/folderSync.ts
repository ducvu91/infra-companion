/**
 * F28/F29 — So lệch hai thư mục local ↔ remote, và theo dõi thư mục local để tự upload.
 *
 * Phần thuần: **quyết định** file nào mới hơn, file nào chỉ có một bên, và đường dẫn remote tương
 * ứng của một file local. Phần liệt kê thư mục và truyền file dùng lại `SftpService` đã có.
 *
 * Vì sao không dùng checksum ở bản đầu: tính md5 cả cây trên remote là một lệnh chạy lâu và ăn
 * CPU của máy production, còn mtime + size trả lời đúng câu hỏi thật ("tôi vừa sửa file nào chưa
 * đẩy lên"). Ngưỡng lệch thời gian chịu được đặt tường minh vì hai máy hiếm khi đồng bộ giờ tuyệt
 * đối và nhiều filesystem chỉ lưu mtime theo giây.
 */

export interface FileStat {
  /** Đường dẫn TƯƠNG ĐỐI so với gốc thư mục, luôn dùng `/`. */
  path: string
  size: number
  /** ms. */
  mtimeMs: number
}

/** Sai số mtime bỏ qua (ms): 2 giây — đủ cho filesystem lưu theo giây và lệch giờ nhỏ. */
export const MTIME_TOLERANCE_MS = 2000

export type DiffStatus =
  /** Hai bên giống nhau (cùng size, mtime lệch trong ngưỡng). */
  | 'same'
  /** Bản local mới hơn → cần upload. */
  | 'local-newer'
  /** Bản remote mới hơn → cần download (hoặc ai đó vừa sửa trực tiếp trên server). */
  | 'remote-newer'
  /** Chỉ có ở local. */
  | 'local-only'
  /** Chỉ có ở remote. */
  | 'remote-only'
  /** Cùng mtime nhưng khác size — không quyết được bên nào đúng, phải để user xem. */
  | 'conflict'

export interface DiffEntry {
  path: string
  status: DiffStatus
  local: FileStat | null
  remote: FileStat | null
}

/**
 * So hai danh sách file. Kết quả xếp: cần làm gì đó trước (upload/download/lệch), rồi mới tới
 * file giống nhau; trong mỗi nhóm theo đường dẫn — bảng phải mở ra là thấy việc, không phải cuộn.
 */
export function diffFolders(local: readonly FileStat[], remote: readonly FileStat[], toleranceMs = MTIME_TOLERANCE_MS): DiffEntry[] {
  const remoteByPath = new Map(remote.map((f) => [f.path, f]))
  const out: DiffEntry[] = []
  for (const l of local) {
    const r = remoteByPath.get(l.path)
    if (!r) {
      out.push({ path: l.path, status: 'local-only', local: l, remote: null })
      continue
    }
    remoteByPath.delete(l.path)
    const dt = l.mtimeMs - r.mtimeMs
    if (Math.abs(dt) <= toleranceMs) {
      out.push({ path: l.path, status: l.size === r.size ? 'same' : 'conflict', local: l, remote: r })
    } else {
      out.push({ path: l.path, status: dt > 0 ? 'local-newer' : 'remote-newer', local: l, remote: r })
    }
  }
  for (const r of remoteByPath.values()) out.push({ path: r.path, status: 'remote-only', local: null, remote: r })

  const rank: Record<DiffStatus, number> = { conflict: 0, 'local-newer': 1, 'remote-newer': 2, 'local-only': 3, 'remote-only': 4, same: 5 }
  return out.sort((a, b) => rank[a.status] - rank[b.status] || a.path.localeCompare(b.path))
}

/** File cần đẩy lên khi user bấm "Đẩy thay đổi": local mới hơn hoặc chỉ có ở local. */
export function toUpload(entries: readonly DiffEntry[]): DiffEntry[] {
  return entries.filter((e) => e.status === 'local-newer' || e.status === 'local-only')
}

/** Đếm theo trạng thái cho dòng tóm tắt. */
export function countByStatus(entries: readonly DiffEntry[]): Record<DiffStatus, number> {
  const out: Record<DiffStatus, number> = { same: 0, 'local-newer': 0, 'remote-newer': 0, 'local-only': 0, 'remote-only': 0, conflict: 0 }
  for (const e of entries) out[e.status] += 1
  return out
}

/** Mẫu bỏ qua mặc định — thư mục và file gần như không bao giờ nên đẩy lên server. */
export const DEFAULT_IGNORES: readonly string[] = [
  '.git',
  'node_modules',
  'vendor',
  '.DS_Store',
  'Thumbs.db',
  '*.log',
  '*.swp',
  '*.tmp',
  '.env',
  '.idea',
  '.vscode'
]

/**
 * Đường dẫn tương đối có bị bỏ qua không.
 *
 * Mẫu khớp theo TỪNG ĐOẠN đường dẫn: `node_modules` chặn cả cây con, `*.log` chặn mọi file .log ở
 * mọi tầng. Chỉ hỗ trợ `*` (không phải glob đầy đủ) — mẫu càng đơn giản thì người đọc càng đoán
 * đúng nó chặn cái gì, và đây là danh sách người ta sửa bằng tay.
 */
export function isIgnored(relPath: string, patterns: readonly string[]): boolean {
  const segments = relPath.split('/').filter(Boolean)
  for (const raw of patterns) {
    const pattern = raw.trim()
    if (!pattern) continue
    const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i')
    if (segments.some((s) => re.test(s))) return true
  }
  return false
}

/**
 * Đường dẫn remote của một file local. Ghép bằng `/` và **chặn đi ra ngoài gốc**: một đường dẫn
 * tương đối chứa `..` mà cứ ghép thẳng là ghi ra ngoài thư mục đích trên server.
 */
export function remotePathFor(remoteRoot: string, relPath: string): string | null {
  const clean = relPath.replace(/\\/g, '/')
  if (clean.startsWith('/') || clean.split('/').some((s) => s === '..')) return null
  const root = remoteRoot.endsWith('/') ? remoteRoot.slice(0, -1) : remoteRoot
  return `${root}/${clean}`
}

/** Thư mục cha (remote) của một đường dẫn — cần `mkdir -p` trước khi upload file trong cây con. */
export function remoteDirOf(remotePath: string): string {
  const idx = remotePath.lastIndexOf('/')
  return idx <= 0 ? '/' : remotePath.slice(0, idx)
}

/** Đổi đường dẫn tuyệt đối local thành tương đối so với gốc (chuẩn hoá `\` → `/`). */
export function relativeFrom(localRoot: string, absPath: string): string | null {
  const root = localRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  const abs = absPath.replace(/\\/g, '/')
  if (!abs.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return null
  return abs.slice(root.length + 1)
}

// ── DTO cho tính năng "cặp thư mục" (main ↔ renderer) ─────────────────────────

/** Một cặp thư mục local ↔ remote user đã lưu. */
export interface FolderPairDto {
  id: string
  name: string
  hostId: string
  localRoot: string
  remoteRoot: string
  /** Mẫu bỏ qua (một mẫu / dòng khi sửa trên UI). */
  ignores: string[]
  /** Tự đẩy khi file local đổi. Bật lại lúc mở app nếu đang là true. */
  watch: boolean
}

export type FolderPairInput = Omit<FolderPairDto, 'id'> & { id?: string }

export interface FolderScanDto {
  pairId: string
  scannedAt: number
  entries: DiffEntry[]
  counts: Record<DiffStatus, number>
  /** Số file bị bỏ qua vì khớp mẫu ignore (để user biết vì sao thiếu). */
  ignored: number
  /** Có phần nào không đọc được (thư mục remote thiếu quyền…) thì nói rõ. */
  warning?: string
}

export type FolderSyncEventDto =
  /** Watcher vừa bật/tắt (kể cả tắt vì lỗi). */
  | { type: 'watch'; pairId: string; watching: boolean; message?: string }
  /** Một file vừa được đẩy lên do watcher (hoặc do bấm "Đẩy thay đổi"). */
  | { type: 'pushed'; pairId: string; path: string; at: number }
  | { type: 'error'; pairId: string; path?: string; message: string }

/** Giới hạn quét: cây quá lớn thì dừng và nói rõ, đừng treo im lặng. */
export const FOLDER_SCAN_MAX_FILES = 20_000
/** Chờ gom nhiều lần ghi liên tiếp của editor thành một lượt đẩy. */
export const WATCH_DEBOUNCE_MS = 600

/** Dọn danh sách mẫu ignore người dùng nhập (mỗi dòng một mẫu). */
export function parseIgnores(text: string): string[] {
  return text
    .split(/[\r\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}
