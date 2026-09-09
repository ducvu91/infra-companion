import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, watch as fsWatch, type FSWatcher } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import { SftpService, deriveSftpExecFromLoginSteps } from '@infra/core'
import {
  DEFAULT_IGNORES,
  FOLDER_SCAN_MAX_FILES,
  IPC,
  WATCH_DEBOUNCE_MS,
  countByStatus,
  diffFolders,
  isIgnored,
  relativeFrom,
  remoteDirOf,
  remotePathFor,
  toUpload,
  type DiffEntry,
  type FileStat,
  type FolderPairDto,
  type FolderPairInput,
  type FolderScanDto,
  type FolderSyncEventDto
} from '@infra/shared'
import { makeHostKeyVerifier, prepareConnection } from './connection'
import { recordEvent } from './events'
import { getVault, touchActivity } from './vault'

/**
 * F28/F29 — So lệch thư mục local ↔ remote và tự đẩy khi file local đổi.
 *
 * Danh sách cặp nằm ở `folder-pairs.json` (userData) chứ không trong vault: nội dung chỉ là hai
 * đường dẫn và tên host, không có bí mật, và renderer cần đọc được để vẽ danh sách trước cả lúc
 * user mở khoá. Quét/đẩy thì cần vault mở vì phải nối SSH.
 *
 * Phiên SFTP mở LÚC CẦN rồi giữ lại theo cặp: một watcher đang bật mà mở lại kết nối cho từng
 * file đổi thì mỗi lần lưu file trong editor là một lần bắt tay SSH.
 *
 * Chỉ đẩy MỘT CHIỀU (local → remote). Chiều ngược lại cố ý không tự động: file trên production
 * mới hơn thường nghĩa là ai đó vừa sửa trực tiếp trên server, ghi đè xuống máy mình là mất bản
 * sửa đó — bảng so lệch hiện ra để user tự quyết.
 */

interface WatchState {
  watchers: FSWatcher[]
  /** relPath → timer gom nhiều lần ghi liên tiếp thành một lượt đẩy. */
  pending: Map<string, NodeJS.Timeout>
}

const service = new SftpService()
/** pairId → sessionId của phiên SFTP đang giữ. */
const sessions = new Map<string, string>()
const watches = new Map<string, WatchState>()
let pairs: FolderPairDto[] = []
let loaded = false

function configPath(): string {
  return join(app.getPath('userData'), 'folder-pairs.json')
}

function sanitizePair(raw: Partial<FolderPairDto>): FolderPairDto | null {
  if (typeof raw.hostId !== 'string' || !raw.hostId) return null
  if (typeof raw.localRoot !== 'string' || !raw.localRoot) return null
  if (typeof raw.remoteRoot !== 'string' || !raw.remoteRoot.startsWith('/')) return null
  const ignores = Array.isArray(raw.ignores) ? raw.ignores.filter((s): s is string => typeof s === 'string') : [...DEFAULT_IGNORES]
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : randomUUID(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : raw.remoteRoot,
    hostId: raw.hostId,
    localRoot: raw.localRoot,
    remoteRoot: raw.remoteRoot,
    ignores,
    watch: raw.watch === true
  }
}

function loadPairs(): FolderPairDto[] {
  if (loaded) return pairs
  loaded = true
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf8')) as unknown
    pairs = (Array.isArray(raw) ? raw : [])
      .map((p) => sanitizePair(p as Partial<FolderPairDto>))
      .filter((p): p is FolderPairDto => p !== null)
  } catch {
    pairs = [] // chưa có file hoặc hỏng → bắt đầu trống
  }
  return pairs
}

function savePairs(): void {
  try {
    writeFileSync(configPath(), JSON.stringify(pairs, null, 2), 'utf8')
  } catch (error) {
    console.error('[folder-sync] cannot write config:', error instanceof Error ? error.message : error)
  }
}

function broadcast(payload: FolderSyncEventDto): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IPC.FOLDERSYNC_EVENT, payload)
  }
}

function requirePair(pairId: string): FolderPairDto {
  const pair = loadPairs().find((p) => p.id === pairId)
  if (!pair) throw new Error('Cặp thư mục không tồn tại')
  return pair
}

// ── Liệt kê hai bên ───────────────────────────────────────────────────────────

