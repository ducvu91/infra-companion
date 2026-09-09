import { describe, expect, test } from 'vitest'
import {
  MAX_COMMAND_LEN,
  REDACTED,
  prepareForStore,
  redactCommand,
  scoreCommand,
  searchCommandHistory,
  shouldRecord,
  stripPrompt,
  type CommandHistoryEntry
} from '@infra/shared'

const entry = (over: Partial<CommandHistoryEntry> = {}): CommandHistoryEntry => ({
  id: 'e1',
  hostId: 'h1',
  hostLabel: 'app-01',
  command: 'systemctl restart nginx',
  exitCode: 0,
  durationMs: 1200,
  startedAt: 1_700_000_000_000,
  redacted: false,
  ...over
})

describe('shouldRecord', () => {
  test('lệnh thường thì lưu', () => {
    expect(shouldRecord('systemctl restart nginx').record).toBe(true)
    expect(shouldRecord('tail -n 200 /var/log/nginx/error.log').record).toBe(true)
  })

  test('rỗng / quá ngắn thì bỏ, kèm lý do', () => {
    expect(shouldRecord('   ')).toEqual({ record: false, reason: 'empty' })
    expect(shouldRecord('ps')).toEqual({ record: false, reason: 'too-short' })
  })

  test('lệnh tầm thường thì bỏ — gõ lại nhanh hơn tìm', () => {
    for (const cmd of ['cd ..', 'cd /var/log', 'clear', 'exit', 'ls -la', 'll -h']) {
      expect(shouldRecord(cmd), cmd).toEqual({ record: false, reason: 'trivial' })
    }
  })

  test('lệnh tầm thường mà NGẮN thì bị chặn ở bậc độ dài trước — vẫn không lưu', () => {
    // Thứ tự lọc là cố ý: rỗng → quá ngắn → tầm thường. `ls`/`pwd` chỉ 2-3 ký tự nên rơi ở bậc
    // độ dài; kết quả (không lưu) như nhau, lý do khác nhau — test nói đúng cái đang xảy ra
    // thay vì nói cái mình mong.
    for (const cmd of ['ls', 'll', 'pwd', 'w']) {
      expect(shouldRecord(cmd).record, cmd).toBe(false)
    }
  })

  test('lệnh có mật khẩu VẪN được lưu — chỉ giá trị bị che', () => {
    // Đây đúng là loại lệnh người ta cần tìm lại nhất; loại bỏ hẳn là mất tính năng.
    expect(shouldRecord('mysqldump -u root -pPLACEHOLDER1 mydb > dump.sql').record).toBe(true)
  })

  test('`ls` có đường dẫn thì KHÔNG tầm thường — đó là một câu hỏi thật', () => {
    expect(shouldRecord('ls -la /var/www/releases').record).toBe(true)
  })
})

describe('redactCommand — che bí mật', () => {
  test('mysql -pXXX bị che, phần còn lại giữ nguyên', () => {
    const { text, redacted } = redactCommand('mysqldump -u root -pPLACEHOLDER1 mydb > dump.sql')
    expect(redacted).toBe(true)
    expect(text).toBe(`mysqldump -u root -p${REDACTED} mydb > dump.sql`)
    expect(text).not.toContain('PLACEHOLDER1')
  })

  test('--password= và --token= bị che', () => {
    expect(redactCommand('mysql --password=PLACEHOLDER2 -e "show databases"').text).toContain(`--password=${REDACTED}`)
    expect(redactCommand('gh auth login --token PLACEHOLDER3').text).toContain(`--token ${REDACTED}`)
  })

  test('curl -u user:pass che phần pass, giữ user', () => {
    const { text } = redactCommand('curl -u deploy:PLACEHOLDER4 https://example.com/api')
    expect(text).toBe(`curl -u deploy:${REDACTED} https://example.com/api`)
    expect(text).toContain('deploy')
  })

  test('biến môi trường tên nói rõ là bí mật thì che', () => {
    expect(redactCommand('DB_PASSWORD=PLACEHOLDER5 ./deploy.sh').text).toBe(`DB_PASSWORD=${REDACTED} ./deploy.sh`)
    expect(redactCommand('API_TOKEN=PLACEHOLDER6 npm publish').text).toBe(`API_TOKEN=${REDACTED} npm publish`)
  })

  test('biến môi trường KHÔNG phải bí mật thì giữ nguyên', () => {
    const { text, redacted } = redactCommand('NODE_ENV=production npm run build')
    expect(text).toBe('NODE_ENV=production npm run build')
    expect(redacted).toBe(false)
  })

  test('`-p` của lệnh KHÔNG phải mysql thì không được che', () => {
    // Đây là bẫy thật: `-p\S+` chạy tự do sẽ che `cp -pr`, `mkdir -p`, `docker -p 80:80`
    // và biến lịch sử thành vô dụng.
    for (const cmd of [
      'cp -pr /var/www/a /var/www/b',
      'mkdir -p /opt/app/releases/2026',
      'find /var/log -name "*.log" -print',
      'docker run -p8080:80 nginx',
      'rsync -avzp src/ dest/'
    ]) {
      const { text, redacted } = redactCommand(cmd)
      expect(text, cmd).toBe(cmd)
      expect(redacted, cmd).toBe(false)
    }
  })

  test('lệnh sạch thì redacted = false và không đổi một ký tự', () => {
    const cmd = 'systemctl restart nginx && systemctl status nginx'
    const { text, redacted } = redactCommand(cmd)
    expect(text).toBe(cmd)
    expect(redacted).toBe(false)
  })
})

