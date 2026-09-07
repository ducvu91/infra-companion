import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { FACTS_COMMAND, InventoryStore, execOnce, factsToCsv, parseFacts } from '@infra/core'
import { IPC, type InventoryCollectResultDto, type InventoryProgressDto, type InventoryRowDto } from '@infra/shared'
import { makeHostKeyVerifier, prepareConnection } from './connection'
import { getVault, touchActivity } from './vault'

/**
 * Kiểm kê fleet — phần main: chạy `FACTS_COMMAND` trên từng host qua kênh exec riêng (xuyên
 * login-script, không đụng phiên terminal), parse, lưu `inventory.db`. Song song có giới hạn để
 * gate/bastion không nghẹt. Không có lệnh ghi nào chạy trên host.
 */
const CONCURRENCY = 4
const EXEC_TIMEOUT_MS = 60_000

let store: InventoryStore | null = null
function getStore(): InventoryStore {
  store ??= new InventoryStore(join(app.getPath('userData'), 'inventory.db'))
  return store
}

async function collectOne(event: IpcMainInvokeEvent, hostId: string): Promise<InventoryCollectResultDto> {
  try {
    const prepared = await prepareConnection(event.sender, hostId)
    const res = await execOnce(prepared.chain, FACTS_COMMAND, makeHostKeyVerifier(event.sender), {
      loginSteps: prepared.loginSteps,
      timeoutMs: EXEC_TIMEOUT_MS
    })
    if (res.status !== 'done' && !res.stdout.includes('@@')) {
      return { hostId, ok: false, error: res.error ?? res.stderr.trim() ?? 'không chạy được lệnh' }
    }
    const facts = parseFacts(res.stdout)
    const row = getStore().record(hostId, facts, Date.now())
    return { hostId, ok: true, row }
  } catch (error) {
    return { hostId, ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function registerInventoryIpc(): () => void {
  ipcMain.handle(IPC.INVENTORY_LIST, (): InventoryRowDto[] => getStore().latestAll())

  ipcMain.handle(IPC.INVENTORY_COLLECT, async (event, hostIds: string[]): Promise<InventoryCollectResultDto[]> => {
    touchActivity()
    const ids = Array.isArray(hostIds) ? hostIds.filter((x): x is string => typeof x === 'string') : []
    const results: InventoryCollectResultDto[] = []
    let done = 0
    const queue = [...ids]
    const worker = async (): Promise<void> => {
      for (;;) {
        const hostId = queue.shift()
        if (hostId === undefined) return
        const r = await collectOne(event, hostId)
        results.push(r)
        done += 1
        const progress: InventoryProgressDto = { hostId, done, total: ids.length }
        if (!event.sender.isDestroyed()) event.sender.send(IPC.INVENTORY_PROGRESS, progress)
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker))
    return results
  })

  ipcMain.handle(IPC.INVENTORY_DELETE, (_e, hostId: string) => {
    getStore().deleteHost(String(hostId))
  })

  ipcMain.handle(IPC.INVENTORY_EXPORT_CSV, async (): Promise<{ ok: boolean; path?: string; message: string }> => {
    touchActivity()
    const rows = getStore().latestAll()
    if (rows.length === 0) return { ok: false, message: 'Chưa có dữ liệu kiểm kê — bấm Thu thập trước' }
    // Nhãn host lấy từ vault nếu đang mở; khoá thì dùng hostname đã thu, cuối cùng là id
    let labels = new Map<string, string>()
    try {
      if (getVault().state() === 'unlocked') labels = new Map(getVault().listHosts().map((h) => [h.id, h.label]))
    } catch {
      /* vault khoá — dùng fallback */
    }
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const options = {
      title: 'Xuất kiểm kê fleet ra CSV',
      defaultPath: `infra-companion-inventory-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    }
    const pick = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
    if (pick.canceled || !pick.filePath) return { ok: false, message: 'Đã huỷ' }
    const csv = factsToCsv(
      rows.map((r) => ({ label: labels.get(r.hostId) ?? r.facts.hostname ?? r.hostId, hostId: r.hostId, collectedAt: r.collectedAt, facts: r.facts }))
    )
    await writeFile(pick.filePath, csv, 'utf8')
    return { ok: true, path: pick.filePath, message: `Đã xuất ${rows.length} host ra ${pick.filePath}` }
  })

  return () => {
    store?.close()
    store = null
  }
}
