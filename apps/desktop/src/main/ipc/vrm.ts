import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { open, readFile, rm, rename, stat, mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { VRM_PROBE_BYTES, probeVrm } from '@infra/core'
import {
  cleanPos,
  DEFAULT_VRM_SETTINGS,
  IPC,
  sampleDownloadCap,
  VRM_MAX_BYTES,
  VRM_MAX_MODELS,
  VRM_MOTIONS,
  VRM_SAMPLE_MODELS,
  VRM_ZOOM_MAX,
  VRM_ZOOM_MIN,
  VRMA_MAX_BYTES,
  type VrmAnimationPickResult,
  type VrmModelDto,
  type VrmOutfit,
  type VrmOutfitFile,
  type VrmOutfitMap,
  type VrmOutfitsResult,
  type VrmPickResult,
  type VrmReadResult,
  type VrmSampleProgress,
  type VrmSampleResult,
  type VrmSettingsDto
} from '@infra/shared'

/**
 * F70 — nhân vật VRM, mức 1: user chọn file `.vrm` trong máy, app nạp lên hiển thị.
 *
 * **Lưu đường dẫn, KHÔNG copy file** — cố ý khác cách làm của font tự thêm (`fonts.ts` copy
 * vào `userData/fonts/`). Lý do: một model VRM thật là 40–60 MB, nhân đôi nó vào thư mục app
 * chẳng đổi lấy gì, còn làm `userData` phình ra mà user không biết. Đổi lại phải chịu việc
 * file có thể biến mất — xử lý bằng cờ `missing` trong danh sách, để UI nói trước thay vì
 * để việc nạp thất bại lúc user bấm.
 *
 * **Kiểm định dạng ngay lúc chọn, đọc 2 MB đầu.** `three-vrm` chỉ báo lỗi sau khi đã nạp cả
 * file vào renderer và dựng scene, mà một glTF thường (không có phần mở rộng VRM) thì nó nạp
 * ra một cục hình học không xương — **hỏng mà không throw**, đúng loại lỗi im lặng ở mục 8
 * CLAUDE.md. Kiểm ở đây thì user nhận câu nói rõ nguyên nhân và 44 MB không phải đi qua IPC
 * để rồi bị bỏ.
 *
 * Danh bạ ở `userData/vrm-models.json`, cấu hình ở `userData/vrm-settings.json` — **ngoài
 * vault** (khuôn `localdev.ts`): không có bí mật nào ở đây, và nhân vật phải hiện được cả khi
 * vault đang khoá.
 */

interface VrmIndexEntry {
  id: string
  path: string
  label: string
  spec: VrmModelDto['spec']
  meta: VrmModelDto['meta']
  sizeBytes: number
  addedAt: number
}

/** Kẹp mức phóng vào khoảng hợp lệ; giá trị hỏng (NaN, thiếu) về 1. */
function clampZoom(v: unknown): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 1
  return Math.min(VRM_ZOOM_MAX, Math.max(VRM_ZOOM_MIN, n))
}

function modelsPath(): string {
  return join(app.getPath('userData'), 'vrm-models.json')
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'vrm-settings.json')
}

/**
 * Bộ trang phục để **file riêng**, không nhét vào `vrm-settings.json`.
 *
 * Hai lý do: đây là một danh sách (settings là các giá trị lẻ), và thêm trường vào
 * `VrmSettingsDto` phải sửa đúng **3 chỗ** (DTO+defaults, `readSettings`, danh sách `clean`
 * trong handler) — thiếu một chỗ là giá trị bị nuốt im lặng lúc ghi. Đã dính một lần rồi.
 */
function outfitsPath(): string {
  return join(app.getPath('userData'), 'vrm-outfits.json')
}

