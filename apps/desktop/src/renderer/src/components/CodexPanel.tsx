import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { CodexItemDto, CodexReadinessDto } from '@infra/shared'
import { useT } from '../i18n'
import { MiniMarkdown } from '../lib/miniMarkdown'
import { useCodexStore } from '../stores/codex'
import type { AiDockPaneSpec } from './AiDock'
import { OpenInTabButton } from './OpenInTabButton'
import { Button, Field, Select, TextInput } from './ui'

/**
 * Agent Codex — mở dạng TAB (không phải cột dock).
 *
 * **Xác thực bằng GÓI ChatGPT, không API key**: app spawn `codex app-server` và nó tự đọc
 * `~/.codex/auth.json` do user tạo bằng `codex login`. Panel này không có ô nhập key nào, và
 * app không đọc file đó.
 *
 * Vì sao TAB chứ không phải tab thứ ba trong cột dock AI: dock rộng tối đa 720px (mặc định 400)
 * và tồn tại để *hỗ trợ* việc đọc terminal. Codex thì **là** việc chính — output có diff, danh
 * sách file, khối lệnh kèm kết quả. Một diff trong cột 400px không đọc nổi, mà hộp duyệt lệnh
 * (GĐ3) lại là chỗ phải đọc HẾT trước khi bấm.
 */
