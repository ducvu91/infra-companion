import { describe, expect, it, vi } from 'vitest'
import { RpcPeer, type RpcPeerDeps, type ScheduleFn } from './RpcPeer'
import type { CodexNotification, ServerRequest } from './protocol'

/** Hẹn giờ giả — test timeout mà không phải chờ thật. */
function fakeClock() {
  const jobs: Array<{ fn: () => void; at: number; cancelled: boolean }> = []
  let now = 0
  const schedule: ScheduleFn = (fn, ms) => {
    const job = { fn, at: now + ms, cancelled: false }
    jobs.push(job)
    return () => {
      job.cancelled = true
    }
  }
  const advance = (ms: number): void => {
    now += ms
    for (const j of jobs) {
      if (!j.cancelled && j.at <= now) {
        j.cancelled = true
        j.fn()
      }
    }
  }
  return { schedule, advance }
}

function setup(over: Partial<RpcPeerDeps> = {}) {
  const sent: string[] = []
  const notifications: CodexNotification[] = []
  const warnings: string[] = []
  const clock = fakeClock()
  const deps: RpcPeerDeps = {
    send: (line) => sent.push(line),
    onServerRequest: async () => ({}),
    onNotification: (n) => notifications.push(n),
    onProtocolWarning: (m) => warnings.push(m),
    schedule: clock.schedule,
    ...over,
  }
  return { peer: new RpcPeer(deps), sent, notifications, warnings, clock }
}

/** Đọc các message đã ghi ra (mỗi dòng một JSON). */
const parseSent = (sent: string[]): any[] => sent.map((s) => JSON.parse(s.trim()))

describe('RpcPeer — request/response', () => {
  it('ghi request dung khuon JSON-RPC va ket thuc bang \\n', () => {
    const { peer, sent } = setup()
    void peer.request('thread/start', { cwd: 'D:/x' })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.endsWith('\n')).toBe(true)
    expect(JSON.parse(sent[0]!)).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'thread/start',
      params: { cwd: 'D:/x' },
    })
  })

  it('bo han `params` khi khong truyen (khong gui `params: undefined`)', () => {
    const { peer, sent } = setup()
    void peer.request('initialize')
    expect(JSON.parse(sent[0]!)).toEqual({ jsonrpc: '2.0', id: 1, method: 'initialize' })
  })

  it('resolve dung promise khi response ve DAO thu tu', async () => {
    // Ca thật: `turn/start` chạy lâu, một request khác gửi sau lại về trước.
    const { peer } = setup()
    const first = peer.request('turn/start')
    const second = peer.request('thread/list')

    peer.feed('{"id":2,"result":{"threads":[]}}\n')
    await expect(second).resolves.toEqual({ threads: [] })

    peer.feed('{"id":1,"result":{"turnId":"t1"}}\n')
    await expect(first).resolves.toEqual({ turnId: 't1' })
  })

  it('reject kem TEN METHOD khi response co error', async () => {
    const { peer } = setup()
    const p = peer.request('turn/start')
    peer.feed('{"id":1,"error":{"code":-32000,"message":"khong dang nhap"}}\n')
    await expect(p).rejects.toThrow(/turn\/start: khong dang nhap/)
  })

  it('error khong co message thi bao theo code, khong ra chuoi rong', async () => {
    const { peer } = setup()
    const p = peer.request('turn/start')
    peer.feed('{"id":1,"error":{"code":-32001,"message":""}}\n')
    await expect(p).rejects.toThrow(/code -32001/)
  })

  it('nhan response KHONG co field `jsonrpc` (dung nhu app-server that tra ve)', async () => {
    // Quan sát từ codex-cli 0.142.4: `{"id":1,"result":{…}}`, không có "jsonrpc".
    const { peer } = setup()
    const p = peer.request('initialize')
    peer.feed('{"id":1,"result":{"codexHome":"C:\\\\Users\\\\x\\\\.codex"}}\n')
    await expect(p).resolves.toEqual({ codexHome: 'C:\\Users\\x\\.codex' })
  })

  it('resolve duoc result la `null`', async () => {
    const { peer } = setup()
    const p = peer.request('turn/cancel')
    peer.feed('{"id":1,"result":null}\n')
    await expect(p).resolves.toBeNull()
  })
})

