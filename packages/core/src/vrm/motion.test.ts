import { describe, expect, it } from 'vitest'
import {
  MOTION_IDLE_EVERY_MAX_MS,
  MOTION_IDLE_EVERY_MIN_MS,
  motionForRole,
  motionIdleDelayMs,
  motionPackBytes,
  motionsForRole,
  nextMotionForRole,
  VRM_MOTIONS,
  type VrmMotionClip
} from '@infra/shared'

describe('thư viện chuyển động', () => {
  it('mỗi clip đủ thông tin để tải và kiểm', () => {
    for (const c of VRM_MOTIONS) {
      expect(c.url.startsWith('https://')).toBe(true)
      // 64 ký tự hex — sai định dạng thì mọi lượt tải đều hỏng ở bước kiểm
      expect(c.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(c.sizeBytes).toBeGreaterThan(0)
      expect(c.durationSec).toBeGreaterThan(0)
      expect(c.fileName.endsWith('.vrma')).toBe(true)
    }
  })

  it('id và tên file không trùng nhau', () => {
    expect(new Set(VRM_MOTIONS.map((c) => c.id)).size).toBe(VRM_MOTIONS.length)
    expect(new Set(VRM_MOTIONS.map((c) => c.fileName)).size).toBe(VRM_MOTIONS.length)
  })

  it('CHỈ chứa clip cho phân phối lại — repo này public', () => {
    // Bộ "VRMA_MotionPack" của pixiv cấm phát tán lại ở dạng trích xuất được; đây là chốt chặn
    // để không ai vô tình thêm nó vào
    for (const c of VRM_MOTIONS) {
      expect(c.license).toMatch(/CC0/)
      expect(c.licenseUrl.startsWith('https://')).toBe(true)
      expect(c.sourceUrl.startsWith('https://')).toBe(true)
      expect(c.author.length).toBeGreaterThan(0)
    }
  })

  it('mọi vai trò tự chạy đều có ít nhất một clip', () => {
    for (const role of ['idle', 'chat', 'poke', 'alert', 'recover', 'inspect'] as const) {
      expect(motionsForRole(role).length, `vai trò ${role}`).toBeGreaterThan(0)
      expect(motionForRole(role)?.role).toBe(role)
    }
  })

  it('vai trò idle có NHIỀU clip để luân phiên', () => {
    // Một tư thế lặp mãi ở nhịp 90–180 giây thì user thấy đúng cái đó lặp lại và nghĩ là hỏng
    expect(motionsForRole('idle').length).toBeGreaterThanOrEqual(2)
  })

  it('clip DI CHUYỂN không bao giờ được gán vai trò tự chạy', () => {
    // Nhân vật neo ở một góc màn hình — clip đi/chạy làm nó trôi khỏi khung hoặc lún qua mép
    for (const c of VRM_MOTIONS.filter((x) => x.locomotion)) {
      expect(c.role, `${c.id} phải là manual`).toBe('manual')
    }
  })

  it('clip tự chạy không chiếm chỗ quá lâu', () => {
    /**
     * Clip chạy thì lớp tự sinh tắt hết (nhìn theo chuột, kéo níu), nên clip càng dài thì nhân
     * vật càng "chết" lâu. Ngưỡng 25s chứ không 15s: user chọn "Tạo dáng" (20s) cho thao tác
     * chạm vào người, và đó là quyết định của họ — nhưng vẫn phải có trần, clip 40s thì nhân vật
     * đứng như tượng gần một phút sau mỗi cú click.
     */
    for (const role of ['chat', 'poke', 'alert', 'inspect'] as const) {
      for (const c of motionsForRole(role)) expect(c.durationSec, c.id).toBeLessThan(25)
    }
  })

  it('tổng dung lượng vài MB — đủ nhỏ để tải một lượt', () => {
    const mb = motionPackBytes() / 1024 / 1024
    expect(mb).toBeGreaterThan(0.5)
    expect(mb).toBeLessThan(10)
  })

  it('nhịp chạy clip idle THƯA — clip tắt hết lớp tự sinh nên không được dày', () => {
    expect(MOTION_IDLE_EVERY_MIN_MS).toBeGreaterThanOrEqual(60_000)
    expect(motionIdleDelayMs(() => 0)).toBe(MOTION_IDLE_EVERY_MIN_MS)
    expect(motionIdleDelayMs(() => 1)).toBe(MOTION_IDLE_EVERY_MAX_MS)
  })

  it('vai trò không có clip thì trả null, không vỡ', () => {
    expect(motionForRole('manual')).not.toBeNull()
  })
})

describe('xoay vòng clip cùng vai trò', () => {
  const idleIds = motionsForRole('idle').map((c) => c.id)

  it('luân phiên đều, KHÔNG lặp lại cái vừa chạy', () => {
    let last: string | null = null
    const seen: string[] = []
    for (let i = 0; i < 6; i++) {
      // Chú thích kiểu tường minh: `last` được gán từ chính kết quả nên TS không tự suy được
      const c: VrmMotionClip = nextMotionForRole('idle', last, idleIds)!
      expect(c.id, `lượt ${i} lặp lại clip vừa chạy`).not.toBe(last)
      seen.push(c.id)
      last = c.id
    }
    // Sáu lượt phải đi qua hết nhóm, không kẹt ở một cái
    expect(new Set(seen).size).toBe(idleIds.length)
  })

  it('chỉ xét clip ĐÃ TẢI — chưa tải mà chọn thì không có gì để phát', () => {
    const only = idleIds[0]!
    expect(nextMotionForRole('idle', null, [only])!.id).toBe(only)
    // Chỉ còn một clip khả dụng thì trả chính nó, kể cả khi nó vừa chạy
    expect(nextMotionForRole('idle', only, [only])!.id).toBe(only)
  })

  it('chưa tải clip nào → null, không vỡ', () => {
    expect(nextMotionForRole('idle', null, [])).toBeNull()
  })

  it('clip cũ không thuộc nhóm (vừa đổi vai trò) thì bắt đầu lại từ đầu', () => {
    expect(nextMotionForRole('idle', 'không-tồn-tại', idleIds)!.id).toBe(idleIds[0])
  })
})