export function CodexPanel({
  embedded,
  onClose,
  renderSpec,
}: {
  embedded?: boolean
  onClose?: () => void
  /** Chế độ dock: góp spec vào cột AI dùng chung — xem `AiDockShell`. */
  renderSpec?: (spec: AiDockPaneSpec) => ReactNode
}) {
  const t = useT()
  const readiness = useCodexStore((s) => s.readiness)
  const settings = useCodexStore((s) => s.settings)
  const sessionId = useCodexStore((s) => s.sessionId)
  const state = useCodexStore((s) => s.state)
  const items = useCodexStore((s) => s.items)
  const log = useCodexStore((s) => s.log)
  const busy = useCodexStore((s) => s.busy)
  const startError = useCodexStore((s) => s.startError)

  const refreshStatus = useCodexStore((s) => s.refreshStatus)
  const loadSettings = useCodexStore((s) => s.loadSettings)
  const restore = useCodexStore((s) => s.restore)
  const probe = useCodexStore((s) => s.probe)
  const pickBinary = useCodexStore((s) => s.pickBinary)
  const pickCwd = useCodexStore((s) => s.pickCwd)
  const start = useCodexStore((s) => s.start)
  const stop = useCodexStore((s) => s.stop)
  const send = useCodexStore((s) => s.send)
  const cancel = useCodexStore((s) => s.cancel)

  const [cwd, setCwd] = useState('')
  const [input, setInput] = useState('')
  const [showLog, setShowLog] = useState(false)

  useEffect(() => {
    void refreshStatus()
    void loadSettings()
    // Nối lại phiên còn sống: phiên nằm ở MAIN nên nó vẫn chạy sau khi renderer reload hoặc sau
    // khi user đóng rồi mở lại panel. Không làm bước này thì UI hiện "Bắt đầu phiên" trong khi
    // một lượt đang chạy dở, và phiên đó chỉ bị dọn sau TTL 5 phút.
    void restore()
  }, [refreshStatus, loadSettings, restore])

  /**
   * Điền sẵn thư mục làm việc — main chọn thư mục vừa dùng, hoặc một thư mục code hay gặp **đã
   * kiểm tồn tại**. User không phải bấm gì cũng bắt đầu được; muốn đổi thì bấm "Chọn…".
   *
   * `pickedRef` chặn việc ghi đè lựa chọn của user: hàm này chạy lại mỗi khi `settings` đổi (và
   * `settings` đổi sau mỗi lần start vì `recentCwds` được cập nhật), nên không có cờ thì thư mục
   * user vừa chọn tay sẽ bị nhảy về mặc định.
   */
  const pickedRef = useRef(false)
  useEffect(() => {
    if (pickedRef.current) return
    let alive = true
    void window.infra.codex.defaultCwd().then((d) => {
      if (alive && !pickedRef.current && d !== '') setCwd(d)
    })
    return () => {
      alive = false
    }
  }, [settings.recentCwds])

  /**
   * Ô nhập tự cao theo nội dung — làm bằng JS vì `field-sizing: content` **không chạy** ở
   * Electron này (xem chú thích ở chỗ `<textarea>`).
   *
   * Đặt `height = 'auto'` trước rồi mới đọc `scrollHeight`: không reset thì `scrollHeight`
   * không bao giờ nhỏ lại, nên xoá bớt chữ mà ô vẫn cao như cũ.
   */
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [input])

  const running = state.phase === 'running' || state.phase === 'awaiting-approval'
  const canSend = sessionId !== null && !running && input.trim() !== ''

  const submit = (): void => {
    if (!canSend) return
    send(input.trim())
    setInput('')
  }

  /** Vùng CUỘN — màn hình bắt đầu, hoặc nhật ký lượt. Không chứa ô nhập (xem `composer`). */
  const body = (
    <>
      {sessionId === null ? (
        <StartScreen
          readiness={readiness}
          busy={busy}
          cwd={cwd}
          recent={settings.recentCwds}
          startError={startError}
          onCwdChange={(v) => {
            // User tự chọn → khoá mặc định lại, đừng nhảy về gợi ý ở lượt render sau.
            pickedRef.current = true
            setCwd(v)
          }}
          onPickCwd={async () => {
            const picked = await pickCwd()
            if (picked) {
              pickedRef.current = true
              setCwd(picked)
            }
          }}
          onPickBinary={() => void pickBinary()}
          onProbe={() => void probe()}
          onStart={() => void start(cwd)}
        />
      ) : (
        <>
          {/* Phiên vừa resume: agent NHỚ hội thoại cũ (transcript của Codex), nhưng UI chưa
              dựng lại được nên khung trống. Nói rõ, không để user tưởng nó quên hết. */}
          {items.length === 0 && state.threadId && (
            <p className="text-subtle mb-2 text-[11px] leading-relaxed">{t('codex.resumedNote')}</p>
          )}
          <Transcript items={items} />
        </>
      )}
      {/* Phiên cũ chỉ hiện ở màn hình bắt đầu — đang trong phiên mà đổi sang phiên khác là
          thao tác hiếm, và để nó ở đây thì khung chat đỡ một khối. */}
      {sessionId === null && readiness?.kind !== 'not-installed' && <ThreadList />}

      {log.length > 0 && (
        <div className="border-edge mt-4 border-t pt-2">
          <button className="text-subtle hover:text-content text-[11px]" onClick={() => setShowLog((v) => !v)}>
            {showLog ? '▾' : '▸'} {t('codex.logToggle')} ({log.length})
          </button>
          {showLog && (
            <pre className="border-edge bg-input text-muted mt-1.5 max-h-48 overflow-auto rounded border p-2 font-mono text-[10px] whitespace-pre-wrap">
              {log.join('\n')}
            </pre>
          )}
        </div>
      )}
    </>
  )

  /**
   * Khe ĐÁY: trạng thái · ô nhập · nút. Chỉ có khi phiên đang mở — màn hình bắt đầu đã có nút
   * "Bắt đầu phiên" của riêng nó, thêm một khe đáy trống nữa chỉ chiếm chỗ.
   */
  const composer =
    sessionId === null ? null : (
      <>
        <StatusRow />
        {/**
         * MỘT KHUNG LIỀN: ô nhập ở trên, hàng điều khiển ở dưới, chung một viền bo tròn.
         *
         * Bản trước là ba khối rời xếp chồng (ô nhập · hàng model+nút · dòng cwd) nên nhìn rời
         * rạc và nút Gửi to chiếm giữa. Gom vào một khung là khuôn của mọi khung chat hiện nay
         * — mắt đọc ra ngay "đây là chỗ gõ", và hàng dưới thành phụ kiện của nó chứ không phải
         * ba thứ ngang hàng.
         *
         * Viền sáng lên khi focus (`focus-within`) để biết con trỏ đang ở đây.
         */}
        <div className="border-edge-strong bg-input focus-within:border-accent rounded-xl border px-2.5 pt-2 pb-1.5 transition-colors">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              /**
               * **Enter GỬI, Shift+Enter xuống dòng** — khuôn của mọi khung chat, và của chính
               * Codex app. Ctrl+Enter vẫn gửi (khỏi phải bỏ thói quen cũ).
               */
              if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
                // `isComposing` = đang gõ tiếng Việt/Nhật bằng IME: Enter lúc đó là để CHỌN chữ,
                // không phải gửi. Không chặn thì gõ "được" bằng Telex sẽ gửi mất câu dở.
                if (e.nativeEvent.isComposing) return
                e.preventDefault()
                submit()
                return
              }
              if (e.key === 'Escape' && input !== '') {
                e.stopPropagation()
                setInput('')
              }
            }}
            placeholder={t('codex.inputPlaceholder')}
            ref={inputRef}
            /**
             * `bg-transparent` + không viền: ô nhập hoà vào khung, viền là của khung bên ngoài.
             *
             * ⚠️ Ô tự cao theo nội dung làm bằng **JS** (`autoGrow`), KHÔNG bằng
             * `field-sizing: content`: `CSS.supports` báo Chromium hỗ trợ, nhưng đo thật thì
             * cả class Tailwind lẫn inline style đều cho `computedFieldSizing: "fixed"` và ô
             * cao **0px** — tức không thấy chữ mình gõ. Đây đúng loại API im lặng ở mục 8
             * CLAUDE.md, bắt được nhờ đọc `getBoundingClientRect()` sau khi chụp.
             */
            className="text-content placeholder:text-subtle max-h-40 min-h-[3.25rem] w-full resize-none border-0 bg-transparent text-sm outline-none"
          />

          {/* Hàng điều khiển — model bên trái, nút bên phải, cùng một dòng như Claude/Codex. */}
          <div className="mt-1 flex items-center justify-between gap-2">
            <ModelPicker />
            <div className="flex shrink-0 items-center gap-1">
              {/* "Kết thúc phiên" thành nút chữ mờ: nó là thao tác hiếm, để nó cạnh nút Gửi
                  dưới dạng nút đầy đủ thì hai thứ trông ngang hàng nhau. */}
              {running ? (
                <button
                  onClick={cancel}
                  className="text-subtle hover:bg-hover hover:text-content rounded px-2 py-1 text-[11px]"
                >
                  {t('codex.cancelTurn')}
                </button>
              ) : (
                <button
                  onClick={() => void stop()}
                  disabled={busy}
                  className="text-subtle hover:bg-hover hover:text-content rounded px-2 py-1 text-[11px] disabled:opacity-50"
                >
                  {t('codex.endSession')}
                </button>
              )}
              {/* Nút gửi TRÒN, chỉ mũi tên — như Claude. Ở cột 400px thì "Gửi (Ctrl+Enter)"
                  chiếm gần nửa hàng cho một việc mà phím Enter đã làm. Nhãn ở tooltip. */}
              <button
                onClick={submit}
                disabled={!canSend}
                title={running ? t('codex.working') : t('codex.sendHint')}
                aria-label={t('codex.send')}
                className="bg-accent hover:bg-accent-hover flex size-7 shrink-0 items-center justify-center rounded-full text-sm leading-none text-white transition-colors disabled:opacity-30"
              >
                {running ? '…' : '↑'}
              </button>
            </div>
          </div>
        </div>

        {/* cwd dưới khung, mờ và nhỏ — thông tin tham chiếu, không phải điều khiển. */}
        <p className="text-subtle mt-1 truncate font-mono text-[10px]" title={state.cwd}>
          {state.cwd}
        </p>
      </>
    )

  // Chế độ DOCK (tab thứ 3 của cột AI): góp spec, khung do `AiDockShell` vẽ.
  if (renderSpec) {
    return renderSpec({
      id: 'codex',
      icon: '🤖',
      title: t('codex.title'),
      onClose: () => onClose?.(),
      // ⛶ mở sang TAB — cột hẹp đọc diff rất mệt, đó là lý do tab là chế độ chính.
      headerExtra: <OpenInTabButton kind="codex" onDone={onClose} compact />,
      footer: composer,
      children: body,
    })
  }

  return (
    <div className={embedded ? '@container flex min-h-0 flex-1 flex-col' : 'flex h-full flex-col'}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        <div className="mx-auto w-full max-w-4xl">{body}</div>
      </div>
      {composer && (
        <div className="border-edge bg-panel shrink-0 border-t px-4 py-2.5">
          <div className="mx-auto w-full max-w-4xl">{composer}</div>
        </div>
      )}
    </div>
  )
}

