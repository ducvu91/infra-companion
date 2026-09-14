import { useCallback, useEffect, useRef, useState } from 'react'
import { nextMotionForRole, VRM_MOTIONS, type VrmMotionClip, type VrmMotionRole } from '@infra/shared'
import type { VrmStage } from './vrmStage'

/**
 * F70 — nối thư viện chuyển động `.vrma` vào nhân vật.
 *
 * Một hook thay vì rải lời gọi khắp `VrmPanel`: có **bốn** chỗ kích hoạt (chạm, mở chat, cảnh báo,
 * hết cảnh báo) và một lịch chạy nền, mà tất cả đều phải đi qua cùng một luật ưu tiên — clip đang
 * chạy thì không cho clip khác chen ngang, trừ khi cái mới quan trọng hơn.
 *
 * Bytes đọc qua main mỗi lần phát: giữ 13 clip trong RAM renderer là vài MB nằm chết suốt phiên,
 * mà một lượt đọc file cục bộ chỉ mất vài ms. Có nhớ đệm clip vừa dùng cho trường hợp bấm liên tục.
 */

/** Vai trò nào được phép cắt ngang vai trò nào — số lớn thắng. */
const PRIORITY: Record<VrmMotionRole, number> = {
  idle: 0,
  manual: 1,
  // Mở công cụ đọc lâu: trên idle nhưng dưới mọi thứ user vừa chạm vào
  inspect: 1,
  chat: 2,
  poke: 2,
  recover: 3,
  alert: 4
}

export interface VrmMotionApi {
  /** Clip đã tải về máy (theo id). */
  installed: string[]
  /** Toàn bộ danh mục — cho menu 🎬. */
  clips: readonly VrmMotionClip[]
  /** Đang tải bộ clip. */
  downloading: boolean
  /** Tải cả bộ; trả về `true` nếu không clip nào lỗi. */
  download: () => Promise<boolean>
  /** Chạy clip của một vai trò (nếu đã tải). Tự bỏ qua khi có clip ưu tiên cao hơn đang chạy. */
  play: (role: VrmMotionRole) => void
  /** Chạy đúng một clip theo id — user chọn trong menu, luôn thắng mọi thứ trừ cảnh báo. */
  playById: (id: string) => void
  /** Dừng clip, trả nhân vật về chuyển động tự sinh. */
  stop: () => void
  /** Clip đang chạy (id), `null` = đang dùng chuyển động tự sinh. */
  playing: string | null
}

export function useVrmMotion(stage: VrmStage | null, enabled: boolean): VrmMotionApi {
  const [installed, setInstalled] = useState<string[]>([])
  const [downloading, setDownloading] = useState(false)
  const [playing, setPlaying] = useState<string | null>(null)

  /** Vai trò của clip đang chạy + lúc nào nó kết thúc — để quyết cho chen ngang hay không. */
  const current = useRef<{ role: VrmMotionRole; until: number } | null>(null)
  const cache = useRef(new Map<string, Uint8Array>())
  /** Clip vừa chạy của TỪNG vai trò — để xoay vòng, xem `nextMotionForRole`. */
  const lastByRole = useRef(new Map<VrmMotionRole, string>())
  const stopTimer = useRef<number | null>(null)

  useEffect(() => {
    void window.infra.vrm.listMotions().then((r) => setInstalled(r.installed))
  }, [])

  const stop = useCallback(() => {
    if (stopTimer.current !== null) {
      clearTimeout(stopTimer.current)
      stopTimer.current = null
    }
    current.current = null
    setPlaying(null)
    void stage?.playAnimation(null)
  }, [stage])

  /** Nạp bytes (ưu tiên nhớ đệm) rồi phát. `loop` chỉ dùng cho clip user tự chọn. */
  const run = useCallback(
    (clip: VrmMotionClip, loop: boolean) => {
      const go = (bytes: Uint8Array): void => {
        /**
         * **Neo tại chỗ trừ clip di chuyển do user tự chọn.**
         *
         * Đa số clip dời cả người đi (đo được `reaction-startle` 39 cm, `pose-motion` 36 cm), mà
         * khung hình ôm sát thân nên nhân vật đi thẳng ra ngoài. Clip `walk`/`run` thì ngược lại:
         * user chọn chúng CHÍNH VÌ muốn thấy nhân vật đi, neo lại là làm hỏng điều họ muốn xem.
         */
        void stage?.playAnimation(bytes, { once: !loop, anchor: !(loop && clip.locomotion) })
        setPlaying(clip.id)
        current.current = { role: clip.role, until: performance.now() + clip.durationSec * 1000 }
        if (stopTimer.current !== null) clearTimeout(stopTimer.current)
        /**
         * Hẹn giờ dọn state **dài hơn clip một chút**: stage tự gỡ mixer khi clip hết (`once`),
         * nhưng React vẫn nghĩ đang chạy nên nút trong menu kẹt ở trạng thái sáng.
         */
        stopTimer.current = loop
          ? null
          : window.setTimeout(() => {
              stopTimer.current = null
              current.current = null
              setPlaying(null)
            }, clip.durationSec * 1000 + 120)
      }
      const hit = cache.current.get(clip.id)
      if (hit) {
        go(hit)
        return
      }
      void window.infra.vrm.readMotion(clip.id).then((r) => {
        if (!r.ok) return
        cache.current.set(clip.id, r.bytes)
        go(r.bytes)
      })
    },
    [stage]
  )

  const play = useCallback(
    (role: VrmMotionRole) => {
      if (!enabled || !stage) return
      // Xoay vòng trong nhóm clip của vai trò đó — `idle` có hai clip luân phiên
      const clip = nextMotionForRole(role, lastByRole.current.get(role) ?? null, installed)
      if (!clip) return
      // Clip đang chạy còn hạn và ưu tiên cao hơn (hoặc bằng) → để yên, đừng cắt ngang
      const cur = current.current
      if (cur && performance.now() < cur.until && PRIORITY[cur.role] >= PRIORITY[role]) return
      lastByRole.current.set(role, clip.id)
      run(clip, false)
    },
    [enabled, stage, installed, run]
  )

  const playById = useCallback(
    (id: string) => {
      if (!stage) return
      const clip = VRM_MOTIONS.find((c) => c.id === id)
      if (!clip || !installed.includes(id)) return
      // User chọn tay → lặp, và chỉ dừng khi họ bảo dừng
      run(clip, true)
    },
    [stage, installed, run]
  )

  const download = useCallback(async () => {
    setDownloading(true)
    try {
      const r = await window.infra.vrm.downloadMotions()
      setInstalled(r.installed)
      return r.ok
    } finally {
      setDownloading(false)
    }
  }, [])

  // Panel đóng giữa lúc đang chạy clip → dọn hẹn giờ, không để nó nổ vào một stage đã biến mất
  useEffect(
    () => () => {
      if (stopTimer.current !== null) clearTimeout(stopTimer.current)
    },
    []
  )

  return { installed, clips: VRM_MOTIONS, downloading, download, play, playById, stop, playing }
}
