import { describe, expect, test } from 'vitest'
import {
  DEFAULT_IGNORES,
  MTIME_TOLERANCE_MS,
  countByStatus,
  diffFolders,
  isIgnored,
  parseIgnores,
  relativeFrom,
  remoteDirOf,
  remotePathFor,
  toUpload,
  type FileStat
} from '@infra/shared'

/** Thực thi ở `packages/shared` — renderer vẽ bảng so lệch từ đúng các hàm này (CLAUDE.md §5). */

const T = 1_760_000_000_000
const f = (path: string, size: number, mtimeMs: number): FileStat => ({ path, size, mtimeMs })

describe('diffFolders', () => {
  test('giống nhau (cùng size, mtime trong ngưỡng) → same', () => {
    const out = diffFolders([f('a.txt', 100, T)], [f('a.txt', 100, T + 1500)])
    expect(out).toHaveLength(1)
    expect(out[0]!.status).toBe('same')
  })

  test('mtime lệch quá ngưỡng → bên nào mới hơn thắng', () => {
    expect(diffFolders([f('a', 10, T + 10_000)], [f('a', 10, T)])[0]!.status).toBe('local-newer')
    expect(diffFolders([f('a', 10, T)], [f('a', 10, T + 10_000)])[0]!.status).toBe('remote-newer')
    // Đúng ngưỡng thì vẫn coi là giống
    expect(diffFolders([f('a', 10, T + MTIME_TOLERANCE_MS)], [f('a', 10, T)])[0]!.status).toBe('same')
  })

  test('cùng mtime mà khác size → conflict (không tự quyết)', () => {
    expect(diffFolders([f('a', 10, T)], [f('a', 99, T)])[0]!.status).toBe('conflict')
  })

  test('chỉ một bên có', () => {
    const out = diffFolders([f('only-local', 1, T)], [f('only-remote', 1, T)])
    expect(out.find((e) => e.path === 'only-local')).toMatchObject({ status: 'local-only', remote: null })
    expect(out.find((e) => e.path === 'only-remote')).toMatchObject({ status: 'remote-only', local: null })
  })

  test('xếp việc cần làm lên trước, same xuống cuối; trong nhóm theo đường dẫn', () => {
    const out = diffFolders(
      [f('z-same', 1, T), f('b-newer', 2, T + 9999), f('a-only', 3, T), f('c-conflict', 4, T)],
      [f('z-same', 1, T), f('b-newer', 2, T), f('c-conflict', 44, T), f('r-only', 5, T)]
    )
    expect(out.map((e) => e.status)).toEqual(['conflict', 'local-newer', 'local-only', 'remote-only', 'same'])
  })

  test('hai bên rỗng → rỗng', () => {
    expect(diffFolders([], [])).toEqual([])
  })
})

describe('toUpload / countByStatus', () => {
  const entries = diffFolders(
    [f('new.txt', 1, T + 9999), f('only.txt', 1, T), f('same.txt', 1, T), f('conf.txt', 1, T)],
    [f('new.txt', 1, T), f('same.txt', 1, T), f('conf.txt', 9, T), f('rem.txt', 1, T)]
  )

  test('chỉ đẩy local mới hơn và chỉ-có-ở-local; conflict KHÔNG tự đẩy', () => {
    expect(toUpload(entries).map((e) => e.path).sort()).toEqual(['new.txt', 'only.txt'])
  })

  test('đếm đủ mọi trạng thái', () => {
    expect(countByStatus(entries)).toEqual({ same: 1, 'local-newer': 1, 'remote-newer': 0, 'local-only': 1, 'remote-only': 1, conflict: 1 })
  })
})

describe('isIgnored', () => {
  test('tên thư mục chặn cả cây con', () => {
    expect(isIgnored('node_modules/react/index.js', DEFAULT_IGNORES)).toBe(true)
    expect(isIgnored('.git/HEAD', DEFAULT_IGNORES)).toBe(true)
    expect(isIgnored('src/app.js', DEFAULT_IGNORES)).toBe(false)
  })

  test('* khớp theo đoạn, mọi tầng', () => {
    expect(isIgnored('logs/app.log', DEFAULT_IGNORES)).toBe(true)
    expect(isIgnored('deep/dir/x.swp', DEFAULT_IGNORES)).toBe(true)
    expect(isIgnored('app.logger.js', DEFAULT_IGNORES)).toBe(false)
  })

  test('không phân biệt hoa thường, mẫu rỗng bị bỏ qua, mẫu có ký tự regex vẫn an toàn', () => {
    expect(isIgnored('Thumbs.DB', DEFAULT_IGNORES)).toBe(true)
    expect(isIgnored('a.txt', ['', '   '])).toBe(false)
    expect(isIgnored('a+b', ['a+b'])).toBe(true)
    expect(isIgnored('axb', ['a+b'])).toBe(false)
  })

  test('danh sách mẫu rỗng → không bỏ qua gì', () => {
    expect(isIgnored('node_modules/x', [])).toBe(false)
  })
})

describe('remotePathFor / remoteDirOf / relativeFrom', () => {
  test('ghép bằng /, chịu được gốc có hoặc không có / cuối', () => {
    expect(remotePathFor('/var/www/app', 'src/index.php')).toBe('/var/www/app/src/index.php')
    expect(remotePathFor('/var/www/app/', 'index.php')).toBe('/var/www/app/index.php')
  })

  test('CHẶN đi ra ngoài gốc (.. hoặc đường dẫn tuyệt đối) → null', () => {
    expect(remotePathFor('/var/www/app', '../../etc/passwd')).toBeNull()
    expect(remotePathFor('/var/www/app', 'a/../../b')).toBeNull()
    expect(remotePathFor('/var/www/app', '/etc/passwd')).toBeNull()
    // Tên file chứa hai dấu chấm nhưng không phải đoạn ".." thì hợp lệ
    expect(remotePathFor('/var/www/app', 'a..b.txt')).toBe('/var/www/app/a..b.txt')
  })

  test('dấu \\ của Windows được chuẩn hoá', () => {
    expect(remotePathFor('/var/www/app', 'src\\lib\\x.js')).toBe('/var/www/app/src/lib/x.js')
  })

  test('remoteDirOf lấy thư mục cha, gốc là /', () => {
    expect(remoteDirOf('/var/www/app/src/x.js')).toBe('/var/www/app/src')
    expect(remoteDirOf('/x.js')).toBe('/')
  })

  test('relativeFrom: bỏ tiền tố gốc, chuẩn hoá \\, ngoài gốc → null', () => {
    expect(relativeFrom('D:\\work\\app', 'D:\\work\\app\\src\\x.js')).toBe('src/x.js')
    expect(relativeFrom('/home/me/app/', '/home/me/app/index.php')).toBe('index.php')
    expect(relativeFrom('D:\\work\\app', 'D:\\WORK\\APP\\a.txt')).toBe('a.txt') // Windows không phân biệt hoa thường
    expect(relativeFrom('/home/me/app', '/home/me/other/x')).toBeNull()
    expect(relativeFrom('/home/me/app', '/home/me/app')).toBeNull()
  })
})

describe('parseIgnores', () => {
  test('tách theo dòng và dấu phẩy, bỏ khoảng trắng và dòng rỗng', () => {
    expect(parseIgnores('  .git \n node_modules\n\n*.log,  *.tmp \r\n')).toEqual(['.git', 'node_modules', '*.log', '*.tmp'])
  })

  test('chuỗi rỗng → danh sách rỗng (không bỏ qua gì)', () => {
    expect(parseIgnores('   \n\n')).toEqual([])
  })
})