/** Dòng trạng thái phiên: phase + MCP server đang có. */
function StatusRow() {
  const t = useT()
  const state = useCodexStore((s) => s.state)

  const phaseLabel =
    state.phase === 'running'
      ? t('codex.phaseRunning')
      : state.phase === 'awaiting-approval'
        ? t('codex.phaseAwaiting')
        : state.phase === 'failed'
          ? t('codex.phaseFailed')
          : state.phase === 'done'
            ? t('codex.phaseDone')
            : t('codex.phaseIdle')

  return (
    <div className="mb-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={
            state.phase === 'failed'
              ? 'text-danger'
              : state.phase === 'running' || state.phase === 'awaiting-approval'
                ? 'text-warning'
                : 'text-subtle'
          }
        >
          {state.phase === 'running' || state.phase === 'awaiting-approval' ? '● ' : ''}
          {phaseLabel}
        </span>
        {/* Hiện MCP server là CỐ Ý: server trong ~/.codex/config.toml của user tự nạp vào mọi
            thread và app không tắt được từ dòng lệnh — nghĩa là agent có thêm tool ngoài ý muốn
            của app. Không cô lập được thì tối thiểu phải cho user THẤY. */}
        {state.mcpServers.length > 0 && (
          <span className="text-subtle min-w-0 truncate" title={t('codex.mcpHint')}>
            {t('codex.mcpLabel')}{' '}
            {state.mcpServers.map((m) => `${m.name}${m.status === 'ready' ? '' : `(${m.status})`}`).join(', ')}
          </span>
        )}
      </div>
      {/* Kết quả cập nhật CLI hiện NGAY ĐÂY, không chỉ ở thẻ trạng thái của màn hình bắt đầu:
          user bấm "Cập nhật Codex" từ trong phiên (chỗ báo lỗi), nên xác nhận phải về đúng chỗ
          họ đang nhìn — không thì họ chỉ thấy lỗi biến mất mà không biết vì sao. */}
      {!state.error && <InstallProgress />}

      {/* Lý do lỗi trên DÒNG RIÊNG và KHÔNG `truncate`: câu lỗi thật dài hơn chỗ trống cạnh
          nhãn trạng thái, mà đó chính là thông tin duy nhất cho biết phải làm gì tiếp. */}
      {state.error && (
        <div className="mt-1">
          {/* Nhận diện được vấn đề thì nói VIỆC CẦN LÀM trước, câu lỗi gốc để dưới. Dán nguyên
              JSON của server rồi để đấy là bắt user tự đi tra. */}
          {state.issue && (
            <>
              <p className="text-warning font-medium break-words">
                {state.issue === 'outdated-cli'
                  ? t('codex.fixOutdatedCli')
                  : state.issue === 'model-gone'
                    ? t('codex.fixModelGone')
                    : t('codex.fixNotForChatgpt')}
              </p>
              {/* Nút cập nhật NGAY ĐÂY, không bắt user đi tìm: đây là lúc họ vừa gặp lỗi và
                  đang đọc hướng dẫn. `not-for-chatgpt` thì cập nhật cũng có thể giúp (có model
                  mới dùng được bằng gói), nên vẫn hiện. */}
              <div className="mt-1.5">
                <InstallButton />
              </div>
              <InstallProgress />
            </>
          )}
          <p className={`break-words ${state.issue ? 'text-subtle mt-1' : 'text-danger'}`}>{state.error}</p>
        </div>
      )}
    </div>
  )
}