async function readOutfits(): Promise<VrmOutfitFile> {
  const empty: VrmOutfitFile = { outfits: {}, worn: {} }
  try {
    const raw = JSON.parse(await readFile(outfitsPath(), 'utf8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty
    const src = raw as Partial<VrmOutfitFile>
    const outfits: VrmOutfitMap = {}
    for (const [modelId, list] of Object.entries(src.outfits ?? {})) {
      if (!Array.isArray(list)) continue
      outfits[modelId] = list.filter(
        (x): x is VrmOutfit =>
          !!x &&
          typeof x === 'object' &&
          typeof (x as VrmOutfit).id === 'string' &&
          typeof (x as VrmOutfit).name === 'string' &&
          Array.isArray((x as VrmOutfit).hidden)
      )
    }
    const worn: Record<string, string> = {}
    for (const [modelId, id] of Object.entries(src.worn ?? {})) if (typeof id === 'string') worn[modelId] = id
    return { outfits, worn }
  } catch {
    return empty // chưa có file hoặc JSON hỏng → chưa lưu bộ nào
  }
}

async function writeOutfits(file: VrmOutfitFile): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(outfitsPath(), JSON.stringify(file, null, 2), 'utf8')
}

async function readIndex(): Promise<VrmIndexEntry[]> {
  try {
    const raw = JSON.parse(await readFile(modelsPath(), 'utf8')) as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (x): x is VrmIndexEntry =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as VrmIndexEntry).id === 'string' &&
        typeof (x as VrmIndexEntry).path === 'string' &&
        typeof (x as VrmIndexEntry).label === 'string'
    )
  } catch {
    return [] // chưa có file hoặc JSON hỏng → coi như chưa thêm model nào
  }
}

async function writeIndex(entries: VrmIndexEntry[]): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(modelsPath(), JSON.stringify(entries, null, 2), 'utf8')
}

/** Export cho `main/overlay.ts`: quyết định có hiện nhân vật ngoài desktop hay không cần đọc cấu hình này. */
export async function readSettings(): Promise<VrmSettingsDto> {
  try {
    const raw = JSON.parse(await readFile(settingsPath(), 'utf8')) as Partial<VrmSettingsDto>
    return {
      activeId: typeof raw.activeId === 'string' ? raw.activeId : null,
      autoShow: raw.autoShow === true,
      springBones: raw.springBones !== false,
      fpsCap: raw.fpsCap === 60 ? 60 : 30,
      zoom: clampZoom(raw.zoom),
      lookAtCursor: raw.lookAtCursor !== false,
      reactToEvents: raw.reactToEvents !== false,
      rotationY: Number.isFinite(raw.rotationY) ? Number(raw.rotationY) : 0,
      posX: cleanPos(raw.posX),
      posY: cleanPos(raw.posY),
      desktopOverlay: raw.desktopOverlay !== false
    }
  } catch {
    return { ...DEFAULT_VRM_SETTINGS }
  }
}

/** File còn ở chỗ cũ không. Lỗi nào cũng coi là mất — UI chỉ cần biết "nạp được / không". */
async function exists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile()
  } catch {
    return false
  }
}

async function toDto(e: VrmIndexEntry): Promise<VrmModelDto> {
  return { ...e, missing: !(await exists(e.path)) }
}

/**
 * Đọc `n` byte ĐẦU của file. Không dùng `readFile` rồi cắt: việc đó nạp trọn 44 MB vào RAM
 * chỉ để xem 150 KB phần mô tả.
 */
async function readHead(path: string, n: number): Promise<Uint8Array> {
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.allocUnsafe(n)
    const { bytesRead } = await fh.read(buf, 0, n, 0)
    // `subarray` giữ nguyên buffer gốc nên đây là một CỬA SỔ có byteOffset ≠ 0 —
    // `probeVrm` đã tính tới điều đó (có test riêng), đừng "sửa" thành copy cho chắc.
    return buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

/**
 * ==== Tải model mẫu ====
 *
 * Tải ở MAIN chứ không ở renderer: CSP của trang chỉ cho `connect-src 'self'`, nên renderer không
 * gọi ra mạng được — và đó là chủ ý, không nới ra chỉ vì một tính năng.
 *
 * File vào `userData/vrm-samples/`. Đây là ngoại lệ của quy tắc "không copy model vào userData":
 * model mẫu **không phải file của user**, họ không có bản nào khác, nên app phải giữ.
 */
function samplesDir(): string {
  return join(app.getPath('userData'), 'vrm-samples')
}

/** Đang tải — cho phép huỷ, và chặn bấm tải hai lần cùng lúc. */
let sampleAbort: AbortController | null = null

function emitSampleProgress(p: VrmSampleProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IPC.VRM_SAMPLE_PROGRESS, p)
  }
}