/** Quét cây local. Trả cả số file bị bỏ qua để UI nói rõ vì sao bảng thiếu file. */
async function listLocal(root: string, ignores: readonly string[]): Promise<{ files: FileStat[]; ignored: number; truncated: boolean }> {
  const files: FileStat[] = []
  let ignored = 0
  let truncated = false
  const walk = async (dir: string, prefix: string): Promise<void> => {
    if (truncated) return
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (isIgnored(rel, ignores)) {
        ignored += 1
        continue
      }
      // Không đi theo symlink: một link trỏ về thư mục cha là vòng lặp vô hạn
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), rel)
        if (truncated) return
        continue
      }
      if (!entry.isFile()) continue
      if (files.length >= FOLDER_SCAN_MAX_FILES) {
        truncated = true
        return
      }
      const stat = await fsp.stat(join(dir, entry.name)).catch(() => null)
      if (stat) files.push({ path: rel, size: stat.size, mtimeMs: stat.mtimeMs })
    }
  }
  await walk(root, '')
  return { files, ignored, truncated }
}

/** Quét cây remote qua SFTP. Thư mục nào không đọc được (thiếu quyền) thì bỏ qua, có ghi cảnh báo. */
async function listRemote(
  sessionId: string,
  root: string,
  ignores: readonly string[]
): Promise<{ files: FileStat[]; ignored: number; truncated: boolean; unreadable: number }> {
  const files: FileStat[] = []
  let ignored = 0
  let truncated = false
  let unreadable = 0
  const walk = async (dir: string, prefix: string): Promise<void> => {
    if (truncated) return
    let entries: Awaited<ReturnType<typeof service.list>>
    try {
      entries = await service.list(sessionId, dir)
    } catch {
      unreadable += 1
      return
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (isIgnored(rel, ignores)) {
        ignored += 1
        continue
      }
      if (entry.kind === 'symlink') continue
      if (entry.kind === 'dir') {
        await walk(`${dir.endsWith('/') ? dir.slice(0, -1) : dir}/${entry.name}`, rel)
        if (truncated) return
        continue
      }
      if (entry.kind !== 'file') continue
      if (files.length >= FOLDER_SCAN_MAX_FILES) {
        truncated = true
        return
      }
      files.push({ path: rel, size: entry.size, mtimeMs: entry.mtimeMs })
    }
  }
  await walk(root, '')
  return { files, ignored, truncated, unreadable }
}

// ── Phiên SFTP dùng lại theo cặp ──────────────────────────────────────────────

async function ensureSession(sender: WebContents, pair: FolderPairDto): Promise<string> {
  const existing = sessions.get(pair.id)
  if (existing) return existing
  if (!getVault().getHost(pair.hostId)) throw new Error('Host của cặp thư mục không còn tồn tại')
  const prepared = await prepareConnection(sender, pair.hostId)
  const viaExecCommand = deriveSftpExecFromLoginSteps(prepared.loginSteps) ?? undefined
  const { sessionId } = await service.open(prepared.chain, makeHostKeyVerifier(sender), viaExecCommand)
  sessions.set(pair.id, sessionId)
  return sessionId
}

function dropSession(pairId: string): void {
  const sessionId = sessions.get(pairId)
  if (!sessionId) return
  sessions.delete(pairId)
  service.close(sessionId)
}

// ── Đẩy file ──────────────────────────────────────────────────────────────────

/** Đẩy một file local lên đúng chỗ, tạo thư mục cha nếu thiếu. */
async function pushOne(sessionId: string, pair: FolderPairDto, relPath: string): Promise<void> {
  const remotePath = remotePathFor(pair.remoteRoot, relPath)
  // remotePathFor trả null cho ".." / đường dẫn tuyệt đối — không được ghép thẳng, sẽ ghi ra
  // NGOÀI thư mục đích trên server
  if (!remotePath) throw new Error(`Đường dẫn không an toàn: ${relPath}`)
  const dir = remoteDirOf(remotePath)
  if (dir !== '/' && dir !== pair.remoteRoot) await mkdirp(sessionId, dir)
  await service.uploadFileTo(sessionId, join(pair.localRoot, relPath), remotePath, 'upload')
}

/** `mkdir -p` bằng SFTP: tạo từng tầng, tầng đã có thì bỏ qua. */
async function mkdirp(sessionId: string, dir: string): Promise<void> {
  const parts = dir.split('/').filter(Boolean)
  let current = ''
  for (const part of parts) {
    current += `/${part}`
    const stat = await service.stat(sessionId, current).catch(() => null)
    if (stat?.kind === 'dir') continue
    await service.mkdir(sessionId, current).catch((error: unknown) => {
      // Có thể một lượt đẩy song song vừa tạo xong — chỉ nổi lỗi khi thật sự không có thư mục
      return service.stat(sessionId, current).then(
        (s) => {
          if (s.kind !== 'dir') throw error
        },
        () => {
          throw error
        }
      )
    })
  }
}