function Transcript({ items }: { items: readonly CodexItemDto[] }) {
  const t = useT()
  const showReasoning = useCodexStore((s) => s.settings.showReasoning)
  const endRef = useRef<HTMLDivElement>(null)

  const visible = useMemo(
    () =>
      items.filter((i) => {
        /**
         * Item chưa có chữ (vừa `item/started`, chưa delta nào) → một dòng trống vô nghĩa.
         * Giữ `command`/`patch` dù rỗng: chúng nói "đang chạy một lệnh", đó là thông tin.
         *
         * ⚠️ Bản trước lọc bỏ HẲN `userMessage` với lý do "hiện lại câu user là lặp" — sai:
         * câu hỏi không hiện ở đâu khác cả, nên bỏ nó đi là mất một nửa hội thoại (chỉ còn
         * câu trả lời, không biết trả lời cho gì). Cái đáng bỏ chỉ là item RỖNG, và luật
         * ngay dưới đã xử.
         */
        if (i.text === '' && i.kind !== 'command' && i.kind !== 'patch') return false
        if (!showReasoning && i.kind === 'reasoning') return false
        return true
      }),
    [items, showReasoning],
  )

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [visible])

  if (visible.length === 0) {
    return <p className="text-subtle text-[11px] leading-relaxed">{t('codex.emptyHint')}</p>
  }

  return (
    <div className="space-y-3">
      {visible.map((item) => (
        <ItemView key={item.id} item={item} />
      ))}
      <div ref={endRef} />
    </div>
  )
}

function ItemView({ item }: { item: CodexItemDto }) {
  /**
   * Câu HỎI của user — vẽ khác câu trả lời để đọc ra ai đang nói.
   *
   * Không dùng bong bóng lệch phải kiểu app chat: cột dock hẹp tới 280px, một khối lệch phải
   * ăn thêm chỗ mà chẳng thêm thông tin. Thay bằng nền nhạt + vạch màu bên trái — đủ để mắt
   * tách hai bên trong một cột hẹp.
   */
  if (item.kind === 'userMessage') {
    return (
      <div className="border-accent bg-hover/40 rounded border-l-2 px-2.5 py-1.5">
        <p className="text-content text-sm whitespace-pre-wrap">{item.text}</p>
      </div>
    )
  }
  if (item.kind === 'agentMessage') {
    return (
      <div className="text-sm">
        <MiniMarkdown source={item.text} />
        {!item.done && <span className="bg-accent ml-0.5 inline-block h-3 w-1.5 animate-pulse align-middle" />}
      </div>
    )
  }
  if (item.kind === 'reasoning') {
    return (
      <div className="border-edge text-muted border-l-2 pl-2.5 text-xs italic">
        <MiniMarkdown source={item.text} />
      </div>
    )
  }
  // command / patch / other: giữ nguyên định dạng, KHÔNG cắt dòng — đây là lệnh và diff, đọc
  // không hết thì không đánh giá được.
  return (
    <pre className="border-edge bg-input text-content overflow-x-auto rounded border px-2.5 py-2 font-mono text-[11px] whitespace-pre-wrap">
      {item.text}
    </pre>
  )
}

