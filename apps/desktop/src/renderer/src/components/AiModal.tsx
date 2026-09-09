import { useEffect, useMemo, useState } from 'react'
import type { AiConfigDto, AiModeDto, AiProviderDto } from '@infra/shared'
import { useT } from '../i18n'
import { MiniMarkdown } from '../lib/miniMarkdown'
import { terminalTargetPane, useTabsStore } from '../stores/tabs'
import { errorMessage, useToastsStore } from '../stores/toasts'
import { AiDock } from './AiDock'
import { OpenInTabButton } from './OpenInTabButton'
import { Button, Field, Modal, Select, TextArea, TextInput } from './ui'

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
export function AiModal({ onClose, embedded }: { onClose?: () => void; embedded?: boolean }) {
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

  if (showSettings) {
    return (
      <AiSettings
        current={config}
        // đã có config: "Đóng" quay về khung hỏi đáp (giữ câu trả lời đang xem); chưa có thì đóng hẳn
        onClose={() => (config || embedded ? setShowSettings(false) : onClose?.())}
        onSaved={(c) => {
          setConfig(c)
          setShowSettings(false)
        }}
      />
    )
  }

  const body = (
    <>
      <p className="text-subtle mb-2 text-[11px]">
        {config ? `${config.provider} · ${config.model}` : t('ai.notSetUp')}
      </p>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {(['generate', 'explain', 'explain-error'] as AiModeDto[]).map((m) => (
          <button
            key={m}
            className={`rounded border px-2 py-1 text-xs ${
              mode === m
                ? 'border-accent bg-accent-hover/15 text-accent-fg'
                : 'border-edge-strong text-muted hover:bg-hover'
            }`}
            onClick={() => setMode(m)}
          >
            {m === 'generate' ? t('ai.modeGenerate') : m === 'explain' ? t('ai.modeExplain') : t('ai.modeError')}
          </button>
        ))}
      </div>

      <TextArea
        rows={3}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void ask()
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
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        {/* Lệnh sẽ đi tới máy NÀO — panel sống song song và người ta đổi tab liên tục, nên đây
            là thứ phải đọc chắc trước khi bấm chèn. Cố ý KHÔNG dùng `text-subtle text-[10px]`
            như một dòng ghi chú: chụp thử thì nó mờ đến mức mắt bỏ qua, mà bỏ qua dòng này là
            chèn lệnh vào máy khác. Tên máy tô sáng, "Chèn vào:" thì nhạt. */}
        <span className="min-w-0 truncate text-[11px]">
          {activePane ? (
            <>
              <span className="text-subtle">{t('ai.targetLabel')} </span>
              <span className="text-content font-medium">{activePane.subtitle ?? activePane.title}</span>
            </>
          ) : (
            <span className="text-warning">{t('ai.noTarget')}</span>
          )}
        </span>
        <Button variant="primary" disabled={busy || !input.trim()} onClick={() => void ask()}>
          {busy ? t('ai.asking') : t('ai.ask')}
        </Button>
      </div>

      {answer && (
        <div className="border-edge bg-input mt-3 rounded border p-3">
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
      )}
    </>
  )

  // Chế độ TAB: nội dung chảy trong vùng tab, giới hạn bề rộng đọc cho dễ (dòng dài quá thì mắt
  // mất hàng) và có nút ⚙ ở góc vì tab không có header của dock.
  if (embedded) {
    return (
      <div className="@container min-h-0 flex-1 overflow-y-auto px-4 py-3">
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
    )
  }

  return (
    <AiDock
      icon="✨"
      title={t('ai.title')}
      onClose={() => onClose?.()}
      headerExtra={
        <>
          {/* ⛶ = phóng to thành TAB. Đóng dock ngay sau đó: để cả hai cùng mở thì có hai màn hình
              AI với hai state khác nhau, và user không biết mình đang gõ vào cái nào. */}
          <OpenInTabButton kind="ai" onDone={onClose} />
          <button
            className="text-subtle hover:text-content px-1 text-xs leading-none"
            title={t('ai.configure')}
            aria-label={t('ai.configure')}
            onClick={() => setShowSettings(true)}
          >
            ⚙
          </button>
        </>
      }
    >
      {body}
    </AiDock>
  )
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