describe('prepareForStore', () => {
  test('cắt trần độ dài (paste cả script vào terminal)', () => {
    const long = `echo ${'x'.repeat(MAX_COMMAND_LEN + 500)}`
    expect(prepareForStore(long).command.length).toBeLessThanOrEqual(MAX_COMMAND_LEN)
  })

  test('bỏ khoảng trắng đầu/cuối và che bí mật cùng lúc', () => {
    const out = prepareForStore('   mysql -pPLACEHOLDER1 -e "select 1"   ')
    expect(out.command.startsWith('mysql')).toBe(true)
    expect(out.redacted).toBe(true)
    expect(out.command).not.toContain('PLACEHOLDER1')
  })
})

describe('stripPrompt — bỏ prompt khỏi dòng đọc từ buffer', () => {
  test('có promptCol (từ OSC 133;B) thì cắt chính xác', () => {
    const line = '[root@app-01 ~]# systemctl restart nginx'
    expect(stripPrompt(line, '[root@app-01 ~]# '.length)).toBe('systemctl restart nginx')
  })

  test('không có promptCol thì đoán theo ký tự prompt', () => {
    expect(stripPrompt('[root@app-01 ~]# nginx -t')).toBe('nginx -t')
    expect(stripPrompt('deploy@web-01:~$ ls -la /var/www')).toBe('ls -la /var/www')
    expect(stripPrompt('user@host % pnpm build')).toBe('pnpm build')
  })

  test('prompt chứa `$` ở giữa vẫn cắt đúng chỗ (quét ký tự prompt CUỐI)', () => {
    expect(stripPrompt('[user@host $HOME]$ echo hello')).toBe('echo hello')
  })

  test('dòng không có prompt thì trả nguyên chuỗi (đã trim)', () => {
    expect(stripPrompt('  systemctl status nginx  ')).toBe('systemctl status nginx')
  })

  test('promptCol vượt độ dài dòng thì bỏ qua, không cắt rỗng', () => {
    // Nếu tin promptCol vô điều kiện thì đây ra chuỗi rỗng và lịch sử mất một lệnh.
    expect(stripPrompt('nginx -t', 999)).toBe('nginx -t')
  })

  test('KHÔNG cắt bừa khi chỉ có ký tự prompt mà không có khoảng trắng theo sau', () => {
    // `echo a>b` không phải prompt — cắt ở đây là mất `echo a`.
    expect(stripPrompt('echo a>b')).toBe('echo a>b')
  })
})

