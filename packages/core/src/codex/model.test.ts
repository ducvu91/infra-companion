import { describe, expect, it } from 'vitest'
import { classifyModelError, modelFromError, parseModelList, parseModelListFull, parseThreadList } from './model'

describe('parseModelList', () => {
  it('doc dung shape THAT cua model/list (field `data`)', () => {
    // Shape lấy từ lần chạy thật với codex-cli 0.142.4.
    expect(
      parseModelList({
        data: [{ id: 'gpt-5.5', model: 'gpt-5.5', displayName: 'GPT-5.5', hidden: false, isDefault: true }],
        nextCursor: null,
      }),
    ).toEqual([{ id: 'gpt-5.5', displayName: 'GPT-5.5' }])
  })

  it('nhan ca mang tran va cac ten field khac (shape doi theo ban)', () => {
    expect(parseModelList(['a', 'b'])).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(parseModelList({ models: [{ slug: 'x' }] })).toEqual([{ id: 'x' }])
    expect(parseModelList({ items: [{ name: 'y' }] })).toEqual([{ id: 'y' }])
  })

  it('bo qua muc khong co id', () => {
    expect(parseModelList({ data: [{ displayName: 'khong id' }, { id: 'ok' }] })).toEqual([{ id: 'ok' }])
  })

  it('khong doc duoc -> mang RONG (khong doan)', () => {
    expect(parseModelList(null)).toEqual([])
    expect(parseModelList('chuoi la')).toEqual([])
    expect(parseModelList({ khong: 'lien quan' })).toEqual([])
  })
})

describe('classifyModelError — ba mau THAT da gap', () => {
  it('CLI qua cu', () => {
    // config đặt gpt-5.6-terra, CLI 0.142.4
    expect(
      classifyModelError(
        `{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-5.6-terra' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again."}}`,
      ),
    ).toBe('outdated-cli')
  })

  it('model da bi server bo (404) — CHINH cai model/list bao la dung duoc', () => {
    // Đây là lý do không được tin `model/list` rồi tự ghi đè: nó báo gpt-5.5 dùng được,
    // gọi thật thì 404.
    expect(
      classifyModelError(
        'unexpected status 404 Not Found: The model `gpt-5.5` does not exist or you do not have access to it., url: https://chatgpt.com/backend-api/codex/responses',
      ),
    ).toBe('model-gone')
  })

  it('model chi dung duoc voi API key, khong dung duoc bang GOI', () => {
    expect(
      classifyModelError(`{"message":"The 'gpt-5.1-codex' model is not supported when using Codex with a ChatGPT account."}`),
    ).toBe('not-for-chatgpt')
  })

  it('loi khac -> null (khong gan nhan sai)', () => {
    expect(classifyModelError('ECONNREFUSED')).toBeNull()
    expect(classifyModelError('rate limit exceeded')).toBeNull()
    expect(classifyModelError('')).toBeNull()
  })

  it('khong phan biet hoa thuong', () => {
    expect(classifyModelError('REQUIRES A NEWER VERSION of Codex')).toBe('outdated-cli')
  })
})

describe('modelFromError', () => {
  it('lay ten model trong nhay don', () => {
    expect(modelFromError(`The 'gpt-5.6-terra' model requires a newer version`)).toBe('gpt-5.6-terra')
  })

  it('lay ten model trong backtick (mau 404)', () => {
    expect(modelFromError('The model `gpt-5.5` does not exist')).toBe('gpt-5.5')
  })

  it('khong co ten thi tra undefined', () => {
    expect(modelFromError('loi mang')).toBeUndefined()
  })
})

describe('parseModelListFull — muc suy luan', () => {
  // Shape lấy từ lần chạy thật với codex-cli 0.154.0.
  const REAL = {
    data: [
      {
        id: 'gpt-5.6-terra',
        model: 'gpt-5.6-terra',
        displayName: 'GPT-5.6-Terra',
        description: 'Balanced agentic coding model for everyday work.',
        hidden: false,
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'Fast responses' },
          { reasoningEffort: 'medium', description: 'Balances speed' },
          { reasoningEffort: 'high', description: 'Greater depth' },
          { reasoningEffort: 'xhigh', description: 'Extra high' },
          { reasoningEffort: 'max', description: 'Maximum' },
        ],
        defaultReasoningEffort: 'medium',
      },
      { id: 'codex-auto-review', displayName: 'Codex Auto Review', hidden: true, supportedReasoningEfforts: [] },
    ],
  }

  it('doc dung shape THAT, lay ca muc suy luan', () => {
    const got = parseModelListFull(REAL)
    expect(got).toHaveLength(1) // model ẩn bị bỏ
    expect(got[0]).toMatchObject({
      id: 'gpt-5.6-terra',
      displayName: 'GPT-5.6-Terra',
      defaultEffort: 'medium',
    })
    expect(got[0]!.reasoningEfforts).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('BO model an — `codex-auto-review` la model noi bo, vao dropdown la cho user chon nham', () => {
    expect(parseModelListFull(REAL).some((m) => m.id === 'codex-auto-review')).toBe(false)
  })

  it('nhan ca muc suy luan dang chuoi tran', () => {
    const got = parseModelListFull({ data: [{ id: 'm', supportedReasoningEfforts: ['low', 'high'] }] })
    expect(got[0]!.reasoningEfforts).toEqual(['low', 'high'])
  })

  it('khong co muc suy luan -> mang rong, KHONG throw', () => {
    expect(parseModelListFull({ data: [{ id: 'm' }] })[0]!.reasoningEfforts).toEqual([])
  })

  it('khong doc duoc -> mang rong', () => {
    expect(parseModelListFull(null)).toEqual([])
    expect(parseModelListFull({ linh: 'tinh' })).toEqual([])
  })
})

describe('parseThreadList — phien cu', () => {
  // Shape lấy từ lần chạy thật.
  const REAL = {
    data: [
      {
        id: 'th-moi',
        preview: 'Doc README roi tom tat',
        cwd: 'D:\work',
        model: 'gpt-5.6-terra',
        updatedAt: 1789090104,
      },
      { id: 'th-cu', preview: 'Hi', cwd: 'D:\work', model: 'gpt-5.6-terra', updatedAt: 1789042080 },
      // Phiên chưa gửi câu nào — mở lại chẳng để làm gì.
      { id: 'th-trong', preview: '', cwd: 'D:\work', updatedAt: 1789000000 },
    ],
  }

  it('doc dung shape THAT', () => {
    const got = parseThreadList(REAL)
    expect(got).toHaveLength(2)
    expect(got[0]).toMatchObject({ id: 'th-moi', preview: 'Doc README roi tom tat', model: 'gpt-5.6-terra' })
  })

  it('MOI NHAT truoc', () => {
    expect(parseThreadList(REAL).map((t) => t.id)).toEqual(['th-moi', 'th-cu'])
  })

  it('BO phien khong co preview (chua gui cau nao)', () => {
    expect(parseThreadList(REAL).some((t) => t.id === 'th-trong')).toBe(false)
  })

  it('rot ve recencyAt khi khong co updatedAt', () => {
    expect(parseThreadList({ data: [{ id: 'a', preview: 'x', recencyAt: 123 }] })[0]!.updatedAt).toBe(123)
  })

  it('khong doc duoc -> mang rong', () => {
    expect(parseThreadList(null)).toEqual([])
    expect(parseThreadList({ data: 'khong phai mang' })).toEqual([])
  })
})
