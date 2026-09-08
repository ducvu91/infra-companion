import { ipcMain, type WebContents } from 'electron'
import { SECURITY_COMMAND, buildScan, execOnce } from '@infra/core'
import { IPC, type SecurityProgressDto, type SecurityScanDto } from '@infra/shared'
import { makeHostKeyVerifier, prepareConnection } from './connection'
import { touchActivity } from './vault'

/**
 * F38 — Kiểm an ninh nhanh cả fleet. MỘT lệnh chỉ-đọc mỗi host qua kênh exec riêng (xuyên
 * login-script), parse thành danh sách việc cần làm. Không lệnh ghi nào chạy trên host, và kết
 * quả KHÔNG lưu đĩa: nó là ảnh chụp lúc quét, để trong phiên là đủ — lưu lại chỉ tạo thêm một
 * file chứa "máy nào đang hở cổng gì", đúng thứ không nên nằm sẵn trên máy.
 */
const CONCURRENCY = 4
const EXEC_TIMEOUT_MS = 60_000

async function scanOne(sender: WebContents, hostId: string): Promise<SecurityScanDto> {
  const now = Date.now()
  try {
    const prepared = await prepareConnection(sender, hostId)
    const res = await execOnce(prepared.chain, SECURITY_COMMAND, makeHostKeyVerifier(sender), {
      loginSteps: prepared.loginSteps,
      timeoutMs: EXEC_TIMEOUT_MS
    })
    // Lệnh gồm nhiều mục, mục nào thiếu quyền thì rỗng — có dấu `@@` là đã chạy được
    if (!res.stdout.includes('@@')) {
      return { hostId, collectedAt: now, ok: false, error: res.error ?? res.stderr.trim() ?? 'không chạy được lệnh', score: 0, findings: [] }
    }
    return buildScan(hostId, res.stdout, now)
  } catch (error) {
    return { hostId, collectedAt: now, ok: false, error: error instanceof Error ? error.message : String(error), score: 0, findings: [] }
  }
}

export function registerSecurityIpc(): void {
  ipcMain.handle(IPC.SECURITY_SCAN, async (event, hostIds: string[]): Promise<SecurityScanDto[]> => {
    touchActivity()
    const ids = Array.isArray(hostIds) ? hostIds.filter((x): x is string => typeof x === 'string') : []
    const results: SecurityScanDto[] = []
    let done = 0
    const queue = [...ids]
    const worker = async (): Promise<void> => {
      for (;;) {
        const hostId = queue.shift()
        if (hostId === undefined) return
        results.push(await scanOne(event.sender, hostId))
        done += 1
        const progress: SecurityProgressDto = { hostId, done, total: ids.length }
        if (!event.sender.isDestroyed()) event.sender.send(IPC.SECURITY_PROGRESS, progress)
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker))
    return results
  })
}