/**
 * Tải một model mẫu, kiểm sha256, thêm vào danh bạ.
 *
 * Ghi ra file `.part` rồi mới đổi tên: đứt mạng giữa chừng thì không để lại một file `.vrm` cụt
 * mà lần sau app tưởng là model hợp lệ.
 */
async function downloadSample(id: string): Promise<VrmSampleResult> {
  const spec = VRM_SAMPLE_MODELS.find((m) => m.id === id)
  if (!spec) return { ok: false, reason: 'unknown', detail: `không có model mẫu id=${id}` }
  if (sampleAbort) return { ok: false, reason: 'unknown', detail: 'đang tải một model khác' }

  const entries = await readIndex()
  if (entries.length >= VRM_MAX_MODELS) return { ok: false, reason: 'io', detail: 'danh sách model đã đầy' }

  const dir = samplesDir()
  const finalPath = join(dir, spec.fileName)
  const partPath = `${finalPath}.part`
  const ac = new AbortController()
  sampleAbort = ac

  try {
    await mkdir(dir, { recursive: true })
    const urls = [spec.url, ...(spec.mirrors ?? [])]
    let lastErr: Error | null = null
    let received = 0

    for (const url of urls) {
      received = 0
      try {
        const res = await fetch(url, { signal: ac.signal, redirect: 'follow' })
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
        const total = Number(res.headers.get('content-length')) || spec.sizeBytes
        const cap = sampleDownloadCap(spec.sizeBytes)
        const hash = createHash('sha256')
        let lastEmit = 0

        /**
         * Băm cộng dồn theo từng khối và **chặn khi vượt trần**: link bị chuyển hướng sang trang
         * đăng nhập hay trang lỗi sẽ tải mãi cho tới khi đầy đĩa nếu không có bước này.
         */
        const tap = async function* (src: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
          for await (const chunk of src) {
            received += chunk.byteLength
            if (received > cap) throw new Error('nội dung lớn hơn dự kiến — nguồn tải có thể đã đổi')
            hash.update(chunk)
            const now = Date.now()
            if (now - lastEmit >= 200) {
              lastEmit = now
              emitSampleProgress({
                id,
                phase: 'download',
                receivedBytes: received,
                totalBytes: total,
                percent: total > 0 ? Math.min(95, Math.round((received / total) * 95)) : 0
              })
            }
            yield chunk
          }
        }

        await pipeline(Readable.fromWeb(res.body as never), tap, createWriteStream(partPath), { signal: ac.signal })

        emitSampleProgress({ id, phase: 'verify', receivedBytes: received, totalBytes: total, percent: 97 })
        const got = hash.digest('hex')
        if (got !== spec.sha256) {
          await rm(partPath, { force: true })
          emitSampleProgress({ id, phase: 'error', receivedBytes: received, totalBytes: total, percent: 0 })
          return { ok: false, reason: 'checksum', detail: `mong ${spec.sha256.slice(0, 12)}…, nhận ${got.slice(0, 12)}…` }
        }
        lastErr = null
        break
      } catch (e) {
        lastErr = e as Error
        await rm(partPath, { force: true }).catch(() => {})
        if (ac.signal.aborted) break
        // Link hỏng thì thử mirror kế — link bên ngoài chắc chắn sẽ chết theo thời gian
      }
    }

    if (ac.signal.aborted) {
      emitSampleProgress({ id, phase: 'error', receivedBytes: received, totalBytes: null, percent: 0 })
      return { ok: false, reason: 'canceled' }
    }
    if (lastErr) {
      emitSampleProgress({ id, phase: 'error', receivedBytes: received, totalBytes: null, percent: 0 })
      return { ok: false, reason: 'network', detail: lastErr.message }
    }

    await rm(finalPath, { force: true }).catch(() => {})
    await rename(partPath, finalPath)

    // Kiểm đúng như file user tự chọn: đã tải xong không có nghĩa là file dùng được
    const probe = probeVrm(await readHead(finalPath, VRM_PROBE_BYTES))
    if (!probe.ok) {
      await rm(finalPath, { force: true }).catch(() => {})
      emitSampleProgress({ id, phase: 'error', receivedBytes: received, totalBytes: null, percent: 0 })
      return { ok: false, reason: 'checksum', detail: `file không phải VRM hợp lệ (${probe.reason})` }
    }

    const fresh = await readIndex()
    const existing = fresh.find((e) => e.path === finalPath)
    const entry: VrmIndexEntry = {
      id: existing?.id ?? randomUUID(),
      path: finalPath,
      label: spec.label,
      spec: probe.info.spec,
      meta: probe.info.meta,
      sizeBytes: (await stat(finalPath)).size,
      addedAt: existing?.addedAt ?? Date.now()
    }
    await writeIndex(existing ? fresh.map((e) => (e.id === entry.id ? entry : e)) : [...fresh, entry])

    // Tải xong là dùng luôn — user bấm tải để xem nhân vật, không phải để có thêm một dòng danh sách
    const settings = await readSettings()
    await writeFile(settingsPath(), JSON.stringify({ ...settings, activeId: entry.id }, null, 2), 'utf8')

    emitSampleProgress({ id, phase: 'done', receivedBytes: received, totalBytes: received, percent: 100 })
    return { ok: true, modelId: entry.id }
  } catch (e) {
    await rm(partPath, { force: true }).catch(() => {})
    emitSampleProgress({ id, phase: 'error', receivedBytes: 0, totalBytes: null, percent: 0 })
    return { ok: false, reason: 'io', detail: (e as Error).message }
  } finally {
    sampleAbort = null
  }
}

