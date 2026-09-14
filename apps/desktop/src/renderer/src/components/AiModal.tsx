import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AiConfigDto, AiModeDto, AiProviderDto } from '@infra/shared'
import { useT } from '../i18n'
import { MiniMarkdown } from '../lib/miniMarkdown'
import { terminalTargetPane, useTabsStore } from '../stores/tabs'
import { errorMessage, useToastsStore } from '../stores/toasts'
import type { AiDockPaneSpec } from './AiDock'
import { OpenInTabButton } from './OpenInTabButton'
import { Button, Field, Modal, Select, TextInput } from './ui'

const MODEL_HINT: Record<AiProviderDto, string> = {
  claude: 'claude-opus-4-8',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
  ollama: 'llama3.1',
}

const BASEURL_HINT: Record<AiProviderDto, string> = {
  claude: '',
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  ollama: 'http://localhost:11434',
}

/**
 * Trợ lý AI (F09): sinh lệnh từ tiếng Việt/Anh, giải thích lệnh & lỗi, chèn lệnh vào terminal.
 *
 * **Là DOCK cạnh terminal, không phải modal.** Bản đầu là `Modal` có backdrop nên mở Trợ lý AI
 * ra là không làm được gì khác — trong khi việc thật luôn là *vừa hỏi vừa nhìn output*: hỏi cách
 * tìm file lớn, chạy thử, dán lỗi vào hỏi tiếp. Với backdrop thì vòng đó thành "đóng AI → chạy →
 * mở lại → gõ lại câu hỏi".
 *
 * Nay là **cột dock bên phải** (khuôn panel Claude Code trong VS Code): dock **chiếm chỗ thật**
 * nên terminal hẹp lại nhường chỗ chứ **không bị che** — quan trọng vì nửa việc hỏi AI là đọc
 * output, mà một panel nổi dù kéo đi đâu cũng cắn vào phần đang đọc. Kéo mép trái để đổi bề
 * rộng, bề rộng nhớ qua localStorage.
 *
 * Nút **⛶** mở chính nó thành **TAB** (`embedded`): câu trả lời dài — một script nhiều dòng, một
 * bảng so sánh — đọc trong cột 400px là cuộn liên tục. Dùng lại đúng component này chứ không viết
 * bản thứ hai; state nằm ngay trong component nên câu hỏi đang gõ theo sang tab luôn.
 *
 * Cấu hình (provider/model/API key) vẫn là **modal**: đó là form điền một lần, không phải thứ
 * cần dùng song song với terminal, và nó có ô mật khẩu — chặn màn hình lúc đó là đúng.
 */
