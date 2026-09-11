import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, readdir, stat } from 'node:fs/promises'
import { win32 } from 'node:path'
import {
  buildSpawnArgv,
  codexCandidates,
  codexEnv,
  pickNewestBinDir,
  windowsBinRoot,
  type CodexCandidate,
} from '@infra/core'
import { installedCodexBinary } from './install'

/**
 * Tìm binary `codex` trên máy — phần cần `fs`, tách khỏi `discovery.ts` (thuần, có test).
 *
 * Vì sao phải dò nhiều nơi thay vì chỉ tra PATH: trên máy dev này `where codex` trả rỗng nhưng
 * Codex **có cài** — Codex desktop app đặt binary ở `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\`,
 * mỗi bản một thư mục hash và không symlink ra PATH. Chỉ tra PATH là báo "chưa cài" cho một máy
 * đã cài xong và đăng nhập rồi.
 *
 * Đã kiểm chứng thêm hai điều làm đổi cách viết hàm này:
 * - 3/4 thư mục hash trên máy dev **rỗng** (bản cũ dọn exe nhưng để lại thư mục) → phải kiểm có
 *   exe thật, không chỉ đếm thư mục.
 * - `CODEX_CLI_PATH` trong `~/.codex/config.toml` trỏ tới một hash **đã bị xoá** → một đường dẫn
 *   đọc được không có nghĩa là một file chạy được. Cũng vì thế app không đọc file đó (nó là nhà
 *   của công cụ khác, và app đã cam kết không chạm `~/.codex`).
 */

async function isExecutable(p: string): Promise<boolean> {
  try {
    await access(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Ứng viên từ thư mục bin của Codex desktop (Windows) — chọn bản mới nhất CÓ exe. */
async function windowsDesktopCandidate(env: NodeJS.ProcessEnv): Promise<CodexCandidate | null> {
  const root = windowsBinRoot(env)
  if (!root) return null
  let dirs: string[]
  try {
    const entries = await readdir(root, { withFileTypes: true })
    dirs = entries.filter((e) => e.isDirectory()).map((e) => win32.join(root, e.name))
  } catch {
    return null
  }

  const scanned: Array<{ dir: string; mtimeMs: number; hasExe: boolean }> = []
  for (const dir of dirs) {
    const exe = win32.join(dir, 'codex.exe')
    const [hasExe, mtimeMs] = await Promise.all([
      isExecutable(exe),
      stat(dir)
        .then((s) => s.mtimeMs)
        .catch(() => 0),
    ])
    scanned.push({ dir, mtimeMs, hasExe })
  }

  const picked = pickNewestBinDir(scanned)
  return picked ? { path: picked, source: 'well-known' } : null
}

export interface DetectResult {
  readonly binary: CodexCandidate | null
  /** Mọi đường đã thử — để thông báo nói được "đã tìm ở đâu" thay vì bắt user đoán (R2). */
  readonly searched: string[]
}

/**
 * Dò binary, dừng ở ứng viên đầu tiên chạy được.
 *
 * Thứ tự: `manual` (user chỉ tay) → **bản app tự cài** → PATH → well-known → npm global.
 *
 * Bản app cài đứng trước PATH vì nó là bản app **biết chắc còn mới**: user bấm "Cập nhật Codex"
 * xong thì phải dùng ngay bản vừa tải, không phải bản cũ mà Codex desktop app đang giữ (đã gặp:
 * bản cũ 0.142.4 làm mọi model lỗi).
 */
export async function detectCodexBinary(manual?: string): Promise<DetectResult> {
  const searched: string[] = []

  // Bản app tự cài (nếu có) — kiểm trước cả PATH, xem chú thích trên.
  if (typeof manual !== 'string' || manual.trim() === '') {
    const own = await installedCodexBinary()
    if (own) {
      searched.push(own)
      return { binary: { path: own, source: 'app-managed' }, searched }
    }
  }

  const list = codexCandidates(process.env, process.platform, manual)

  for (const c of list) {
    searched.push(c.path)
    if (await isExecutable(c.path)) return { binary: c, searched }
  }

  // Windows: thư mục hash phải duyệt runtime nên `codexCandidates` không sinh sẵn.
  if (process.platform === 'win32') {
    const root = windowsBinRoot(process.env)
    if (root) searched.push(win32.join(root, '*', 'codex.exe'))
    const desktop = await windowsDesktopCandidate(process.env)
    if (desktop) return { binary: desktop, searched }
  }

  return { binary: null, searched }
}

/**
 * Chạy `codex --version`, timeout ngắn.
 *
 * Trả `null` khi không chạy được. Chuỗi version **chỉ để hiển thị** — không bao giờ so sánh để
 * bật/tắt tính năng (R1: schema đổi theo bản, nên feature-detect qua `initialize` chứ không
 * qua số version).
 */
export async function codexVersion(binary: string, timeoutMs = 5_000): Promise<string | null> {
  const { file, args } = buildSpawnArgv(binary, ['--version'], process.platform)
  return new Promise<string | null>((resolve) => {
    let out = ''
    let done = false
    const finish = (v: string | null): void => {
      if (done) return
      done = true
      resolve(v)
    }

    const child = spawn(file, args, {
      env: codexEnv(process.env),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* đã chết */
      }
      finish(null)
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (c: string) => {
      out += c
    })
    child.on('error', () => {
      clearTimeout(timer)
      finish(null)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      const text = out.trim()
      finish(code === 0 && text !== '' ? text.split('\n')[0]!.trim() : null)
    })
  })
}
