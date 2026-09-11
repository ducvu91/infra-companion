import { describe, expect, it } from 'vitest'
import {
  CODEX_DEFAULT_PROFILE,
  buildLoginParams,
  isValidProfileName,
  parseAccount,
  parseLoginCompleted,
  parseRateLimit,
  rateLimitParts,
} from './account'

describe('parseAccount', () => {
  it('doc dung shape THAT cua account/read', () => {
    // Shape lấy từ lần chạy thật (email đã thay bằng giá trị mẫu).
    const got = parseAccount({
      account: { type: 'chatgpt', email: 'deploy@example.com', planType: 'go' },
      requiresOpenaiAuth: true,
    })
    expect(got).toEqual({ authMode: 'chatgpt', email: 'deploy@example.com', planType: 'go' })
  })

  it('CHUA dang nhap -> null', () => {
    expect(parseAccount({ requiresOpenaiAuth: true })).toBeNull()
    expect(parseAccount({})).toBeNull()
    expect(parseAccount(null)).toBeNull()
  })

  it('`requiresOpenaiAuth` KHONG dung de ket luan da dang nhap', () => {
    // Nó nói về việc *cần* auth, không nói đã *có* auth — nhầm hai cái là báo "đã đăng nhập"
    // cho một máy chưa login.
    expect(parseAccount({ requiresOpenaiAuth: false })).toBeNull()
  })

  it('dang nhap bang API key thi khong co email', () => {
    const got = parseAccount({ account: { type: 'apiKey' } })
    expect(got).toMatchObject({ authMode: 'apiKey' })
    expect(got?.email).toBeUndefined()
  })

  it('type la -> unknown, KHONG throw (schema doi theo ban)', () => {
    expect(parseAccount({ account: { type: 'kieuMoi', email: 'x@example.com' } })).toMatchObject({
      authMode: 'unknown',
      email: 'x@example.com',
    })
  })

  it('goi moi cua OpenAI van doc duoc (planType la chuoi tho)', () => {
    expect(parseAccount({ account: { type: 'chatgpt', planType: 'goi-chua-ton-tai' } })?.planType).toBe(
      'goi-chua-ton-tai',
    )
  })
})

describe('parseRateLimit', () => {
  it('doc dung shape THAT', () => {
    const got = parseRateLimit({
      rateLimits: {
        limitId: 'codex',
        primary: { usedPercent: 10, windowDurationMins: 43200, resetsAt: 1791093730 },
        secondary: null,
        rateLimitReachedType: null,
      },
    })
    expect(got).toEqual({ usedPercent: 10, windowMins: 43200, resetsAt: 1791093730, reached: false })
  })

  it('da dung tran -> reached', () => {
    const got = parseRateLimit({
      rateLimits: { primary: { usedPercent: 100 }, rateLimitReachedType: 'primary' },
    })
    expect(got).toMatchObject({ usedPercent: 100, reached: true })
  })

  it('khong co primary -> null (khong bao 0% cho cai minh khong biet)', () => {
    // Báo "0%" khi không đọc được là nói sai theo hướng làm user yên tâm — tệ hơn không hiện.
    expect(parseRateLimit({ rateLimits: {} })).toBeNull()
    expect(parseRateLimit({})).toBeNull()
  })
})

describe('rateLimitParts', () => {
  const now = 1_700_000_000_000 // ms

  it('tinh so ngay den luc reset', () => {
    const resetsAt = Math.floor(now / 1000) + 3 * 86_400
    expect(rateLimitParts({ usedPercent: 42, resetsAt }, now)).toEqual({ usedPercent: 42, resetsInDays: 3 })
  })

  it('lam TRON LEN — con 2 tieng thi la "1 ngay", khong phai "0 ngay"', () => {
    const resetsAt = Math.floor(now / 1000) + 7200
    expect(rateLimitParts({ usedPercent: 5, resetsAt }, now).resetsInDays).toBe(1)
  })

  it('da qua han thi bo qua moc reset', () => {
    const resetsAt = Math.floor(now / 1000) - 100
    expect(rateLimitParts({ usedPercent: 5, resetsAt }, now).resetsInDays).toBeUndefined()
  })

  it('khong co resetsAt thi chi tra %', () => {
    expect(rateLimitParts({ usedPercent: 88 }, now)).toEqual({ usedPercent: 88 })
  })
})

describe('parseLoginCompleted', () => {
  it('thanh cong', () => {
    expect(parseLoginCompleted({ success: true, loginId: 'l1', error: null })).toMatchObject({
      ok: true,
      loginId: 'l1',
    })
  })

  it('that bai PHAI giu ly do — user vua bam nut va mo ca browser', () => {
    const got = parseLoginCompleted({ success: false, error: 'user tu choi cap quyen' })
    expect(got.ok).toBe(false)
    expect(got.error).toBe('user tu choi cap quyen')
  })

  it('params rong -> coi la that bai (khong doan thanh cong)', () => {
    expect(parseLoginCompleted({}).ok).toBe(false)
    expect(parseLoginCompleted(null).ok).toBe(false)
  })
})

describe('buildLoginParams', () => {
  it('OAuth browser', () => {
    expect(buildLoginParams('chatgpt')).toEqual({ type: 'chatgpt' })
  })

  it('ma thiet bi dung dung ten cua schema', () => {
    expect(buildLoginParams('deviceCode')).toEqual({ type: 'chatgptDeviceCode' })
  })

  it('KHONG co duong nao sinh ra type apiKey', () => {
    // Cả tính năng tồn tại để dùng GÓI; một ô nhập key ở đây là mời người ta sang đường
    // tính tiền theo lượt mà không nhận ra.
    for (const k of ['chatgpt', 'deviceCode'] as const) {
      expect(buildLoginParams(k)['type']).not.toBe('apiKey')
    }
  })
})

describe('isValidProfileName', () => {
  it('nhan ten thuong', () => {
    for (const n of ['Cong viec', 'ca-nhan', 'client_A', 'acc2']) {
      expect(isValidProfileName(n), n).toBe(true)
    }
  })

  it('CHAN path traversal va ky tu Windows cam', () => {
    // Tên này đi vào tên thư mục dưới userData — lọt `..` là ghi ra ngoài.
    for (const n of ['..', '.', '../etc', 'a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a|b']) {
      expect(isValidProfileName(n), n).toBe(false)
    }
  })

  it('chan ten rong, qua dai, va bat dau bang khoang trang', () => {
    expect(isValidProfileName('')).toBe(false)
    expect(isValidProfileName('x'.repeat(41))).toBe(false)
    expect(isValidProfileName(' a')).toBe(false)
    expect(isValidProfileName('-a')).toBe(false)
  })

  it('chan ten danh rieng `default`', () => {
    expect(isValidProfileName(CODEX_DEFAULT_PROFILE)).toBe(false)
  })
})
