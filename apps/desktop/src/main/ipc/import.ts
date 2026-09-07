import { execFile } from 'node:child_process'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { dialog, ipcMain } from 'electron'
import { decodeTextFile, importClientHosts, importSshConfig, parseClientFile, parsePuttyReg } from '@infra/core'
import {
  IPC,
  type ClientImportDraftDto,
  type ClientImportPreviewDto,
  type ClientImportResultDto,
  type SshConfigImportResult
} from '@infra/shared'
import { getVault, touchActivity } from './vault'

const execFileAsync = promisify(execFile)
const PUTTY_REG_KEY = 'HKCU\\Software\\SimonTatham\\PuTTY\\Sessions'

export function registerImportIpc(): void {
  ipcMain.handle(IPC.IMPORT_SSH_CONFIG, async (): Promise<SshConfigImportResult | null> => {
    touchActivity()
    const defaultPath = path.join(os.homedir(), '.ssh', 'config')
    const result = await dialog.showOpenDialog({
      title: 'Chọn file ssh_config',
      defaultPath,
      properties: ['openFile', 'showHiddenFiles']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const content = await fsp.readFile(result.filePaths[0]!, 'utf8')
    return importSshConfig(getVault(), content)
  })

  /**
   * Nhập từ client khác — bước 1: chọn file, parse, trả bảng xem trước. KHÔNG ghi gì. File có
   * thể là UTF-16 (Regedit xuất vậy) nên đọc bytes rồi tự decode theo BOM.
   */
  ipcMain.handle(IPC.IMPORT_CLIENT_PICK, async (): Promise<ClientImportPreviewDto | null> => {
    touchActivity()
    const result = await dialog.showOpenDialog({
      title: 'Chọn file của PuTTY (.reg) / MobaXterm (.mxtsessions) / WinSCP (.ini) / Termius (.csv)',
      properties: ['openFile', 'showHiddenFiles'],
      filters: [
        { name: 'PuTTY / MobaXterm / WinSCP / Termius', extensions: ['reg', 'mxtsessions', 'ini', 'csv', 'txt'] },
        { name: 'Mọi file', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const file = result.filePaths[0]!
    const text = decodeTextFile(await fsp.readFile(file))
    return parseClientFile(path.basename(file), text)
  })

  /**
   * Windows: đọc thẳng PuTTY từ Registry bằng `reg export` ra file tạm rồi parse như .reg.
   * Không dùng module native; ở hệ khác trả null (UI ẩn nút).
   */
  ipcMain.handle(IPC.IMPORT_CLIENT_PUTTY_REGISTRY, async (): Promise<ClientImportPreviewDto | null> => {
    touchActivity()
    if (process.platform !== 'win32') return null
    const tmp = path.join(os.tmpdir(), `infra-putty-${process.pid}-${Date.now()}.reg`)
    try {
      await execFileAsync('reg', ['export', PUTTY_REG_KEY, tmp, '/y'], { windowsHide: true })
      const text = decodeTextFile(await fsp.readFile(tmp))
      const parsed = parsePuttyReg(text)
      return { format: 'putty', source: 'PuTTY (Registry)', drafts: parsed.drafts, warnings: parsed.warnings }
    } catch (error) {
      // Không có PuTTY / khoá không tồn tại → reg trả lỗi: coi như "không có gì để nhập"
      const message = error instanceof Error ? error.message : String(error)
      return { format: 'putty', source: 'PuTTY (Registry)', drafts: [], warnings: [`Không đọc được Registry: ${message}`] }
    } finally {
      await fsp.rm(tmp, { force: true })
    }
  })

  /** Bước 2: ghi các draft user đã tick. Vault phải đang mở. */
  ipcMain.handle(
    IPC.IMPORT_CLIENT_COMMIT,
    (_e, drafts: ClientImportDraftDto[], source: string): ClientImportResultDto => {
      touchActivity()
      if (getVault().state() !== 'unlocked') throw new Error('Vault đang khoá — mở khoá trước đã')
      return importClientHosts(getVault(), Array.isArray(drafts) ? drafts : [], String(source || 'import'))
    }
  )
}
