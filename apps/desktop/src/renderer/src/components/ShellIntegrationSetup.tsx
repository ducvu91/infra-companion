import { useState } from 'react'
import { OSC133_BASH_SNIPPET, osc133InstallCommand } from '@infra/shared'
import { useT } from '../i18n'
import { terminalTargetPane } from '../stores/tabs'
import { useToastsStore } from '../stores/toasts'

/**
 * Khối "bật shell integration" — hiện ngay chỗ người dùng gặp bế tắc.
 *
 * Trước đây ô tìm lệnh (F24) khi rỗng chỉ nói *"cần shell integration — dán đoạn OSC 133 ở Cài
 * đặt → Terminal vào ~/.bashrc"*. Câu đó đúng nhưng **không dùng được**: nó không nói đoạn nào,
 * bắt người ta rời khỏi đây, đi tìm trong Cài đặt, rồi tự SSH vào từng máy. Ai đọc xong cũng
 * phải làm thêm bốn bước mới bắt đầu được.
 *
 * Nay có đủ ba đường, xếp theo mức tự động giảm dần:
 *  · **Cài vào máy này** — gửi lệnh ghi vào `~/.bashrc` của host đang mở, chạy luôn. Một bấm.
 *  · **Chép** — cho ai muốn tự dán, hoặc dán vào Ansible/cloud-init để rải cả fleet.
 *  · **Xem đoạn script** — mở ra đọc trước khi tin; không ai nên chạy thứ mình chưa xem.
 *
 * Vì sao nút cài **gửi kèm Enter** (khác hẳn nút "Chèn lệnh" của Trợ lý AI, cố ý không kèm):
 * lệnh này do CHÍNH APP dựng ra và là read-append vào một file cấu hình của user, không phải
 * chuỗi do AI hay lịch sử sinh ra; người dùng đã bấm đúng nút mang tên "cài vào máy này", nên
 * bắt bấm Enter lần nữa chỉ là thêm một bước không nói thêm điều gì.
 */
export function ShellIntegrationSetup() {
  const t = useT()
  const [showScript, setShowScript] = useState(false)
  const [copied, setCopied] = useState(false)
  const push = useToastsStore((s) => s.push)

  const copy = (): void => {
    void navigator.clipboard.writeText(OSC133_BASH_SNIPPET).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const install = (): void => {
    // `terminalTargetPane()` chứ không đọc tab active: ô tìm này mở đè lên mọi thứ, và ở chế độ
    // tab thì tab active là chính công cụ — helper tự rơi về tab terminal gần nhất.
    const target = terminalTargetPane()
    if (!target) {
      push(t('shellSetup.needTerminal'), 'error')
      return
    }
    window.infra.terminal.write(target.pane.sessionId, `${osc133InstallCommand()}\n`)
    push(t('shellSetup.sent', { host: target.pane.subtitle ?? target.pane.title }), 'info')
  }

  return (
    <div className="border-edge bg-input mx-3 my-2 rounded border p-3">
      <p className="text-content mb-1 text-xs font-medium">{t('shellSetup.title')}</p>
      <p className="text-subtle mb-2.5 text-[11px] leading-relaxed">{t('shellSetup.why')}</p>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <button
          className="border-accent/50 bg-accent-soft/40 text-accent-fg hover:bg-accent-soft/60 rounded border px-2 py-1 text-[11px]"
          title={t('shellSetup.installHint')}
          onClick={install}
        >
          ⚡ {t('shellSetup.install')}
        </button>
        <button
          className={`border-edge-strong rounded border px-2 py-1 text-[11px] ${
            copied ? 'text-accent' : 'text-muted hover:bg-hover hover:text-content'
          }`}
          onClick={copy}
        >
          {copied ? `✓ ${t('shellSetup.copied')}` : `⧉ ${t('shellSetup.copy')}`}
        </button>
        <button
          className="border-edge-strong text-muted hover:bg-hover hover:text-content rounded border px-2 py-1 text-[11px]"
          aria-expanded={showScript}
          onClick={() => setShowScript((v) => !v)}
        >
          {showScript ? `▾ ${t('shellSetup.hideScript')}` : `▸ ${t('shellSetup.showScript')}`}
        </button>
      </div>

      {/* Đoạn script để ĐỌC: `whitespace-pre` + cuộn ngang, không wrap — một dòng shell bị gấp
          khúc là thứ người ta không dám chạy vì không rõ nó dừng ở đâu.
          `max-h-36` chứ không cao hơn: chụp thử với 48 thì script đẩy dòng ghi chú "cài vào
          .bashrc có hiệu lực từ phiên SAU" ra khỏi khu cuộn của ô tìm và bị cắt mất nửa — mà đó
          đúng là câu trả lời cho "cài rồi sao vẫn chưa ghi gì". Script tự cuộn được. */}
      {showScript && (
        <pre className="border-edge bg-app text-muted mb-2 max-h-36 overflow-auto rounded border p-2 font-mono text-[10px] leading-relaxed whitespace-pre">
          {OSC133_BASH_SNIPPET}
        </pre>
      )}

      <p className="text-subtle text-[10px] leading-relaxed">{t('shellSetup.note')}</p>
    </div>
  )
}
