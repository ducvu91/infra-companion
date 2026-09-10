/**
 * Harness chụp ảnh dock AI — dựng tạm để TỰ NHÌN kết quả, không phải code sản phẩm.
 * Phải nằm TRONG apps/desktop thì Tailwind (@source) mới quét ra class.
 */
import { createRoot } from 'react-dom/client'
import { useUiStore } from '../src/renderer/src/stores/ui'
import { AiDockHost } from '../src/renderer/src/components/AiDock'

// Stub IPC — harness chạy ngoài Electron preload nên `window.infra` chưa có.
;(window as unknown as { infra: unknown }).infra = {
  ai: {
    getConfig: async () => ({ provider: 'gemini', model: 'gemini-3.5-flash', baseUrl: '', hasApiKey: true }),
    ask: async () => ({ text: 'demo' }),
  },
  aiDiagnose: { history: async () => [] },
}

// Mở CẢ HAI panel để thấy thanh tab.
useUiStore.setState({ aiPanelOpen: true, aiDiagnoseOpen: true, aiDockTab: 'ai', aiDockWidth: 280 })

// Chụp CẢ HAI bề rộng: 400 mặc định và 280 (hẹp nhất kéo được) — hàng tab + 3 nút vỡ hay không
// chỉ lộ ở mức hẹp nhất.
function Demo() {
  return (
    <div className="bg-app flex h-screen flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="text-subtle flex flex-1 items-center justify-center font-mono text-xs">400px</div>
        <AiDockHost />
      </div>
    </div>
  )
}

document.documentElement.setAttribute('data-theme', 'dark')
createRoot(document.getElementById('root')!).render(<Demo />)
