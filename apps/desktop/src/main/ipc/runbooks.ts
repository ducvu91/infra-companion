import { ipcMain } from 'electron'
import { IPC, sanitizeRunbook, type Runbook } from '@infra/shared'
import { getVault, touchActivity } from './vault'

/**
 * Sổ tay vận hành — phần RIÊNG của user (sổ tay có sẵn nằm ngay trong renderer, không qua IPC).
 * Lưu một mảng JSON ở bảng `meta` của vault (khoá `runbooks_custom`): không phải bí mật nên không
 * mã hoá, nhưng đi cùng vault.db để backup/khôi phục vault là còn sổ tay. Cần vault mở.
 */
const KEY = 'runbooks_custom'

function requireUnlocked(): void {
  if (getVault().state() !== 'unlocked') throw new Error('Vault đang khoá — mở khoá trước đã')
}

function readAll(): Runbook[] {
  const raw = getVault().readMetaValue(KEY)
  if (!raw) return []
  try {
    const list = JSON.parse(raw) as unknown
    return (Array.isArray(list) ? list : []).map(sanitizeRunbook).filter((r): r is Runbook => r !== null)
  } catch {
    return []
  }
}

function writeAll(list: Runbook[]): void {
  getVault().writeMetaValue(KEY, JSON.stringify(list))
}

export function registerRunbooksIpc(): void {
  ipcMain.handle(IPC.RUNBOOKS_LIST_CUSTOM, (): Runbook[] => {
    requireUnlocked()
    return readAll()
  })

  ipcMain.handle(IPC.RUNBOOKS_SAVE_CUSTOM, (_e, raw: Runbook): Runbook[] => {
    touchActivity()
    requireUnlocked()
    const clean = sanitizeRunbook(raw)
    if (!clean) throw new Error('Sổ tay thiếu tiêu đề')
    const next = { ...clean, updatedAt: Date.now() }
    const list = readAll()
    const idx = list.findIndex((r) => r.id === next.id)
    if (idx >= 0) list[idx] = next
    else list.push(next)
    writeAll(list)
    return list
  })

  ipcMain.handle(IPC.RUNBOOKS_DELETE_CUSTOM, (_e, id: string): Runbook[] => {
    touchActivity()
    requireUnlocked()
    const list = readAll().filter((r) => r.id !== String(id))
    writeAll(list)
    return list
  })
}
