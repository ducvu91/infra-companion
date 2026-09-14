import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  expressionForEvent,
  HINT_FIRST_MS,
  HINT_RETRY_MS,
  hintDelayMs,
  motionIdleDelayMs,
  motionPackBytes,
  openedLine,
  pickHint,
  sampleErrorMessage,
  statusForEvent,
  VRM_ZOOM_MAX,
  VRM_ZOOM_MIN,
  zoomStep,
  type AppEventSeverity,
  type VrmModelDto,
  type VrmSampleModel,
  type VrmSampleProgress,
  type VrmSettingsDto
} from '@infra/shared'
import { createVrmStage, type VrmPart, type VrmStage } from '../lib/vrmStage'
import { useDraggablePanel } from '../lib/useDraggablePanel'
import { useVrmMotion, type VrmMotionApi } from '../lib/useVrmMotion'
import {
  VrmChatBubble,
  VrmMiniPanel,
  VrmOutfitPanel,
  VrmRadialMenu,
  VrmSettingsFrame,
  VrmSidePanel,
  VrmSpeechBubble,
  type RadialAction
} from './VrmRadialMenu'
import { useEventsStore } from '../stores/events'
import { useUiStore } from '../stores/ui'
import { useToolUsageStore } from '../stores/toolUsage'
import { useTabsStore } from '../stores/tabs'
import { useVrmChatStore } from '../stores/vrmChat'
import { useVrmHintsStore } from '../stores/vrmHints'
import { openTool, splitMenuLabel, TOOLS, toolKey } from '../lib/toolCatalog'
import { useT } from '../i18n'

/**
 * F70 — panel nhân vật VRM, **mức 1**: model nằm trong máy user, user tự chọn file.
 *
 * App không tải model từ mạng và không kèm model nào trong bản cài (một model là 40–60 MB).
 * Panel không dùng `Modal` và cũng không dùng `FloatingPanel`: nhân vật là thứ *ở cạnh* trong
 * lúc làm việc, có backdrop là biến nó thành thứ phải đóng trước khi gõ được vào terminal —
 * mà ngay cả khung panel cũng làm nhân vật trông như bị nhốt trong hộp, nên khi đã dựng xong
 * thì bỏ hẳn khung (xem `VrmStageShell`).
 */

/**
 * Khoảng chừa từ mép phải khi nhân vật ở vị trí mặc định (px).
 *
 * Không phải lề thẩm mỹ: các bảng nổi **trên đầu** nhân vật căn giữa theo thân người (chat rộng
 * 320px, cài đặt 256px) trong khi thân chỉ ~150px. Đứng sát mép thì bảng bị kẹp lại cho khỏi
 * tràn màn hình và lệch hẳn sang trái so với nhân vật. Chừa ~nửa hiệu bề rộng thì bảng rộng
 * nhất vẫn nằm đúng giữa.
 */
const CHROMELESS_RIGHT_GAP = 92

/**
 * Mở panel nhân vật lúc khởi động nếu user đã bật "Hiện lúc mở app".
 *
 * Đọc cấu hình ở đây (một hook nhỏ trong App) chứ không trong `VrmPanel`: panel chưa mở thì
 * chưa mount, mà cờ này quyết định chính việc có mount hay không.
 */
