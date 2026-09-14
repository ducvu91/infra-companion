import { useEffect, useRef, useState } from 'react'
import { expressionForEvent, statusForEvent, type AppEventDto } from '@infra/shared'
import { createVrmStage, type VrmStage } from '../lib/vrmStage'
import { VrmSpeechBubble } from './VrmRadialMenu'

/** Bong bóng tự tắt sau chừng này; cửa sổ thì main ẩn muộn hơn (15 s) để nhân vật còn đứng đó một lát. */
const BUBBLE_MS = 8_000
/** Khoảng trống phía trên khung model — chỗ cho bong bóng đứng trên đầu nhân vật. */
const HEAD_ROOM_PX = 56

/**
 * F70 — nhân vật NGOÀI desktop (route `#vrm-overlay`): cửa sổ trong suốt ở góc màn hình, chỉ
 * hiện khi app đang ở khay / thu nhỏ mà có thông báo. Main quyết định hiện/ẩn (`main/overlay.ts`);
 * ở đây chỉ dựng model, đổi biểu cảm và nói câu thông báo.
 *
 * Cố ý TỐI GIẢN so với `VrmPanel`: không menu, không chat, không kéo thả, không nhìn theo chuột.
 * Cửa sổ này nằm đè lên app KHÁC của user, càng ít thứ càng tốt — mọi tương tác là một cú click
 * đưa về cửa sổ chính, nơi có đủ mọi thứ.
 */
export function VrmOverlayApp() {
  const boxRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<VrmStage | null>(null)
  const [bubble, setBubble] = useState<{ id: number; text: string; severity: AppEventDto['severity'] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    let stage: VrmStage | null = null
    void (async () => {
      try {
        const s = await window.infra.vrm.getSettings()
        if (!s.activeId) throw new Error('no active model')
        const res = await window.infra.vrm.read(s.activeId)
        if (!res.ok) throw new Error(res.detail ?? res.reason)
        const box = boxRef.current
        if (ac.signal.aborted || !box) return
        stage = await createVrmStage(
          {
            container: box,
            bytes: res.bytes,
            fpsCap: 30,
            springBones: s.springBones,
            lookAtCursor: false,
            rotationY: s.rotationY
          },
          ac.signal
        )
        if (ac.signal.aborted) {
          stage.dispose()
          stage = null
          return
        }
        stageRef.current = stage

        // Khoác lại bộ đang mặc — cùng bước như `VrmPanel`; thiếu thì ngoài desktop nhân vật lại
        // mặc "đồ mặc định", trông như một nhân vật khác.
        const saved = await window.infra.vrm.listOutfits(s.activeId)
        if (ac.signal.aborted) return
        const worn = saved.outfits.find((o) => o.id === saved.wornId)
        if (worn) {
          const off = new Set(worn.hidden)
          for (const p of stage.listParts()) stage.setPartVisible(p.name, !off.has(p.name))
        }
        // Từ đây main mới gửi thông báo và cho cửa sổ hiện — hiện sớm hơn là một ô trống
        window.infra.vrmOverlay.ready()
      } catch (e) {
        if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      ac.abort()
      stage?.dispose()
      stageRef.current = null
    }
  }, [])

  // Thông báo tới: biểu cảm tức thời + dáng người giữ theo mức độ + bong bóng nói CHUYỆN GÌ.
  // Luôn hiện cái mới nhất, ghi đè cái đang hiện — cùng luật chống bão với `VrmPanel`.
  useEffect(
    () =>
      window.infra.vrmOverlay.onEvent((ev) => {
        stageRef.current?.playExpression(expressionForEvent(ev.kind, ev.severity))
        stageRef.current?.setStatus(statusForEvent(ev.kind, ev.severity))
        setBubble({ id: ev.id, text: ev.title, severity: ev.severity })
      }),
    []
  )

  useEffect(() => {
    if (!bubble) return
    const t = window.setTimeout(() => setBubble(null), BUBBLE_MS)
    return () => window.clearTimeout(t)
  }, [bubble?.id])

  const anchor = (): { left: number; top: number; width: number; height: number } => {
    const r = boxRef.current?.getBoundingClientRect()
    // Bong bóng tự lùi lên 56px so với `top` → đặt `top` sát mép trên khung là nó đứng ngay trên đầu
    return r
      ? { left: r.left, top: r.top + 8, width: r.width, height: r.height }
      : { left: 0, top: HEAD_ROOM_PX, width: window.innerWidth, height: window.innerHeight - HEAD_ROOM_PX }
  }

  return (
    <div
      className="relative h-full w-full cursor-pointer select-none"
      style={{ background: 'transparent' }}
      title="Mở Infra Companion"
      onClick={() => window.infra.vrmOverlay.open()}
      onPointerEnter={() => window.infra.vrmOverlay.hold()}
      onPointerLeave={() => window.infra.vrmOverlay.release()}
    >
      <div ref={boxRef} className="absolute inset-x-0 bottom-0" style={{ top: HEAD_ROOM_PX }} />
      {bubble && <VrmSpeechBubble text={bubble.text} severity={bubble.severity} anchor={anchor()} opaque />}
      {error && (
        // Lỗi nạp thì cửa sổ này không bao giờ được hiện (main chờ READY), dòng này chỉ để đọc khi debug
        <div className="text-subtle absolute bottom-2 left-2 text-[10px]">{error}</div>
      )}
    </div>
  )
}
