import { describe, expect, it } from 'vitest'
import { codexEnv } from './env'

describe('codexEnv — giu nhung gi Codex CAN', () => {
  it('giu PATH, HOME, USERPROFILE, LOCALAPPDATA, CODEX_HOME', () => {
    const out = codexEnv({
      PATH: '/usr/bin',
      HOME: '/home/deploy',
      USERPROFILE: 'C:\\Users\\deploy',
      LOCALAPPDATA: 'C:\\Users\\deploy\\AppData\\Local',
      CODEX_HOME: 'C:\\Users\\deploy\\.codex',
    })
    expect(out).toMatchObject({
      PATH: '/usr/bin',
      HOME: '/home/deploy',
      USERPROFILE: 'C:\\Users\\deploy',
      LOCALAPPDATA: 'C:\\Users\\deploy\\AppData\\Local',
      CODEX_HOME: 'C:\\Users\\deploy\\.codex',
    })
  })

  it('giu CA `PATH` va `Path` (Node khong chuan hoa nhat quan tren Windows)', () => {
    const out = codexEnv({ PATH: 'a', Path: 'b' })
    expect(out['PATH']).toBe('a')
    expect(out['Path']).toBe('b')
  })

  it('giu proxy de may sau proxy cong ty van goi duoc', () => {
    const out = codexEnv({ HTTPS_PROXY: 'http://proxy:8080', NO_PROXY: 'localhost', https_proxy: 'http://p:1' })
    expect(out['HTTPS_PROXY']).toBe('http://proxy:8080')
    expect(out['NO_PROXY']).toBe('localhost')
    expect(out['https_proxy']).toBe('http://p:1')
  })

  it('giu LANG/LC_ALL — sai encoding la output tieng Viet thanh ky tu rac', () => {
    const out = codexEnv({ LANG: 'vi_VN.UTF-8', LC_ALL: 'vi_VN.UTF-8' })
    expect(out['LANG']).toBe('vi_VN.UTF-8')
    expect(out['LC_ALL']).toBe('vi_VN.UTF-8')
  })

  it('them TERM_PROGRAM de lenh cua agent biet dang o trong app', () => {
    expect(codexEnv({})['TERM_PROGRAM']).toBe('InfraCompanion')
  })

  it('bo bien rong (khong truyen key rong sang con)', () => {
    const out = codexEnv({ PATH: '', HOME: '/h' })
    expect(out).not.toHaveProperty('PATH')
    expect(out['HOME']).toBe('/h')
  })
})

describe('codexEnv — HANG RAO BAO MAT: phai bo nhung gi khong duoc ro', () => {
  // Bộ test này là chống hồi quy cho quyết định bảo mật, không phải kiểm tra tính năng.

  it('bo OPENAI_API_KEY — de lot vao la Codex am tham tinh tien theo API key', () => {
    // User đã chốt dùng GÓI ChatGPT. Biến này lọt vào thì tính năng vẫn "chạy",
    // chỉ có hoá đơn mới nói ra sự thật — đúng loại lỗi "xanh nhưng sai".
    const out = codexEnv({ OPENAI_API_KEY: 'sk-that', PATH: '/usr/bin' })
    expect(out).not.toHaveProperty('OPENAI_API_KEY')
    expect(out['PATH']).toBe('/usr/bin')
  })

  it('bo OPENAI_BASE_URL — khong de doi endpoint ngam', () => {
    expect(codexEnv({ OPENAI_BASE_URL: 'http://evil' })).not.toHaveProperty('OPENAI_BASE_URL')
  })

  it('bo ELECTRON_RUN_AS_NODE — bien nay duoc set san cho vitest tren may dev', () => {
    expect(codexEnv({ ELECTRON_RUN_AS_NODE: '1' })).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
  })

  it('bo moi khoa nha cung cap khac', () => {
    const out = codexEnv({
      ANTHROPIC_API_KEY: 'sk-ant-x',
      AWS_ACCESS_KEY_ID: 'AKIA',
      AWS_SECRET_ACCESS_KEY: 's',
      GOOGLE_APPLICATION_CREDENTIALS: '/x.json',
      AZURE_CLIENT_SECRET: 'z',
      GCP_PROJECT: 'p',
      DO_TOKEN: 'dop_v1',
      DIGITALOCEAN_TOKEN: 'x',
      GITHUB_TOKEN: 'ghp',
      GH_TOKEN: 'gho',
      GITLAB_TOKEN: 'glpat',
      NPM_TOKEN: 'npm_x',
    })
    for (const k of [
      'ANTHROPIC_API_KEY',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'AZURE_CLIENT_SECRET',
      'GCP_PROJECT',
      'DO_TOKEN',
      'DIGITALOCEAN_TOKEN',
      'GITHUB_TOKEN',
      'GH_TOKEN',
      'GITLAB_TOKEN',
      'NPM_TOKEN',
    ]) {
      expect(out, `phai bo ${k}`).not.toHaveProperty(k)
    }
  })

  it('bo bien noi bo cua app (tien to INFRA_)', () => {
    expect(codexEnv({ INFRA_GOOGLE_CLIENT_SECRET: 'x' })).not.toHaveProperty('INFRA_GOOGLE_CLIENT_SECRET')
  })

  it('khong ke thua bien LA — allowlist chu khong denylist', () => {
    // Điểm khác `LocalSession.cleanEnv` (kế thừa cả process.env): ở đây một biến không
    // có trong KEEP thì không đi qua, kể cả khi nó vô hại.
    const out = codexEnv({ MOT_BIEN_LA: 'x', BIEN_KHAC: 'y', PATH: '/b' })
    expect(out).not.toHaveProperty('MOT_BIEN_LA')
    expect(out).not.toHaveProperty('BIEN_KHAC')
    expect(out['PATH']).toBe('/b')
  })

  it('bo khong phan biet hoa thuong', () => {
    const out = codexEnv({ openai_api_key: 'sk', aws_secret_access_key: 's' } as NodeJS.ProcessEnv)
    expect(out).not.toHaveProperty('openai_api_key')
    expect(out).not.toHaveProperty('aws_secret_access_key')
  })
})

describe('codexEnv — extra', () => {
  it('extra di qua duoc DU trung tien to bi bo (token MCP bridge)', () => {
    // `INFRA_` nằm trong danh sách bỏ để không rò biến nội bộ, nhưng token của MCP bridge
    // là thứ ta CHỦ ĐỘNG muốn đưa vào.
    const out = codexEnv({ INFRA_SECRET: 'khong-duoc-ro' }, { extra: { INFRA_MCP_TOKEN: 'tok-123' } })
    expect(out['INFRA_MCP_TOKEN']).toBe('tok-123')
    expect(out).not.toHaveProperty('INFRA_SECRET')
  })

  it('extra ghi de gia tri da loc', () => {
    const out = codexEnv({ CODEX_HOME: '/cu' }, { extra: { CODEX_HOME: '/moi' } })
    expect(out['CODEX_HOME']).toBe('/moi')
  })
})