export function useVrmAutoShow(): void {
  useEffect(() => {
    void (async () => {
      const s = await window.infra.vrm.getSettings()
      // Chỉ mở khi có model để hiện — bật autoShow rồi xoá model thì đừng bắt user thấy
      // màn hình "chọn file" mỗi lần mở app
      if (!s.autoShow || !s.activeId) return
      const list = await window.infra.vrm.list()
      if (list.some((m) => m.id === s.activeId && !m.missing)) {
        useUiStore.getState().setVrmPanelOpen(true)
      }
    })()
  }, [])
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading'; ratio: number }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }

export function VrmPanel({ onClose }: { readonly onClose: () => void }) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<VrmStage | null>(null)
  /** Bản state của `stageRef` — xem chú thích ở chỗ gán. */
  const [stageReady, setStageReady] = useState<VrmStage | null>(null)
  const [models, setModels] = useState<VrmModelDto[]>([])
  const [settings, setSettings] = useState<VrmSettingsDto | null>(null)
  /**
   * Thư viện chuyển động `.vrma` (CC0, tải theo yêu cầu).
   *
   * Gắn ở component CHA vì bốn chỗ kích hoạt nằm rải rác: chạm vào người và mở chat ở shell bên
   * dưới, còn cảnh báo thì đến từ store sự kiện ở đây. Khai SAU `settings` — nó đọc `reactToEvents`.
   */
  const motion = useVrmMotion(stageReady, settings?.reactToEvents !== false)
  /**
   * Đọc `motion` từ ref trong effect nghe sự kiện.
   *
   * Effect đó cố ý chỉ phụ thuộc `reactToEvents` — thêm `motion` vào deps là nó gỡ rồi đăng ký
   * lại listener mỗi lần state của hook đổi (đang tải, clip đang chạy), và mỗi lần gỡ là mất một
   * nhịp sự kiện.
   */
  const motionRef = useRef(motion)
  motionRef.current = motion
  const [load, setLoad] = useState<LoadState>({ kind: 'idle' })
  const [picking, setPicking] = useState(false)
  /** Tỉ lệ ngang/dọc thật của model, để khung ôm sát thân người thay vì đoán bề rộng. */
  const [stageAspect, setStageAspect] = useState<number | null>(null)
  /**
   * Bong bóng thoại đang hiện trên đầu nhân vật; `null` = không có.
   *
   * Dùng chung cho cả cảnh báo hệ thống và câu nhân vật tự nói (vừa mở tính năng hộ user) — hai
   * nguồn nhưng **một chỗ hiện**, nếu không thì hai bong bóng chồng lên nhau trên cùng cái đầu.
   * `id` chỉ để `useEffect` hẹn giờ nhận ra "đây là câu MỚI" và gia hạn lại từ đầu.
   */
  const [bubble, setBubble] = useState<{ id: number; text: string; severity: AppEventSeverity } | null>(null)
  const speak = useCallback((text: string) => {
    setBubble({ id: Date.now(), text, severity: 'info' })
  }, [])
  /**
   * Góc xoay hiện tại, giữ ngoài React state.
   *
   * Kéo xoay phải mượt theo từng sự kiện chuột, mà mỗi lần `setState` là một vòng render —
   * `ref` cho phép đẩy thẳng vào sân khấu rồi chỉ ghi vào settings lúc thả tay.
   */
  const rotationRef = useRef(0)
  /** Biểu cảm + mesh model khai — đọc từ stage sau khi dựng, mỗi model một khác. */
  const [expressions, setExpressions] = useState<string[]>([])
  const [parts, setParts] = useState<VrmPart[]>([])
  const [animationName, setAnimationName] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const [list, s] = await Promise.all([window.infra.vrm.list(), window.infra.vrm.getSettings()])
      setModels(list)
      setSettings(s)
    })()
  }, [])

  const active = settings?.activeId ? (models.find((m) => m.id === settings.activeId) ?? null) : null

  /**
   * Nạp model đang chọn vào canvas.
   *
   * `AbortController` là bắt buộc, không phải cho gọn: nạp 44 MB mất vài giây và user đổi
   * model hai lần liên tiếp là chuyện thường. Không huỷ lượt cũ thì hai scene cùng dựng xong
   * và cái nạp xong sau đè lên cái trước, còn cái trước ở lại trong VRAM không ai dọn.
   */
  useEffect(() => {
    if (!active || active.missing || !settings) return
    const container = boxRef.current
    if (!container) return

    const ac = new AbortController()
    setLoad({ kind: 'loading', ratio: 0 })
    // Quên mấy dòng này thì đổi model xong khung vẫn giữ tỉ lệ, biểu cảm và danh sách mesh
    // của model CŨ
    setStageAspect(null)
    setExpressions([])
    setParts([])
    setAnimationName(null)

    void (async () => {
      try {
        const res = await window.infra.vrm.read(active.id)
        if (ac.signal.aborted) return
        if (!res.ok) {
          setLoad({
            kind: 'error',
            message:
              res.reason === 'missing'
                ? 'Không tìm thấy file — có thể đã bị xoá hoặc đổi chỗ.'
                : res.reason === 'tooLarge'
                  ? 'File quá lớn.'
                  : `Không đọc được file${res.detail ? `: ${res.detail}` : ''}`
          })
          return
        }
        const stage = await createVrmStage(
          {
            container,
            bytes: res.bytes,
            fpsCap: settings.fpsCap,
            springBones: settings.springBones,
            lookAtCursor: settings.lookAtCursor,
            rotationY: settings.rotationY,
            onProgress: (ratio) => setLoad({ kind: 'loading', ratio })
          },
          ac.signal
        )
        if (ac.signal.aborted) {
          stage.dispose()
          return
        }
        stageRef.current = stage
        // State song song với ref: hook chuyển động cần BIẾT LÚC NÀO stage sẵn sàng, mà gán ref
        // không kích hoạt render nên nó sẽ mãi thấy `null`
        setStageReady(stage)
        setStageAspect(stage.aspect)
        setExpressions(stage.listExpressions())
        const loaded = stage.listParts()
        setParts(loaded)
        setLoad({ kind: 'ready' })

        /**
         * Khoác lại bộ trang phục lần trước đang mặc.
         *
         * Hiện/ẩn mesh chỉ sống trong state của renderer, nên không có bước này thì mở lại app
         * là mọi món hiện hết — "bấm vào bộ là mặc được" trông như hỏng ngay lần dùng thứ hai.
         */
        const modelId = active.id
        const saved = await window.infra.vrm.listOutfits(modelId)
        if (ac.signal.aborted) return
        const worn = saved.outfits.find((o) => o.id === saved.wornId)
        if (!worn) return
        const off = new Set(worn.hidden)
        for (const p of loaded) stage.setPartVisible(p.name, !off.has(p.name))
        setParts(loaded.map((p) => ({ ...p, visible: !off.has(p.name) })))
      } catch (e) {
        if (ac.signal.aborted) return
        setLoad({ kind: 'error', message: (e as Error).message })
      }
    })()

    return () => {
      ac.abort()
      stageRef.current?.dispose()
      stageRef.current = null
      setStageReady(null)
    }
    // Cố ý chỉ phụ thuộc id model: đổi FPS/springBone thì đẩy vào sân khấu đang chạy
    // (hai setter dưới đây), KHÔNG nạp lại 44 MB.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.missing])

  useEffect(() => {
    if (settings) stageRef.current?.setFpsCap(settings.fpsCap)
  }, [settings?.fpsCap, settings])

  useEffect(() => {
    if (settings) stageRef.current?.setSpringBones(settings.springBones)
  }, [settings?.springBones, settings])

  // Không cần effect cho `zoom`: nó đổi KÍCH THƯỚC KHUNG, mà khung đổi thì `ResizeObserver`
  // dưới đây đã gọi `resize()` → camera tự căn lại.

  useEffect(() => {
    if (!settings) return
    rotationRef.current = settings.rotationY
    stageRef.current?.setRotationY(settings.rotationY)
  }, [settings?.rotationY, settings])

  useEffect(() => {
    if (settings) stageRef.current?.setLookAtCursor(settings.lookAtCursor)
  }, [settings?.lookAtCursor, settings])

  /**
   * Theo chuột trên TOÀN CỬA SỔ, không chỉ trong khung nhân vật.
   *
   * Bản đầu chỉ nghe `onPointerMove` của khung — tức nhân vật chỉ dõi theo khi con trỏ đã nằm
   * trên người nó. User rê chuột khắp app và **không thấy gì**, đúng như phản hồi.
   *
   * Chia theo **nửa bề rộng CỬA SỔ**, không theo bề rộng khung: khung ôm sát người nên chỉ
   * ~150px, chia theo nó thì rê chuột ra xa 75px đã chạm biên ±1 và nhân vật nhìn cứng một
   * hướng suốt phần còn lại của màn hình — vẫn ra cảm giác "không nhìn theo".
   */
  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const box = boxRef.current
      const stage = stageRef.current
      if (!box || !stage) return
      const r = box.getBoundingClientRect()
      if (r.width === 0) return
      stage.setCursor(
        Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2))),
        Math.max(-1, Math.min(1, -(e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2)))
      )
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  /**
   * Chế độ gỡ lỗi hoạt ảnh (§12): gõ `avatarDebug(true)` trong DevTools console.
   *
   * Đặt ở console chứ không thêm mục vào menu chuột phải: menu đó là của user và đã có 6 mục,
   * nhét thêm một mục chỉ dev mới dùng là làm rối chỗ user nhìn mỗi ngày.
   */
  useEffect(() => {
    const w = window as unknown as {
      avatarDebug?: (on?: boolean) => string
      avatarArmMode?: (mode?: 'zero' | 'rest' | 'natural') => string
      avatarSpin?: () => string
      avatarArmDebug?: (flags?: Record<string, boolean>) => string
    }
    w.avatarDebug = (on = true) => {
      stageRef.current?.setDebug(on)
      return on ? 'avatar debug: BẬT (log mỗi giây ra console)' : 'avatar debug: tắt'
    }
    /**
     * `avatarArmMode('rest')` = tắt toàn bộ animation tay (chỉ hạ tay A-pose) — để tách "model gốc
     * cong tay" khỏi "animation làm cong". `'zero'` = rig gốc, mọi xương tay về 0. `'natural'` =
     * trở lại bình thường.
     */
    w.avatarArmMode = (mode = 'natural') => {
      stageRef.current?.setArmMode(mode)
      return `arm mode: ${mode}`
    }
    // Xem thử ngay thay vì chờ 2–3 phút / 25–55 giây
    w.avatarSpin = () => {
      stageRef.current?.triggerSpin()
      return 'spin: xoay một vòng'
    }
    /**
     * `avatarArmDebug({ fingers: false })` tắt riêng một lớp (arms/hands/fingers/weightShift/micro/
     * interaction); `{ showTargets: true }` hiện cầu xanh = đích bàn tay, cầu cam = khuỷu IK (§19).
     */
    w.avatarArmDebug = (flags = {}) => {
      stageRef.current?.setArmDebug(flags as never)
      return `arm debug: ${JSON.stringify(flags)}`
    }
    return () => {
      delete w.avatarDebug
      delete w.avatarArmMode
      delete w.avatarSpin
      delete w.avatarArmDebug
    }
  }, [])

  /**
   * Nhân vật phản ứng với cảnh báo của app.
   *
   * Nghe qua store zustand chứ **không** đăng ký thêm listener IPC: `App.tsx` đã đăng ký một
   * lần cho cả app, thêm cái thứ hai là cùng một sự kiện được xử lý hai nơi.
   */
  useEffect(() => {
    if (!settings?.reactToEvents) return
    return useEventsStore.subscribe((s, prev) => {
      const ev = s.events[0]
      if (!ev || ev.id === prev.events[0]?.id) return
      // `marker` là user tự đánh dấu (deploy…), không phải chuyện bất thường → không phản ứng
      if (ev.kind === 'marker') return
      // Biểu cảm = phản ứng tức thời; trạng thái = dáng người giữ suốt lúc hệ thống có vấn đề
      stageRef.current?.playExpression(expressionForEvent(ev.kind, ev.severity))
      stageRef.current?.setStatus(statusForEvent(ev.kind, ev.severity))
      /**
       * Clip toàn thân — kênh thứ tư, mạnh nhất, nên chỉ dùng cho hai đầu của thang: có chuyện
       * (cúi xin lỗi) và hết chuyện (ăn mừng). Mức `info` không gọi clip: một thông báo bình
       * thường mà nhân vật diễn cả đoạn 7 giây là làm phiền, không phải báo tin.
       */
      if (ev.kind === 'recover') motionRef.current?.play('recover')
      else if (ev.severity !== 'info') motionRef.current?.play('alert')

      /**
       * Bong bóng thoại — kênh thứ ba, và là kênh duy nhất nói được **chuyện gì** vừa xảy ra.
       *
       * Luật chống bão: luôn hiện cái MỚI NHẤT (ghi đè cái đang hiện) và tự tắt sau 6 giây.
       * Một đợt cảnh báo hàng loạt mà xếp hàng mười bong bóng thì tệ hơn là không có — user
       * phải ngồi chờ hết hàng đợi mới thấy được tình hình hiện tại.
       */
      setBubble({ id: ev.id, text: ev.title, severity: ev.severity })
    })
  }, [settings?.reactToEvents])

  // Tự tắt sau 6 giây. Hẹn giờ đặt theo `bubble.id` nên thông báo mới luôn gia hạn lại từ đầu
  // thay vì bị cái cũ tắt sớm.
  useEffect(() => {
    if (!bubble) return
    const h = setTimeout(() => setBubble(null), 6000)
    return () => clearTimeout(h)
  }, [bubble])

  /**
   * Theo kích thước khung bằng `ResizeObserver`, không bằng sự kiện `resize` của window:
   * panel này đổi cỡ do user kéo grip `◢` hoặc bấm `⛶` — window không hề đổi.
   */
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return
      const { width, height } = entry.contentRect
      stageRef.current?.resize(width, height)
    })
    ro.observe(box)
    return () => ro.disconnect()
  }, [])

  const patch = useCallback(async (p: Partial<VrmSettingsDto>) => {
    setSettings(await window.infra.vrm.setSettings(p))
  }, [])

  /** Vừa thêm một model (chọn file hoặc tải mẫu) → nạp lại danh sách + cấu hình để stage dựng nó. */
  const refreshAfterAdd = useCallback(async () => {
    setModels(await window.infra.vrm.list())
    setSettings(await window.infra.vrm.getSettings())
    setLoad({ kind: 'idle' })
  }, [])

  const pick = useCallback(async () => {
    setPicking(true)
    try {
      const res = await window.infra.vrm.pick()
      if (res.ok) {
        await refreshAfterAdd()
        return
      }
      if (res.reason === 'canceled') return
      setLoad({ kind: 'error', message: pickError(res.reason, res.detail) })
    } finally {
      setPicking(false)
    }
  }, [])

  /**
   * Bỏ một model khỏi danh sách.
   *
   * **Không xoá file `.vrm` gốc** — app chỉ lưu đường dẫn, file là của user. Hỏi lại một lần vì
   * thêm lại phải đi tìm file trong máy, và mọi bộ trang phục đã lưu cho model đó cũng mất theo
   * (id sinh mới mỗi lần thêm nên không khớp lại được).
   *
   * Xoá model ĐANG hiện thì `activeId` do main tự đặt về `null`; đọc lại settings rồi tự chọn
   * model còn lại đầu danh sách — để `null` thì nhân vật biến mất và user tưởng app hỏng.
   */
  const removeModel = useCallback(
    async (id: string) => {
      const target = models.find((m) => m.id === id)
      if (!target) return
      const ok = window.confirm(
        `Bỏ "${target.label}" khỏi danh sách?\n\nFile .vrm gốc trong máy KHÔNG bị xoá. Các bộ trang phục đã lưu cho nhân vật này sẽ mất.`
      )
      if (!ok) return

      await window.infra.vrm.remove(id)
      const list = await window.infra.vrm.list()
      setModels(list)
      const s = await window.infra.vrm.getSettings()
      // Vừa xoá đúng model đang hiện → nhảy sang model còn lại, đừng để trống
      if (!s.activeId && list.length > 0) setSettings(await window.infra.vrm.setSettings({ activeId: list[0]!.id }))
      else setSettings(s)
    },
    [models]
  )

  /**
   * Nạp file `.vrma` vào sân khấu đang chạy.
   *
   * Lỗi phải hiện thành câu nói được nguyên nhân: một `.glb` thường nạp qua đây sẽ không có
   * animation nào và `playAnimation` ném lỗi — im lặng thì user chỉ thấy "bấm mà không có gì
   * xảy ra", đúng loại hỏng ở mục 8 CLAUDE.md.
   */
  const pickAnimation = useCallback(async () => {
    const res = await window.infra.vrm.pickAnimation()
    if (!res.ok) {
      if (res.reason === 'canceled') return
      setLoad({
        kind: 'error',
        message:
          res.reason === 'tooLarge'
            ? `File quá lớn${res.detail ? ` (${res.detail})` : ''}.`
            : `Không đọc được file${res.detail ? `: ${res.detail}` : ''}`
      })
      return
    }
    try {
      await stageRef.current?.playAnimation(res.bytes)
      setAnimationName(res.name)
    } catch (e) {
      setAnimationName(null)
      setLoad({ kind: 'error', message: (e as Error).message })
    }
  }, [])

  return (
    <VrmStageShell
      boxRef={boxRef}
      stageAspect={stageAspect}
      stage={stageRef.current}
      motion={motion}
      bubble={bubble}
      onSpeak={speak}
      savedPos={
        settings?.posX != null && settings?.posY != null ? { x: settings.posX, y: settings.posY } : null
      }
      onSavePos={(x, y) => void patch({ posX: x, posY: y })}
      zoom={settings?.zoom ?? 1}
      expressions={expressions}
      parts={parts}
      models={models}
      activeModelId={settings?.activeId ?? null}
      onPickModel={(id) => void patch({ activeId: id })}
      onRemoveModel={(id) => void removeModel(id)}
      onTogglePart={(name, visible) => {
        stageRef.current?.setPartVisible(name, visible)
        setParts((prev) => prev.map((p) => (p.name === name ? { ...p, visible } : p)))
      }}
      /**
       * Mặc một bộ: đặt lại hiện/ẩn cho **mọi** món theo bộ đó.
       *
       * Duyệt hết danh sách chứ không chỉ những món trong `hidden`: bộ lưu danh sách món TẮT,
       * nên món không có trong đó phải được **bật lại** — thiếu bước này thì mặc bộ B sau bộ A
       * là còn sót mấy món của A đang tắt.
       */
      onApplyOutfit={(hidden) => {
        const off = new Set(hidden)
        // Đổi mesh TRƯỚC, ngoài hàm cập nhật state: `setParts(prev => …)` có thể được React gọi
        // lại (StrictMode ở dev chạy hai lần), mà trong đó lại đi gọi sang three.js là trộn tác
        // dụng phụ vào chỗ đáng lẽ chỉ tính giá trị
        for (const p of parts) stageRef.current?.setPartVisible(p.name, !off.has(p.name))
        setParts(parts.map((p) => ({ ...p, visible: !off.has(p.name) })))
      }}
      // Quên luôn vị trí đã kéo: "về mặc định" mà nhân vật vẫn đứng chỗ cũ thì nút này chỉ làm
      // một nửa việc user mong đợi (cần tải lại panel mới thấy, xem `key` ở dưới)
      onResetView={() => void patch({ zoom: 1, rotationY: 0, posX: null, posY: null })}
      onZoom={(deltaY) => void patch({ zoom: zoomStep(settings?.zoom ?? 1, deltaY) })}
      /**
       * Xoay: đẩy THẲNG vào sân khấu, `commit` mới ghi file.
       *
       * Kéo chuột sinh hàng chục sự kiện mỗi giây; gọi `patch` ở mỗi sự kiện là ngần ấy lần
       * ghi JSON xuống đĩa + ngần ấy vòng render React cho một thao tác liên tục.
       */
      onRotateBy={(rad, commit) => {
        rotationRef.current += rad
        if (commit) void patch({ rotationY: rotationRef.current })
        else stageRef.current?.setRotationY(rotationRef.current)
      }}
      /**
       * Bỏ khung CHỈ khi nhân vật đã thật sự hiện. Các trạng thái còn lại là CHỮ (chọn file,
       * đang nạp, lỗi, mất file) — chữ trên nền trong suốt đè lên Dashboard thì không đọc nổi.
       */
      chromeless={!!active && !active.missing && load.kind === 'ready'}
      overlay={
        !active ? (
          <StartScreen
            onPick={() => void pick()}
            onDownloaded={() => void refreshAfterAdd()}
            models={models}
            picking={picking}
            error={load.kind === 'error' ? load.message : null}
          />
        ) : load.kind === 'loading' ? (
          <div className="text-subtle flex flex-col items-center justify-center gap-2 text-xs">
            <span>Đang nạp model…</span>
            <div className="bg-edge h-1 w-32 overflow-hidden rounded-full">
              <div className="bg-accent h-full transition-all" style={{ width: `${Math.round(load.ratio * 100)}%` }} />
            </div>
          </div>
        ) : load.kind === 'error' ? (
          <div className="text-danger p-3 text-center text-xs">{load.message}</div>
        ) : active.missing ? (
          <div className="text-warning flex flex-col items-center justify-center gap-2 p-3 text-center text-xs">
            <span>Không còn thấy file ở chỗ cũ.</span>
            <span className="text-subtle break-all">{active.path}</span>
            <button className="border-edge hover:bg-elevated rounded border px-2 py-1" onClick={() => void pick()}>
              Chọn lại file
            </button>
          </div>
        ) : null
      }
      controls={
        settings && (
          <div className="flex flex-col gap-2">
            {active && <ModelInfo model={active} />}
            <VrmControls
              models={models}
              active={active}
              settings={settings}
              animationName={animationName}
              onPatch={(p) => void patch(p)}
              onPick={() => void pick()}
              onDownloaded={() => void refreshAfterAdd()}
              onRemoveModel={(id) => void removeModel(id)}
              onCloseCharacter={onClose}
              onPickAnimation={() => void pickAnimation()}
              onClearAnimation={() => {
                void stageRef.current?.playAnimation(null)
                setAnimationName(null)
              }}
            />
          </div>
        )
      }
    />
  )
}

