/**
 * F70 — kiểu dữ liệu của model VRM.
 *
 * Đặt ở `shared` (không ở `core`) vì **renderer phải dùng** mà renderer không được import
 * `@infra/core` — kéo `ssh2` vào bundle web là vỡ build (CLAUDE.md mục 5). Hàm parse thật
 * (`probeVrm`) vẫn ở `core/src/vrm/glb.ts` và import kiểu từ đây.
 */

export type VrmSpec = '0.x' | '1.0'

/**
 * Điều khoản sử dụng do tác giả model khai trong file. **Hiện cho user thấy**, không dùng để
 * chặn: app không có tư cách phán xử giấy phép, nhưng im lặng thì user không biết mình đang
 * dùng model cấm dùng thương mại.
 *
 * Hai bản VRM đặt tên khoá khác nhau hoàn toàn (0.x: `title`/`author` số ít;
 * 1.0: `name`/`authors` mảng) — chuẩn hoá về một hình dạng ở đây để UI chỉ vẽ một kiểu.
 */
export interface VrmMeta {
  title?: string
  author?: string
  /** Bản 1.0 dùng mã chuỗi (`everyone`/`onlyAuthor`…), bản 0.x dùng nhãn riêng. */
  avatarPermission?: string
  commercialUse?: string
  licenseUrl?: string
}
