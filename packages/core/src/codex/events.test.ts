import { describe, expect, it } from 'vitest'
import { initialThreadState, reduceAll, reduceThreadEvent } from './events'
import type { CodexNotification } from './protocol'

const n = (method: string, params?: unknown): CodexNotification => ({ method, params })

describe('reduceThreadEvent — thread & turn', () => {
  it('thread/started lay id (shape THAT: params.thread.id)', () => {
    const s = reduceThreadEvent(
      initialThreadState(),
      n('thread/started', { thread: { id: 'th-1', sessionId: 'th-1', cwd: 'D:/x' } }),
    )
    expect(s.threadId).toBe('th-1')
  })

  it('turn/started lay id tu params.turn.id (KHONG phai params.turnId)', () => {
    // Shape thật `{threadId, turn: {id, status, items}}` — đọc sai chỗ là turnId luôn null,
    // và `turn/interrupt` (cần turnId) sẽ không bao giờ chạy được.
    const s = reduceThreadEvent(
      initialThreadState(),
      n('turn/started', { threadId: 'th-1', turn: { id: 't-1', status: 'inProgress', items: [] } }),
    )
    expect(s).toMatchObject({ phase: 'running', turnId: 't-1', error: null })
  })

  it('turn/started xoa loi cua lan truoc', () => {
    let s = reduceThreadEvent(
      initialThreadState(),
      n('turn/completed', { turn: { id: 't-0', status: 'failed', error: { message: 'loi cu' } } }),
    )
    expect(s.phase).toBe('failed')
    s = reduceThreadEvent(s, n('turn/started', { turn: { id: 't-1', status: 'inProgress' } }))
    expect(s).toMatchObject({ phase: 'running', error: null })
  })

  it('turn/completed DONG moi item con dang chay', () => {
    const s = reduceAll(initialThreadState(), [
      n('turn/started', { turn: { id: 't-1', status: 'inProgress' } }),
      n('item/agentMessage/delta', { itemId: 'i1', delta: 'dang go' }),
      n('turn/completed', { turn: { id: 't-1', status: 'completed' } }),
    ])
    expect(s.phase).toBe('done')
    expect(s.items.every((i) => i.done)).toBe(true)
  })

  it('THAT BAI ve qua turn/completed voi status=failed (khong co turn/failed)', () => {
    // `turn/failed` KHÔNG tồn tại trong giao thức — bản đầu tôi đoán có, nên mọi lượt lỗi
    // hiện thành "Xong" mà không có chữ nào.
    const s = reduceThreadEvent(
      initialThreadState(),
      n('turn/completed', { turn: { id: 't-1', status: 'failed', error: { message: 'het quota' } } }),
    )
    expect(s).toMatchObject({ phase: 'failed', error: 'het quota' })
  })

  it('status=failed khong co message van co cau noi duoc', () => {
    const s = reduceThreadEvent(initialThreadState(), n('turn/completed', { turn: { id: 't', status: 'failed' } }))
    expect(s.phase).toBe('failed')
    expect(s.error).toBeTruthy()
  })

  it('status=interrupted (user bam Dung) KHONG phai loi', () => {
    const s = reduceThreadEvent(initialThreadState(), n('turn/completed', { turn: { id: 't', status: 'interrupted' } }))
    expect(s).toMatchObject({ phase: 'done', error: null })
  })

  it('thread/status/changed systemError -> failed', () => {
    const s = reduceThreadEvent(
      initialThreadState(),
      n('thread/status/changed', { status: { type: 'systemError', message: 'mat ket noi' } }),
    )
    expect(s).toMatchObject({ phase: 'failed', error: 'mat ket noi' })
  })

  it('thread/status/changed idle khong doi gi', () => {
    const before = initialThreadState()
    expect(reduceThreadEvent(before, n('thread/status/changed', { status: { type: 'idle' } }))).toBe(before)
  })
})

