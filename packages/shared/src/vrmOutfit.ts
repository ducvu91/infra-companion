/**
 * F70 — trang phục nhân vật VRM.
 *
 * ⚠️ **Chuẩn VRM KHÔNG có khái niệm "bộ trang phục".** File chỉ chứa các mesh rời, không có
 * metadata nào nói mesh nào thuộc bộ nào. Đo thật trên 3 model:
 *
 * - `Ctg 2.0` → 16 mesh rời: `Dress`, `Sleeve`, `Socks`, `slippers`, `Ribbon`, `HandGloves`…
 *   Toàn món lẻ, không có bộ nào cả.
 * - `Carlotta` → `U_Char_0/1/2` — tên vô nghĩa do công cụ xuất sinh ra.
 * - `Aostylish` → `Body (merged)` — cả trang phục nằm trong MỘT mesh, không tách nổi.
 *
 * Nên "bộ trang phục" ở đây là **do user tự đặt**: bật/tắt các món rồi lưu lại tổ hợp đó dưới
 * một cái tên. Không có cách nào đọc bộ ra từ file, và đoán theo tên ("Dress + Socks chắc là
 * một bộ") chỉ đúng trong đầu người chứ không đúng trong dữ liệu.
 */

/**
 * Đuôi do công cụ xuất VRM thêm vào — không phải tên tác giả đặt, giấu đi cho dễ đọc.
 *
 * Phải khớp **nhiều đuôi chồng nhau và theo thứ tự bất kỳ**: gặp thật cả `U_Char_0.baked.baked`
 * lẫn `Body (merged).baked`, tức `(merged)` không nhất thiết đứng cuối. Bản đầu neo mỗi nhánh
 * vào `$` nên chỉ bóc được đuôi ngoài cùng và để lại `Body (merged)`.
 */
const EXPORT_SUFFIX = /(?:\.baked|\s*\(merged\))+$/gi

/** Tên mesh do công cụ sinh tự động, không mang ý nghĩa gì với user. */
const MEANINGLESS = /^(u_char|mesh|object|primitive|material|node)[\s_-]*\d*$/i

/** Bỏ đuôi kỹ thuật để hiện lên UI. */
export function cleanPartName(raw: string): string {
  return raw.replace(EXPORT_SUFFIX, '').trim()
}

/**
 * Model này có món nào đáng cho user bật/tắt không.
 *
 * `false` khi tác giả đã gộp hết vào một mesh, hoặc chỉ còn tên máy sinh — lúc đó hiện ra một
 * danh sách vài dòng vô nghĩa còn tệ hơn là nói thẳng "model này không tách được".
 */
export function hasCustomisableParts(names: readonly string[]): boolean {
  return names.filter((n) => !MEANINGLESS.test(cleanPartName(n))).length >= 2
}

/** Lọc ra những món đáng hiện, kèm tên đã dọn. */
export function usableParts<T extends { name: string }>(parts: readonly T[]): Array<T & { label: string }> {
  return parts
    .map((p) => ({ ...p, label: cleanPartName(p.name) }))
    .filter((p) => !MEANINGLESS.test(p.label) && p.label.length > 0)
}

/** Một bộ trang phục do user tự lưu: tên + danh sách món đang TẮT. */
export interface VrmOutfit {
  id: string
  name: string
  /**
   * Tên các mesh bị **ẩn** trong bộ này (lưu cái tắt, không lưu cái bật).
   *
   * Lưu danh sách tắt vì nó gần như luôn ngắn hơn, và quan trọng hơn: món mới xuất hiện (đổi
   * sang model khác có nhiều mesh hơn) thì mặc định là **hiện**, đúng với ý "bộ này chỉ tắt
   * mấy món tôi đã chọn tắt" thay vì làm nhân vật trần trụi.
   */
  hidden: string[]
}

/** Bộ trang phục theo từng model — khoá là `VrmModelDto.id`. */
export type VrmOutfitMap = Record<string, VrmOutfit[]>

/**
 * Toàn bộ nội dung `vrm-outfits.json`: các bộ đã lưu + bộ đang mặc của từng model.
 *
 * Có `worn` vì hiện/ẩn mesh chỉ sống trong state của renderer — mặc một bộ rồi khởi động lại
 * app là mọi thứ hiện lại hết, và "bấm vào bộ là mặc được" trông như hỏng ngay lần dùng thứ hai.
 */
export interface VrmOutfitFile {
  outfits: VrmOutfitMap
  /** model id → outfit id đang mặc. */
  worn: Record<string, string>
}

/** Kết quả trả về renderer: các bộ của một model + bộ đang mặc. */
export interface VrmOutfitsResult {
  outfits: VrmOutfit[]
  wornId: string | null
}

/** Áp một bộ: trả về map tên mesh → có hiện hay không. */
export function visibilityFor(outfit: VrmOutfit, allNames: readonly string[]): Record<string, boolean> {
  const hidden = new Set(outfit.hidden)
  const out: Record<string, boolean> = {}
  for (const n of allNames) out[n] = !hidden.has(n)
  return out
}

/** Tổ hợp bật/tắt hiện tại có khớp bộ này không — để đánh dấu bộ đang mặc. */
export function matchesOutfit(outfit: VrmOutfit, parts: ReadonlyArray<{ name: string; visible: boolean }>): boolean {
  const hidden = new Set(outfit.hidden)
  return parts.every((p) => p.visible === !hidden.has(p.name))
}