/**
 * Khung chứa sân khấu VRM — **một cây DOM duy nhất cho mọi trạng thái**.
 *
 * Vì sao không rẽ nhánh `return` giữa "có khung" và "không khung": `createVrmStage` gắn context
 * WebGL vào đúng phần tử `<canvas>` nó nhận lúc dựng. Rẽ nhánh khiến React unmount canvas cũ và
 * mount canvas mới khi trạng thái đổi sang `ready`, stage vẫn vẽ vào canvas đã rời khỏi DOM →
 * **nhân vật biến mất mà không một lỗi nào được ném ra**. Giữ canvas ở nguyên một chỗ trong cây,
 * chỉ đổi class của khung bao quanh.
 *
 * `pointer-events-none` ở lớp ngoài khi không khung là **bắt buộc, không phải tinh chỉnh**: bỏ
 * nền đi thì ô này vô hình nhưng vẫn nuốt mọi cú click xuống Dashboard bên dưới — đúng loại
 * "xanh mà không hoạt động" ở mục 8 CLAUDE.md.
 *
 * Hệ quả phải nói thẳng với user: vùng nhận chuột là HÌNH CHỮ NHẬT bao quanh nhân vật, không
 * phải đúng đường viền cơ thể — muốn chính xác từng pixel thì phải raycast mỗi lần di chuột.
 */