/**
 * ==== Thư viện chuyển động `.vrma` ====
 *
 * Cùng khuôn với model mẫu: tải theo yêu cầu vào `userData/vrm-motions/`, kiểm sha256, ghi `.part`
 * rồi mới đổi tên. Khác ở chỗ tải **cả bộ một lượt** — 13 clip ~4 MB, bắt user bấm từng cái là
 * phiền hơn giá trị nhận lại.
 */
function motionsDir(): string {
  return join(app.getPath('userData'), 'vrm-motions')
}

/** Clip nào đã có trên đĩa (và đúng dung lượng — file cụt coi như chưa có). */
async function installedMotions(): Promise<string[]> {
  const dir = motionsDir()
  const out: string[] = []
  for (const c of VRM_MOTIONS) {
    try {
      const st = await stat(join(dir, c.fileName))
      if (st.size === c.sizeBytes) out.push(c.id)
    } catch {
      /* chưa có — bình thường */
    }
  }
  return out
}

/** Tải một clip; trả `true` nếu sau lượt này file đã nằm đúng chỗ với sha256 khớp. */
async function downloadOneMotion(c: (typeof VRM_MOTIONS)[number], signal: AbortSignal): Promise<boolean> {
  const finalPath = join(motionsDir(), c.fileName)
  const partPath = `${finalPath}.part`
  try {
    const res = await fetch(c.url, { signal, redirect: 'follow' })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const hash = createHash('sha256')
    const cap = sampleDownloadCap(c.sizeBytes)
    let received = 0
    const tap = async function* (src: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
      for await (const chunk of src) {
        received += chunk.byteLength
        if (received > cap) throw new Error('nội dung lớn hơn dự kiến')
        hash.update(chunk)
        yield chunk
      }
    }
    await pipeline(Readable.fromWeb(res.body as never), tap, createWriteStream(partPath), { signal })
    if (hash.digest('hex') !== c.sha256) {
      await rm(partPath, { force: true })
      return false
    }
    await rm(finalPath, { force: true }).catch(() => {})
    await rename(partPath, finalPath)
    return true
  } catch {
    await rm(partPath, { force: true }).catch(() => {})
    return false
  }
}