describe('RpcPeer — timeout', () => {
  it('reject voi ten method va so giay khi qua han', async () => {
    const { peer, clock } = setup()
    const p = peer.request('turn/start', undefined, 60_000)
    clock.advance(60_000)
    await expect(p).rejects.toThrow(/turn\/start khong phan hoi sau 60s/)
    expect(peer.pendingCount).toBe(0)
  })

  it('timeoutMs <= 0 = cho KHONG gioi han (turn co the chay 30 phut)', async () => {
    const { peer, clock } = setup()
    const p = peer.request('turn/start', undefined, 0)
    clock.advance(10 * 60_000)
    expect(peer.pendingCount).toBe(1)
    peer.feed('{"id":1,"result":{"ok":true}}\n')
    await expect(p).resolves.toEqual({ ok: true })
  })

  it('response ve DUNG han thi huy timer, khong reject muon', async () => {
    const { peer, clock } = setup()
    const p = peer.request('thread/start', undefined, 1000)
    peer.feed('{"id":1,"result":{}}\n')
    await expect(p).resolves.toEqual({})
    clock.advance(5000) // timer cũ không được phép bắn
    expect(peer.pendingCount).toBe(0)
  })

  it('response ve SAU timeout chi la warning, khong crash', async () => {
    const { peer, warnings, clock } = setup()
    const p = peer.request('turn/start', undefined, 1000)
    clock.advance(1000)
    await expect(p).rejects.toThrow()
    peer.feed('{"id":1,"result":{"muon":true}}\n')
    expect(warnings.some((w) => w.includes('timeout'))).toBe(true)
  })
})

describe('RpcPeer — fail() khi tien trinh chet', () => {
  it('reject MOI promise dang cho voi ly do noi duoc', async () => {
    // Test quan trọng nhất của file: đây là hợp đồng chống bug "UI đứng ở spinner vĩnh viễn".
    const { peer } = setup()
    const a = peer.request('turn/start')
    const b = peer.request('thread/list')
    expect(peer.pendingCount).toBe(2)

    peer.fail('codex app-server thoat code 1: ERROR khong tim thay model')

    await expect(a).rejects.toThrow(/thoat code 1.*khong tim thay model/)
    await expect(b).rejects.toThrow(/thoat code 1/)
    expect(peer.pendingCount).toBe(0)
  })

  it('request SAU khi fail bi reject ngay, khong xep hang cho vo vong', async () => {
    const { peer, sent } = setup()
    peer.fail('stdin da dong')
    await expect(peer.request('turn/start')).rejects.toThrow(/stdin da dong/)
    expect(sent).toHaveLength(0) // không ghi gì ra tiến trình đã chết
  })

  it('giu LY DO DAU TIEN — do la nguyen nhan goc', async () => {
    const { peer } = setup()
    const p = peer.request('turn/start')
    peer.fail('exit code 1: het quota')
    peer.fail('stdin closed') // hệ quả, không phải nguyên nhân
    await expect(p).rejects.toThrow(/het quota/)
  })

  it('goi fail() nhieu lan khong loi khi khong con pending', () => {
    const { peer } = setup()
    expect(() => {
      peer.fail('a')
      peer.fail('b')
    }).not.toThrow()
  })

  it('send() throw (stdin dong) thi reject ngay chu khong doi timeout', async () => {
    const { peer } = setup({
      send: () => {
        throw new Error('EPIPE')
      },
    })
    await expect(peer.request('turn/start')).rejects.toThrow(/EPIPE/)
    expect(peer.pendingCount).toBe(0)
  })
})

describe('RpcPeer — notification', () => {
  it('notify() ghi message KHONG co id', () => {
    const { peer, sent } = setup()
    peer.notify('initialized', {})
    expect(JSON.parse(sent[0]!)).toEqual({ jsonrpc: '2.0', method: 'initialized', params: {} })
  })

  it('chuyen notification den onNotification', () => {
    const { peer, notifications } = setup()
    peer.feed('{"method":"turn/started","params":{"turnId":"t1"}}\n')
    expect(notifications).toEqual([{ method: 'turn/started', params: { turnId: 't1' } }])
  })

  it('notification KHONG lam anh huong pending nao', async () => {
    const { peer } = setup()
    const p = peer.request('turn/start')
    peer.feed('{"method":"item/agentMessage/delta","params":{"text":"a"}}\n')
    expect(peer.pendingCount).toBe(1)
    peer.feed('{"id":1,"result":{}}\n')
    await expect(p).resolves.toEqual({})
  })
})