function VrmStageShell({
  boxRef,
  chromeless,
  overlay,
  controls,
  stageAspect,
  stage,
  motion,
  bubble,
  onSpeak,
  savedPos,
  onSavePos,
  zoom,
  onZoom,
  onRotateBy,
  expressions,
  parts,
  models,
  activeModelId,
  onPickModel,
  onRemoveModel,
  onTogglePart,
  onApplyOutfit,
  onResetView
}: {
  readonly boxRef: React.RefObject<HTMLDivElement | null>
  readonly chromeless: boolean
  readonly overlay: React.ReactNode
  readonly controls: React.ReactNode
  /** Tỉ lệ ngang/dọc thật của model, `null` khi chưa dựng xong. */
  readonly stageAspect: number | null
  readonly stage: VrmStage | null
  /** Thư viện chuyển động — shell dùng cho "chạm vào người" và "mở chat", menu 🎬 dùng phần còn lại. */
  readonly motion: VrmMotionApi
  /** Thông báo đang hiện trên đầu nhân vật; `null` = không có. */
  readonly bubble: { id: number; text: string; severity: AppEventSeverity } | null
  readonly zoom: number
  readonly onZoom: (deltaY: number) => void
  /** `commit` = user đã thả tay → mới ghi vào settings. */
  readonly onRotateBy: (rad: number, commit: boolean) => void
  readonly expressions: string[]
  readonly parts: VrmPart[]
  readonly models: VrmModelDto[]
  readonly activeModelId: string | null
  readonly onPickModel: (id: string) => void
  /** Bỏ model khỏi danh sách (không xoá file gốc). */
  readonly onRemoveModel: (id: string) => void
  readonly onTogglePart: (name: string, visible: boolean) => void
  /** Mặc một bộ đã lưu — `hidden` là các mesh phải ẩn, còn lại bật hết. */
  readonly onApplyOutfit: (hidden: readonly string[]) => void
  readonly onResetView: () => void
  /** Cho nhân vật nói một câu trong bong bóng thoại. */
  readonly onSpeak: (text: string) => void
  /** Vị trí đã lưu theo tỉ lệ cửa sổ (0..1); `null` = chưa kéo lần nào. */
  readonly savedPos: { x: number; y: number } | null
  /** Ghi vị trí mới (tỉ lệ) — chỉ gọi lúc user thả tay. */
  readonly onSavePos: (x: number, y: number) => void
}) {
  /**
   * Vị trí nhân vật, nhớ qua các lần mở app.
   *
   * Lưu theo **tỉ lệ** cửa sổ rồi đổi ra pixel lúc dựng: user đổi cỡ cửa sổ hay cắm màn hình
   * khác thì toạ độ pixel cũ trỏ ra ngoài màn hình và nhân vật biến mất không dấu vết.
   *
   * Tính MỘT lần lúc mount (`useState` khởi tạo lười): đọc lại mỗi render thì mỗi lần đổi cỡ
   * cửa sổ lại giật nhân vật về chỗ đã lưu, kể cả khi user vừa kéo nó đi.
   */
  const [initialPos] = useState(() =>
    savedPos ? { x: savedPos.x * window.innerWidth, y: savedPos.y * window.innerHeight } : null
  )
  const { panelRef, pos, resetPos, headerHandlers } = useDraggablePanel({
    initial: initialPos,
    onCommit: (p) => onSavePos(p.x / window.innerWidth, p.y / window.innerHeight),
    // Kéo trần nay là "níu nhân vật" (thả ra bật về chỗ cũ), nên DỜI khung phải giữ Ctrl
    requireCtrl: true
  })

  /**
   * Cột dock AI bên phải đang mở → nhân vật **né sang trái đúng bề rộng dock**.
   *
   * Dock nằm trong flex row nên chiếm chỗ thật, còn panel này là `absolute` neo theo mép phải
   * CỬA SỔ — không né thì nhân vật đứng đè ngay lên khung chat của Trợ lý AI (⛶ từ bong bóng
   * chat mở ra đúng cột này). Ba cờ mirror đúng điều kiện `AiDockHost` render: thiếu cờ nào là
   * mở công cụ đó xong nhân vật vẫn đè lên.
   *
   * Né bằng `right`/`left` chứ không `transform`: không đổi kích thước nên `ResizeObserver`
   * không gọi `resize()`, camera giữ nguyên; và `getBoundingClientRect()` trả đúng vị trí mới
   * nên bong bóng thoại/menu vẫn bám theo người.
   */
  const dockOpen = useUiStore((s) => s.aiPanelOpen || s.aiDiagnoseOpen || s.codexPanelOpen)
  const dockWidth = useUiStore((s) => s.aiDockWidth)
  // Tính ngoài selector: selector đóng gói `dockOpen` cũ có thể trả về số cũ một lượt render,
  // và đó đúng là lượt dock vừa đóng — model sẽ đứng lệch thêm một nhịp
  const dockW = dockOpen ? dockWidth : 0

  /**
   * Nút "về mặc định" xoá vị trí đã lưu → trả panel về góc neo.
   *
   * Gọi `resetPos()` chứ **không** remount qua `key`: `boxRef` giữ thẻ canvas WebGL, mà effect
   * nạp model nằm ở component CHA nên nó không chạy lại — remount là canvas biến mất vĩnh viễn
   * và phải nạp lại model 40 MB (cùng họ với bẫy `forceContextLoss` đã dính trước đây).
   */
  useEffect(() => {
    if (savedPos === null) resetPos()
    // `resetPos` ổn định theo vòng đời hook, không cần vào deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedPos === null])
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  /** Vòng con công cụ (mục 🧰) — mở tại cùng tâm với vòng chính. */
  const [toolRing, setToolRing] = useState<{ x: number; y: number } | null>(null)
  /** Bong bóng chat AI trên đầu nhân vật. */
  const [chatOpen, setChatOpen] = useState(false)
  /**
   * Clip "đang nói" khi mở khung chat.
   *
   * Một effect theo `chatOpen` thay vì gọi ở cả **ba** chỗ mở chat (nhấn giữ, menu tròn, thu về
   * từ dock AI): ba lời gọi rải rác là ba chỗ để quên khi thêm lối vào thứ tư.
   */
  const motionPlay = motion.play
  useEffect(() => {
    if (chatOpen) motionPlay('chat')
  }, [chatOpen, motionPlay])

  /**
   * Mở công cụ "ngồi đọc lâu" → nhân vật xem điện thoại cho hợp cảnh.
   *
   * Nghe cờ `modal` của store thay vì móc vào từng nút bấm: so sánh config và replication mở được
   * từ sidebar, lưới công cụ, bảng lệnh và vòng công cụ của chính nhân vật — móc từng chỗ là bốn
   * chỗ để quên.
   */
  const openModal = useUiStore((s) => s.modal)
  useEffect(() => {
    if (openModal === 'compare' || openModal === 'replication') motionPlay('inspect')
  }, [openModal, motionPlay])
  /** Đọc `motion` trong hẹn giờ mà không phải đặt lại lịch mỗi lần state của hook đổi. */
  const motionRef2 = useRef(motion)
  motionRef2.current = motion

  /**
   * Clip "đứng thư giãn" chạy THƯA (90–180 giây một lần), không phải nền liên tục.
   *
   * Lý do không cho lặp mãi: clip chạy thì stage tắt toàn bộ lớp tự sinh — mất nhìn theo chuột,
   * kéo níu, tay đu theo quán tính. Để nó chiếm chỗ vĩnh viễn là đánh đổi cả phần tương tác lấy
   * một vòng lặp 8 giây. Thỉnh thoảng chen vào thì được cả hai.
   *
   * Đọc cờ bận qua `ref` (xem `hintBusyRef`) nên không phải đặt lại hẹn giờ mỗi lần một cờ đổi.
   */
  useEffect(() => {
    if (!chromeless) return
    let timer = 0
    const fire = (): void => {
      if (!hintBusyRef.current) motionRef2.current?.play('idle')
      timer = window.setTimeout(fire, motionIdleDelayMs(Math.random))
    }
    timer = window.setTimeout(fire, motionIdleDelayMs(Math.random))
    return () => clearTimeout(timer)
  }, [chromeless])
  /**
   * Nối với nút "thu về nhân vật" trên dock AI: báo cho dock biết có nhân vật để về, và nhận yêu
   * cầu mở bong bóng từ đó. So với bộ đếm ĐÃ THẤY chứ không so với 0: store sống qua các lần
   * mount, mount lại mà thấy đếm > 0 rồi tự bật chat là sai.
   */
  useEffect(() => {
    useVrmChatStore.getState().setAttached(stage !== null)
    return () => useVrmChatStore.getState().setAttached(false)
  }, [stage])
  const openReq = useVrmChatStore((s) => s.openRequest)
  const seenReq = useRef(openReq)
  useEffect(() => {
    if (openReq === seenReq.current) return
    seenReq.current = openReq
    setChatOpen(true)
    useVrmChatStore.getState().setMini(false)
  }, [openReq])
  /** Bảng hai bên đang mở: biểu cảm / trang phục / model; `null` = không mở. */
  const [side, setSide] = useState<'expr' | 'parts' | 'models' | 'motion' | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  /**
   * ==== GỢI Ý THAO TÁC — nhân vật tự kể lúc rảnh ====
   *
   * Mọi thao tác với nhân vật đều vô hình (nhấn giữ, click phải, Shift+kéo, Ctrl+lăn) — không
   * nói thì user không bao giờ biết. Lịch thưa: 25 s sau khi nạp, rồi 3–6 phút một câu; **chỉ
   * gợi thao tác chưa làm** (`useVrmHintsStore` nhớ qua các lần mở app), làm hết thì im hẳn.
   *
   * Im khi đang bận: chat/menu/bảng bên/dock đang mở, hoặc đang có bong bóng khác (cảnh báo hệ
   * thống quan trọng hơn lời gợi ý). Đọc trạng thái qua `ref` để không phải đặt lại hẹn giờ mỗi
   * lần một cờ đổi — đặt lại là nhịp bị trôi và câu gợi ý tới đúng lúc user vừa đóng menu.
   */
  const hintsDone = useVrmHintsStore((s) => s.done)
  const markHintDone = useVrmHintsStore((s) => s.markDone)
  const hintBusyRef = useRef(false)
  hintBusyRef.current = !!menu || !!toolRing || !!side || showSettings || chatOpen || dockOpen || !!bubble
  const hintsDoneRef = useRef(hintsDone)
  hintsDoneRef.current = hintsDone
  const lastHintRef = useRef<string | null>(null)
  useEffect(() => {
    if (!chromeless) return
    let timer = 0
    const fire = (): void => {
      if (hintBusyRef.current) {
        timer = window.setTimeout(fire, HINT_RETRY_MS)
        return
      }
      const h = pickHint(hintsDoneRef.current, lastHintRef.current, Math.random)
      if (!h) return // user đã làm hết → thôi, không hẹn nữa
      lastHintRef.current = h.id
      onSpeak(h.text)
      timer = window.setTimeout(fire, hintDelayMs(Math.random))
    }
    timer = window.setTimeout(fire, HINT_FIRST_MS)
    return () => clearTimeout(timer)
  }, [chromeless, onSpeak])
  /** Toạ độ X lúc bắt đầu Shift+kéo; `null` = không đang xoay. */
  const rotating = useRef<number | null>(null)
  /** Điểm bấm lúc bắt đầu kéo-níu (kéo trần trên thân người); `null` = không đang níu. */
  const tugStart = useRef<{ x: number; y: number } | null>(null)

  /**
   * Nhấn GIỮ trên người → mở chat (§5).
   *
   * Ba ref chứ không state: tất cả đều đọc/ghi ngay trong handler chuột, mà state thì phải chờ
   * một vòng render mới thấy giá trị mới — đủ để bỏ lỡ đúng cái sự kiện cần chặn.
   */
  const holdTimer = useRef<number | null>(null)
  const holdStart = useRef<{ x: number; y: number } | null>(null)
  /** Nhấn giữ vừa kích hoạt → nuốt luôn `click` theo sau. */
  const holdFired = useRef(false)
  const cancelHold = useCallback(() => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current)
    holdTimer.current = null
    holdStart.current = null
  }, [])
  // Panel đóng giữa lúc đang hẹn giờ thì hẹn vẫn nổ và mở chat của một panel đã biến mất
  useEffect(() => cancelHold, [cancelHold])

  /**
   * Công cụ đã ghim trên Dashboard, đưa thẳng vào vòng con.
   *
   * Dùng lại `useToolUsageStore.pinned` + `openTool()` — **không** tự dựng danh sách thứ hai:
   * `openTool` là nơi duy nhất biết công cụ nào mở dạng popup, cái nào mở dạng tab, nên đi
   * đường khác là sớm muộn cũng lệch với Dashboard.
   *
   * Cắt ở 10 mục: vòng tròn còn phải đủ chỗ cho nút "Tất cả", và quá nhiều nút thì vòng nở ra
   * to hơn cả nhân vật.
   */
  const pinnedIds = useToolUsageStore((s) => s.pinned)
  const t = useT()
  const pinnedToolActions = useMemo<RadialAction[]>(() => {
    const byKey = new Map(TOOLS.map((tool) => [toolKey(tool), tool]))
    const actions: RadialAction[] = []
    for (const id of pinnedIds.slice(0, 10)) {
      const tool = byKey.get(id)
      if (!tool) continue // công cụ đã bị bỏ khỏi catalog nhưng còn sót trong danh sách ghim
      const { icon, name } = splitMenuLabel(t(tool.menuKey))
      actions.push({
        id,
        icon,
        label: name,
        onSelect: () => {
          openTool(tool)
          onSpeak(openedLine(name))
        }
      })
    }
    actions.push({
      id: 'all-tools',
      icon: '⊞',
      label: 'Tất cả công cụ',
      onSelect: () => useTabsStore.getState().openToolTab('features')
    })
    return actions
  }, [pinnedIds, t, onSpeak])

  /** Vùng nhân vật trên màn hình, để bảng hai bên bám đúng hai mép. */
  const anchorRect = (): { left: number; top: number; width: number; height: number } => {
    const r = boxRef.current?.getBoundingClientRect()
    return r
      ? { left: r.left, top: r.top, width: r.width, height: r.height }
      : { left: 0, top: 56, width: 200, height: 440 }
  }

  // Quay lại trạng thái có khung thì dọn hết lớp nổi: lúc đó controls đã hiện thẳng trong
  // panel, để hộp nổi chồng lên nữa là hiện hai bản của cùng một thứ.
  useEffect(() => {
    if (!chromeless) {
      setShowSettings(false)
      setMenu(null)
      setToolRing(null)
      setChatOpen(false)
      setSide(null)
    }
  }, [chromeless])

  /**
   * Bề rộng khung ôm sát thân người.
   *
   * Chiều cao cố định, bề rộng suy từ tỉ lệ THẬT của model. Đặt số cứng (260px như trước) thì
   * model gầy thừa khoảng trống hai bên — mà khoảng trống ấy vẫn nuốt chuột — còn model có
   * váy xoè thì **bị cắt mất hai bên**. `stageAspect` chưa có (đang nạp) thì dùng 0.6 tạm.
   */
  /**
   * Khung phóng to theo `zoom`: phóng model mà giữ nguyên khung thì nhân vật tràn ra ngoài và
   * **bị cắt** bởi mép khung — vùng nhận chuột cũng lệch theo.
   */
  const H = Math.round(440 * zoom)
  const width = Math.round(H * (stageAspect ?? 0.6))

  return (
    <div
      ref={panelRef}
      /**
       * Chưa kéo lần nào → neo ở **góc dưới-phải**, đo từ hai mép đó chứ không phải left/top.
       *
       * Bề ngang khung đổi theo từng model (nó ôm sát người, `stageAspect` chỉ có sau khi đo
       * xong), nên neo bằng `left` thì mỗi lần đổi nhân vật là khung trượt ngang một đoạn.
       * Neo từ mép phải/dưới thì mép đó đứng yên, model rộng hẹp bao nhiêu cũng vậy.
       *
       * Chỉ neo đáy ở chế độ không khung: hộp có khung là bảng cài đặt, cao theo nội dung và
       * dính đáy thì che mất thanh trạng thái.
       *
       * Lề phải `CHROMELESS_RIGHT_GAP` chứ không sát mép: bảng nổi trên đầu nhân vật (chat rộng
       * 320px, cài đặt 256px) căn giữa theo thân người, mà thân chỉ ~150px — đứng sát mép thì
       * nửa bảng bị đẩy ngược vào trong và lệch hẳn khỏi nhân vật. Chừa sẵn nửa hiệu bề rộng
       * thì bảng nằm đúng giữa.
       */
      style={
        /**
         * Mở CÀI ĐẶT → nhân vật vào **chính giữa màn hình**, vì bảng cài đặt là khung lớn hai cột
         * và nhân vật đứng ở khe giữa hai cột (user yêu cầu). Tắt cài đặt thì về đúng chỗ cũ —
         * `left` tính từ tâm nên không đụng tới vị trí đã lưu.
         */
        showSettings && chromeless
          ? { left: Math.round(window.innerWidth / 2 - width / 2), bottom: 12 }
          : pos
            ? // Đã kéo tay: giữ đúng chỗ user đặt, CHỈ đẩy sang trái khi chỗ đó lọt vào vùng dock
              { left: dockW > 0 ? Math.min(pos.x, window.innerWidth - dockW - width - 8) : pos.x, top: pos.y }
            : chromeless
              ? { right: CHROMELESS_RIGHT_GAP + dockW }
              : { top: 56 }
      }
      className={`absolute z-40 flex flex-col ${
        showSettings && chromeless ? '' : pos ? '' : chromeless ? 'bottom-3' : 'right-3'
      } ${
        chromeless
          ? // `left`/`right`/`bottom` đổi khi dock hoặc cài đặt mở/đóng → trượt sang thay vì nhảy
            'pointer-events-none transition-[left,right,bottom,top] duration-300'
          : 'bg-elevated/95 border-edge-strong w-80 gap-2 overflow-hidden rounded-lg border p-3 opacity-95 shadow-2xl transition-opacity hover:opacity-100'
      }`}
    >
      {/* Canvas phải có kích thước THẬT từ CSS: WebGLRenderer đọc clientWidth/Height lúc dựng,
          canvas cao 0 thì scene trống mà không báo lỗi gì. Kéo bằng chính thân nhân vật —
          không khung thì không còn header để nắm; chuột phải mở menu. */}
      {/**
       * Khi CỘT DOCK AI mở (⛶ từ bong bóng chat, hoặc mở Trợ lý AI/Chẩn đoán/Codex): nhân vật
       * mờ đi và **không nhận chuột nữa**. Đóng dock là bấm/kéo lại bình thường.
       *
       * Bong bóng chat NHỎ thì KHÔNG tắt: nó chỉ chiếm một dải trên đầu, người vẫn phải bấm/kéo
       * được — user đã yêu cầu rõ. Bản đầu tắt cả lúc chat nhỏ và bị bắt sửa lại.
       *
       * Tắt chuột lúc dock mở còn chặn một lỗi thật: model đang bị đẩy sang trái né dock, chỉ
       * cần một cú click xê dịch 1px là hook kéo-thả **ghi lại vị trí đã đẩy** thành vị trí user
       * chọn — đóng dock xong nhân vật ở lại đó, "không về chỗ cũ". Không nhận chuột thì không
       * có gì để ghi.
       *
       * `pointer-events-none` chứ không `opacity-0`: ẩn bằng opacity KHÔNG tắt vùng nhận chuột
       * — đã dính đúng bẫy đó với hai nút ✕/⚙ trước đây.
       *
       * ⚠️ Chỉ đổi CLASS trên chính div này, tuyệt đối không bọc thêm/bỏ bớt thẻ: `boxRef` là
       * nơi canvas WebGL cắm vào, đổi cấu trúc DOM là mất context và phải nạp lại model 40 MB.
       */}
      <div
        ref={boxRef}
        style={chromeless ? { height: H, width } : undefined}
        className={`relative shrink-0 transition-opacity duration-200 ${
          chromeless ? 'pointer-events-auto cursor-grab active:cursor-grabbing' : 'h-[380px] w-full overflow-hidden'
        } ${dockOpen ? 'pointer-events-none opacity-40' : ''}`}
        /**
         * Tooltip NGẮN. Bản trước liệt kê cả 5 thao tác nên Windows vẽ ra một dải chữ chạy ngang
         * gần hết màn hình, che mất chính nhân vật — mà tooltip thì tự hiện khi rê chuột, user
         * không bấm gì cũng phải chịu. Danh sách đầy đủ đã có ở menu chuột phải và ở các câu gợi ý
         * nhân vật tự nói, nên ở đây chỉ cần chỉ đường tới đó.
         */
        title="Chuột phải để mở menu"
        onContextMenu={(e) => {
          if (!chromeless) return
          // Chuột phải TRONG một bảng nổi là việc của bảng đó, không phải mở menu nhân vật
          if ((e.target as HTMLElement).closest('[data-vrm-overlay]')) return
          // Chặn menu ngữ cảnh mặc định của Chromium, nếu không nó đè lên menu của mình
          e.preventDefault()
          // Toạ độ MÀN HÌNH: vòng tròn vẽ ở lớp phủ toàn cửa sổ, không trong khung hẹp
          setMenu({ x: e.clientX, y: e.clientY })
          markHintDone('menu')
        }}
        onWheel={(e) => {
          // CHỈ khi giữ Ctrl: lăn trần phải để nguyên cho trang phía sau cuộn
          if (!e.ctrlKey) return
          // Lăn trong bảng nổi là để CUỘN BẢNG (bảng cài đặt có vùng cuộn), không phóng nhân vật
          if ((e.target as HTMLElement).closest('[data-vrm-overlay]')) return
          e.preventDefault()
          onZoom(e.deltaY)
          markHintDone('zoom')
        }}
        onPointerMove={(e) => {
          // Nhích quá 6px là user đang KÉO chứ không phải nhấn giữ → huỷ hẹn mở chat
          const h = holdStart.current
          if (h && (Math.abs(e.clientX - h.x) > 6 || Math.abs(e.clientY - h.y) > 6)) {
            cancelHold()
            // Nhích quá ngưỡng từ một cú bấm trên người (không Shift) = đang KÉO dời nhân vật
            if (!e.shiftKey) markHintDone('move')
          }

          // Vị trí con trỏ do listener toàn cửa sổ lo (xem effect `pointermove` ở trên) —
          // ở đây chỉ còn việc kéo xoay
          const r = e.currentTarget.getBoundingClientRect()
          if (rotating.current !== null) {
            // Kéo ngang cả bề rộng khung = xoay đúng một vòng
            onRotateBy(((e.clientX - rotating.current) / r.width) * Math.PI * 2, false)
            rotating.current = e.clientX
            return
          }
          /**
           * Kéo TRẦN = níu nhân vật (không dời khung). Gửi độ lệch theo TỈ LỆ khung nên kéo trên
           * khung nhỏ hay to đều ra cùng độ ngả — stage không biết gì về pixel.
           */
          const tg = tugStart.current
          if (tg) {
            stage?.setTug({ x: (e.clientX - tg.x) / r.width, y: (e.clientY - tg.y) / r.height })
            if (Math.abs(e.clientX - tg.x) > 12 || Math.abs(e.clientY - tg.y) > 12) markHintDone('tug')
            return
          }
          // Còn lại là Ctrl+kéo dời khung — chuyển tiếp cho hook kéo-di-chuyển
          headerHandlers.onPointerMove(e)
        }}
        onPointerDown={(e) => {
          /**
           * Ba kiểu kéo, phân biệt bằng phím bổ trợ:
           * - **Shift+kéo** = xoay người.
           * - **Ctrl+kéo** = dời nhân vật đi chỗ khác (trước đây là kéo trần).
           * - **kéo trần** = níu nhân vật, buông thì bật về chỗ cũ.
           *
           * Đổi kéo-trần từ "dời" sang "níu" là yêu cầu của user. Dời vẫn phải còn một đường
           * vào (Ctrl) — không thì nhân vật kẹt cứng tại chỗ, không cách nào dời.
           */
          if (e.shiftKey && chromeless) {
            e.stopPropagation()
            rotating.current = e.clientX
            e.currentTarget.setPointerCapture(e.pointerId)
            markHintDone('rotate')
            return
          }
          /**
           * ⚠️ Bấm vào một BẢNG NỔI (cài đặt, chat, danh sách) thì **không phải** chạm vào nhân vật.
           *
           * Các bảng đó mở ĐÈ lên người, mà `hitTest` chỉ là hộp bao quanh xương — nó không biết
           * có tấm bảng nào nằm trên. Thiếu bước này thì bấm một nút trong bảng sẽ vừa khởi động
           * kéo-níu vừa hẹn mở chat, và `setPointerCapture` kéo con trỏ về div này nên **nút không
           * bao giờ nhận được `click`** (cùng họ với bẫy `setPointerCapture` đã làm ô checkbox
           * không tích được). `onClick` đã có bước chặn này, nhưng thiếu ở `pointerdown` thì hỏng
           * ngay từ đầu chuỗi sự kiện.
           */
          if ((e.target as HTMLElement).closest('[data-vrm-overlay]')) return

          // Kéo trần trên THÂN NGƯỜI = níu. Bấm vào góc khung trống thì không — ở đó không có gì
          // để níu, và để nguyên cho hook kéo xử lý thì user vẫn dời được như thói quen cũ.
          if (chromeless && !e.ctrlKey && !e.metaKey && e.button === 0) {
            const r = e.currentTarget.getBoundingClientRect()
            const nx = ((e.clientX - r.left) / r.width) * 2 - 1
            const ny = -(((e.clientY - r.top) / r.height) * 2 - 1)
            if (stage?.hitTest(nx, ny)) {
              tugStart.current = { x: e.clientX, y: e.clientY }
              e.currentTarget.setPointerCapture(e.pointerId)
            }
          }
          /**
           * Nhấn GIỮ ~500ms trên người → mở chat.
           *
           * Ghi lại điểm bấm để `onPointerMove` huỷ khi user thật ra đang **kéo**: không có
           * bước đó thì mỗi lần dời nhân vật lại bật khung chat ra giữa chừng.
           */
          if (chromeless && e.button === 0) {
            const r = e.currentTarget.getBoundingClientRect()
            const nx = ((e.clientX - r.left) / r.width) * 2 - 1
            const ny = -(((e.clientY - r.top) / r.height) * 2 - 1)
            // Chỉ tính khi bấm trúng THÂN NGƯỜI, không phải góc khung trống
            if (stage?.hitTest(nx, ny)) {
              holdStart.current = { x: e.clientX, y: e.clientY }
              holdTimer.current = window.setTimeout(() => {
                holdTimer.current = null
                holdFired.current = true
                setChatOpen(true)
                useVrmChatStore.getState().setMini(false)
                markHintDone('hold')
              }, 500)
            }
          }
          headerHandlers.onPointerDown(e)
        }}
        onPointerUp={(e) => {
          // Thả tay trước 500ms → không phải nhấn giữ, huỷ hẹn
          cancelHold()
          if (rotating.current !== null) {
            rotating.current = null
            // Thả tay mới ghi xuống đĩa (xem `onRotateBy`)
            onRotateBy(0, true)
            return
          }
          // Buông tay níu → lò xo trong stage tự đưa thân về chỗ cũ
          if (tugStart.current) {
            tugStart.current = null
            stage?.setTug(null)
            return
          }
          headerHandlers.onPointerUp(e)
        }}
        onPointerCancel={() => {
          // Mất pointer giữa chừng (chuyển cửa sổ, alt-tab) cũng phải buông — không thì thân
          // ngả mãi một bên vì không bao giờ có `pointerup`
          if (tugStart.current) {
            tugStart.current = null
            stage?.setTug(null)
          }
        }}
        onClick={(e) => {
          if (!chromeless || !stage) return
          // Nhấn giữ vừa mở chat → KHÔNG `poke` nữa: trình duyệt vẫn sinh `click` sau đó, để
          // nguyên là nhân vật vừa mở chat vừa giật mình phản ứng
          if (holdFired.current) {
            holdFired.current = false
            return
          }
          // Bấm vào bảng nổi (cài đặt, chat, danh sách) thì không phải là chạm vào nhân vật —
          // các bảng đó nằm đè lên người nên raycast vẫn trúng nếu không chặn ở đây
          if ((e.target as HTMLElement).closest('[data-vrm-overlay]')) return
          const r = e.currentTarget.getBoundingClientRect()
          const nx = ((e.clientX - r.left) / r.width) * 2 - 1
          const ny = -(((e.clientY - r.top) / r.height) * 2 - 1)
          // Raycast: chỉ phản ứng khi click trúng THÂN NGƯỜI, không phải góc khung trống
          // `poke` tự bốc kiểu phản ứng và biểu cảm hợp với kiểu đó
          if (stage.hitTest(nx, ny)) {
            stage.poke()
            // Clip giật mình — chạy một lần rồi tự trả về chuyển động thường
            motion.play('poke')
            markHintDone('poke')
          }
        }}
      >
        {/* Canvas do `createVrmStage` tự tạo và tự gỡ — KHÔNG render ở đây. Canvas đã bị
            `forceContextLoss()` thì chết vĩnh viễn, nên mỗi model phải có thẻ riêng; để React
            giữ một thẻ dùng lại thì đổi model là vỡ ngay. */}
        {/* `z-10`: canvas do stage chèn thẳng vào DOM nên đứng sau các nút của React trong
            thứ tự anh em — thiếu z-index thì lời báo lỗi/tiến độ bị canvas che mất. */}
        {overlay && <div className="absolute inset-0 z-10 flex items-center justify-center">{overlay}</div>}

        {menu && (
          <VrmRadialMenu
            x={menu.x}
            y={menu.y}
            onDismiss={() => setMenu(null)}
            actions={[
              {
                id: 'expr',
                icon: '😊',
                label: `Biểu cảm (${expressions.length})`,
                onSelect: () => setSide('expr')
              },
              {
                id: 'parts',
                icon: '👗',
                label: 'Trang phục',
                onSelect: () => {
                  setSide('parts')
                  markHintDone('outfit')
                }
              },
              {
                id: 'chat',
                icon: '💬',
                label: 'Hỏi trợ lý AI',
                // Bỏ thu nhỏ: chọn "hỏi" mà ra bong bóng chỉ đọc được thì user phải bấm thêm
                // một lần nữa mới gõ được — trạng thái mini là của lần trước, không phải ý bây giờ
                onSelect: () => {
                  useVrmChatStore.getState().setMini(false)
                  setChatOpen(true)
                }
              },
              {
                id: 'tools',
                icon: '🧰',
                label: 'Công cụ',
                onSelect: () => setToolRing({ x: menu.x, y: menu.y })
              },
              { id: 'motion', icon: '🎬', label: 'Chuyển động', onSelect: () => setSide('motion') },
              { id: 'models', icon: '🧑‍🎤', label: 'Đổi nhân vật', onSelect: () => setSide('models') },
              { id: 'settings', icon: '⚙', label: 'Cài đặt', onSelect: () => setShowSettings(true) },
              {
                id: 'reset',
                icon: '↺',
                label: 'Về cỡ & góc mặc định',
                onSelect: () => onResetView()
              },
            ]}
          />
        )}

        {/* Bong bóng thoại khi có thông báo — chỉ ở chế độ không khung, vì lúc có khung thì
            panel đã là một hộp có chữ, thêm bong bóng nữa là hai lớp chữ chồng nhau.
            Đang mở chat thì nhường chỗ: hai bong bóng cùng nằm trên đầu là chồng lên nhau. */}
        {bubble && chromeless && !chatOpen && (
          <VrmSpeechBubble text={bubble.text} severity={bubble.severity} anchor={anchorRect()} />
        )}

        {chatOpen && (
          <VrmChatBubble
            anchor={anchorRect()}
            onClose={() => setChatOpen(false)}
            onOpenFull={() => {
              setChatOpen(false)
              // Mở qua `openTool` như mọi lối vào khác — nó là nơi DUY NHẤT biết Trợ lý AI mở
              // dạng dock hay tab, và lượt dùng cũng được đếm đúng
              const ai = TOOLS.find((x) => x.id === 'ai')
              if (ai) openTool(ai)
            }}
          />
        )}

        {/* Vòng con: công cụ đã ghim trên Dashboard + nút "Tất cả" + đường quay lại vòng chính */}
        {toolRing && (
          <VrmRadialMenu
            x={toolRing.x}
            y={toolRing.y}
            onDismiss={() => setToolRing(null)}
            actions={[
              ...pinnedToolActions,
              {
                id: 'back',
                icon: '↩',
                label: 'Quay lại',
                // Không có nút này thì muốn về menu chính phải đóng rồi chuột phải lại từ đầu
                onSelect: () => {
                  setMenu({ x: toolRing.x, y: toolRing.y })
                  setToolRing(null)
                }
              }
            ]}
          />
        )}

        {/* Bảng hai bên: giữa để trống cho nhân vật nên vừa chọn vừa thấy kết quả */}
        {side === 'expr' && (
          <VrmSidePanel
            title="Biểu cảm"
            items={expressions.map((e) => ({ id: e, label: e }))}
            onPick={(id) => stage?.playExpression([id])}
            anchor={anchorRect()}
            onClose={() => setSide(null)}
          />
        )}
        {side === 'parts' && (
          <VrmOutfitPanel
            modelId={activeModelId}
            parts={parts}
            onTogglePart={onTogglePart}
            onApplyOutfit={onApplyOutfit}
            anchor={anchorRect()}
            onClose={() => setSide(null)}
          />
        )}
        {side === 'motion' &&
          /**
           * Chưa tải clip thì hộp nhỏ (chỉ một nút); tải rồi thì **hai cột hai bên nhân vật** như
           * bảng biểu cảm — user yêu cầu rõ: đừng đè lên người.
           */
          (motion.installed.length === 0 ? (
            <VrmMotionPanel motion={motion} anchor={anchorRect()} onClose={() => setSide(null)} onSpeak={onSpeak} />
          ) : (
            <VrmSidePanel
              title="Chuyển động"
              items={[
                // Dừng đứng đầu để lúc đang chạy clip thì nó ở ngay tầm mắt
                ...(motion.playing ? [{ id: '__stop', label: '■ Dừng' }] : []),
                ...motion.clips.map((c) => ({
                  id: c.id,
                  label: `${c.label}${c.locomotion ? ' 🚶' : ''}`,
                  active: motion.playing === c.id
                }))
              ]}
              activeId={motion.playing}
              onPick={(id) => (id === '__stop' ? motion.stop() : motion.playById(id))}
              anchor={anchorRect()}
              onClose={() => setSide(null)}
            />
          ))}
        {side === 'models' && (
          <VrmSidePanel
            title="Nhân vật"
            items={models.map((m) => ({ id: m.id, label: m.label + (m.missing ? ' (mất file)' : '') }))}
            activeId={activeModelId}
            onPick={(id) => {
              onPickModel(id)
              setSide(null)
            }}
            // Bảng vẫn mở sau khi xoá: dọn danh sách thường là xoá vài cái liền một lúc
            onRemove={onRemoveModel}
            anchor={anchorRect()}
            onClose={() => setSide(null)}
          />
        )}

        {chromeless && showSettings && controls && (
          <VrmSettingsFrame anchor={anchorRect()} onClose={() => setShowSettings(false)}>
            {controls}
          </VrmSettingsFrame>
        )}
      </div>

      {/* Có khung thì controls hiện THẲNG, không giấu sau menu: trong đó có tác giả + giấy phép
          model, mà quy tắc của `ModelInfo` là "hiện chứ không chặn" — giấu đi thì user không
          biết mình đang dùng model tác giả cấm dùng thương mại. Không khung thì đành phải giấu
          (chữ trên nền trong suốt không đọc nổi), đó là cái giá của việc bỏ khung. */}
      {!chromeless && controls}
    </div>
  )
}