export function AiModal({
  onClose,
  embedded,
  renderSpec,
  onCollapseToCharacter,
}: {
  onClose?: () => void
  embedded?: boolean
  /**
   * Có = hiện nút "thu về nhân vật" (💬) trên hàng tab của dock: đóng cột, mở lại bong bóng chat
   * trên đầu nhân vật VRM — đường ngược của nút ⛶ trong bong bóng. Dock chỉ truyền khi nhân vật
   * đang hiện; không có nhân vật thì không có nút, không mời user về một chỗ không tồn tại.
   */
  onCollapseToCharacter?: () => void
  /**
   * Chế độ dock: thay vì tự vẽ cột, panel đưa spec của mình lên `AiDockShell` để hai công cụ AI
   * dùng chung một cột + thanh tab. Là hàm chứ không phải `<AiDock>` bọc ngoài vì shell phải biết
   * TẤT CẢ panel đang mở mới quyết được có vẽ thanh tab hay không.
   */
  renderSpec?: (spec: AiDockPaneSpec) => ReactNode
}) {
  const t = useT()
  const [config, setConfig] = useState<AiConfigDto | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [mode, setMode] = useState<AiModeDto>('generate')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<{
    text: string
    command?: string
  } | null>(null)
  /**
   * Pane terminal nhận lệnh. Dùng `terminalTargetPane()` chứ không đọc thẳng tab active: ở chế
   * độ TAB thì tab active LÀ chính màn hình AI này, đọc tab active sẽ ra "không có terminal" và
   * nút Chèn tắt vĩnh viễn. Helper đó tự rơi về tab terminal gần nhất — cùng cách AiDiagnoseModal
   * đã làm cho đúng ca này.
   */
  const tabsSnapshot = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeId)
  const lastTerminalTabId = useTabsStore((s) => s.lastTerminalTabId)
  const target = useMemo(
    () => terminalTargetPane(),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cố ý phụ thuộc vào 3 giá trị store
    [tabsSnapshot, activeTabId, lastTerminalTabId],
  )
  const activePane = target?.pane

  useEffect(() => {
    void window.infra.ai.getConfig().then((c) => {
      setConfig(c)
      if (!c) setShowSettings(true)
    })
  }, [])

  const ask = async (): Promise<void> => {
    if (!input.trim() || busy) return
    setBusy(true)
    setAnswer(null)
    try {
      const res = await window.infra.ai.ask(mode, input.trim())
      setAnswer(res)
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  /**
   * Chèn lệnh vào terminal — **KHÔNG kèm Enter**, và **KHÔNG đóng panel**.
   *
   * Không đóng là chủ ý: sau khi chạy thử thường còn hỏi tiếp ("lệnh này báo lỗi này thì sao"),
   * đóng panel là bắt gõ lại câu hỏi từ đầu. Đây chính là cái mà bản modal làm sai.
   */
  const insertCommand = (): void => {
    if (!answer?.command || !target) return
    window.infra.terminal.write(target.pane.sessionId, answer.command)
    useToastsStore.getState().push(t('ai.inserted'), 'info')
    // Ở chế độ TAB, terminal vừa nhận lệnh đang ở một tab KHÁC — không chuyển sang thì user chỉ
    // thấy một toast rồi ngồi nhìn màn hình AI, tưởng chèn không được. Ở dock thì terminal ngay
    // bên cạnh nên đứng yên là đúng.
    if (embedded) useTabsStore.getState().setActive(target.tabId)
  }

  // Form cấu hình là `Modal` (overlay riêng) nên vẽ SONG SONG chứ không thay chỗ panel: ở chế độ
  // dock, thay chỗ sẽ làm panel biến khỏi thanh tab suốt lúc mở form — tab tự nhiên mất rồi hiện
  // lại. Vẽ song song thì dock đứng yên, form nổi lên trên.
  const settings = showSettings ? (
    <AiSettings
      current={config}
      // đã có config: "Đóng" quay về khung hỏi đáp (giữ câu trả lời đang xem); chưa có thì đóng hẳn
      onClose={() => (config || embedded ? setShowSettings(false) : onClose?.())}
      onSaved={(c) => {
        setConfig(c)
        setShowSettings(false)
      }}
    />
  ) : null

  /**
   * Vùng CUỘN: model đang dùng + câu trả lời. Cố ý **không** chứa ô nhập — xem `composer`.
   */
  const body = (
    <>
      <p className="text-subtle mb-2 text-[11px]">
        {config ? `${config.provider} · ${config.model}` : t('ai.notSetUp')}
      </p>

      {answer ? (
        <div className="border-edge bg-input rounded border p-3">
          <MiniMarkdown source={answer.text} />
          {answer.command && (
            <div className="border-edge mt-2 border-t pt-2">
              {/* Lệnh XUỐNG DÒNG, không `truncate`: cột dock hẹp nên một dòng `find … | sort …`
                  bị cắt còn `find /var -xdev -type f -printf '%s %p\n' | so…` — mà đây là lệnh
                  sắp chạy trên máy thật, đọc không hết thì không nên bấm. Thà cao thêm 2 dòng. */}
              <code className="text-success block font-mono text-[11px] break-all whitespace-pre-wrap">
                {answer.command}
              </code>
              <div className="mt-2 flex justify-end">
                <Button
                  variant="primary"
                  className="!px-2 !py-1 !text-xs"
                  disabled={!activePane}
                  title={activePane ? t('ai.insertHint') : t('ai.insertNeedTab')}
                  onClick={insertCommand}
                >
                  ↵ {t('ai.insert')}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        // Panel rỗng thì vùng cuộn trắng trơn, trông như chưa nạp xong. Một dòng nói việc cần làm
        // là đủ; ví dụ cụ thể đã nằm ở placeholder của ô nhập ngay bên dưới.
        !busy && <p className="text-subtle text-[11px] leading-relaxed">{t('ai.emptyHint')}</p>
      )}

      {busy && <p className="text-muted text-xs">{t('ai.asking')}</p>}
    </>
  )

  /**
   * Ô nhập tự cao theo nội dung — bằng JS, cùng lý do ở `CodexPanel`: `field-sizing: content` báo
   * là hỗ trợ nhưng đo thật thì ô cao 0px ở Electron này. Đặt `auto` trước rồi mới đọc
   * `scrollHeight`, không thì xoá bớt chữ mà ô vẫn cao như cũ.
   */
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [input])

  /**
   * Khe ĐÁY (`footer` của `AiDock`): MỘT khung liền như tab Codex — ô nhập ở trên, hàng điều
   * khiển ở dưới (kiểu câu hỏi bên trái · nút gửi tròn bên phải), máy đích thành dòng nhỏ dưới
   * khung, đúng chỗ Codex để cwd.
   *
   * Cùng khuôn với Codex là chủ ý: hai tab cạnh nhau trong một cột mà ô nhập mỗi tab một kiểu
   * (bên này ba chip + nút to, bên kia khung bo tròn + mũi tên) thì trông như hai app dán vào
   * nhau. Neo ở đáy như mọi khung chat: câu trả lời chảy phía trên, chỗ gõ đứng yên một chỗ.
   */
  const composer = (
    <>
      <div className="border-edge-strong bg-input focus-within:border-accent rounded-xl border px-2.5 pt-2 pb-1.5 transition-colors">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter GỬI, Shift+Enter xuống dòng — như Codex và mọi khung chat; Ctrl+Enter vẫn gửi
            if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
              // Đang gõ tiếng Việt/Nhật bằng IME: Enter là để CHỌN chữ, không phải gửi
              if (e.nativeEvent.isComposing) return
              e.preventDefault()
              void ask()
              return
            }
            // Esc thuộc terminal ở panel này (không backdrop) — nhưng trong ô nhập thì Esc xoá
            // nội dung đang gõ là phản xạ quen, và chặn lan để Esc không đóng thứ khác.
            if (e.key === 'Escape' && input !== '') {
              e.stopPropagation()
              setInput('')
            }
          }}
          placeholder={
            mode === 'generate' ? t('ai.phGenerate') : mode === 'explain' ? t('ai.phExplain') : t('ai.phError')
          }
          className="text-content placeholder:text-subtle max-h-40 min-h-[3.25rem] w-full resize-none border-0 bg-transparent text-sm outline-none"
        />

        <div className="mt-1 flex items-center justify-between gap-2">
          {/* Kiểu câu hỏi đứng đúng chỗ Codex đặt model: `<select>` trần, không viền — nó đã nằm
              trong khung nhập, thêm hộp viền nữa là hộp trong hộp. Vẫn là <select> thật để có bàn
              phím và menu hệ điều hành miễn phí. */}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as AiModeDto)}
            title={t('ai.modeLabel')}
            aria-label={t('ai.modeLabel')}
            className="text-accent-fg hover:bg-hover hover:text-content min-w-0 cursor-pointer appearance-none truncate rounded border-0 bg-transparent py-0.5 pr-1 pl-1 text-[11px] font-medium outline-none"
          >
            <option value="generate">{t('ai.modeGenerate')}</option>
            <option value="explain">{t('ai.modeExplain')}</option>
            <option value="explain-error">{t('ai.modeError')}</option>
          </select>
          {/* Nút gửi TRÒN, chỉ mũi tên — như Codex; ở cột 400px thì "Hỏi AI (Ctrl+Enter)" chiếm
              gần nửa hàng cho một việc phím Enter đã làm. Nhãn đầy đủ ở tooltip. */}
          <button
            onClick={() => void ask()}
            disabled={busy || !input.trim()}
            title={busy ? t('ai.asking') : t('ai.sendHint')}
            aria-label={t('ai.ask')}
            className="bg-accent hover:bg-accent-hover flex size-7 shrink-0 items-center justify-center rounded-full text-sm leading-none text-white transition-colors disabled:opacity-30"
          >
            {busy ? '…' : '↑'}
          </button>
        </div>
      </div>

      {/* Lệnh sẽ đi tới máy NÀO — dưới khung như dòng cwd của Codex, nhưng KHÔNG mờ kiểu ghi chú
          10px: panel sống song song và người ta đổi tab liên tục, chụp thử thì dòng mờ bị mắt bỏ
          qua, mà bỏ qua dòng này là chèn lệnh vào máy khác. Tên máy tô sáng, "Chèn vào:" thì nhạt. */}
      <p className="mt-1 truncate text-[11px]">
        {activePane ? (
          <>
            <span className="text-subtle">{t('ai.targetLabel')} </span>
            <span className="text-content font-medium">{activePane.subtitle ?? activePane.title}</span>
          </>
        ) : (
          <span className="text-warning">{t('ai.noTarget')}</span>
        )}
      </p>
    </>
  )

  // Chế độ TAB: nội dung chảy trong vùng tab, giới hạn bề rộng đọc cho dễ (dòng dài quá thì mắt
  // mất hàng) và có nút ⚙ ở góc vì tab không có header của dock.
  //
  // Cùng cách chia khe như dock — chỉ vùng câu trả lời cuộn, `composer` neo đáy tab. Ở tab thì
  // trả lời còn dài hơn (đó là lý do có tab), nên để ô nhập trôi theo là sai hơn nữa.
  if (embedded) {
    return (
      <div className="@container flex min-h-0 flex-1 flex-col">
        {settings}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          <div className="mx-auto w-full max-w-3xl">
            <div className="mb-2 flex justify-end">
              <button
                className="border-edge-strong text-muted hover:bg-hover hover:text-content rounded border px-2 py-0.5 text-[11px]"
                title={t('ai.configure')}
                onClick={() => setShowSettings(true)}
              >
                ⚙ {t('ai.configure')}
              </button>
            </div>
            {body}
          </div>
        </div>
        <div className="border-edge bg-panel shrink-0 border-t px-4 py-2.5">
          <div className="mx-auto w-full max-w-3xl">{composer}</div>
        </div>
      </div>
    )
  }

  // Chế độ DOCK: không tự vẽ khung mà trả spec lên `AiDockShell` — khung (bề rộng, thanh tab) là
  // của chung hai công cụ AI, panel chỉ góp nội dung của mình.
  return renderSpec?.({
    id: 'ai',
    icon: '✨',
    title: t('ai.title'),
    headerExtra: (
      <>
        {/* 💬 = thu về bong bóng trên đầu nhân vật — đường ngược của ⛶ trong bong bóng. */}
        {onCollapseToCharacter && (
          <button
            className="text-subtle hover:bg-hover hover:text-content shrink-0 rounded px-1 py-0.5 text-sm leading-none"
            title={t('ai.collapseToCharacter')}
            aria-label={t('ai.collapseToCharacter')}
            onClick={onCollapseToCharacter}
          >
            💬
          </button>
        )}
        {/* ⛶ = phóng to thành TAB. Đóng dock ngay sau đó: để cả hai cùng mở thì có hai màn hình
            AI với hai state khác nhau, và user không biết mình đang gõ vào cái nào. */}
        <OpenInTabButton kind="ai" onDone={onClose} compact />
        <button
          className="text-subtle hover:text-content px-1 text-xs leading-none"
          title={t('ai.configure')}
          aria-label={t('ai.configure')}
          onClick={() => setShowSettings(true)}
        >
          ⚙
        </button>
      </>
    ),
    // `settings` là Modal `fixed` nên chỗ đặt trong cây không đổi vị trí hiển thị; gửi kèm footer
    // để nó sống cùng vòng đời panel.
    footer: (
      <>
        {settings}
        {composer}
      </>
    ),
    children: body,
  })
}

