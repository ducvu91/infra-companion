import { describe, expect, it } from 'vitest'
import { probeVrm, VRM_PROBE_BYTES } from './glb'

/**
 * Dựng một file glTF-Binary tối giản trong bộ nhớ. Không nhúng file `.vrm` mẫu vào repo:
 * repo public và một model thật là hàng chục MB, vào git là vĩnh viễn.
 */
function buildGlb(
  doc: unknown,
  opts: { magic?: number; version?: number; chunkType?: number; truncateJson?: number } = {}
): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(doc))
  // Spec đòi chunk JSON pad tới bội số 4 bằng dấu cách; dựng đúng để test sát thật
  const pad = (4 - (json.length % 4)) % 4
  const chunkLen = json.length + pad
  const out = new Uint8Array(12 + 8 + chunkLen)
  const view = new DataView(out.buffer)
  view.setUint32(0, opts.magic ?? 0x46546c67, true)
  view.setUint32(4, opts.version ?? 2, true)
  view.setUint32(8, out.length, true)
  view.setUint32(12, opts.truncateJson ?? chunkLen, true)
  view.setUint32(16, opts.chunkType ?? 0x4e4f534a, true)
  out.set(json, 20)
  out.fill(0x20, 20 + json.length, 20 + chunkLen)
  return out
}

const VRM1 = {
  extensionsUsed: ['VRMC_vrm', 'VRMC_springBone', 'VRMC_materials_mtoon'],
  meshes: [{}, {}],
  materials: [{}, {}, {}],
  images: [{}],
  extensions: {
    VRMC_vrm: {
      specVersion: '1.0',
      meta: {
        name: 'Nhân vật thử',
        authors: ['Tác giả A', 'Tác giả B'],
        avatarPermissionType: 'onlyAuthor',
        commercialUsageType: 'personalNonProfit',
        licenseUrl: 'https://example.com/license'
      }
    }
  }
}

describe('probeVrm', () => {
  it('đọc được VRM 1.0 kèm meta, đếm mesh/material/image', () => {
    const r = probeVrm(buildGlb(VRM1))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.info.spec).toBe('1.0')
    expect(r.info.specVersion).toBe('1.0')
    expect(r.info.meta.title).toBe('Nhân vật thử')
    // authors là MẢNG ở bản 1.0 — gộp lại thành một dòng hiển thị được
    expect(r.info.meta.author).toBe('Tác giả A, Tác giả B')
    expect(r.info.meta.commercialUse).toBe('personalNonProfit')
    expect(r.info.meshCount).toBe(2)
    expect(r.info.materialCount).toBe(3)
    expect(r.info.imageCount).toBe(1)
    // Model VRM thường KHÔNG mang animation: chuyển động do code sinh
    expect(r.info.animationCount).toBe(0)
    expect(r.info.extensions).toContain('VRMC_springBone')
  })

  it('đọc được VRM 0.x với bộ khoá meta khác hẳn', () => {
    const r = probeVrm(
      buildGlb({
        meshes: [{}],
        extensions: {
          VRM: {
            specVersion: '0.0',
            meta: {
              title: 'Model cũ',
              author: 'Một người',
              allowedUserName: 'Everyone',
              commercialUssageName: 'Disallow' // sic — spec 0.x gõ sai chính tả khoá này
            }
          }
        }
      })
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.info.spec).toBe('0.x')
    expect(r.info.meta.title).toBe('Model cũ')
    expect(r.info.meta.author).toBe('Một người')
    expect(r.info.meta.commercialUse).toBe('Disallow')
  })

  it('glTF thường (không có phần mở rộng VRM) → notVrm, không phải "hỏng file"', () => {
    // Đây là ca hỏng IM LẶNG nếu để three-vrm tự lo: nó nạp ra hình học không xương
    const r = probeVrm(buildGlb({ meshes: [{}], materials: [{}] }))
    expect(r).toEqual({ ok: false, reason: 'notVrm' })
  })

  it('phân biệt được từng kiểu file sai', () => {
    expect(probeVrm(new Uint8Array(8))).toEqual({ ok: false, reason: 'tooSmall' })
    expect(probeVrm(buildGlb(VRM1, { magic: 0x12345678 }))).toEqual({ ok: false, reason: 'notGlb' })
    expect(probeVrm(buildGlb(VRM1, { version: 1 }))).toEqual({ ok: false, reason: 'badVersion' })
    // Chunk đầu là BIN thay vì JSON
    expect(probeVrm(buildGlb(VRM1, { chunkType: 0x004e4942 }))).toEqual({ ok: false, reason: 'noJsonChunk' })
  })

  it('chunk JSON dài hơn số byte đang có → noJsonChunk, KHÔNG parse chuỗi bị cắt', () => {
    // Ca thật: nơi gọi chỉ đọc 2 MB đầu mà chunk JSON lớn hơn thế
    const r = probeVrm(buildGlb(VRM1, { truncateJson: 10_000_000 }))
    expect(r).toEqual({ ok: false, reason: 'noJsonChunk' })
  })

  it('JSON hỏng → badJson chứ không throw', () => {
    // Ghi một byte không hợp lệ ở đầu chunk JSON (offset 20) — chỗ chắc chắn phá cú pháp
    const g = buildGlb(VRM1)
    g[20] = 0x5d // ']' thay cho '{'
    expect(probeVrm(g)).toEqual({ ok: false, reason: 'badJson' })
  })

  it('đọc đúng khi Uint8Array là cửa sổ trên buffer lớn hơn', () => {
    // Buffer của Node dùng pool chung nên byteOffset ≠ 0 là chuyện thường; bỏ qua nó
    // thì DataView đọc lệch sang dữ liệu khác và mọi thứ sai một cách khó hiểu
    const glb = buildGlb(VRM1)
    const big = new Uint8Array(64 + glb.length)
    big.set(glb, 64)
    const r = probeVrm(big.subarray(64))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.info.meta.title).toBe('Nhân vật thử')
  })

  it('meta thiếu hoàn toàn thì vẫn ok, chỉ là không có gì để hiện', () => {
    const r = probeVrm(buildGlb({ extensions: { VRMC_vrm: { specVersion: '1.0' } } }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.info.meta).toEqual({})
  })

  it('VRM_PROBE_BYTES đủ rộng cho phần mô tả của model thật', () => {
    // File thật đo được: chunk JSON ~158 KB trong file 44 MB
    expect(VRM_PROBE_BYTES).toBeGreaterThan(512 * 1024)
  })
})