/**
 * Cụm chỉnh nhân vật, dùng chung cho cả hai chế độ (trong khung panel và trong hộp ⚙).
 */
function VrmControls({
  models,
  active,
  settings,
  animationName,
  onPatch,
  onPick,
  onRemoveModel,
  onPickAnimation,
  onClearAnimation,
  onCloseCharacter,
  onDownloaded
}: {
  readonly models: VrmModelDto[]
  readonly active: VrmModelDto | null
  readonly settings: VrmSettingsDto
  readonly animationName: string | null
  readonly onPatch: (p: Partial<VrmSettingsDto>) => void
  readonly onPick: () => void
  /** Tải xong model mẫu → nạp lại danh sách. */
  readonly onDownloaded: () => void
  /** Bỏ model khỏi danh sách (không xoá file gốc). */
  readonly onRemoveModel: (id: string) => void
  readonly onPickAnimation: () => void
  readonly onClearAnimation: () => void
  /** Tắt hẳn nhân vật — chuyển từ menu vòng tròn về đây cho khỏi bấm nhầm. */
  readonly onCloseCharacter: () => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-subtle flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={settings.springBones} onChange={(e) => onPatch({ springBones: e.target.checked })} />
          Tóc/váy đu đưa
        </label>
        <label className="flex items-center gap-1.5">
          FPS
          <select
            className="bg-elevated border-edge rounded border px-1 py-0.5"
            value={settings.fpsCap}
            onChange={(e) => onPatch({ fpsCap: Number(e.target.value) === 60 ? 60 : 30 })}
          >
            <option value={30}>30</option>
            <option value={60}>60</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={settings.autoShow} onChange={(e) => onPatch({ autoShow: e.target.checked })} />
          Hiện lúc mở app
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={settings.lookAtCursor}
            onChange={(e) => onPatch({ lookAtCursor: e.target.checked })}
          />
          Nhìn theo chuột
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={settings.reactToEvents}
            onChange={(e) => onPatch({ reactToEvents: e.target.checked })}
          />
          Phản ứng khi có cảnh báo
        </label>
        <label
          className="flex items-center gap-1.5"
          title="App đang ở khay hoặc thu nhỏ mà có cảnh báo thì nhân vật hiện ở góc màn hình để báo; bấm vào là mở lại app"
        >
          <input
            type="checkbox"
            checked={settings.desktopOverlay}
            disabled={!settings.reactToEvents}
            onChange={(e) => onPatch({ desktopOverlay: e.target.checked })}
          />
          Hiện ngoài desktop khi app ở khay
        </label>
      </div>

      <div className="text-subtle flex items-center gap-2 text-xs">
        <span className="shrink-0">Cỡ</span>
        <input
          type="range"
          className="min-w-0 flex-1"
          min={VRM_ZOOM_MIN}
          max={VRM_ZOOM_MAX}
          step={0.05}
          value={settings.zoom}
          onChange={(e) => onPatch({ zoom: Number(e.target.value) })}
        />
        <span className="w-10 shrink-0 text-right tabular-nums">{Math.round(settings.zoom * 100)}%</span>
        {(settings.zoom !== 1 || settings.rotationY !== 0) && (
          <button
            className="border-edge hover:bg-elevated shrink-0 rounded border px-1.5 py-0.5"
            title="Về cỡ và góc mặc định"
            onClick={() => onPatch({ zoom: 1, rotationY: 0 })}
          >
            ↺
          </button>
        )}
      </div>

      {/* Biểu cảm và trang phục KHÔNG còn ở đây: model thật khai 30–40 biểu cảm, xổ dọc thì
          dài quá màn hình. Chúng mở bằng chuột phải → menu vòng tròn → bảng hai bên nhân vật
          (`VrmSidePanel`), chia hai cột nên mắt quét nhanh hơn hẳn một cột dài. */}

      {/* Đổi model nhanh — để NGOÀI phần thu gọn vì đây là thứ hay dùng nhất sau các công tắc */}
      {models.length > 1 && active && (
        <div className="flex gap-1">
          <select
            className="bg-elevated border-edge min-w-0 flex-1 rounded border px-2 py-1 text-xs"
            value={active.id}
            onChange={(e) => onPatch({ activeId: e.target.value })}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.missing ? ' (mất file)' : ''}
              </option>
            ))}
          </select>
          {/* Xoá model ĐANG CHỌN: `<select>` gốc không gắn được nút cho từng dòng.
              Bảng chuột-phải (`VrmSidePanel`) thì xoá được bất kỳ dòng nào. */}
          <button
            className="border-edge text-subtle hover:text-danger hover:border-danger rounded border px-2 py-1 text-xs"
            title={`Bỏ "${active.label}" khỏi danh sách (không xoá file gốc)`}
            onClick={() => onRemoveModel(active.id)}
          >
            🗑
          </button>
        </div>
      )}

      {/**
       * Hai mục dùng THƯA — thêm nhân vật, nạp file chuyển động — gộp vào một khối bung ra.
       *
       * Bảng này mở ngay cạnh nhân vật, mà nhân vật hay đứng sát đáy màn hình; để mọi thứ mở sẵn
       * thì bảng cao quá và phần dưới lọt ra ngoài màn hình (user chụp được). Các công tắc hằng
       * ngày ở trên vẫn mở sẵn, còn hai mục này là việc làm vài lần rồi thôi.
       */}
      {/**
       * Bảng tra thao tác — thay cho tooltip dài.
       *
       * Mọi thao tác với nhân vật đều vô hình (nhấn giữ, Ctrl+kéo, Shift+kéo, Ctrl+lăn), nên phải
       * có MỘT chỗ tra được. Trước đây nhét hết vào `title` của khung nhân vật: Windows vẽ ra một
       * dải chữ chạy gần hết màn hình, tự hiện mỗi lần rê chuột và che mất chính nhân vật.
       * Ở đây thì user chủ động mở khi cần, và nhân vật vẫn tự kể dần qua các câu gợi ý.
       */}
      <details className="group border-edge border-t pt-2">
        <summary className="text-subtle hover:text-content flex cursor-pointer list-none items-center gap-1 text-xs">
          <span className="group-open:hidden">▸</span>
          <span className="hidden group-open:inline">▾</span>
          Thao tác với nhân vật
        </summary>
        <div className="text-subtle mt-1.5 space-y-1 text-[11px]">
          {[
            ['Click', 'nhân vật phản ứng'],
            ['Nhấn giữ', 'mở khung chat'],
            ['Kéo', 'níu — thả ra bật về'],
            ['Ctrl + kéo', 'di chuyển'],
            ['Shift + kéo', 'xoay người'],
            ['Ctrl + lăn', 'to / nhỏ'],
            ['Chuột phải', 'mở menu']
          ].map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="text-content w-20 shrink-0 font-medium">{k}</span>
              <span className="min-w-0 flex-1">{v}</span>
            </div>
          ))}
        </div>
      </details>

      <details className="group border-edge border-t pt-2">
        <summary className="text-subtle hover:text-content flex cursor-pointer list-none items-center gap-1 text-xs">
          <span className="group-open:hidden">▸</span>
          <span className="hidden group-open:inline">▾</span>
          Thêm nhân vật · Chuyển động
        </summary>

        <div className="mt-2 flex flex-col gap-2">
          {/* Tải model mẫu — cũng để Ở ĐÂY, không chỉ ở màn hình mời chọn: ai đã có sẵn một model
              thì không bao giờ thấy màn hình đó, nên sẽ không biết có model mẫu để tải. */}
          <SampleDownload onDownloaded={onDownloaded} models={models} compact />

          <div className="flex flex-wrap items-center gap-1">
            <button className="border-edge hover:bg-elevated rounded border px-2 py-1 text-xs" onClick={onPickAnimation}>
              🎞 Nạp file .vrma
            </button>
            {animationName && (
              <>
                <span className="text-subtle max-w-32 truncate text-xs" title={animationName}>
                  {animationName}
                </span>
                <button
                  className="border-edge hover:bg-elevated rounded border px-1.5 py-0.5 text-xs"
                  title="Về chuyển động mặc định"
                  onClick={() => onClearAnimation()}
                >
                  ✕
                </button>
              </>
            )}
          </div>
        </div>
      </details>

      <div className="flex items-center gap-2">
        <button className="border-edge hover:bg-elevated rounded border px-2 py-1 text-xs" onClick={onPick}>
          📂 Chọn model khác
        </button>
        {/**
         * "Tắt nhân vật" chuyển từ menu vòng tròn về ĐÂY.
         *
         * Ở vòng tròn nó nằm ngay cạnh các mục hay dùng (biểu cảm, trang phục, công cụ) nên rất
         * dễ bấm nhầm, mà bấm nhầm là mất luôn nhân vật — phải đi mở lại từ Dashboard. Việc
         * "tắt" là việc làm một lần, hợp với chỗ cài đặt hơn là chỗ thao tác hằng ngày.
         */}
        <button
          className="border-edge text-subtle hover:text-danger hover:border-danger ml-auto rounded border px-2 py-1 text-xs"
          onClick={onCloseCharacter}
        >
          ✕ Tắt nhân vật
        </button>
      </div>
    </div>
  )
}