describe('redactCommand — các lỗ đã bịt (regression)', () => {
  test('mật khẩu TRONG NHÁY cũng bị che — đúng loại mật khẩu mạnh mới hay gõ trong nháy', () => {
    // Bản đầu chỉ khớp `[^\s'"]+` nên `-p"..."` lọt hoàn toàn.
    for (const cmd of ['mysql -p"PLACEHOLDER WITH SPACE" mydb', "mysql -p'PLACEHOLDER WITH SPACE' mydb"]) {
      const { text, redacted } = redactCommand(cmd)
      expect(redacted, cmd).toBe(true)
      expect(text, cmd).not.toContain('PLACEHOLDER WITH SPACE')
    }
    expect(redactCommand('DB_PASSWORD="PLACEHOLDER WITH SPACE" ./deploy.sh').text).not.toContain('PLACEHOLDER WITH SPACE')
    expect(redactCommand('gh auth login --token "PLACEHOLDER TOK"').text).not.toContain('PLACEHOLDER TOK')
  })

  test('header xác thực trong curl -H bị che, giữ tên scheme', () => {
    // Dạng gõ bí mật phổ biến nhất hiện nay, và không có `-p` nào để bắt.
    const bearer = redactCommand('curl -H "Authorization: Bearer sk-TESTVALUE" https://example.com')
    expect(bearer.redacted).toBe(true)
    expect(bearer.text).not.toContain('sk-TESTVALUE')
    expect(bearer.text).toContain('Bearer')
    expect(redactCommand('curl -H "X-Api-Key: KEYVALUE" https://example.com').text).not.toContain('KEYVALUE')
  })

  test('header KHÔNG phải xác thực thì giữ nguyên', () => {
    const cmd = 'curl -H "Content-Type: application/json" https://example.com'
    expect(redactCommand(cmd).text).toBe(cmd)
  })

  test('KHÔNG che hai lần — chuỗi thay chỗ không bị mẫu sau ăn lại', () => {
    // Hai nhánh (trong-nháy rồi trần) chạy lần lượt trên cùng chuỗi; thiếu chốt thì ra
    // `-p<đã che> che>`.
    const { text } = redactCommand('mysql -p"PLACEHOLDER SPACED" mydb')
    expect(text.split(REDACTED)).toHaveLength(2)
    expect(text).toBe(`mysql -p${REDACTED} mydb`)
  })

  test('chuỗi thay chỗ không chứa ký tự mà chính các mẫu còn khớp được', () => {
    expect(REDACTED).not.toMatch(/[\s'"<>]/)
  })
})

describe('stripPrompt — không tin promptCol mù quáng (regression)', () => {
  test('promptCol CŨ dài hơn prompt thật thì BỎ QUA, không cắt mất đầu lệnh', () => {
    // Bẫy thật: PS1 chứa \w, `cd /` làm prompt ngắn lại nhưng cột cũ vẫn 20.
    // Tin nó thì `echo rm -rf /` thành `-rf /` — một lệnh KHÁC HẲN, rồi F24 chèn nó ra terminal.
    expect(stripPrompt('[app-01 ~]$ echo rm -rf /', 20)).toBe('echo rm -rf /')
    expect(stripPrompt('$ sudo systemctl restart nginx', 22)).toBe('sudo systemctl restart nginx')
    expect(stripPrompt('$ sudo rm -rf /tmp', 10)).toBe('sudo rm -rf /tmp')
  })

  test('promptCol ĐÚNG (kết thúc bằng ký tự prompt) thì vẫn cắt chính xác', () => {
    const line = '[root@app-01 /var/log/nginx]# sudo rm -rf /tmp/x'
    expect(stripPrompt(line, '[root@app-01 /var/log/nginx]# '.length)).toBe('sudo rm -rf /tmp/x')
  })
})

describe('scoreCommand — thứ tự của ô tìm', () => {
  const now = 1_700_000_000_000

  test('không khớp thì trả null', () => {
    expect(scoreCommand(entry(), 'postgres', { now })).toBeNull()
  })

  test('khớp đầu chuỗi ăn điểm hơn khớp giữa chuỗi', () => {
    const prefix = scoreCommand(entry({ command: 'nginx -t' }), 'nginx', { now })!
    const middle = scoreCommand(entry({ command: 'systemctl restart nginx' }), 'nginx', { now })!
    expect(prefix).toBeGreaterThan(middle)
  })

  test('khớp đầu một TỪ ăn điểm hơn khớp giữa từ', () => {
    const wordStart = scoreCommand(entry({ command: 'systemctl restart nginx' }), 'nginx', { now })!
    const inWord = scoreCommand(entry({ command: 'tail /var/log/mynginx.log' }), 'nginx', { now })!
    expect(wordStart).toBeGreaterThan(inWord)
  })

  test('cùng host được cộng điểm — đang đứng trên máy nào thì lệnh máy đó gần hơn', () => {
    const same = scoreCommand(entry({ hostId: 'h1' }), 'nginx', { hostId: 'h1', now })!
    const other = scoreCommand(entry({ hostId: 'h2' }), 'nginx', { hostId: 'h1', now })!
    expect(same).toBeGreaterThan(other)
  })

  test('lệnh mới hơn đứng trước lệnh cũ', () => {
    const fresh = scoreCommand(entry({ startedAt: now - 86_400_000 }), 'nginx', { now })!
    const old = scoreCommand(entry({ startedAt: now - 86_400_000 * 40 }), 'nginx', { now })!
    expect(fresh).toBeGreaterThan(old)
  })

  test('truy vấn rỗng khớp mọi lệnh (mở ô tìm ra là thấy lệnh gần nhất)', () => {
    expect(scoreCommand(entry(), '', { now })).not.toBeNull()
  })

  test('không phân biệt chữ hoa/thường', () => {
    expect(scoreCommand(entry({ command: 'systemctl restart NGINX' }), 'nginx', { now })).not.toBeNull()
  })
})

describe('searchCommandHistory', () => {
  const now = 1_700_000_000_000

  test('gộp trùng theo nội dung lệnh, đếm số lần và số host', () => {
    const results = searchCommandHistory(
      [
        entry({ id: 'a', hostId: 'h1', hostLabel: 'app-01', command: 'nginx -t', startedAt: now - 3000 }),
        entry({ id: 'b', hostId: 'h2', hostLabel: 'app-02', command: 'nginx -t', startedAt: now - 1000 }),
        entry({ id: 'c', hostId: 'h1', hostLabel: 'app-01', command: 'nginx -t', startedAt: now - 5000 })
      ],
      'nginx',
      { now }
    )
    expect(results).toHaveLength(1)
    expect(results[0]!.runCount).toBe(3)
    expect(results[0]!.hostCount).toBe(2)
  })

  test('lần chạy MỚI NHẤT làm đại diện cho dòng đã gộp', () => {
    const results = searchCommandHistory(
      [
        entry({ id: 'old', command: 'deploy.sh', exitCode: 1, startedAt: now - 90_000, hostLabel: 'app-01' }),
        entry({ id: 'new', command: 'deploy.sh', exitCode: 0, startedAt: now - 1000, hostLabel: 'app-02' })
      ],
      'deploy',
      { now }
    )
    expect(results[0]!.id).toBe('new')
    expect(results[0]!.exitCode).toBe(0)
    expect(results[0]!.hostLabel).toBe('app-02')
  })

  test('lệnh không khớp bị loại khỏi kết quả', () => {
    const results = searchCommandHistory(
      [entry({ command: 'nginx -t' }), entry({ id: 'x', command: 'psql -l' })],
      'nginx',
      { now }
    )
    expect(results.map((r) => r.command)).toEqual(['nginx -t'])
  })

  test('limit cắt số dòng trả về', () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      entry({ id: `e${i}`, command: `cmd-${i} nginx`, startedAt: now - i * 1000 })
    )
    expect(searchCommandHistory(entries, 'nginx', { now, limit: 3 })).toHaveLength(3)
  })

  test('danh sách rỗng không nổ', () => {
    expect(searchCommandHistory([], 'nginx', { now })).toEqual([])
  })

  test('onlyHostId lọc kết quả nhưng hostCount vẫn đếm trên TOÀN BỘ dữ liệu', () => {
    // Lọc mảng trước khi gọi thì hostCount ra 1 và huy hiệu "+N máy nữa" mất đúng lúc cần nhất.
    const entries = [
      entry({ id: 'a', hostId: 'h1', hostLabel: 'app-01', command: 'nginx -t', startedAt: now - 1000 }),
      entry({ id: 'b', hostId: 'h2', hostLabel: 'app-02', command: 'nginx -t', startedAt: now - 2000 }),
      entry({ id: 'c', hostId: 'h3', hostLabel: 'app-03', command: 'nginx -t', startedAt: now - 3000 }),
      entry({ id: 'd', hostId: 'h2', hostLabel: 'app-02', command: 'psql -l', startedAt: now - 500 })
    ]
    const filtered = searchCommandHistory(entries, '', { now, onlyHostId: 'h1' })
    expect(filtered.map((r) => r.command)).toEqual(['nginx -t'])
    expect(filtered[0]!.hostCount).toBe(3)
  })

  test('onlyHostId null = không lọc', () => {
    const entries = [
      entry({ id: 'a', hostId: 'h1', command: 'nginx -t' }),
      entry({ id: 'b', hostId: 'h2', command: 'psql -l' })
    ]
    expect(searchCommandHistory(entries, '', { now, onlyHostId: null })).toHaveLength(2)
  })

  test('host đang mở nổi lên đầu dù lệnh cũ hơn', () => {
    const results = searchCommandHistory(
      [
        entry({ id: 'other', hostId: 'h2', command: 'restart nginx other', startedAt: now - 1000 }),
        entry({ id: 'mine', hostId: 'h1', command: 'restart nginx mine', startedAt: now - 86_400_000 * 3 })
      ],
      'restart',
      { hostId: 'h1', now }
    )
    expect(results[0]!.id).toBe('mine')
  })
})
