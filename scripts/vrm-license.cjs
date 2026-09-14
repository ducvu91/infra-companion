#!/usr/bin/env node
/**
 * Đọc GIẤY PHÉP nhúng trong file `.vrm` — dùng trước khi đưa bất kỳ model nào vào repo.
 *
 * File VRM mang sẵn metadata quyền sử dụng do chính tác giả đặt (VRM 1.0: `VRMC_vrm.meta`,
 * VRM 0.x: `VRM.meta`). Đây là **nguồn đáng tin hơn lời mô tả trên trang tải về**: trang web có
 * thể đổi, còn metadata đi theo file.
 *
 * Quan tâm nhất là quyền **phân phối lại** — repo này public, đưa model vào là phát tán nó cho
 * mọi người tải. Model cho phép "dùng thương mại" nhưng CẤM phân phối lại thì KHÔNG đưa vào được.
 *
 * Dùng:  node scripts/vrm-license.cjs <file.vrm> [file2.vrm ...]
 */
const fs = require('node:fs')

/** Đọc chunk JSON đầu của file glb. Không nạp cả file vào three — chỉ cần phần mô tả. */
function readGltfJson(path) {
  const fd = fs.openSync(path, 'r')
  try {
    const header = Buffer.alloc(20)
    fs.readSync(fd, header, 0, 20, 0)
    if (header.toString('utf8', 0, 4) !== 'glTF') throw new Error('không phải file glb/vrm')
    const jsonLen = header.readUInt32LE(12)
    const buf = Buffer.alloc(jsonLen)
    fs.readSync(fd, buf, 0, jsonLen, 20)
    return JSON.parse(buf.toString('utf8'))
  } finally {
    fs.closeSync(fd)
  }
}

/** VRM 1.0 và 0.x đặt quyền ở hai chỗ khác nhau, tên trường cũng khác — quy về một khuôn. */
function readMeta(gltf) {
  const ext = gltf.extensions || {}
  const v1 = ext.VRMC_vrm
  if (v1?.meta) {
    const m = v1.meta
    return {
      spec: 'VRM 1.0',
      name: m.name,
      authors: (m.authors || []).join(', '),
      phanPhoiLai: m.modification === 'allowModificationRedistribution' ? 'CHO (kèm sửa đổi)' : m.modification,
      thuongMai: m.commercialUsage,
      giayPhep: m.licenseUrl,
      dungNhanVat: m.avatarPermission,
      ghiCong: m.creditNotation,
      chinhSua: m.modification
    }
  }
  const v0 = ext.VRM
  if (v0?.meta) {
    const m = v0.meta
    return {
      spec: 'VRM 0.x',
      name: m.title,
      authors: m.author,
      phanPhoiLai: m.allowedUserName === 'Everyone' ? 'xem licenseName' : m.allowedUserName,
      thuongMai: m.commercialUssageName || m.commercialUsageName,
      giayPhep: m.licenseName === 'Other' ? m.otherLicenseUrl || 'Other (không ghi URL)' : m.licenseName,
      dungNhanVat: m.allowedUserName,
      ghiCong: m.otherPermissionUrl || '',
      chinhSua: m.modification
    }
  }
  return null
}

/**
 * Kết luận NGẮN: có an toàn để đưa vào repo public không. Thà nói "không chắc" còn hơn đoán.
 *
 * Ưu tiên bắt tín hiệu CẤM trước tín hiệu CHO: model 0.x hay ghi thẳng `Redistribution_Prohibited`
 * vào `licenseName`, còn URL giấy phép VRoid thì nhét `redistribution=allow|disallow` vào query —
 * đọc sót chỗ đó là kết luận ngược hẳn.
 */
function verdict(meta) {
  if (!meta) return '❓ KHÔNG đọc được metadata — không đưa vào repo'
  const lic = String(meta.giayPhep || '').toLowerCase()

  // CẤM — xét trước tiên
  if (lic.includes('redistribution_prohibited') || lic.includes('redistribution=disallow')) {
    return '❌ CẤM phân phối lại (ghi rõ trong metadata) — KHÔNG đưa vào repo'
  }
  if (meta.chinhSua === 'prohibited') return '❌ CẤM sửa đổi/phân phối lại — KHÔNG đưa vào repo'

  // CHO rõ ràng
  if (lic.includes('cc0') || lic.includes('publicdomain')) return '✅ CC0 — phân phối lại thoải mái'
  if (lic.includes('redistribution=allow')) {
    const credit = lic.includes('credit=necessary') ? ' (PHẢI ghi công tác giả)' : ''
    const com = lic.includes('corporate_commercial_use=disallow') ? ' — nhưng CẤM dùng thương mại doanh nghiệp' : ''
    return `✅ CHO phân phối lại${credit}${com}`
  }
  if (meta.chinhSua === 'allowModificationRedistribution') {
    return '✅ Metadata CHO phân phối lại — vẫn nên đọc thêm licenseUrl'
  }
  if (lic.includes('cc_by') || lic.includes('cc-by')) return '⚠️ CC-BY — được, nhưng PHẢI ghi công tác giả'
  return '❓ Không kết luận được từ metadata — phải đọc giấy phép gốc trước khi dùng'
}

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('Dùng: node scripts/vrm-license.cjs <file.vrm> [...]')
  process.exit(1)
}
for (const f of files) {
  console.log('─'.repeat(70))
  console.log(f)
  try {
    const meta = readMeta(readGltfJson(f))
    if (meta) {
      for (const [k, v] of Object.entries(meta)) {
        if (v !== undefined && v !== '') console.log(`  ${k.padEnd(14)} ${v}`)
      }
    }
    console.log(`  ${'KẾT LUẬN'.padEnd(14)} ${verdict(meta)}`)
  } catch (e) {
    console.log('  LỖI:', e.message)
  }
}