/**
 * Khối tải model mẫu — dùng ở **hai** chỗ: màn hình mời chọn (chưa có model nào) và bảng cài đặt
 * (đã có model rồi vẫn muốn thêm).
 *
 * Đặt ở cả hai là cần thiết: bản đầu chỉ để ở màn hình mời chọn, nên ai đã có sẵn một model thì
 * **không bao giờ thấy nút tải** — user báo đúng chuyện đó.
 *
 * Model mẫu KHÔNG nhúng trong app: 14 MB vào mọi bản cài của mọi người, kể cả phần lớn không bao
 * giờ bật nhân vật lên, là cái giá sai.
 */
function SampleDownload({
  onDownloaded,
  models,
  disabled,
  compact
}: {
  readonly onDownloaded: () => void
  /** Model đã có trong danh bạ — model mẫu nào đã tải rồi thì KHÔNG mời tải lại. */
  readonly models: VrmModelDto[]
  readonly disabled?: boolean
  /** Bản gọn cho bảng cài đặt: bớt chữ, không có đường kẻ "hoặc". */
  readonly compact?: boolean
}) {
  const [samples, setSamples] = useState<VrmSampleModel[]>([])
  const [progress, setProgress] = useState<VrmSampleProgress | null>(null)
  const [dlError, setDlError] = useState<string | null>(null)

  useEffect(() => {
    void window.infra.vrm.listSamples().then(setSamples)
  }, [])

  /**
   * Bỏ model mẫu đã tải khỏi danh sách mời.
   *
   * So theo **tên file**, không theo nhãn: nhãn là thứ đọc từ metadata trong file nên hai model
   * khác nhau có thể trùng tên, còn `fileName` là do chính app đặt khi tải về (`vrm-samples/`).
   * Kiểm bằng hậu tố đường dẫn để không phụ thuộc dấu gạch chéo của từng hệ điều hành.
   */
  const pending = samples.filter(
    (s) => !models.some((m) => m.path.replace(/\\/g, '/').endsWith(`/${s.fileName}`))
  )
  useEffect(() => window.infra.vrm.onSampleProgress(setProgress), [])

  const busy = progress?.phase === 'download' || progress?.phase === 'verify'
  // Tải hết rồi (hoặc chưa đọc được danh sách) → biến mất hẳn, không để lại khối rỗng
  if (pending.length === 0) return null

  const download = async (id: string): Promise<void> => {
    setDlError(null)
    setProgress({ id, phase: 'download', receivedBytes: 0, totalBytes: null, percent: 0 })
    const res = await window.infra.vrm.downloadSample(id)
    if (!res.ok) {
      setProgress(null)
      // Huỷ là do chính user bấm — không phải lỗi, không cần câu đỏ
      if (res.reason !== 'canceled') setDlError(sampleErrorMessage(res.reason))
      return
    }
    onDownloaded()
  }

  return (
    <>
      {!compact && (
        <p className="text-subtle text-xs leading-relaxed">Chưa có model? Tải một nhân vật mẫu về dùng ngay.</p>
      )}
      {pending.map((s) => (
        <div key={s.id} className="border-edge bg-elevated/40 w-full rounded border p-2.5 text-left">
          <div className="text-content text-xs font-medium">{s.label}</div>
          {!compact && <div className="text-subtle mt-0.5 text-[11px] leading-relaxed">{s.note}</div>}
          <div className="text-subtle mt-1 text-[10px]">
            {s.author} · {s.license} · {(s.sizeBytes / 1024 / 1024).toFixed(0)} MB
          </div>
          {busy && progress?.id === s.id ? (
            <div className="mt-2">
              <div className="bg-input h-1.5 w-full overflow-hidden rounded-full">
                <div
                  className="bg-accent h-full transition-[width] duration-200"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-subtle text-[10px]">
                  {progress.phase === 'verify'
                    ? 'Đang kiểm tra file…'
                    : `${(progress.receivedBytes / 1024 / 1024).toFixed(1)} MB`}
                </span>
                <button
                  className="text-subtle hover:text-content text-[10px] underline"
                  onClick={() => window.infra.vrm.cancelSample()}
                >
                  Huỷ
                </button>
              </div>
            </div>
          ) : (
            <button
              className="border-edge hover:bg-elevated mt-2 w-full rounded border px-3 py-1.5 text-xs disabled:opacity-50"
              disabled={busy || disabled}
              onClick={() => void download(s.id)}
            >
              ⬇ Tải về và dùng
            </button>
          )}
        </div>
      ))}
      {dlError && <p className="text-danger text-[11px] leading-relaxed">{dlError}</p>}
    </>
  )
}

