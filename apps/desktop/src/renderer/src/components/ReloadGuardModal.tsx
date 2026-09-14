import { useEffect, useState } from 'react'
import { Button, Modal } from './ui'
import { useT } from '../i18n'

/**
 * Hỏi lại trước khi nạp lại cửa sổ bằng Ctrl+R / F5.
 *
 * Ctrl+R là phản xạ của trình duyệt, nhưng ở đây nó **đóng sạch mọi tab terminal đang mở** —
 * mất phiên SSH và lệnh đang chạy dở, không có đường hoàn tác. Phím đã bị chặn ở main
 * (`before-input-event`, chỉ bắt phím gõ), nên reload do app tự gọi không đi qua đây.
 *
 * Mặc định là **Huỷ**: người lỡ tay bấm Ctrl+R thường bấm tiếp Enter/Space theo quán tính, nên
 * nút nguy hiểm không được giữ focus.
 */
export function ReloadGuardModal() {
  const t = useT()
  const [open, setOpen] = useState(false)

  useEffect(() => window.infra.app.onReloadRequested(() => setOpen(true)), [])

  if (!open) return null
  return (
    <Modal title={t('reloadGuard.title')} onClose={() => setOpen(false)}>
      <div className="w-[420px] max-w-full">
        <p className="text-muted mb-4 text-xs leading-relaxed">{t('reloadGuard.desc')}</p>
        <div className="flex justify-end gap-2">
          <Button autoFocus onClick={() => setOpen(false)}>
            {t('reloadGuard.cancel')}
          </Button>
          <Button variant="danger" onClick={() => window.infra.app.confirmReload()}>
            {t('reloadGuard.confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