describe('RpcPeer — server request (approval)', () => {
  it('goi handler roi ghi response dung id', async () => {
    const seen: ServerRequest[] = []
    const { peer, sent } = setup({
      onServerRequest: async (req) => {
        seen.push(req)
        return { decision: 'accept' }
      },
    })
    peer.feed('{"id":42,"method":"execCommandApproval","params":{"command":"ls"}}\n')
    await vi.waitFor(() => expect(sent).toHaveLength(1))

    expect(seen).toHaveLength(1)
    expect(seen[0]!.method).toBe('execCommandApproval')
    expect(JSON.parse(sent[0]!)).toEqual({ jsonrpc: '2.0', id: 42, result: { decision: 'accept' } })
  })

  it('handler tra undefined thi gui `{}` chu khong bo trong result', async () => {
    const { peer, sent } = setup({ onServerRequest: async () => undefined })
    peer.feed('{"id":7,"method":"applyPatchApproval","params":{}}\n')
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(JSON.parse(sent[0]!)).toEqual({ jsonrpc: '2.0', id: 7, result: {} })
  })

  it('handler THROW thi VAN gui {id,error} — im lang la treo phien', async () => {
    // App-server đang đợi đúng id này; không trả lời là turn không bao giờ kết thúc.
    const { peer, sent } = setup({
      onServerRequest: async () => {
        throw new Error('user dong panel')
      },
    })
    peer.feed('{"id":9,"method":"execCommandApproval","params":{}}\n')
    await vi.waitFor(() => expect(sent).toHaveLength(1))

    const msg = parseSent(sent)[0]
    expect(msg.id).toBe(9)
    expect(msg.error.message).toBe('user dong panel')
    expect(msg.result).toBeUndefined()
  })

  it('phan biet dung request (id+method) voi response (id, khong method)', async () => {
    const calls: string[] = []
    const { peer } = setup({
      onServerRequest: async (req) => {
        calls.push(req.method)
        return {}
      },
    })
    const p = peer.request('turn/start')
    // Cùng có `id`, nhưng cái đầu có `method` → là request từ server.
    peer.feed('{"id":100,"method":"execCommandApproval","params":{}}\n')
    peer.feed('{"id":1,"result":{"done":true}}\n')

    await expect(p).resolves.toEqual({ done: true })
    expect(calls).toEqual(['execCommandApproval'])
  })
})

describe('RpcPeer — frame la va dong hong', () => {
  it('dong khong parse duoc thanh warning, cac frame khac VAN chay', async () => {
    const { peer, warnings } = setup()
    const p = peer.request('turn/start')
    peer.feed('rac khong phai json\n{"id":1,"result":{"ok":1}}\n')
    await expect(p).resolves.toEqual({ ok: 1 })
    expect(warnings.some((w) => w.includes('khong parse duoc'))).toBe(true)
  })

  it('response cho id chua tung gui = warning, khong crash', () => {
    const { peer, warnings } = setup()
    peer.feed('{"id":999,"result":{}}\n')
    expect(warnings.some((w) => w.includes('999'))).toBe(true)
  })

  it('message khong thuoc loai nao = warning', () => {
    const { peer, warnings } = setup()
    peer.feed('{"chi_co_field_la":1}\n')
    expect(warnings.some((w) => w.includes('khong thuoc loai nao'))).toBe(true)
  })

  it('frame la (ban app-server moi) KHONG lam vo phien dang chay', async () => {
    // R1: schema đổi theo version — thêm method lạ không được quyền giết phiên.
    const { peer, notifications } = setup()
    const p = peer.request('turn/start')
    peer.feed('{"method":"tinhNangHoanToanMoi/xyz","params":{"gi":"do"}}\n')
    peer.feed('{"id":1,"result":{}}\n')
    await expect(p).resolves.toEqual({})
    expect(notifications).toHaveLength(1)
  })

  it('feed() nhieu lan voi chunk cat giua dong', async () => {
    const { peer } = setup()
    const p = peer.request('initialize')
    peer.feed('{"id":1,"resu')
    expect(peer.pendingCount).toBe(1)
    peer.feed('lt":{"ok":true}}\n')
    await expect(p).resolves.toEqual({ ok: true })
  })
})