export function registerVrmIpc(): () => void {
  ipcMain.handle(IPC.VRM_MOTION_LIST, async () => ({
    clips: VRM_MOTIONS,
    installed: await installedMotions()
  }))

  ipcMain.handle(IPC.VRM_MOTION_DOWNLOAD, async () => {
    await mkdir(motionsDir(), { recursive: true })
    const have = new Set(await installedMotions())
    const ac = new AbortController()
    const failed: string[] = []
    // Tuần tự, không song song: 13 request cùng lúc tới cùng một host là cách nhanh nhất bị chặn
    for (const c of VRM_MOTIONS) {
      if (have.has(c.id)) continue
      if (!(await downloadOneMotion(c, ac.signal))) failed.push(c.id)
    }
    const installed = await installedMotions()
    return { ok: failed.length === 0, installed, failed }
  })

  ipcMain.handle(IPC.VRM_MOTION_READ, async (_e, id: string) => {
    const c = VRM_MOTIONS.find((x) => x.id === id)
    if (!c) return { ok: false as const, reason: 'không có clip này' }
    try {
      return { ok: true as const, bytes: new Uint8Array(await readFile(join(motionsDir(), c.fileName))) }
    } catch (e) {
      return { ok: false as const, reason: (e as Error).message }
    }
  })

  ipcMain.handle(IPC.VRM_SAMPLE_LIST, () => VRM_SAMPLE_MODELS)

  ipcMain.handle(IPC.VRM_SAMPLE_DOWNLOAD, (_e, id: string): Promise<VrmSampleResult> => downloadSample(id))

  ipcMain.on(IPC.VRM_SAMPLE_CANCEL, () => sampleAbort?.abort())

  ipcMain.handle(IPC.VRM_LIST, async (): Promise<VrmModelDto[]> => {
    const entries = await readIndex()
    return Promise.all(entries.map(toDto))
  })

  ipcMain.handle(IPC.VRM_PICK, async (): Promise<VrmPickResult> => {
    const res = await dialog.showOpenDialog({
      title: 'Chọn model VRM',
      properties: ['openFile'],
      filters: [
        { name: 'Model VRM', extensions: ['vrm'] },
        { name: 'Mọi file', extensions: ['*'] }
      ]
    })
    if (res.canceled || res.filePaths.length === 0) return { ok: false, reason: 'canceled' }
    const path = res.filePaths[0]!

    const entries = await readIndex()
    if (entries.length >= VRM_MAX_MODELS) return { ok: false, reason: 'full' }

    let sizeBytes: number
    try {
      sizeBytes = (await stat(path)).size
    } catch (e) {
      return { ok: false, reason: 'io', detail: (e as Error).message }
    }
    if (sizeBytes > VRM_MAX_BYTES) {
      return { ok: false, reason: 'tooLarge', detail: `${Math.round(sizeBytes / 1024 / 1024)} MB` }
    }

    let head: Uint8Array
    try {
      head = await readHead(path, VRM_PROBE_BYTES)
    } catch (e) {
      return { ok: false, reason: 'io', detail: (e as Error).message }
    }

    const probe = probeVrm(head)
    if (!probe.ok) {
      // Phân biệt "không phải VRM" (file glTF/ảnh/zip hợp lệ nhưng sai loại) với "file hỏng":
      // hai câu này dẫn user đi hai hướng khác nhau
      return probe.reason === 'notVrm'
        ? { ok: false, reason: 'notVrm' }
        : { ok: false, reason: 'badFile', detail: probe.reason }
    }

    // Cùng một file chọn hai lần thì cập nhật tại chỗ, không tạo dòng thứ hai
    const existing = entries.find((e) => e.path === path)
    const entry: VrmIndexEntry = {
      id: existing?.id ?? randomUUID(),
      path,
      label: probe.info.meta.title ?? basename(path).replace(/\.vrm$/i, ''),
      spec: probe.info.spec,
      meta: probe.info.meta,
      sizeBytes,
      addedAt: existing?.addedAt ?? Date.now()
    }
    await writeIndex(existing ? entries.map((e) => (e.id === entry.id ? entry : e)) : [...entries, entry])

    // Model vừa thêm thành model đang dùng — user chọn file là để xem nó ngay
    const settings = await readSettings()
    await writeFile(settingsPath(), JSON.stringify({ ...settings, activeId: entry.id }, null, 2), 'utf8')

    return { ok: true, model: { ...entry, missing: false } }
  })

  ipcMain.handle(IPC.VRM_REMOVE, async (_e, id: string): Promise<boolean> => {
    const entries = await readIndex()
    if (!entries.some((x) => x.id === id)) return false
    // Chỉ bỏ khỏi danh bạ — file là của user, app không bao giờ xoá file gốc của họ
    await writeIndex(entries.filter((x) => x.id !== id))
    const settings = await readSettings()
    if (settings.activeId === id) {
      await writeFile(settingsPath(), JSON.stringify({ ...settings, activeId: null }, null, 2), 'utf8')
    }
    // Dọn luôn bộ trang phục của model đó: id sinh mới mỗi lần thêm, nên bỏ rồi thêm lại KHÔNG
    // dùng lại được các bộ cũ — để lại chỉ là rác lớn dần mà không ai thấy
    const outfitFile = await readOutfits()
    if (outfitFile.outfits[id] || outfitFile.worn[id]) {
      delete outfitFile.outfits[id]
      delete outfitFile.worn[id]
      await writeOutfits(outfitFile)
    }
    return true
  })

  /**
   * Nạp trọn bytes cho renderer dựng scene. Trả `Uint8Array` — `invoke` chuyển nó bằng
   * structured clone (nhị phân), **không** qua JSON, nên 44 MB đi thẳng. Cố ý KHÔNG dùng
   * data URL như font: base64 làm 44 MB phồng thành ~60 MB chuỗi JS.
   */
  ipcMain.handle(IPC.VRM_READ, async (_e, id: string): Promise<VrmReadResult> => {
    const entry = (await readIndex()).find((x) => x.id === id)
    if (!entry) return { ok: false, reason: 'missing' }
    try {
      const st = await stat(entry.path)
      if (!st.isFile()) return { ok: false, reason: 'missing' }
      if (st.size > VRM_MAX_BYTES) return { ok: false, reason: 'tooLarge' }
      const bytes = await readFile(entry.path)
      return { ok: true, bytes }
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      if (err.code === 'ENOENT') return { ok: false, reason: 'missing' }
      return { ok: false, reason: 'io', detail: err.message }
    }
  })

  /**
   * Chọn file `.vrma` và trả luôn bytes.
   *
   * Khác `VRM_PICK`/`VRM_READ` (tách 2 lượt vì model 40–60 MB và có danh bạ lưu lại): animation
   * chỉ là dữ liệu xương vài trăm KB và **không lưu vào danh bạ** — user nạp lúc nào dùng lúc
   * đó — nên gộp một lượt là đủ.
   */
  ipcMain.handle(IPC.VRM_PICK_ANIMATION, async (): Promise<VrmAnimationPickResult> => {
    const res = await dialog.showOpenDialog({
      title: 'Chọn file chuyển động VRM',
      properties: ['openFile'],
      filters: [
        { name: 'Chuyển động VRM', extensions: ['vrma'] },
        { name: 'Mọi file', extensions: ['*'] }
      ]
    })
    if (res.canceled || res.filePaths.length === 0) return { ok: false, reason: 'canceled' }
    const path = res.filePaths[0]!
    try {
      const size = (await stat(path)).size
      if (size > VRMA_MAX_BYTES) {
        return { ok: false, reason: 'tooLarge', detail: `${Math.round(size / 1024 / 1024)} MB` }
      }
      return { ok: true, name: basename(path), bytes: new Uint8Array(await readFile(path)) }
    } catch (e) {
      return { ok: false, reason: 'io', detail: (e as Error).message }
    }
  })

  ipcMain.handle(IPC.VRM_GET_SETTINGS, (): Promise<VrmSettingsDto> => readSettings())

  ipcMain.handle(IPC.VRM_SET_SETTINGS, async (_e, patch: Partial<VrmSettingsDto>): Promise<VrmSettingsDto> => {
    const next: VrmSettingsDto = { ...(await readSettings()), ...patch }
    // Chuẩn hoá lại sau khi merge: renderer gửi gì cũng không được ghi giá trị lạ vào file
    // ⚠️ Thêm trường mới vào `VrmSettingsDto` thì phải thêm vào ĐÂY và `readSettings()` nữa —
    // thiếu một chỗ là giá trị bị nuốt lúc ghi mà không lỗi nào báo.
    const clean: VrmSettingsDto = {
      activeId: typeof next.activeId === 'string' ? next.activeId : null,
      autoShow: next.autoShow === true,
      springBones: next.springBones !== false,
      fpsCap: next.fpsCap === 60 ? 60 : 30,
      zoom: clampZoom(next.zoom),
      lookAtCursor: next.lookAtCursor !== false,
      reactToEvents: next.reactToEvents !== false,
      // Gói về [-π, π]: kéo xoay nhiều vòng thì số cứ lớn mãi, lưu ra file rồi đọc lại là
      // một con số vô nghĩa
      rotationY: Number.isFinite(next.rotationY) ? Math.atan2(Math.sin(next.rotationY), Math.cos(next.rotationY)) : 0,
      posX: cleanPos(next.posX),
      posY: cleanPos(next.posY),
      desktopOverlay: next.desktopOverlay !== false
    }
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(settingsPath(), JSON.stringify(clean, null, 2), 'utf8')
    return clean
  })

  ipcMain.handle(IPC.VRM_LIST_OUTFITS, async (_e, modelId: string): Promise<VrmOutfitsResult> => {
    const file = await readOutfits()
    return { outfits: file.outfits[modelId] ?? [], wornId: file.worn[modelId] ?? null }
  })

  ipcMain.handle(
    IPC.VRM_SAVE_OUTFIT,
    async (_e, modelId: string, name: string, hidden: string[]): Promise<VrmOutfitsResult> => {
      const file = await readOutfits()
      const list = file.outfits[modelId] ?? []
      const clean = name.trim().slice(0, 60) || 'Bộ không tên'
      // Trùng tên thì GHI ĐÈ chứ không tạo bản thứ hai: user lưu lại cùng một tên là đang muốn
      // cập nhật bộ đó, chứ không phải muốn có hai dòng giống hệt nhau trong danh sách
      const at = list.findIndex((o) => o.name === clean)
      const entry: VrmOutfit = { id: at >= 0 ? list[at]!.id : randomUUID(), name: clean, hidden: [...hidden] }
      file.outfits[modelId] = at >= 0 ? list.map((o, i) => (i === at ? entry : o)) : [...list, entry]
      // Lưu xong là đang mặc chính bộ đó — tổ hợp hiện tại vừa được chụp lại thành nó
      file.worn[modelId] = entry.id
      await writeOutfits(file)
      return { outfits: file.outfits[modelId]!, wornId: entry.id }
    }
  )

  ipcMain.handle(IPC.VRM_REMOVE_OUTFIT, async (_e, modelId: string, outfitId: string): Promise<VrmOutfitsResult> => {
    const file = await readOutfits()
    file.outfits[modelId] = (file.outfits[modelId] ?? []).filter((o) => o.id !== outfitId)
    // Xoá đúng bộ đang mặc thì quên luôn, không để trỏ vào một id không còn tồn tại
    if (file.worn[modelId] === outfitId) delete file.worn[modelId]
    await writeOutfits(file)
    return { outfits: file.outfits[modelId], wornId: file.worn[modelId] ?? null }
  })

  ipcMain.handle(IPC.VRM_SET_WORN_OUTFIT, async (_e, modelId: string, outfitId: string | null): Promise<void> => {
    const file = await readOutfits()
    if (outfitId) file.worn[modelId] = outfitId
    else delete file.worn[modelId]
    await writeOutfits(file)
  })

  return () => {
    ipcMain.removeHandler(IPC.VRM_LIST)
    ipcMain.removeHandler(IPC.VRM_PICK)
    ipcMain.removeHandler(IPC.VRM_REMOVE)
    ipcMain.removeHandler(IPC.VRM_READ)
    ipcMain.removeHandler(IPC.VRM_GET_SETTINGS)
    ipcMain.removeHandler(IPC.VRM_SET_SETTINGS)
    ipcMain.removeHandler(IPC.VRM_PICK_ANIMATION)
    ipcMain.removeHandler(IPC.VRM_LIST_OUTFITS)
    ipcMain.removeHandler(IPC.VRM_SAVE_OUTFIT)
    ipcMain.removeHandler(IPC.VRM_REMOVE_OUTFIT)
    ipcMain.removeHandler(IPC.VRM_SET_WORN_OUTFIT)
    ipcMain.removeHandler(IPC.VRM_MOTION_LIST)
    ipcMain.removeHandler(IPC.VRM_MOTION_DOWNLOAD)
    ipcMain.removeHandler(IPC.VRM_MOTION_READ)
    ipcMain.removeHandler(IPC.VRM_SAMPLE_LIST)
    ipcMain.removeHandler(IPC.VRM_SAMPLE_DOWNLOAD)
    ipcMain.removeAllListeners(IPC.VRM_SAMPLE_CANCEL)
    // Đang tải dở mà thoát app → huỷ, không để pipeline ghi tiếp vào file sau khi mọi thứ đã dọn
    sampleAbort?.abort()
  }
}