// ── Watcher ───────────────────────────────────────────────────────────────────

function stopWatch(pairId: string): void {
  const state = watches.get(pairId)
  if (!state) return
  watches.delete(pairId)
  for (const timer of state.pending.values()) clearTimeout(timer)
  for (const watcher of state.watchers) watcher.close()
}

/**
 * Bật theo dõi thư mục local. `fs.watch` đệ quy chỉ có trên Windows/macOS; trên Linux nó im lặng
 * chỉ báo tầng gốc — nên ở đó tự đăng ký watcher cho từng thư mục con thay vì để user tưởng đang
 * theo dõi cả cây (đúng bài API-im-lặng của CLAUDE.md §8).
 */
async function startWatch(sender: WebContents, pair: FolderPairDto): Promise<void> {
  stopWatch(pair.id)
  const state: WatchState = { watchers: [], pending: new Map() }
  watches.set(pair.id, state)

  const onChange = (relPath: string): void => {
    if (isIgnored(relPath, pair.ignores)) return
    const existing = state.pending.get(relPath)
    if (existing) clearTimeout(existing)
    state.pending.set(
      relPath,
      setTimeout(() => {
        state.pending.delete(relPath)
        void pushChanged(sender, pair, relPath)
      }, WATCH_DEBOUNCE_MS)
    )
  }

  const recursiveSupported = process.platform === 'win32' || process.platform === 'darwin'
  if (recursiveSupported) {
    state.watchers.push(
      fsWatch(pair.localRoot, { recursive: true }, (_event, filename) => {
        if (filename) onChange(String(filename).replace(/\\/g, '/'))
      })
    )
  } else {
    for (const dir of await listDirs(pair.localRoot, pair.ignores)) {
      const prefix = relativeFrom(pair.localRoot, dir)
      state.watchers.push(
        fsWatch(dir, (_event, filename) => {
          if (filename) onChange(prefix ? `${prefix}/${filename}` : String(filename))
        })
      )
    }
  }
  broadcast({ type: 'watch', pairId: pair.id, watching: true })
}

/** Mọi thư mục trong cây (kể cả gốc), bỏ những cây con bị ignore. */
async function listDirs(root: string, ignores: readonly string[]): Promise<string[]> {
  const out = [root]
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (isIgnored(rel, ignores)) continue
      const full = join(dir, entry.name)
      out.push(full)
      await walk(full, rel)
    }
  }
  await walk(root, '')
  return out
}

/** Một file vừa đổi → đẩy lên. File bị xoá thì KHÔNG xoá trên server (xem ghi chú ở đầu file). */
async function pushChanged(sender: WebContents, pair: FolderPairDto, relPath: string): Promise<void> {
  const local = await fsp.stat(join(pair.localRoot, relPath)).catch(() => null)
  if (!local?.isFile()) return // vừa xoá / là thư mục / đổi tên — không đẩy
  try {
    const sessionId = await ensureSession(sender, pair)
    await pushOne(sessionId, pair, relPath)
    broadcast({ type: 'pushed', pairId: pair.id, path: relPath, at: Date.now() })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Kết nối đứt giữa lúc watcher đang chạy: bỏ phiên để lượt sau nối lại, và nói rõ ra
    dropSession(pair.id)
    broadcast({ type: 'error', pairId: pair.id, path: relPath, message })
    recordEvent({
      kind: 'alert',
      source: 'app',
      severity: 'warning',
      hostId: pair.hostId,
      title: `Không đẩy được ${relPath}`,
      detail: `${pair.name}: ${message}`
    })
  }
}

// ── IPC ───────────────────────────────────────────────────────────────────────