function AiSettings({
  current,
  onClose,
  onSaved,
}: {
  current: AiConfigDto | null
  onClose: () => void
  onSaved: (c: AiConfigDto) => void
}) {
  const t = useT()
  const [provider, setProvider] = useState<AiProviderDto>(current?.provider ?? 'claude')
  const [model, setModel] = useState(current?.model ?? MODEL_HINT.claude)
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)

  const changeProvider = (p: AiProviderDto): void => {
    setProvider(p)
    if (!current || current.provider !== p) setModel(MODEL_HINT[p])
    if (p === 'ollama' && !baseUrl) setBaseUrl('http://localhost:11434')
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.infra.ai.setConfig({
        provider,
        model: model.trim() || MODEL_HINT[provider],
        baseUrl: baseUrl.trim(),
        // undefined = giữ key cũ; chỉ gửi khi user nhập mới
        apiKey: apiKey ? apiKey : undefined,
      })
      const cfg = await window.infra.ai.getConfig()
      if (cfg) onSaved(cfg)
    } catch (error) {
      useToastsStore.getState().push(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={t('ai.configTitle')} onClose={onClose}>
      <div className="w-[440px] max-w-full">
        <Field label={t('ai.provider')}>
          <Select value={provider} onChange={(e) => changeProvider(e.target.value as AiProviderDto)}>
            <option value="claude">Claude (Anthropic)</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini (Google)</option>
            <option value="ollama">{t('ai.ollamaOption')}</option>
          </Select>
        </Field>
        <Field label={t('ai.model')}>
          <TextInput value={model} onChange={(e) => setModel(e.target.value)} placeholder={MODEL_HINT[provider]} />
        </Field>
        {provider !== 'claude' && (
          <Field label={provider === 'ollama' ? t('ai.ollamaUrl') : t('ai.baseUrl')}>
            <TextInput
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={BASEURL_HINT[provider]}
            />
          </Field>
        )}
        {provider !== 'ollama' && (
          <Field label={current?.hasApiKey ? t('ai.apiKeyKeep') : t('ai.apiKey')}>
            <TextInput
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                current?.hasApiKey
                  ? '••••••••'
                  : provider === 'claude'
                    ? 'sk-ant-…'
                    : provider === 'gemini'
                      ? 'AIza…'
                      : 'sk-…'
              }
            />
          </Field>
        )}
        <p className="text-subtle mb-3 text-[11px]">{t('ai.keyNote')}</p>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{t('common.close')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? t('ai.saving') : t('common.save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