function StartScreen({
  onPick,
  onDownloaded,
  models,
  picking,
  error
}: {
  readonly onPick: () => void
  /** Tải xong model mẫu → cha nạp lại danh sách + cấu hình (giống sau khi `pick`). */
  readonly onDownloaded: () => void
  /** Model đã có — để không mời tải lại model mẫu đã tải. */
  readonly models: VrmModelDto[]
  readonly picking: boolean
  readonly error: string | null
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-6 text-center">
      <span className="text-4xl">🧑‍🎤</span>

      <SampleDownload onDownloaded={onDownloaded} models={models} disabled={picking} />

      <div className="text-subtle flex w-full items-center gap-2 text-[10px]">
        <span className="border-edge flex-1 border-t" />
        hoặc
        <span className="border-edge flex-1 border-t" />
      </div>

      <p className="text-subtle text-xs leading-relaxed">
        Chọn một file <code className="text-content">.vrm</code> có trong máy.
        <br />
        App chỉ ghi nhớ đường dẫn, không giữ bản sao.
      </p>
      <button
        className="border-edge hover:bg-elevated rounded border px-3 py-1.5 text-xs disabled:opacity-50"
        disabled={picking}
        onClick={onPick}
      >
        {picking ? 'Đang mở…' : '📂 Chọn file .vrm'}
      </button>
      {error && <p className="text-danger text-xs">{error}</p>}
    </div>
  )
}

