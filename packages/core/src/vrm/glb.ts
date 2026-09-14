/**
 * F70 — nhân vật VRM: đọc phần đầu file để biết nó có thật là VRM không, và là bản nào.
 *
 * Vì sao parse ở đây chứ không để `three-vrm` tự lo: thư viện chỉ báo lỗi SAU khi đã nạp
 * trọn 40–60 MB vào renderer và dựng scene. Một file `.vrm` sai định dạng (hoặc là glTF
 * thường không có phần mở rộng VRM) sẽ nạp ra một cục hình học không xương, không mặt —
 * hỏng nhưng **không** throw. Kiểm ở main trước khi truyền bytes thì user nhận được câu
 * nói rõ nguyên nhân, và 44 MB không phải đi qua IPC để rồi bị bỏ.
 *
 * Chỉ đọc **chunk JSON đầu** (~150 KB trong file 44 MB), không chạm chunk BIN.
 *
 * Cấu trúc glTF-Binary (glTF 2.0 §4.4.1):
 *   header  12B: magic 'glTF' | version u32 | tổng độ dài u32
 *   chunk    8B: độ dài u32 | loại 4B ('JSON' hoặc 'BIN\0')  rồi tới nội dung
 */

import type { VrmMeta, VrmSpec } from '@infra/shared'

/** Magic 'glTF' dạng số little-endian — so bằng số nhanh và không cần decode chuỗi. */
const GLB_MAGIC = 0x46546c67
const HEADER_BYTES = 12
const CHUNK_HEADER_BYTES = 8

/** Trần chunk JSON. Phần mô tả của model thật hiếm khi quá 1 MB; hơn nữa là file dị thường. */
const MAX_JSON_CHUNK = 8 * 1024 * 1024

export type { VrmMeta, VrmSpec }

export interface VrmInfo {
  spec: VrmSpec
  /** Chuỗi tác giả khai (`'1.0'`, `'0.0'`…). Chỉ để hiển thị, KHÔNG so sánh để bật/tắt gì. */
  specVersion?: string
  meta: VrmMeta
  meshCount: number
  materialCount: number
  imageCount: number
  animationCount: number
  /** Tên các phần mở rộng file dùng — cho phép nói "model này có springBone" trên UI. */
  extensions: string[]
}

export type VrmProbe =
  | { ok: true; info: VrmInfo }
  | { ok: false; reason: 'tooSmall' | 'notGlb' | 'badVersion' | 'noJsonChunk' | 'badJson' | 'notVrm' }

/**
 * Đọc header + chunk JSON của một file `.vrm`.
 *
 * Cố ý nhận `Uint8Array` (không nhận đường dẫn) để hàm thuần và test được: nơi gọi ở main
 * chỉ cần đọc **phần đầu** file rồi đưa vào đây, không phải nạp cả 44 MB.
 */
export function probeVrm(bytes: Uint8Array): VrmProbe {
  if (bytes.length < HEADER_BYTES + CHUNK_HEADER_BYTES) return { ok: false, reason: 'tooSmall' }

  // `byteOffset` bắt buộc: một Uint8Array có thể là CỬA SỔ trên ArrayBuffer lớn hơn
  // (Buffer của Node hay dùng pool chung), bỏ qua nó là đọc nhầm sang dữ liệu của người khác.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  if (view.getUint32(0, true) !== GLB_MAGIC) return { ok: false, reason: 'notGlb' }
  if (view.getUint32(4, true) !== 2) return { ok: false, reason: 'badVersion' }

  const chunkLen = view.getUint32(HEADER_BYTES, true)
  const chunkType = view.getUint32(HEADER_BYTES + 4, true)
  // 'JSON' little-endian
  if (chunkType !== 0x4e4f534a) return { ok: false, reason: 'noJsonChunk' }
  if (chunkLen === 0 || chunkLen > MAX_JSON_CHUNK) return { ok: false, reason: 'noJsonChunk' }

  const start = HEADER_BYTES + CHUNK_HEADER_BYTES
  // Nơi gọi có thể mới đọc một phần đầu file: thiếu byte thì nói rõ, đừng parse JSON bị cắt
  if (start + chunkLen > bytes.length) return { ok: false, reason: 'noJsonChunk' }

  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + chunkLen)))
  } catch {
    return { ok: false, reason: 'badJson' }
  }
  if (!json || typeof json !== 'object') return { ok: false, reason: 'badJson' }

  const doc = json as Record<string, unknown>
  const ext = asRecord(doc.extensions)
  const vrm1 = asRecord(ext?.VRMC_vrm)
  const vrm0 = asRecord(ext?.VRM)
  if (!vrm1 && !vrm0) return { ok: false, reason: 'notVrm' }

  const spec: VrmSpec = vrm1 ? '1.0' : '0.x'
  const node = vrm1 ?? vrm0!

  return {
    ok: true,
    info: {
      spec,
      specVersion: asString(node.specVersion),
      meta: spec === '1.0' ? meta1(asRecord(node.meta)) : meta0(asRecord(node.meta)),
      meshCount: asArrayLength(doc.meshes),
      materialCount: asArrayLength(doc.materials),
      imageCount: asArrayLength(doc.images),
      animationCount: asArrayLength(doc.animations),
      extensions: Array.isArray(doc.extensionsUsed)
        ? doc.extensionsUsed.filter((x): x is string => typeof x === 'string')
        : []
    }
  }
}

/**
 * VRM 1.0: `authors` là MẢNG, quyền dùng là mã chuỗi.
 * (`VRMC_vrm.meta` — spec vrm-1.0)
 */
function meta1(m: Record<string, unknown> | null): VrmMeta {
  if (!m) return {}
  const authors = Array.isArray(m.authors)
    ? m.authors.filter((x): x is string => typeof x === 'string')
    : []
  return {
    title: asString(m.name),
    author: authors.length > 0 ? authors.join(', ') : undefined,
    avatarPermission: asString(m.avatarPermissionType) ?? asString(m.allowedUserName),
    commercialUse: asString(m.commercialUsageType) ?? asString(m.commercialUssageName),
    licenseUrl: asString(m.licenseUrl) ?? asString(m.otherLicenseUrl)
  }
}

/** VRM 0.x: khoá tên khác hẳn (`title`, `author` số ít, `allowedUserName`). */
function meta0(m: Record<string, unknown> | null): VrmMeta {
  if (!m) return {}
  return {
    title: asString(m.title),
    author: asString(m.author),
    avatarPermission: asString(m.allowedUserName),
    commercialUse: asString(m.commercialUssageName) ?? asString(m.commercialUsageName),
    licenseUrl: asString(m.otherLicenseUrl) ?? asString(m.licenseName)
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
}

function asArrayLength(v: unknown): number {
  return Array.isArray(v) ? v.length : 0
}

/**
 * Số byte đầu file cần đọc để `probeVrm` có đủ dữ liệu trong **hầu hết** trường hợp.
 * Nơi gọi vẫn phải xử lý `noJsonChunk` (chunk JSON lớn hơn mức này) bằng cách đọc thêm.
 */
export const VRM_PROBE_BYTES = 2 * 1024 * 1024
