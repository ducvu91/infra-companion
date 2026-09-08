import { describe, expect, test } from 'vitest'
import {
  NOTIFY_MIN_DURATION_MS,
  OSC133_BASH_SNIPPET,
  commandSucceeded,
  formatDuration,
  parseOsc133,
  shortenCommand,
  shouldNotify
} from '@infra/shared'

/** Thực thi ở `packages/shared` — renderer đọc marker và quyết định có báo (CLAUDE.md §5). */

describe('parseOsc133', () => {
  test('bốn mốc chuẩn A/B/C/D', () => {
    expect(parseOsc133('A')).toEqual({ kind: 'prompt-start', exitCode: null })
    expect(parseOsc133('B')).toEqual({ kind: 'prompt-end', exitCode: null })
    expect(parseOsc133('C')).toEqual({ kind: 'command-start', exitCode: null })
    expect(parseOsc133('D;0')).toEqual({ kind: 'command-done', exitCode: 0 })
    expect(parseOsc133('D;127')).toEqual({ kind: 'command-done', exitCode: 127 })
  })

  test('D không kèm code, hoặc code rác → exitCode null (vẫn là mốc xong)', () => {
    expect(parseOsc133('D')).toEqual({ kind: 'command-done', exitCode: null })
    expect(parseOsc133('D;')).toEqual({ kind: 'command-done', exitCode: null })
    expect(parseOsc133('D;abc')).toEqual({ kind: 'command-done', exitCode: null })
  })

  test('chữ thường và tham số phụ vẫn đọc được; payload lạ → null', () => {
    expect(parseOsc133('c')).toEqual({ kind: 'command-start', exitCode: null })
    expect(parseOsc133('D;0;aid=1')).toEqual({ kind: 'command-done', exitCode: 0 })
    expect(parseOsc133('P;k=i')).toBeNull()
    expect(parseOsc133('')).toBeNull()
  })

  test('exit code âm (bị signal) vẫn giữ nguyên', () => {
    expect(parseOsc133('D;-1')).toEqual({ kind: 'command-done', exitCode: -1 })
  })
})

describe('commandSucceeded', () => {
  test('0 hoặc không biết code = coi như thành công; khác 0 là lỗi', () => {
    expect(commandSucceeded({ exitCode: 0 })).toBe(true)
    expect(commandSucceeded({ exitCode: null })).toBe(true)
    expect(commandSucceeded({ exitCode: 1 })).toBe(false)
    expect(commandSucceeded({ exitCode: 130 })).toBe(false)
  })
})

describe('shouldNotify', () => {
  const base = { command: 'apt-get upgrade -y', durationMs: 60_000, paneVisible: false, enabled: true }

  test('lệnh dài, pane đang ẩn → báo', () => {
    expect(shouldNotify(base)).toEqual({ notify: true })
  })

  test('tính năng tắt → không báo', () => {
    expect(shouldNotify({ ...base, enabled: false })).toEqual({ notify: false, reason: 'disabled' })
  })

  test('pane đang hiện → không báo (user đang nhìn rồi)', () => {
    expect(shouldNotify({ ...base, paneVisible: true })).toEqual({ notify: false, reason: 'pane-visible' })
  })

  test('lệnh ngắn → không báo', () => {
    expect(shouldNotify({ ...base, durationMs: 3000 })).toEqual({ notify: false, reason: 'too-short' })
    // Đúng ngưỡng thì báo
    expect(shouldNotify({ ...base, durationMs: NOTIFY_MIN_DURATION_MS }).notify).toBe(true)
    expect(shouldNotify({ ...base, durationMs: 5000, minDurationMs: 1000 }).notify).toBe(true)
  })

  test('lệnh tương tác / theo dõi log KHÔNG báo dù chạy lâu', () => {
    for (const cmd of ['vim /etc/nginx/nginx.conf', 'tail -f /var/log/syslog', 'htop', 'less big.log', 'mysql -u root -p', 'tmux attach', 'ssh app-01', 'watch df -h', 'journalctl -u nginx -f']) {
      expect(shouldNotify({ ...base, command: cmd }), cmd).toMatchObject({ notify: false, reason: 'interactive' })
    }
    expect(shouldNotify({ ...base, command: 'exit' })).toMatchObject({ reason: 'interactive' })
  })

  test('lệnh có tên chứa chữ giống lệnh tương tác nhưng khác lệnh → vẫn báo', () => {
    // "vimdiff" bắt đầu bằng vim nhưng \b chặn; "topgrade" tương tự
    expect(shouldNotify({ ...base, command: 'topgrade' }).notify).toBe(true)
    expect(shouldNotify({ ...base, command: './deploy-vim-config.sh' }).notify).toBe(true)
  })

  test('lệnh rỗng → không báo', () => {
    expect(shouldNotify({ ...base, command: '   ' })).toEqual({ notify: false, reason: 'empty' })
  })
})

describe('formatDuration / shortenCommand', () => {
  test('ms, giây lẻ, giây chẵn, phút, giờ', () => {
    expect(formatDuration(450)).toBe('450ms')
    expect(formatDuration(1200)).toBe('1.2s')
    expect(formatDuration(45_000)).toBe('45s')
    expect(formatDuration(180_000)).toBe('3m')
    expect(formatDuration(200_000)).toBe('3m20s')
    expect(formatDuration(3_840_000)).toBe('1h04m')
  })

  test('cắt lệnh dài, gộp khoảng trắng', () => {
    expect(shortenCommand('  ls   -la  ')).toBe('ls -la')
    expect(shortenCommand('x'.repeat(80))).toHaveLength(60)
    expect(shortenCommand('x'.repeat(80)).endsWith('…')).toBe(true)
    expect(shortenCommand('abc', 10)).toBe('abc')
  })
})

describe('OSC133_BASH_SNIPPET', () => {
  test('có guard chống dán hai lần, nhánh cho cả zsh và bash, và cả bốn mốc', () => {
    expect(OSC133_BASH_SNIPPET).toContain('__ic_osc133')
    expect(OSC133_BASH_SNIPPET).toContain('ZSH_VERSION')
    expect(OSC133_BASH_SNIPPET).toContain('BASH_VERSION')
    for (const mark of ['133;A', '133;B', '133;C', '133;D']) expect(OSC133_BASH_SNIPPET, mark).toContain(mark)
  })

  test('KHÔNG dùng $(...) ở tầng ngoài — phải đi qua được hop login-script (§4)', () => {
    expect(OSC133_BASH_SNIPPET).not.toMatch(/\$\(/)
  })
})