export function registerFolderSyncIpc(): () => void {
  ipcMain.handle(IPC.FOLDERSYNC_LIST, (): FolderPairDto[] => loadPairs())

  ipcMain.handle(IPC.FOLDERSYNC_SAVE, (_event, input: FolderPairInput): FolderPairDto => {
    const list = loadPairs()
    const pair = sanitizePair(input as Partial<FolderPairDto>)
    if (!pair) throw new Error('Cặp thư mục thiếu host, thư mục local hoặc thư mục remote tuyệt đối')
    const index = list.findIndex((p) => p.id === pair.id)
    if (index >= 0) {
      // Đổi đường dẫn / mẫu ignore thì watcher cũ đang theo dõi thứ khác → dựng lại
      stopWatch(pair.id)
      dropSession(pair.id)
      list[index] = pair
    } else {
      list.push(pair)
    }
    savePairs()
    return pair
  })

  ipcMain.handle(IPC.FOLDERSYNC_DELETE, (_event, id: string): void => {
    stopWatch(id)
    dropSession(id)
    pairs = loadPairs().filter((p) => p.id !== id)
    savePairs()
  })

  ipcMain.handle(IPC.FOLDERSYNC_PICK_LOCAL, async (event): Promise<string | null> => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options = { title: 'Chọn thư mục local', properties: ['openDirectory' as const] }
    const pick = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    return pick.canceled || !pick.filePaths[0] ? null : pick.filePaths[0]
  })

  ipcMain.handle(IPC.FOLDERSYNC_SCAN, async (event, pairId: string): Promise<FolderScanDto> => {
    touchActivity()
    const pair = requirePair(pairId)
    const sessionId = await ensureSession(event.sender, pair)
    const [local, remote] = await Promise.all([
      listLocal(pair.localRoot, pair.ignores),
      listRemote(sessionId, pair.remoteRoot, pair.ignores)
    ])
    const entries = diffFolders(local.files, remote.files)
    const warnings: string[] = []
    if (local.truncated || remote.truncated) warnings.push(`Cây quá lớn, chỉ so ${FOLDER_SCAN_MAX_FILES} file đầu`)
    if (remote.unreadable > 0) warnings.push(`${remote.unreadable} thư mục remote không đọc được (thiếu quyền)`)
    return {
      pairId,
      scannedAt: Date.now(),
      entries,
      counts: countByStatus(entries),
      ignored: local.ignored + remote.ignored,
      ...(warnings.length > 0 ? { warning: warnings.join(' · ') } : {})
    }
  })

  ipcMain.handle(
    IPC.FOLDERSYNC_PUSH,
    async (event, pairId: string, paths?: string[]): Promise<{ pushed: number; failed: number; message: string }> => {
      touchActivity()
      const pair = requirePair(pairId)
      const sessionId = await ensureSession(event.sender, pair)
      let list: string[]
      if (Array.isArray(paths) && paths.length > 0) {
        list = paths.filter((p): p is string => typeof p === 'string')
      } else {
        const local = await listLocal(pair.localRoot, pair.ignores)
        const remote = await listRemote(sessionId, pair.remoteRoot, pair.ignores)
        list = toUpload(diffFolders(local.files, remote.files)).map((e: DiffEntry) => e.path)
      }
      let pushed = 0
      let failed = 0
      const errors: string[] = []
      for (const relPath of list) {
        try {
          await pushOne(sessionId, pair, relPath)
          pushed += 1
          broadcast({ type: 'pushed', pairId, path: relPath, at: Date.now() })
        } catch (error) {
          failed += 1
          const message = error instanceof Error ? error.message : String(error)
          if (errors.length < 3) errors.push(`${relPath}: ${message}`)
          broadcast({ type: 'error', pairId, path: relPath, message })
        }
      }
      const message =
        failed === 0 ? `Đã đẩy ${pushed} file` : `Đã đẩy ${pushed} file, ${failed} file lỗi — ${errors.join(' · ')}`
      if (failed > 0) {
        recordEvent({
          kind: 'alert',
          source: 'app',
          severity: 'warning',
          hostId: pair.hostId,
          title: `${failed} file không đẩy được`,
          detail: `${pair.name}: ${errors.join(' · ')}`
        })
      }
      return { pushed, failed, message }
    }
  )

  ipcMain.handle(IPC.FOLDERSYNC_WATCH, async (event, pairId: string, on: boolean): Promise<boolean> => {
    const pair = requirePair(pairId)
    if (!on) {
      stopWatch(pairId)
      pair.watch = false
      savePairs()
      broadcast({ type: 'watch', pairId, watching: false })
      return false
    }
    touchActivity()
    // Nối trước khi báo "đang theo dõi": host sai / vault khoá thì phải lỗi ngay tại đây, chứ
    // không để watcher bật xanh rồi mỗi lần đẩy mới thất bại
    await ensureSession(event.sender, pair)
    await startWatch(event.sender, pair)
    pair.watch = true
    savePairs()
    return true
  })

  return () => {
    for (const id of [...watches.keys()]) stopWatch(id)
    sessions.clear()
    service.closeAll()
  }
}