function StartScreen({
  readiness,
  busy,
  cwd,
  recent,
  startError,
  onCwdChange,
  onPickCwd,
  onPickBinary,
  onProbe,
  onStart,
}: {
  readiness: CodexReadinessDto | null
  busy: boolean
  cwd: string
  recent: readonly string[]
  startError: string | null
  onCwdChange: (v: string) => void
  onPickCwd: () => void
  onPickBinary: () => void
  onProbe: () => void
  onStart: () => void
}) {
  const t = useT()
  const ok = readiness?.kind === 'ready' || readiness?.kind === 'installed-unverified'

  return (
    <div className="space-y-4">
      <ReadinessCard readiness={readiness} busy={busy} onPickBinary={onPickBinary} onProbe={onProbe} />

      {ok && (
        <div className="border-edge rounded border p-3">
          <Field label={t('codex.cwdLabel')}>
            <div className="flex gap-2">
              {/* Dropdown khi có nhiều lựa chọn (đã dùng nhiều thư mục), còn không thì hiện
                  đường dẫn dạng chữ. Cả hai đường đều hiện ĐẦY ĐỦ đường dẫn: đây là thư mục
                  agent sắp được quyền sửa file trong đó, nên phải đọc được trước khi bấm. */}
              {recent.length > 1 || (recent.length === 1 && !recent.includes(cwd)) ? (
                <Select value={cwd} onChange={(e) => onCwdChange(e.target.value)} className="min-w-0 flex-1">
                  {cwd !== '' && !recent.includes(cwd) && <option value={cwd}>{cwd}</option>}
                  {recent.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </Select>
              ) : (
                <span
                  className={`min-w-0 flex-1 self-center truncate font-mono text-xs ${
                    cwd === '' ? 'text-subtle' : 'text-content'
                  }`}
                  title={cwd}
                >
                  {cwd === '' ? t('codex.cwdNone') : cwd}
                </span>
              )}
              <Button onClick={onPickCwd}>{t('codex.pickCwd')}</Button>
            </div>
          </Field>
          <p className="text-subtle mb-3 text-[11px] leading-relaxed">
            {cwd === '' ? t('codex.cwdNoneNote') : t('codex.cwdNote')}
          </p>
          {startError && <p className="text-danger mb-2 text-xs break-words">{startError}</p>}
          <div className="flex justify-end">
            <Button variant="primary" disabled={busy || cwd.trim() === ''} onClick={onStart}>
              {busy ? t('codex.starting') : t('codex.startSession')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Thẻ trạng thái CLI.
 *
 * Mỗi trạng thái nói được **việc phải làm tiếp**, không chỉ "không dùng được": `not-installed`
 * kèm số đường đã tìm (trên máy có Codex cài ngoài PATH thì câu "không tìm thấy" trần trụi là
 * bắt user đoán), `needs-login` kèm đúng lệnh phải chạy, `found-broken` kèm stderr thật.
 */
function ReadinessCard({
  readiness,
  busy,
  onPickBinary,
  onProbe,
}: {
  readiness: CodexReadinessDto | null
  busy: boolean
  onPickBinary: () => void
  onProbe: () => void
}) {
  const t = useT()
  if (!readiness) return <p className="text-subtle text-xs">{t('codex.checking')}</p>

  const tone =
    readiness.kind === 'ready'
      ? 'border-success/40 bg-success/5'
      : readiness.kind === 'installed-unverified'
        ? 'border-edge'
        : 'border-warning/40 bg-warning/5'

  return (
    <div className={`rounded border p-3 ${tone}`}>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-content text-sm font-semibold">{t('codex.cliTitle')}</span>
        <div className="flex shrink-0 gap-1.5">
          {/* Cập nhật chủ động cũng cần có, không chỉ lúc lỗi: bản CLI cũ dần rồi hỏng lặng lẽ
              (server bỏ model), nên phải có đường sửa trước khi gặp lỗi. */}
          {(readiness.kind === 'ready' || readiness.kind === 'installed-unverified') && <InstallButton />}
          <Button className="!px-2 !py-1 !text-xs" disabled={busy} onClick={onProbe}>
            {busy ? t('codex.checking') : t('codex.recheck')}
          </Button>
        </div>
      </div>

      {readiness.kind === 'not-installed' && (
        <>
          <p className="text-warning text-xs">{t('codex.notInstalled')}</p>
          <p className="text-subtle mt-1 text-[11px] leading-relaxed">
            {t('codex.notInstalledHint')}
            {readiness.searched && readiness.searched.length > 0 && (
              <> {t('codex.searchedCount', { n: String(readiness.searched.length) })}</>
            )}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <InstallButton primary />
            <Button className="!px-2 !py-1 !text-xs" onClick={onPickBinary}>
              {t('codex.pickBinary')}
            </Button>
          </div>
          <InstallProgress />
        </>
      )}

      {readiness.kind === 'found-broken' && (
        <>
          <p className="text-warning text-xs">{t('codex.broken')}</p>
          <pre className="text-muted mt-1 max-h-24 overflow-auto font-mono text-[10px] whitespace-pre-wrap">
            {readiness.detail}
          </pre>
          {/* Bản quá cũ (thiếu `app-server`) cũng rơi vào đây — tải bản mới là cách sửa. */}
          <div className="mt-2">
            <InstallButton primary />
          </div>
          <InstallProgress />
        </>
      )}

      {readiness.kind === 'needs-login' && <LoginBox />}

      {(readiness.kind === 'ready' || readiness.kind === 'installed-unverified') && (
        <>
          <p className="text-content text-xs">
            {readiness.version ?? ''}
            {readiness.kind === 'installed-unverified' && (
              <span className="text-subtle"> · {t('codex.unverified')}</span>
            )}
          </p>
          {readiness.account && <AccountRow />}
          {readiness.codexHome && (
            <p className="text-subtle mt-1 text-[11px]">
              {t('codex.authFrom')} <span className="font-mono">{readiness.codexHome}</span>
            </p>
          )}
          <p className="text-subtle mt-1 text-[11px] leading-relaxed">{t('codex.subscriptionNote')}</p>
          <InstallProgress />
        </>
      )}

      <ProfileRow />
    </div>
  )
}

/**
 * Chọn model + mức suy luận, **ngay trong khung chat** (kiểu Codex app: "5.6 Terra · High").
 *
 * Để ở đây chứ không trong Settings vì nó là lựa chọn *theo câu hỏi*: một câu vặt thì `low` cho
 * nhanh, một refactor thì `high`. Chôn trong Settings là biến nó thành thứ đặt một lần rồi quên.
 *
 * Mức suy luận lấy từ `model/list` (`supportedReasoningEfforts`) chứ không hardcode — mỗi model
 * hỗ trợ một bộ khác nhau, và bộ đó đổi theo bản CLI.
 */
function ModelPicker() {
  const t = useT()
  const models = useCodexStore((s) => s.models)
  const chosenModel = useCodexStore((s) => s.chosenModel)
  const chosenEffort = useCodexStore((s) => s.chosenEffort)
  const chooseModel = useCodexStore((s) => s.chooseModel)
  const loadModels = useCodexStore((s) => s.loadModels)

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  // Chưa đọc được danh sách (CLI cũ, mất mạng) → không hiện gì. Một dropdown rỗng còn tệ hơn
  // không có dropdown: nó mời user bấm vào một thứ không làm được gì.
  if (models.length === 0) return null

  const current = models.find((m) => m.id === chosenModel) ?? models[0]!
  const efforts = current.reasoningEfforts

  /**
   * `<select>` KHÔNG viền, nền trong suốt — nó nằm trong khung nhập nên một hộp viền nữa ở đây
   * là hộp trong hộp. Vẫn là `<select>` thật (không phải dropdown tự vẽ): nó cho bàn phím,
   * screen reader và menu hệ điều hành miễn phí, mà việc này không cần gì hơn thế.
   */
  const bare =
    'text-subtle hover:text-content cursor-pointer appearance-none rounded border-0 bg-transparent py-0.5 pr-1 text-[11px] outline-none hover:bg-hover'

  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <select
        value={current.id}
        className={`${bare} min-w-0 truncate pl-1`}
        title={current.description ?? current.id}
        onChange={(e) => {
          const next = models.find((m) => m.id === e.target.value)
          // Đổi model thì mức suy luận cũ có thể không tồn tại ở model mới — rơi về mặc định
          // của nó thay vì gửi một mức mà server sẽ từ chối.
          void chooseModel(e.target.value, next?.defaultEffort ?? undefined)
        }}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.displayName ?? m.id}
          </option>
        ))}
      </select>
      {efforts.length > 1 && (
        <select
          value={chosenEffort ?? current.defaultEffort ?? efforts[0]!}
          // Mức suy luận tô ACCENT: nó là thứ user đổi thường xuyên theo từng câu hỏi, và là
          // cách Codex app làm ("5.6 Terra **High**" — chữ High nổi hơn tên model).
          className={`${bare} text-accent-fg pl-1 font-medium`}
          title={t('codex.effortHint')}
          onChange={(e) => void chooseModel(current.id, e.target.value)}
        >
          {efforts.map((ef) => (
            <option key={ef} value={ef}>
              {ef}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

/**
 * Danh sách phiên cũ — mở lại và chat tiếp.
 *
 * Codex tự lưu transcript ra `~/.codex/sessions/**.jsonl`, nên app **không lưu bản thứ hai**:
 * hai nguồn sự thật cho cùng một thứ thì sớm muộn lệch nhau, mà bản của Codex mới là bản
 * `thread/resume` đọc được.
 */
function ThreadList() {
  const t = useT()
  const threads = useCodexStore((s) => s.threads)
  const loading = useCodexStore((s) => s.loadingThreads)
  const busy = useCodexStore((s) => s.busy)
  const loadThreads = useCodexStore((s) => s.loadThreads)
  const resumeThread = useCodexStore((s) => s.resumeThread)
  // Đóng mặc định: đa số lần mở panel là để bắt đầu việc mới, không phải tìm việc cũ.
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (open) void loadThreads()
  }, [open, loadThreads])

  return (
    <div className="border-edge mt-3 rounded border p-3">
      <button
        className="text-content flex w-full items-center justify-between gap-2 text-left text-sm font-semibold"
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          {open ? '▾' : '▸'} {t('codex.oldSessions')}
        </span>
        {open && !loading && (
          <span className="text-subtle text-[11px]">{t('codex.sessionCount', { n: String(threads.length) })}</span>
        )}
      </button>

      {open && (
        <div className="mt-2">
          {loading && <p className="text-subtle text-[11px]">{t('codex.loadingSessions')}</p>}
          {!loading && threads.length === 0 && <p className="text-subtle text-[11px]">{t('codex.noSessions')}</p>}
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {threads.map((th) => (
              <button
                key={th.id}
                disabled={busy}
                onClick={() => void resumeThread(th)}
                className="border-edge hover:border-edge-strong hover:bg-hover block w-full rounded border px-2.5 py-1.5 text-left disabled:opacity-50"
              >
                <p className="text-content truncate text-xs">{th.preview}</p>
                <p className="text-subtle mt-0.5 truncate text-[10px]">
                  {new Date(th.updatedAt * 1000).toLocaleString()}
                  {th.model ? ` · ${th.model}` : ''}
                  {th.cwd ? ` · ${th.cwd}` : ''}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Nút tải/cập nhật Codex CLI.
 *
 * Có vì `codex update` của chính CLI **không dùng được** với bản do Codex desktop app quản (đo
 * thật: *"Could not detect the Codex installation method"*), mà bản cũ thì làm **mọi model đều
 * lỗi**. Nên app tự tải qua npm vào thư mục của mình và ưu tiên dùng bản đó.
 */
function InstallButton({ primary }: { primary?: boolean }) {
  const t = useT()
  const installing = useCodexStore((s) => s.installing)
  const installCli = useCodexStore((s) => s.installCli)
  return (
    <Button
      variant={primary ? 'primary' : undefined}
      className="!px-2 !py-1 !text-xs"
      disabled={installing}
      onClick={() => void installCli()}
    >
      {installing ? t('codex.installing') : t('codex.installCli')}
    </Button>
  )
}

/**
 * Tiến độ / kết quả cài.
 *
 * Xong thì nói **thành công bằng một câu**, không để user tự suy từ dòng log `version: …`. Đã
 * gặp thật: user nhìn `version: codex-cli 0.154.0` nằm cạnh câu lỗi cũ và hiểu là *cập nhật
 * thất bại* — đúng ngược với sự thật.
 */
function InstallProgress() {
  const t = useT()
  const installing = useCodexStore((s) => s.installing)
  const log = useCodexStore((s) => s.installLog)
  const err = useCodexStore((s) => s.installError)
  const done = useCodexStore((s) => s.installedVersion)

  /**
   * Câu "✓ đã cập nhật" tự ẩn sau 20 giây.
   *
   * Nó là **xác nhận một lần**, không phải trạng thái: để mãi thì nó chiếm chỗ trong khe đáy
   * (vốn đã hẹp) suốt phiên, và mất nghĩa vì user không còn liên hệ nó với việc mình vừa làm.
   * Lỗi thì KHÔNG tự ẩn — user cần đọc lại được.
   */
  useEffect(() => {
    if (!done) return
    const timer = setTimeout(() => useCodexStore.setState({ installedVersion: null }), 20_000)
    return () => clearTimeout(timer)
  }, [done])

  if (!installing && !err && !done) return null

  return (
    <div className="mt-1.5">
      {installing && (
        <>
          <p className="text-warning text-[11px]">● {t('codex.installNote')}</p>
          {log.length > 0 && (
            // Dòng cuối của npm: cho thấy nó đang chạy chứ không treo. Chỉ trong lúc cài.
            <p className="text-subtle truncate font-mono text-[10px]" title={log.join('\n')}>
              {log[log.length - 1]}
            </p>
          )}
        </>
      )}
      {!installing && err && <p className="text-danger text-[11px] break-words">{err}</p>}
      {!installing && !err && done && (
        <p className="text-success text-[11px]">✓ {t('codex.installDone', { version: done })}</p>
      )}
    </div>
  )
}

/**
 * Khối đăng nhập — **ngay trong app**, không bắt user mở terminal.
 *
 * Bản trước chỉ hiện chữ `codex login` rồi để user tự đi tìm terminal, dù app-server có sẵn
 * `account/login/start` qua JSON-RPC. Nút chính mở OAuth trong browser; mã thiết bị là đường thứ
 * hai cho máy không mở được browser (hoặc khi user đang điều khiển máy khác).
 */
function LoginBox() {
  const t = useT()
  const loggingIn = useCodexStore((s) => s.loggingIn)
  const loginHint = useCodexStore((s) => s.loginHint)
  const loginError = useCodexStore((s) => s.loginError)
  const login = useCodexStore((s) => s.login)
  const cancelLogin = useCodexStore((s) => s.cancelLogin)

  return (
    <div>
      <p className="text-warning text-xs">{t('codex.notSignedIn')}</p>
      <p className="text-subtle mt-1 text-[11px] leading-relaxed">{t('codex.signInNote')}</p>

      {loginError && <p className="text-danger mt-1.5 text-xs break-words">{loginError}</p>}

      {loginHint && (
        <div className="border-edge bg-input mt-2 rounded border p-2">
          {loginHint.userCode && (
            <>
              <p className="text-subtle text-[11px]">{t('codex.deviceCodeLabel')}</p>
              <p className="text-content font-mono text-base tracking-widest select-all">{loginHint.userCode}</p>
            </>
          )}
          {/* `authUrl` chỉ về đây khi main KHÔNG mở được browser (hoặc dùng mã thiết bị) — lúc
              đó nó là đường thoát duy nhất nên phải hiện đầy đủ và chọn được. */}
          {loginHint.authUrl && (
            <>
              {!loginHint.userCode && <p className="text-warning text-[11px]">{t('codex.openManually')}</p>}
              <p className="text-subtle mt-1 font-mono text-[11px] break-all select-all">{loginHint.authUrl}</p>
            </>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {loggingIn ? (
          <>
            <span className="text-warning self-center text-[11px]">
              ● {loginHint?.userCode ? t('codex.waitingCode') : t('codex.waitingBrowser')}
            </span>
            <Button className="!px-2 !py-1 !text-xs" onClick={() => void cancelLogin()}>
              {t('common.cancel')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" className="!px-2 !py-1 !text-xs" onClick={() => void login('chatgpt')}>
              {t('codex.signIn')}
            </Button>
            <Button className="!px-2 !py-1 !text-xs" onClick={() => void login('deviceCode')}>
              {t('codex.signInDevice')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

/** Tài khoản đang dùng + hạn mức gói + nút đổi/đăng xuất. */
function AccountRow() {
  const t = useT()
  const readiness = useCodexStore((s) => s.readiness)
  const busy = useCodexStore((s) => s.busy)
  const loggingIn = useCodexStore((s) => s.loggingIn)
  const loginHint = useCodexStore((s) => s.loginHint)
  const loginError = useCodexStore((s) => s.loginError)
  const login = useCodexStore((s) => s.login)
  const cancelLogin = useCodexStore((s) => s.cancelLogin)
  const logout = useCodexStore((s) => s.logout)
  const acc = readiness?.account
  const rl = readiness?.rateLimit
  if (!acc) return null

  return (
    <div className="border-edge mt-2 border-t pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-content truncate text-xs">
            {acc.email ?? t('codex.authApiKey')}
            {acc.planType && <span className="text-subtle"> · {acc.planType}</span>}
          </p>
          {rl && (
            <p className={`mt-0.5 text-[11px] ${rl.reached ? 'text-danger' : 'text-subtle'}`}>
              {rl.reached
                ? t('codex.quotaReached')
                : rl.resetsInDays !== undefined
                  ? t('codex.quotaUsedReset', { pct: String(rl.usedPercent), days: String(rl.resetsInDays) })
                  : t('codex.quotaUsed', { pct: String(rl.usedPercent) })}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          {/* Đổi tài khoản = login lại: Codex ghi đè credential trong CODEX_HOME này. Không
              phải logout-rồi-login vì như vậy có một quãng không tài khoản nào nếu login lỗi. */}
          <Button className="!px-2 !py-1 !text-xs" disabled={busy || loggingIn} onClick={() => void login('chatgpt')}>
            {t('codex.switchAccount')}
          </Button>
          <Button className="!px-2 !py-1 !text-xs" disabled={busy || loggingIn} onClick={() => void logout()}>
            {t('codex.signOut')}
          </Button>
        </div>
      </div>

      {/* Trạng thái chờ để RIÊNG một dòng, không nhét vào nhãn nút: nút đổi chữ thành "đang
          chờ…" làm người ta tưởng mình bấm sai chỗ, và mất luôn nút Huỷ. */}
      {loggingIn && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-warning text-[11px]">● {t('codex.waitingBrowser')}</span>
          <Button className="!px-2 !py-0.5 !text-[11px]" onClick={() => void cancelLogin()}>
            {t('common.cancel')}
          </Button>
          {loginHint?.authUrl && (
            <span className="text-subtle min-w-0 flex-1 font-mono text-[11px] break-all select-all">
              {loginHint.authUrl}
            </span>
          )}
        </div>
      )}
      {loginError && <p className="text-danger mt-1.5 text-xs break-words">{loginError}</p>}
    </div>
  )
}

/**
 * Chọn profile — cách duy nhất giữ NHIỀU tài khoản song song.
 *
 * Codex lưu đúng một tài khoản mỗi `CODEX_HOME`, nên "thêm tài khoản thứ hai" = thêm một thư mục
 * `CODEX_HOME`. Chỉ hiện khối này khi CLI dùng được: bàn chuyện profile lúc chưa cài Codex là
 * dẫn user đi lạc.
 */
function ProfileRow() {
  const t = useT()
  const readiness = useCodexStore((s) => s.readiness)
  const settings = useCodexStore((s) => s.settings)
  const profiles = useCodexStore((s) => s.profiles)
  const busy = useCodexStore((s) => s.busy)
  const loadProfiles = useCodexStore((s) => s.loadProfiles)
  const addProfile = useCodexStore((s) => s.addProfile)
  const removeProfile = useCodexStore((s) => s.removeProfile)
  const useProfile = useCodexStore((s) => s.useProfile)

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void loadProfiles()
  }, [loadProfiles])

  if (readiness?.kind === 'not-installed' || readiness?.kind === 'found-broken') return null

  const active = settings.activeProfile
  const isSystem = active === 'default'

  return (
    <div className="border-edge mt-2 border-t pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-subtle text-[11px]">{t('codex.profileLabel')}</span>
        <Select
          value={active}
          disabled={busy}
          onChange={(e) => void useProfile(e.target.value)}
          className="!w-auto !py-0.5 !text-[11px]"
        >
          {profiles.map((p) => (
            <option key={p.name} value={p.name}>
              {p.isSystem ? t('codex.profileSystem') : p.name}
            </option>
          ))}
        </Select>
        {!adding && (
          <button className="text-subtle hover:text-content text-[11px]" onClick={() => setAdding(true)}>
            + {t('codex.profileAdd')}
          </button>
        )}
        {!isSystem && !adding && (
          <button
            className="text-subtle hover:text-danger text-[11px]"
            title={t('codex.profileRemoveHint')}
            onClick={() => void removeProfile(active)}
          >
            🗑 {t('codex.profileRemove')}
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <TextInput
            autoFocus
            value={name}
            placeholder={t('codex.profileNamePlaceholder')}
            className="!w-40 !py-0.5 !text-[11px]"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setAdding(false)
                setErr(null)
              }
            }}
          />
          <Button
            className="!px-2 !py-0.5 !text-[11px]"
            onClick={() => {
              void addProfile(name).then((e) => {
                setErr(e)
                if (!e) {
                  setAdding(false)
                  setName('')
                }
              })
            }}
          >
            {t('common.save')}
          </Button>
          <button
            className="text-subtle hover:text-content text-[11px]"
            onClick={() => {
              setAdding(false)
              setErr(null)
            }}
          >
            {t('common.cancel')}
          </button>
          {err && <span className="text-danger text-[11px]">{err}</span>}
        </div>
      )}

      <p className="text-subtle mt-1 text-[11px] leading-relaxed">
        {isSystem ? t('codex.profileSystemNote') : t('codex.profileOwnNote')}
      </p>
    </div>
  )
}