describe('reduceThreadEvent — delta theo itemId', () => {
  it('noi delta thanh mot khoi chu', () => {
    const s = reduceAll(initialThreadState(), [
      n('item/agentMessage/delta', { itemId: 'i1', delta: 'Xin ' }),
      n('item/agentMessage/delta', { itemId: 'i1', delta: 'chao ' }),
      n('item/agentMessage/delta', { itemId: 'i1', delta: 'ban' }),
    ])
    expect(s.items).toHaveLength(1)
    expect(s.items[0]!.text).toBe('Xin chao ban')
    expect(s.items[0]!.done).toBe(false)
  })

  it('HAI item XEN KE vao dung item cua no (bug de gap nhat)', () => {
    // Reasoning của bước sau chảy trong khi message bước trước chưa xong.
    const s = reduceAll(initialThreadState(), [
      n('item/agentMessage/delta', { itemId: 'msg', delta: 'A1' }),
      n('item/reasoning/summaryTextDelta', { itemId: 'rsn', delta: 'R1' }),
      n('item/agentMessage/delta', { itemId: 'msg', delta: 'A2' }),
      n('item/reasoning/summaryTextDelta', { itemId: 'rsn', delta: 'R2' }),
    ])
    expect(s.items).toHaveLength(2)
    const msg = s.items.find((i) => i.id === 'msg')!
    const rsn = s.items.find((i) => i.id === 'rsn')!
    expect(msg.text).toBe('A1A2')
    expect(rsn.text).toBe('R1R2')
    expect(msg.kind).toBe('agentMessage')
    expect(rsn.kind).toBe('reasoning')
  })

  it('giu THU TU xuat hien cua item', () => {
    const s = reduceAll(initialThreadState(), [
      n('item/started', { turnId: 't', item: { id: 'a', type: 'reasoning' } }),
      n('item/started', { turnId: 't', item: { id: 'b', type: 'agentMessage' } }),
      n('item/agentMessage/delta', { itemId: 'a', delta: 'x' }),
    ])
    expect(s.items.map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('item/started lay id tu params.item.id — KHONG phai params.itemId', () => {
    // Bug thật: `item/started`/`item/completed` không có `itemId` ở params (id nằm trong
    // `item`), nên bản đầu bỏ qua SẠCH hai event này.
    const s = reduceThreadEvent(
      initialThreadState(),
      n('item/started', { threadId: 'th', turnId: 't', startedAtMs: 1, item: { id: 'i9', type: 'agentMessage' } }),
    )
    expect(s.items).toHaveLength(1)
    expect(s.items[0]).toMatchObject({ id: 'i9', kind: 'agentMessage' })
  })

  it('lay kind tu item.type (chinh xac hon doan theo ten method)', () => {
    // `item/started` dùng CHUNG một method cho mọi loại item, nên tên method không nói được gì.
    const cases = [
      ['agentMessage', 'agentMessage'],
      ['reasoning', 'reasoning'],
      ['commandExecution', 'command'],
      ['fileChange', 'patch'],
      ['webSearch', 'other'],
      // Kind riêng để UI lọc bỏ: app-server phát lại câu user vừa gõ như một item, hiện
      // lại là lặp — và lúc `item/started` nó chưa có text nên thành một dòng TRỐNG.
      ['userMessage', 'userMessage'],
    ] as const
    for (const [type, expected] of cases) {
      const s = reduceThreadEvent(initialThreadState(), n('item/started', { turnId: 't', item: { id: 'x', type } }))
      expect(s.items[0]!.kind, type).toBe(expected)
    }
  })

  it('userMessage: doc text tu MANG `content`, khong phai field `text`', () => {
    // Bug thật: `content` là mảng UserInput (`[{type:'text',text:'…'}]`). Đọc nó như chuỗi thì
    // ra undefined → item rỗng → bị lọc → CAU HOI CUA USER khong bao gio hien.
    const s = reduceThreadEvent(
      initialThreadState(),
      n('item/started', {
        turnId: 't',
        item: { id: 'u1', type: 'userMessage', content: [{ type: 'text', text: 'doc README giup toi' }] },
      }),
    )
    expect(s.items[0]).toMatchObject({ kind: 'userMessage', text: 'doc README giup toi' })
  })

  it('userMessage nhieu doan text -> noi bang xuong dong', () => {
    const s = reduceThreadEvent(
      initialThreadState(),
      n('item/completed', {
        turnId: 't',
        item: {
          id: 'u1',
          type: 'userMessage',
          content: [
            { type: 'text', text: 'dong 1' },
            { type: 'text', text: 'dong 2' },
          ],
        },
      }),
    )
    expect(s.items[0]!.text).toBe('dong 1\ndong 2')
  })

  it('userMessage chi co anh (khong text) -> KHONG tao dong trong', () => {
    // UI này không vẽ ảnh; item không có chữ nào thì để nó rỗng cho UI lọc.
    const s = reduceThreadEvent(
      initialThreadState(),
      n('item/started', {
        turnId: 't',
        item: { id: 'u1', type: 'userMessage', content: [{ type: 'image', url: 'data:…' }] },
      }),
    )
    expect(s.items[0]!.text).toBe('')
  })

  it('commandExecution: hien lenh + output + exit code', () => {
    const s = reduceThreadEvent(
      initialThreadState(),
      n('item/completed', {
        turnId: 't',
        item: { id: 'c1', type: 'commandExecution', command: 'ls -la', aggregatedOutput: 'total 0', exitCode: 0 },
      }),
    )
    expect(s.items[0]!.text).toContain('$ ls -la')
    expect(s.items[0]!.text).toContain('total 0')
    // exit 0 thì KHÔNG hiện — chỉ ồn thêm.
    expect(s.items[0]!.text).not.toContain('exit 0')
  })

  it('commandExecution loi thi NOI RO exit code', () => {
    const s = reduceThreadEvent(
      initialThreadState(),
      n('item/completed', {
        turnId: 't',
        item: { id: 'c1', type: 'commandExecution', command: 'false', aggregatedOutput: '', exitCode: 1 },
      }),
    )
    expect(s.items[0]!.text).toContain('[exit 1]')
  })

  it('delta rong khong tao item moi', () => {
    const s = reduceThreadEvent(initialThreadState(), n('item/agentMessage/delta', { itemId: 'i1', delta: '' }))
    expect(s.items).toEqual([])
  })

  it('item khong co itemId thi bo qua, khong crash', () => {
    const before = initialThreadState()
    expect(reduceThreadEvent(before, n('item/agentMessage/delta', { delta: 'x' }))).toBe(before)
  })

  it('nhan ca bien the ten field `text` thay vi `delta`', () => {
    const s = reduceThreadEvent(initialThreadState(), n('item/reasoning/textDelta', { itemId: 'i', text: 'abc' }))
    expect(s.items[0]!.text).toBe('abc')
  })

  it('item/completed lay text day du khi da opt-out delta', () => {
    // Opt-out `reasoning/textDelta` thì không có delta nào; text đầy đủ về ở item/completed.
    const s = reduceThreadEvent(
      initialThreadState(),
      n('item/completed', { turnId: 't', item: { id: 'i1', type: 'agentMessage', text: 'toan bo cau tra loi' } }),
    )
    expect(s.items[0]).toMatchObject({ text: 'toan bo cau tra loi', done: true, kind: 'agentMessage' })
  })

  it('NANG CAP kind khi item/started chua noi ro loai', () => {
    // Ca item.type là loại app chưa map ('other'), rồi delta mới nói rõ là agentMessage.
    const s = reduceAll(initialThreadState(), [
      n('item/started', { turnId: 't', item: { id: 'i1', type: 'loaiChuaBiet' } }),
      n('item/agentMessage/delta', { itemId: 'i1', delta: 'xin chao' }),
    ])
    expect(s.items[0]!.kind).toBe('agentMessage')
  })

  it('item/completed KHONG ha kind da biet ve `other`', () => {
    const s = reduceAll(initialThreadState(), [
      n('item/reasoning/summaryTextDelta', { itemId: 'i1', delta: 'suy luan' }),
      // `item` không có `type` → suy từ method 'item/completed' ra 'other', KHÔNG được ghi đè.
      n('item/completed', { turnId: 't', item: { id: 'i1' } }),
    ])
    expect(s.items[0]!.kind).toBe('reasoning')
  })

  it('item/completed KHONG lam mat text da nhan qua delta', () => {
    const s = reduceAll(initialThreadState(), [
      n('item/agentMessage/delta', { itemId: 'i1', delta: 'da go xong' }),
      n('item/completed', { turnId: 't', item: { id: 'i1' } }),
    ])
    expect(s.items[0]).toMatchObject({ text: 'da go xong', done: true })
  })

  it('giu text DAI HON giua delta va item.text (khong mat chu o ca hai chieu)', () => {
    // Delta gom được một phần, `item.text` đầy đủ hơn → lấy cái dài hơn.
    const s = reduceAll(initialThreadState(), [
      n('item/agentMessage/delta', { itemId: 'i1', delta: 'mot phan' }),
      n('item/completed', { turnId: 't', item: { id: 'i1', type: 'agentMessage', text: 'mot phan va phan con lai' } }),
    ])
    expect(s.items[0]!.text).toBe('mot phan va phan con lai')
  })

  it('cat text qua dai nhung GIU DUOI', () => {
    // R4: agent `cat` file lớn. Phần cuối là kết luận nên phải giữ.
    let s = initialThreadState()
    for (let i = 0; i < 30; i++) {
      s = reduceThreadEvent(s, n('item/agentMessage/delta', { itemId: 'i', delta: 'x'.repeat(10_000) }))
    }
    s = reduceThreadEvent(s, n('item/agentMessage/delta', { itemId: 'i', delta: 'KET-THUC' }))
    expect(s.items[0]!.text.length).toBeLessThan(230_000)
    expect(s.items[0]!.text.endsWith('KET-THUC')).toBe(true)
    expect(s.items[0]!.text.startsWith('…')).toBe(true)
  })
})

describe('reduceThreadEvent — MCP server (R7)', () => {
  it('ghi nhan tung server va CAP NHAT tai cho khi doi status', () => {
    const s = reduceAll(initialThreadState(), [
      n('mcpServer/startupStatus/updated', { name: 'infra_bridge', status: 'starting', error: null }),
      n('mcpServer/startupStatus/updated', { name: 'node_repl', status: 'starting', error: null }),
      n('mcpServer/startupStatus/updated', { name: 'infra_bridge', status: 'ready', error: null }),
    ])
    expect(s.mcpServers).toHaveLength(2)
    expect(s.mcpServers.find((x) => x.name === 'infra_bridge')!.status).toBe('ready')
  })

  it('giu LY DO khi server chet — user phai biet vi sao thieu tool', () => {
    const s = reduceThreadEvent(
      initialThreadState(),
      n('mcpServer/startupStatus/updated', {
        name: 'pencil',
        status: 'failed',
        error: 'MCP startup failed: The system cannot find the path specified. (os error 3)',
      }),
    )
    expect(s.mcpServers[0]!.error).toContain('os error 3')
  })

  it('server khong co ten thi bo qua', () => {
    const before = initialThreadState()
    expect(reduceThreadEvent(before, n('mcpServer/startupStatus/updated', { status: 'ready' }))).toBe(before)
  })
})

describe('reduceThreadEvent — frame la (R1)', () => {
  it('method hoan toan la tra ve CHINH state (so sanh tham chieu)', () => {
    const before = initialThreadState()
    const after = reduceThreadEvent(before, n('tinhNangMoi/chuaTungCo', { gi: 'do' }))
    expect(after).toBe(before)
  })

  it('params khong phai object khong lam crash', () => {
    const before = initialThreadState()
    expect(() => reduceThreadEvent(before, n('turn/started', 'chuoi la'))).not.toThrow()
    expect(() => reduceThreadEvent(before, n('turn/started', null))).not.toThrow()
    expect(() => reduceThreadEvent(before, n('turn/started', [1, 2]))).not.toThrow()
  })

  it('item/... la van ghi nhan item ton tai', () => {
    const s = reduceThreadEvent(initialThreadState(), n('item/loaiMoi/xyz', { itemId: 'i9' }))
    expect(s.items).toHaveLength(1)
    expect(s.items[0]!.kind).toBe('other')
  })
})

describe('reduceThreadEvent — chuoi day du mot turn', () => {
  it('dung theo trinh tu that tu probe', () => {
    const s = reduceAll(initialThreadState(), [
      n('thread/started', { thread: { id: 'th-1' } }),
      n('mcpServer/startupStatus/updated', { name: 'infra_bridge', status: 'ready', error: null }),
      n('turn/started', { threadId: 'th-1', turn: { id: 't-1', status: 'inProgress', items: [] } }),
      n('item/started', { threadId: 'th-1', turnId: 't-1', item: { id: 'r1', type: 'reasoning' } }),
      n('item/reasoning/summaryTextDelta', { itemId: 'r1', turnId: 't-1', delta: 'Dang doc thu muc' }),
      n('item/completed', { threadId: 'th-1', turnId: 't-1', item: { id: 'r1', type: 'reasoning' } }),
      n('item/started', { threadId: 'th-1', turnId: 't-1', item: { id: 'm1', type: 'agentMessage' } }),
      n('item/agentMessage/delta', { itemId: 'm1', turnId: 't-1', delta: 'Thu muc co 3 file' }),
      n('item/completed', { threadId: 'th-1', turnId: 't-1', item: { id: 'm1', type: 'agentMessage' } }),
      n('turn/completed', { threadId: 'th-1', turn: { id: 't-1', status: 'completed' } }),
    ])
    expect(s).toMatchObject({ threadId: 'th-1', turnId: 't-1', phase: 'done', error: null })
    expect(s.items).toHaveLength(2)
    expect(s.items[0]).toMatchObject({ kind: 'reasoning', text: 'Dang doc thu muc', done: true })
    expect(s.items[1]).toMatchObject({ kind: 'agentMessage', text: 'Thu muc co 3 file', done: true })
    expect(s.mcpServers).toHaveLength(1)
  })

  it('immutable — khong sua state cu', () => {
    const before = initialThreadState()
    const after = reduceThreadEvent(before, n('turn/started', { turn: { id: 't', status: 'inProgress' } }))
    expect(before.turnId).toBeNull()
    expect(after.turnId).toBe('t')
    expect(after).not.toBe(before)
  })
})