/**
 * Thông tin tác giả khai trong file. **Hiện chứ không chặn**: app không phán xử giấy phép,
 * nhưng im lặng thì user không biết mình đang dùng model tác giả cấm dùng thương mại.
 */
/**
 * Thông tin model: **một dòng tên**, còn lại giấu sau "Chi tiết".
 *
 * Bản trước đổ hết bốn dòng (phiên bản, dung lượng, tác giả, thương mại, URL giấy phép) lên đầu
 * bảng cài đặt — chiếm gần nửa chiều cao cho thứ đọc một lần rồi thôi, đẩy các công tắc thật sự
 * hay dùng xuống dưới và ra ngoài màn hình.
 *
 * Vẫn **hiện chứ không chặn**: app không phán xử giấy phép, nhưng giấu hẳn thì user không biết
 * mình đang dùng model tác giả cấm dùng thương mại. `<details>` giữ đúng cân bằng đó, và là thẻ
 * HTML sẵn có nên có bàn phím + đọc màn hình miễn phí.
 */
function ModelInfo({ model }: { readonly model: VrmModelDto }) {
  const mb = (model.sizeBytes / 1024 / 1024).toFixed(1)
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-1.5">
        <span className="text-content min-w-0 flex-1 truncate text-xs font-medium" title={model.path}>
          {model.label}
        </span>
        <span className="text-subtle shrink-0 text-[10px] group-open:hidden">Chi tiết ▾</span>
        <span className="text-subtle hidden shrink-0 text-[10px] group-open:inline">Thu gọn ▴</span>
      </summary>
      <div className="text-subtle mt-1 space-y-0.5 text-[11px]">
        <div>
          VRM {model.spec} · {mb} MB
          {model.meta.author ? ` · ${model.meta.author}` : ''}
        </div>
        {model.meta.commercialUse && <div>Dùng thương mại: {model.meta.commercialUse}</div>}
        {model.meta.licenseUrl && (
          <div className="truncate" title={model.meta.licenseUrl}>
            Giấy phép: {model.meta.licenseUrl}
          </div>
        )}
      </div>
    </details>
  )
}

function pickError(reason: string, detail?: string): string {
  switch (reason) {
    case 'notVrm':
      // Ca thật hay gặp: file `.glb` xuất từ Blender chưa gắn phần mở rộng VRM
      return 'File này là glTF/GLB thường, chưa có dữ liệu VRM (xương, biểu cảm). Cần file xuất đúng định dạng VRM.'
    case 'tooLarge':
      return `File quá lớn${detail ? ` (${detail})` : ''} — giới hạn 200 MB.`
    case 'full':
      return 'Danh sách model đã đầy. Bỏ một model cũ trước khi thêm.'
    case 'badFile':
      return `File không đọc được (${detail ?? 'hỏng'}).`
    default:
      return `Không thêm được model${detail ? `: ${detail}` : ''}`
  }
}

/**
 * Bảng 🎬 Chuyển động — chọn một clip `.vrma` cho nhân vật diễn.
 *
 * Clip **tải theo yêu cầu**, không nằm trong bản cài: 13 clip ~4 MB, phần lớn user không bao giờ
 * mở bảng này. Chưa tải thì bảng chỉ có một nút tải cả bộ.
 *
 * Clip chọn tay **lặp mãi** cho tới khi bấm Dừng, khác hẳn clip tự chạy theo trạng thái (chạy một
 * lần rồi trả quyền lại cho chuyển động tự sinh). Ở đây user đang chủ động xem, nên dừng là việc
 * của họ.
 */
function VrmMotionPanel({
  motion,
  anchor,
  onClose,
  onSpeak
}: {
  readonly motion: VrmMotionApi
  readonly anchor: { left: number; top: number; width: number; height: number }
  readonly onClose: () => void
  readonly onSpeak: (text: string) => void
}) {
  const mb = (motionPackBytes() / 1024 / 1024).toFixed(1)
  const have = motion.installed.length > 0

  return (
    <VrmMiniPanel title="Chuyển động" anchor={anchor} onClose={onClose}>
      {!have ? (
        <div className="flex flex-col gap-2">
          <p className="text-subtle text-[11px] leading-relaxed">
            {motion.clips.length} chuyển động (CC0) — tải một lần rồi dùng mãi.
          </p>
          <button
            className="border-edge hover:bg-elevated rounded border px-3 py-1.5 text-xs disabled:opacity-50"
            disabled={motion.downloading}
            onClick={() => {
              void motion.download().then((ok) => {
                if (ok) onSpeak('Onii~ em học được vài động tác mới rồi nè~ 🎬')
              })
            }}
          >
            {motion.downloading ? 'Đang tải…' : `⬇ Tải bộ chuyển động (${mb} MB)`}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {motion.playing && (
            <button
              className="border-edge-strong bg-input hover:bg-hover mb-1 rounded border px-2 py-1 text-xs"
              onClick={motion.stop}
            >
              ■ Dừng, về bình thường
            </button>
          )}
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {motion.clips.map((c) => {
              const ready = motion.installed.includes(c.id)
              const on = motion.playing === c.id
              return (
                <button
                  key={c.id}
                  disabled={!ready}
                  title={
                    ready
                      ? `${c.durationSec.toFixed(1)}s · ${c.author} · ${c.license}`
                      : 'Chưa tải được clip này'
                  }
                  onClick={() => motion.playById(c.id)}
                  className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] disabled:opacity-40 ${
                    on ? 'bg-accent/30 text-content' : 'text-subtle hover:bg-base/60 hover:text-content'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{c.label}</span>
                  {/* Clip di chuyển: nhân vật rời khỏi chỗ đứng, nên báo trước chứ đừng để user
                      bấm rồi mới thấy nhân vật trôi ra khỏi khung */}
                  {c.locomotion && <span title="Nhân vật sẽ di chuyển khỏi chỗ đứng">🚶</span>}
                  <span className="shrink-0 tabular-nums opacity-60">{c.durationSec.toFixed(0)}s</span>
                </button>
              )
            })}
          </div>
          <p className="text-subtle mt-1 text-[10px] leading-relaxed">
            CC0 · へすい/rerofumi, sashii, JenJell
          </p>
        </div>
      )}
    </VrmMiniPanel>
  )
}
