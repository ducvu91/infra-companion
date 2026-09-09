import { readFile, writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC, type CommandHistoryEntry } from '@infra/shared'
import { getVault, touchActivity } from './vault'

/**
 * F24 — lịch sử LỆNH theo host.
 *
 * Ghi nhận đến từ renderer: OSC 133 (F23) chỉ đến được xterm, nên chỉ renderer biết một lệnh
 * vừa bắt đầu và vừa xong. Main chỉ là nơi có vault.
 *
 * **`touchActivity()` cố ý KHÔNG được gọi ở đường GHI.** Ghi lịch sử xảy ra mỗi lần một lệnh
 * kết thúc, kể cả khi người dùng đã bỏ máy đi từ lâu và lệnh đó là một `sleep` dài hay một
 * job trong tmux — coi đó là "người dùng đang hoạt động" thì vault **không bao giờ auto-lock**
 * nữa. Cùng lý do đã ghi cho auto-sync và lịch chạy tự động. Đường ĐỌC/xoá thì có, vì đó là
 * người dùng thật đang bấm.
 */
export function registerCommandHistoryIpc(): void {
  /**
   * Vault khoá thì im lặng bỏ lượt — KHÔNG throw. Lệnh vẫn chạy bình thường trong terminal khi
   * vault khoá (phiên SSH đã mở từ trước), và một hộp lỗi bật lên giữa lúc người ta đang gõ chỉ
   * để nói "không ghi được lịch sử" là phá việc chính vì một việc phụ.
   */
  ipcMain.handle(
    IPC.CMDHIST_ADD,
    (
      _e,
      input: {
        hostId: string | null
        hostLabel: string
        command: string
        exitCode: number | null
        durationMs: number
        startedAt: number
        redacted?: boolean
      }
    ): boolean => {
      const vault = getVault()
      if (vault.state() !== 'unlocked') return false
      try {
        vault.addCommandHistory(input)
        return true
      } catch {
        return false
      }
    }
  )

  ipcMain.handle(
    IPC.CMDHIST_LIST,
    (_e, options?: { hostId?: string | null; limit?: number }): CommandHistoryEntry[] => {
      touchActivity()
      if (getVault().state() !== 'unlocked') return []
      return getVault().listCommandHistory(options ?? {})
    }
  )

  // Hai đường XOÁ cũng phải chặn khi vault khoá, dù chúng không cần DEK để chạy:
  // `deleteCommandHistory`/`clearCommandHistory` chỉ gọi `ensureDb()`, mà `ensureDb()` mở được
  // file DB không cần khoá — nên thiếu guard này thì `DELETE FROM command_history` thi hành
  // bình thường **sau lưng màn hình khoá**, mất dữ liệu vĩnh viễn. Guard ở renderer không tính:
  // main là biên giới.
  ipcMain.handle(IPC.CMDHIST_DELETE, (_e, id: string): boolean => {
    if (getVault().state() !== 'unlocked') return false
    touchActivity()
    getVault().deleteCommandHistory(id)
    return true
  })

  ipcMain.handle(IPC.CMDHIST_CLEAR, (_e, hostId?: string | null): number => {
    if (getVault().state() !== 'unlocked') return 0
    touchActivity()
    return getVault().clearCommandHistory(hostId ?? null)
  })

  /**
   * Xuất ra file JSON **KHÔNG mã hoá** — lịch sử lệnh không đi qua sync (xem migration v19),
   * nên đây là đường duy nhất mang nó sang máy khác.
   *
   * Không mã hoá là quyết định có ý thức: file này để người dùng tự mang đi bằng USB/`scp`, mã
   * hoá nó lại đòi thêm một passphrase nữa để rồi quên. Bù lại **phải nói thẳng trong thông báo**
   * rằng file là chữ thường đọc được, để người ta biết không thả nó vào một thư mục chia sẻ.
   */
  ipcMain.handle(IPC.CMDHIST_EXPORT, async (_e, hostId?: string | null): Promise<string | null> => {
    touchActivity()
    if (getVault().state() !== 'unlocked') return null
    const entries = getVault().listCommandHistory({ hostId: hostId ?? null })
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const options = {
      title: 'Xuất lịch sử lệnh ra file',
      defaultPath: `infra-command-history-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const pick = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
    if (pick.canceled || !pick.filePath) return null
    // Bỏ `id` — id là của bản ghi trong vault này, máy nhận tự sinh id mới.
    const payload = {
      kind: 'infra-companion/command-history',
      version: 1,
      exportedAt: Date.now(),
      entries: entries.map(({ id: _id, ...rest }) => rest)
    }
    await writeFile(pick.filePath, JSON.stringify(payload, null, 2), 'utf8')
    return pick.filePath
  })

  ipcMain.handle(IPC.CMDHIST_IMPORT, async (): Promise<{ added: number; message?: string }> => {
    touchActivity()
    if (getVault().state() !== 'unlocked') return { added: 0, message: 'Vault đang khoá — mở khoá trước đã' }
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const options = {
      title: 'Nhập lịch sử lệnh từ file',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile' as const]
    }
    const pick = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (pick.canceled || pick.filePaths.length === 0) return { added: 0, message: 'Đã huỷ' }
    try {
      const raw = await readFile(pick.filePaths[0]!, 'utf8')
      const parsed = JSON.parse(raw) as { kind?: string; entries?: unknown }
      if (parsed.kind !== 'infra-companion/command-history' || !Array.isArray(parsed.entries)) {
        return { added: 0, message: 'File không phải bản xuất lịch sử lệnh của Infra Companion' }
      }
      // Lọc từng dòng thay vì tin cả file: một file sửa tay hoặc cắt dở sẽ có dòng thiếu trường,
      // và một `undefined` lọt vào `INSERT` là lỗi SQL giữa vòng lặp — nhập được nửa rồi vỡ.
      const entries = parsed.entries.filter(
        (e): e is Omit<CommandHistoryEntry, 'id'> =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as { command?: unknown }).command === 'string' &&
          (e as { command: string }).command.trim() !== '' &&
          typeof (e as { hostLabel?: unknown }).hostLabel === 'string' &&
          typeof (e as { startedAt?: unknown }).startedAt === 'number' &&
          typeof (e as { durationMs?: unknown }).durationMs === 'number'
      )
      const skipped = parsed.entries.length - entries.length
      const added = getVault().importCommandHistory(
        entries.map((e) => ({
          hostId: typeof e.hostId === 'string' ? e.hostId : null,
          hostLabel: e.hostLabel,
          command: e.command,
          exitCode: typeof e.exitCode === 'number' ? e.exitCode : null,
          durationMs: e.durationMs,
          startedAt: e.startedAt,
          redacted: e.redacted === true
        }))
      )
      const parts = [`Đã nhập ${added} lệnh`]
      if (added < entries.length) parts.push(`${entries.length - added} dòng đã có sẵn`)
      if (skipped > 0) parts.push(`${skipped} dòng bị bỏ vì thiếu trường`)
      return { added, message: parts.join(' · ') }
    } catch (error) {
      return { added: 0, message: error instanceof Error ? error.message : String(error) }
    }
  })
}
