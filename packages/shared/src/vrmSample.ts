/**
 * F70 — model mẫu tải theo yêu cầu.
 *
 * Vì sao **không nhúng thẳng vào app**: model 14 MB sẽ vào mọi bản cài của mọi người, kể cả phần
 * lớn không bao giờ bật nhân vật lên. Tải khi cần thì cài đặt nhẹ nguyên vẹn, còn ai muốn dùng thì
 * bấm một nút.
 *
 * Vì sao **tự host trên GitHub Release của chính repo** chứ không trỏ thẳng sang trang gốc: link
 * của bên thứ ba chắc chắn sẽ chết theo thời gian (đã dính với runtime của local dev), và tải từ
 * một domain mình không kiểm soát thì không bảo đảm được nội dung. Giấy phép CC0 cho phép mình
 * host lại.
 */

/** Một model mẫu app có thể tải về hộ user. */
export interface VrmSampleModel {
  id: string
  /** Tên hiện trên UI. */
  label: string
  /** Mô tả ngắn: nhân vật thế nào, ai làm. */
  note: string
  /** Tác giả gốc — CC0 không bắt ghi công, nhưng ghi là chuyện nên làm. */
  author: string
  license: string
  /** Trang giấy phép, để user tự kiểm nếu muốn. */
  licenseUrl: string
  /** Nơi tải. Trỏ vào GitHub Release của chính repo này. */
  url: string
  /** Dự phòng khi link chính hỏng. */
  mirrors?: readonly string[]
  /** sha256 của file `.vrm` — bắt buộc khớp, lệch là vứt file đi. */
  sha256: string
  sizeBytes: number
  /** Tên file lưu vào máy user. */
  fileName: string
}

/**
 * Danh sách model mẫu. Hiện chỉ một — thêm nữa thì UI tự hiện thành danh sách chọn.
 *
 * ⚠️ **Chỉ thêm model có giấy phép cho PHÂN PHỐI LẠI.** Kiểm bằng `scripts/vrm-license.cjs` trước,
 * và với nhân vật game thương mại thì metadata trong file KHÔNG đủ — người chuyển đổi sang VRM tự
 * điền trường đó, họ không sở hữu bản quyền nhân vật.
 */
export const VRM_SAMPLE_MODELS: readonly VrmSampleModel[] = [
  {
    id: 'sendagaya-shino',
    label: 'Sendagaya Shino',
    note: 'Nữ sinh tóc dài — model mẫu chính thức của dự án VRoid',
    author: 'pixiv Inc.',
    license: 'CC0 (miễn trừ bản quyền)',
    licenseUrl: 'https://vroid.pixiv.help/hc/en-us/articles/360013482714-Sendagaya-Shino',
    // Release của chính repo này — xem docs/vrm-nhan-vat.md mục 10.2 để biết cách đăng lên.
    // Tag `vrm-sample-v1` cố ý TÁCH khỏi tag phát hành app: model không đổi theo phiên bản app,
    // và gắn vào tag app thì mỗi lần phát hành lại phải đính kèm 14 MB đó một lần nữa.
    url: 'https://github.com/xShiroeNguyenx/infra-companion/releases/download/vrm-sample-v1/sendagaya-shino.vrm',
    sha256: 'f11b2648e7e588ae171ad1c32e465f84e5b130b1d1789e3a3702946c0981d2a9',
    sizeBytes: 14_870_776,
    fileName: 'sendagaya-shino.vrm'
  }
]

/**
 * Trần dung lượng khi tải: dừng sớm nếu nhận vượt xa mức dự kiến.
 *
 * Không có nó thì một link bị chuyển hướng sai (trang đăng nhập, trang lỗi, file khác) sẽ được tải
 * về cho tới khi đầy đĩa. Nới 30% cho chênh lệch nén/đóng gói.
 */
export function sampleDownloadCap(sizeBytes: number): number {
  return Math.max(Math.round(sizeBytes * 1.3), 1_000_000)
}

/** Tiến độ tải, main bắn sang renderer. */
export interface VrmSampleProgress {
  id: string
  /** `download` đang tải · `verify` đang kiểm sha256 · `done` xong · `error` hỏng. */
  phase: 'download' | 'verify' | 'done' | 'error'
  receivedBytes: number
  totalBytes: number | null
  percent: number
  message?: string
}

export type VrmSampleFailReason = 'network' | 'checksum' | 'canceled' | 'io' | 'unknown'

export type VrmSampleResult =
  | { ok: true; modelId: string }
  | { ok: false; reason: VrmSampleFailReason; detail?: string }

/**
 * Câu báo lỗi cho user — **nói được nguyên nhân**, không phải mã lỗi.
 *
 * `checksum` đáng nói riêng: file tải về không khớp mã băm nghĩa là nội dung khác với cái đã kiểm,
 * có thể do mạng hỏng hoặc do bị chặn/thay thế. Cả hai đều phải vứt file đi, và user cần biết vì
 * sao app từ chối một file "đã tải xong".
 */
export function sampleErrorMessage(reason: VrmSampleFailReason): string {
  switch (reason) {
    case 'network':
      return 'Không tải được — kiểm tra kết nối mạng rồi thử lại.'
    case 'checksum':
      return 'File tải về không khớp mã kiểm tra nên đã bị bỏ. Thử lại; nếu vẫn vậy thì mạng đang chèn nội dung lạ.'
    case 'canceled':
      return 'Đã huỷ tải.'
    case 'io':
      return 'Không ghi được file xuống đĩa — kiểm tra dung lượng trống.'
    default:
      return 'Tải thất bại.'
  }
}
