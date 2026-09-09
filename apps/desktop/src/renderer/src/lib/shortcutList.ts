/**
 * Danh sách phím tắt để TRA CỨU — nguồn dùng chung cho cheat sheet Dashboard và thẻ "Phím tắt"
 * trong Trợ giúp.
 *
 * Trước đây danh sách này nằm trong `DashboardView.tsx` và là bản chép tay của các handler
 * hardcode trong `App.tsx`; giờ vẫn phải giữ đồng bộ bằng tay với App.tsx (không có cách nào đọc
 * ngược từ handler ra), nhưng ít nhất chỉ còn MỘT bản chép thay vì hai.
 *
 * Riêng 4 phím terminal thì user đổi được ở Cài đặt → đọc giá trị đang lưu chứ không in cứng,
 * nếu không cheat sheet sẽ nói dối ngay khi user đổi phím.
 */

import type { I18nKey } from '../i18n'
import { SHORTCUT_ACTIONS, type ShortcutAction } from './shortcuts'

export interface ShortcutEntry {
  /** Khoá i18n mô tả hành động. */
  key: I18nKey
  /** Từng phím một để render thành các <kbd> riêng. */
  combo: string[]
}

/** Phím cấp app — phải khớp với bộ handler keydown trong `App.tsx`. */
export const APP_SHORTCUTS: ReadonlyArray<ShortcutEntry> = [
  { key: 'dashboard.sc.help', combo: ['F1'] },
  { key: 'dashboard.sc.shortcuts', combo: ['Ctrl', '/'] },
  { key: 'dashboard.sc.palette', combo: ['Ctrl', 'Shift', 'P'] },
  { key: 'dashboard.sc.newTab', combo: ['Ctrl', 'Shift', 'T'] },
  { key: 'dashboard.sc.closeTab', combo: ['Ctrl', 'Shift', 'W'] },
  { key: 'dashboard.sc.cycle', combo: ['Ctrl', 'Tab'] },
  { key: 'dashboard.sc.split', combo: ['Ctrl', 'Shift', 'D'] },
  { key: 'dashboard.sc.broadcast', combo: ['Ctrl', 'Shift', 'B'] },
  { key: 'dashboard.sc.sidebar', combo: ['Ctrl', 'Shift', 'H'] },
  { key: 'dashboard.sc.ai', combo: ['Ctrl', 'I'] },
  // F24 — ô tìm lệnh đã chạy. Ctrl+Shift+R chứ không Ctrl+R: Ctrl+R để dành cho
  // reverse-search của bash trong terminal.
  { key: 'cmdHistory.title', combo: ['Ctrl', 'Shift', 'R'] },
  // Panel đáy của theme Workbench. Thiếu ở đây suốt từ v0.2.22 — mà đó chính là chỗ người ta
  // đến tra khi không biết mở panel bằng gì.
  { key: 'dashboard.sc.bottomPanel', combo: ['Ctrl', 'J'] }
]

/** Nhãn i18n của 4 hành động terminal — dùng lại khoá đã có ở màn hình Cài đặt. */
const TERM_LABEL: Record<ShortcutAction, I18nKey> = {
  copy: 'settings.sc.copy',
  paste: 'settings.sc.paste',
  find: 'settings.sc.find',
  explain: 'settings.sc.explain'
}

/** 4 phím terminal theo ĐÚNG giá trị user đang đặt (`stores/settings`.shortcuts). */
export function terminalShortcuts(current: Record<ShortcutAction, string>): ShortcutEntry[] {
  return SHORTCUT_ACTIONS.map((action) => ({
    key: TERM_LABEL[action],
    combo: current[action].split('+')
  }))
}
