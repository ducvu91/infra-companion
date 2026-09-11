/**
 * Cài / cập nhật Codex CLI **vào thư mục riêng của app** — thuần, dựng đường dẫn và argv.
 *
 * Vì sao app phải tự cài thay vì chỉ bảo user đi cập nhật:
 *
 * 1. `codex update` (lệnh có sẵn của CLI) **không dùng được** với bản do Codex desktop app quản.
 *    Đo thật: nó thoát ngay với *"Could not detect the Codex installation method. Please update
 *    manually"* — vì binary nằm trong thư mục hash của app đó, không phải npm/brew.
 * 2. Bản CLI cũ làm **mọi model đều lỗi**: 0.142.4 chỉ biết `gpt-5.5` (mà server đã bỏ → 404),
 *    trong khi 0.154.0 báo `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5` và chạy được model user
 *    đang cấu hình. Tức "CLI cũ" không phải bất tiện nhỏ mà là tính năng không dùng được.
 *
 * Cài bằng **npm vào thư mục userData của app**, KHÔNG `npm -g`: cài toàn cục cần quyền ghi vào
 * thư mục npm chung và sẽ **đổi cả bản `codex` user gõ ở terminal** — app không được tự ý làm
 * thế với công cụ của người ta. Bản trong userData chỉ app dùng, và `detectCodexBinary` ưu tiên
 * nó khi có.
 */

import { posix, win32 } from 'node:path'

/** Package npm chính thức. `latest` trả bản mới nhất; nó tự kéo binary theo nền tảng. */
export const CODEX_NPM_PACKAGE = '@openai/codex'

/** Thư mục con trong userData chứa bản CLI app tự cài. */
export const CODEX_INSTALL_SUBDIR = 'codex-cli'

/**
 * Đường dẫn binary sau khi `npm install` vào `root`.
 *
 * npm đặt binary thật trong package con theo nền tảng (`@openai/codex-win32-x64/vendor/…`), còn
 * `bin/` của package chính chỉ là script JS bọc ngoài. Trỏ thẳng vào binary để không phải chạy
 * qua Node — đã kiểm chứng đường dẫn này trên win32-x64.
 *
 * Trả về **danh sách** ứng viên vì cấu trúc vendor đổi theo bản; nơi gọi lấy cái đầu tiên tồn tại.
 */
export function installedBinaryCandidates(root: string, platform: NodeJS.Platform): string[] {
  const join = platform === 'win32' ? win32.join : posix.join
  const nm = join(root, 'node_modules', '@openai')
  const exe = platform === 'win32' ? 'codex.exe' : 'codex'

  // Tên package con + tên thư mục vendor theo nền tảng.
  const targets: Array<{ pkg: string; vendor: string }> =
    platform === 'win32'
      ? [{ pkg: 'codex-win32-x64', vendor: 'x86_64-pc-windows-msvc' }]
      : platform === 'darwin'
        ? [
            { pkg: 'codex-darwin-arm64', vendor: 'aarch64-apple-darwin' },
            { pkg: 'codex-darwin-x64', vendor: 'x86_64-apple-darwin' },
          ]
        : [
            { pkg: 'codex-linux-x64', vendor: 'x86_64-unknown-linux-musl' },
            { pkg: 'codex-linux-arm64', vendor: 'aarch64-unknown-linux-musl' },
          ]

  const out: string[] = []
  for (const t of targets) {
    out.push(join(nm, t.pkg, 'vendor', t.vendor, 'bin', exe))
  }
  // Dự phòng: bản mới có thể đặt binary ngay trong `bin/` của package chính.
  out.push(join(nm, 'codex', 'bin', exe))
  return out
}

/**
 * argv cho `npm install`.
 *
 * `--no-save` vì không có `package.json` để ghi vào; `--no-audit`/`--no-fund` để output ngắn và
 * không gọi thêm mạng cho việc không liên quan; `--prefix` để npm cài vào đúng thư mục app chứ
 * không đi tìm `package.json` ở cây trên.
 */
export function npmInstallArgs(root: string, version = 'latest'): string[] {
  return [
    'install',
    `${CODEX_NPM_PACKAGE}@${version}`,
    '--prefix',
    root,
    '--no-save',
    '--no-audit',
    '--no-fund',
    '--loglevel',
    'error',
  ]
}

/**
 * So version dạng `a.b.c` — trả `true` nếu `a` MỚI HƠN `b`.
 *
 * Chỉ so ba số đầu, bỏ hậu tố (`-alpha.6`): app dùng nó để nói "có bản mới", không phải để chọn
 * bản, nên chính xác tới patch là đủ. Không parse được thì trả `false` — đừng báo có bản mới dựa
 * trên một chuỗi không hiểu.
 */
export function isNewerVersion(a: string, b: string): boolean {
  const nums = (s: string): number[] => {
    const m = s.match(/(\d+)\.(\d+)\.(\d+)/)
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : []
  }
  const x = nums(a)
  const y = nums(b)
  if (x.length !== 3 || y.length !== 3) return false
  for (let i = 0; i < 3; i++) {
    if (x[i]! !== y[i]!) return x[i]! > y[i]!
  }
  return false
}
