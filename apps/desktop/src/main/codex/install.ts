import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import {
  CODEX_INSTALL_SUBDIR,
  CODEX_NPM_PACKAGE,
  installedBinaryCandidates,
  npmInstallArgs,
} from '@infra/core'

/**
 * Cài / cập nhật Codex CLI **vào thư mục của app** — phần cần `child_process`.
 *
 * Vì sao app tự cài chứ không chỉ bảo user đi cập nhật (cả hai điều đã đo thật):
 * - `codex update` của CLI **không dùng được** với bản do Codex desktop app quản: nó thoát ngay
 *   với *"Could not detect the Codex installation method"*.
 * - Bản cũ 0.142.4 làm **mọi model đều lỗi** (`model/list` chỉ báo `gpt-5.5` mà server đã bỏ →
 *   404), còn 0.154.0 báo `gpt-5.6-terra`/`gpt-5.6-luna`/`gpt-5.5` và chạy được model user đang
 *   cấu hình. Nên "CLI cũ" ở đây không phải bất tiện nhỏ mà là tính năng không dùng được.
 *
 * Cài bằng npm vào `userData/codex-cli`, **KHÔNG `npm -g`**: cài toàn cục cần quyền ghi thư mục
 * npm chung và sẽ đổi cả bản `codex` user gõ ở terminal — app không được tự ý làm vậy với công
 * cụ của người ta.
 */

/** Thư mục app cài Codex vào. */
export function codexInstallRoot(): string {
  return join(app.getPath('userData'), CODEX_INSTALL_SUBDIR)
}

async function isExecutable(p: string): Promise<boolean> {
  try {
    await access(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Binary do app cài, nếu có. Trả `null` khi chưa cài (hoặc cài dở). */
export async function installedCodexBinary(): Promise<string | null> {
  for (const p of installedBinaryCandidates(codexInstallRoot(), process.platform)) {
    if (await isExecutable(p)) return p
  }
  return null
}

/**
 * `npm` chạy bằng gì.
 *
 * Trên Windows `npm` là shim `.cmd` nên không spawn trực tiếp được với `shell:false` — bọc qua
 * `cmd.exe /d /s /c` (cùng cách `buildSpawnArgv` xử shim của codex). POSIX thì gọi thẳng.
 */
function npmCommand(args: readonly string[]): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    // Quote từng tham số có dấu cách — đường dẫn userData thường có ("AppData\Local").
    const line = ['npm', ...args].map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')
    return { file: 'cmd.exe', args: ['/d', '/s', '/c', line] }
  }
  return { file: 'npm', args: [...args] }
}

export interface InstallResult {
  readonly ok: boolean
  /** Đường dẫn binary sau khi cài — chỉ có khi `ok`. */
  readonly binary?: string
  /** Câu nói được nguyên nhân khi thất bại. */
  readonly error?: string
}

/** Trần thời gian tải: 5 phút. Mạng chậm vẫn kịp (đo thật ~17s), treo thì không giữ UI mãi. */
const INSTALL_TIMEOUT_MS = 5 * 60_000

/**
 * Cài/cập nhật Codex CLI. `onLine` nhận từng dòng output để UI hiện tiến độ.
 *
 * Never-throw: trả `{ok:false, error}` — nơi gọi là một handler IPC, và một promise reject ở đó
 * chỉ thành thông báo vô nghĩa cho user.
 */
export async function installCodexCli(
  onLine: (line: string) => void,
  version = 'latest',
): Promise<InstallResult> {
  const root = codexInstallRoot()
  try {
    await mkdir(root, { recursive: true })
  } catch (error) {
    return { ok: false, error: `khong tao duoc thu muc cai: ${error instanceof Error ? error.message : String(error)}` }
  }

  const { file, args } = npmCommand(npmInstallArgs(root, version))
  onLine(`npm install ${CODEX_NPM_PACKAGE}@${version} …`)

  const code = await new Promise<number | null>((resolve) => {
    const child = spawn(file, args, {
      cwd: root,
      // KHÔNG dùng `codexEnv` ở đây: đó là env cho tiến trình *agent* (lọc rất chặt, bỏ cả
      // biến proxy nội bộ của npm). npm cần env của user để biết registry/proxy/cert — cài
      // sau proxy công ty mà lọc mất `NPM_CONFIG_*` là tải không được.
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const timer = setTimeout(() => {
      onLine('het thoi gian cho (5 phut) — dang huy')
      try {
        child.kill()
      } catch {
        /* da chet */
      }
    }, INSTALL_TIMEOUT_MS)

    const pump = (chunk: string): void => {
      for (const l of chunk.split('\n')) {
        const t = l.trim()
        if (t !== '') onLine(t)
      }
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', pump)
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', pump)
    child.on('error', (err) => {
      clearTimeout(timer)
      // ENOENT = không có npm trên máy. Nói rõ, đừng để user đoán.
      onLine(`khong chay duoc npm: ${err.message}`)
      resolve(null)
    })
    child.on('exit', (c) => {
      clearTimeout(timer)
      resolve(c)
    })
  })

  if (code !== 0) {
    return {
      ok: false,
      error:
        code === null
          ? 'khong chay duoc npm — may can co Node.js/npm de app tu cai Codex'
          : `npm install thoat voi code ${code}`,
    }
  }

  const binary = await installedCodexBinary()
  if (!binary) {
    // npm báo thành công mà không tìm thấy binary = cấu trúc package đã đổi. Đây đúng loại lỗi
    // im lặng mục 8 CLAUDE.md nói tới, nên phải kiểm tường minh chứ không tin exit code.
    return { ok: false, error: 'npm bao thanh cong nhung khong tim thay binary codex trong thu muc vua cai' }
  }
  onLine(`da cai: ${binary}`)
  return { ok: true, binary }
}
