/**
 * F70 — sân khấu 3D cho nhân vật VRM. **Không phụ thuộc React**: một lớp thuần với
 * `mount`/`dispose`, để component chỉ còn việc gọi và dọn.
 *
 * Vì sao tách khỏi component: three.js giữ tài nguyên GPU (geometry, texture, render target)
 * mà garbage collector của JS **không** thu hồi — phải gọi `.dispose()` tay. Trộn chuyện đó
 * vào một component React có `StrictMode` (mount hai lần ở dev) là cách chắc chắn nhất để rò
 * VRAM: mỗi lần mở panel thêm một scene 44 MB texture còn treo. Tách ra thì vòng đời rõ ràng
 * và cái `dispose()` không bị lẫn giữa các `useEffect`.
 *
 * Thư viện được **nạp động** (`import()` trong `create()`) — `three` + `@pixiv/three-vrm` là
 * ~1,2 MB sau minify, và phần lớn user không bao giờ mở nhân vật. Nạp thẳng ở đầu file là bắt
 * mọi người trả phí cho tính năng của vài người.
 */

import {
  armSignFor,
  damp,
  FINGER_CURL,
  FINGER_CURL_RIGHT_SCALE,
  FINGER_JOINTS,
  frameDistance,
  elbowDrift,
  elbowDriftReach,
  lookArmOffset,
  LOOK_ARM,
  MICRO_ARM,
  NATURAL_REST,
  newArmSwing,
  newTug,
  restTarget,
  solveTwoBoneIk,
  SPIN_MS,
  spinAngle,
  spinDelayMs,
  stepArmSwing,
  stepTug,
  WEIGHT_SHIFT_ARM,
  type ArmRestSide,
  isClaimedByHigher,
  isDoubleBlink,
  nextActionAt,
  pickReaction,
  pulse,
  smoothStep,
  STATUS_HOLD_MS,
  type AvatarStatus,
  type BoneGroup,
  type Layer,
  type Reaction
} from '@infra/shared'

/** FPS mặc định. 30 đủ mượt cho nhân vật đứng yên và tiết kiệm rõ so với 60. */
export type FpsCap = 30 | 60

/**
 * Chế độ lớp tay — để CHẨN ĐOÁN "model gốc cong tay hay animation làm cong".
 *
 * - `zero`: mọi xương tay/ngón về rotation 0 → thấy rest pose **thật** của rig (T-pose nếu rig chuẩn).
 * - `rest`: IK tư thế nghỉ ĐỨNG YÊN — không sway, không vi chuyển động, không dồn trọng tâm (§20).
 * - `natural`: đầy đủ.
 *
 * `zero` và `rest` chỉ dùng lúc đo; mặc định `natural`.
 */
export type ArmMode = 'zero' | 'rest' | 'natural'

/** Công tắc chẩn đoán từng lớp của tay (§19). Mặc định tất cả bật, `showTargets` tắt. */
export interface ArmDebugFlags {
  arms: boolean
  hands: boolean
  fingers: boolean
  weightShift: boolean
  micro: boolean
  interaction: boolean
  /** Tay đu theo quán tính khi thân xoay (Shift+kéo, vòng tự xoay). */
  swing: boolean
  /** Khuỷu trôi quanh trục vai→tay + tay đưa theo hướng nhìn. */
  elbow: boolean
  /** Hiện cầu xanh = đích bàn tay, cầu cam = khuỷu IK — để căn chỉnh bằng mắt. */
  showTargets: boolean
}

/**
 * Lề bề ngang cộng thêm sau khi đo, cho tóc/váy vung ra lúc chuyển động.
 *
 * Đo thật: bề ngang lúc động nở tới 30% so với tư thế nghỉ. 18% là chỗ cân bằng — đủ để không
 * cắt tay/tóc trong phần lớn thời gian, mà không để thừa khoảng trống lớn hai bên (khoảng
 * trống ấy vẫn nuốt chuột vì vùng nhận chuột là hình chữ nhật).
 */
/**
 * Lề bề ngang cộng thêm sau khi đo ở tư thế NGHỈ.
 *
 * **2,2 chứ không 1,18**: 18% đủ cho tóc/váy vung theo nhịp idle, nhưng từ khi có clip `.vrma`
 * thì nhân vật còn dang tay và giơ tay lên. Đo bề ngang thật (khoảng cách hai bàn tay) trên
 * Sendagaya Shino, lấy tỉ lệ so với lúc đứng yên:
 *
 * | clip | cần lề |
 * |---|---|
 * | xem điện thoại | 0,92× |
 * | đứng thư giãn  | 1,32× |
 * | tạo dáng       | 1,92× |
 * | ăn mừng        | 2,16× |
 * | máy bay        | **3,55×** |
 *
 * Chọn 2,2 — đủ cho mọi clip tự chạy. Không chọn 3,55 vì khung rộng gấp 3,5 lần thân người thì
 * lúc đứng yên (99% thời gian) nhân vật teo lại thành một hình bé tí giữa khung, và khung càng
 * to càng nuốt nhiều vùng click của app phía dưới. Clip "máy bay" vì thế chuyển sang nhóm chọn
 * tay — user bấm xem thì chấp nhận tay hơi chạm mép, còn clip tự chạy thì không được cắt.
 */
const WIDTH_MARGIN = 2.2

export interface VrmStageOptions {
  /**
   * Thẻ CHỨA canvas, không phải canvas.
   *
   * Stage tự tạo `<canvas>` riêng cho mỗi lần dựng và tự gỡ lúc `dispose()`. Bắt buộc phải
   * vậy: `dispose()` gọi `forceContextLoss()` để trả context WebGL (Chromium chỉ cho ~16 cái),
   * mà thao tác đó **giết vĩnh viễn** context của thẻ canvas đó — tái dùng đúng thẻ ấy cho
   * model kế tiếp thì `new WebGLRenderer` không lấy được context và three ném
   * `Cannot read properties of null (reading 'precision')`. Đã gặp thật khi đổi model.
   */
  container: HTMLElement
  /** Bytes của file `.vrm` — main đọc từ đĩa rồi đưa sang. */
  bytes: Uint8Array
  fpsCap: FpsCap
  springBones: boolean
  lookAtCursor: boolean
  rotationY: number
  /** Báo tiến độ nạp để UI không đứng im trong 2–5 giây giải nén 44 MB. */
  onProgress?: (ratio: number) => void
}

/** Một mesh bật/tắt được trong model (mũ, áo khoác, phụ kiện…). */
export interface VrmPart {
  name: string
  visible: boolean
}

export interface VrmStage {
  /** Gọi khi kích thước khung đổi (kéo grip resize / bấm ⛶). */
  resize(width: number, height: number): void
  setFpsCap(cap: FpsCap): void
  setSpringBones(on: boolean): void
  /**
   * Tỉ lệ ngang/dọc THẬT của model (bề ngang ÷ chiều cao), đo sau khi đã hạ tay.
   *
   * Nơi gọi dùng số này để đặt bề rộng khung ôm sát thân người. Không đoán được từ ngoài:
   * mỗi model một dáng (váy xoè, tóc dài, phụ kiện), và đoán hụt thì hoặc thừa khoảng trống
   * hai bên, hoặc **cắt mất tay/váy** — mà cắt thì không có lỗi nào báo.
   */
  readonly aspect: number
  setRotationY(rad: number): void
  setLookAtCursor(on: boolean): void
  /**
   * Vị trí con trỏ trong khung, toạ độ chuẩn hoá [-1, 1] (gốc ở giữa). `null` = chuột ra
   * ngoài → nhân vật nhìn thẳng trở lại.
   */
  setCursor(nx: number | null, ny: number | null): void
  /** Chuột có đang chạm đúng thân người không (raycast), để nơi gọi đổi con trỏ / bắt click. */
  hitTest(nx: number, ny: number): boolean
  /**
   * Kéo trần (không Ctrl) = **níu nhân vật**: thân ngả theo hướng kéo, thả tay thì bật về.
   *
   * `frac` = độ lệch con trỏ so với điểm bấm, theo tỉ lệ bề rộng/cao khung; `null` = đã thả tay.
   * Không dời cửa sổ — dời cửa sổ nay là Ctrl+kéo, do React lo.
   */
  setTug(frac: { x: number; y: number } | null): void
  /**
   * Phản ứng khi bị chạm vào: **xoay người nhẹ về phía con trỏ rồi trả về chỗ cũ**, kèm ngoái
   * nhìn và biểu cảm.
   *
   * Đổi biểu cảm không thôi là quá kín đáo ở cỡ hiển thị này. Đã thử và bỏ hai kiểu: nhún dọc
   * (trông như bị đè) và lắc nghiêng qua lại (giật, vì nghiêng người là dáng mất thăng bằng).
   *
   * Mỗi lần bốc một kiểu khác trong `REACTIONS` (không trúng lại kiểu vừa dùng) và tự chọn
   * biểu cảm hợp kiểu đó — nơi gọi **không** cần truyền danh sách biểu cảm nữa.
   */
  poke(): void
  /**
   * Đặt trạng thái nhân vật theo tình hình hệ thống — một dáng người giữ liên tục
   * (`STATUS_HOLD_MS`), không phải một cú giật như `poke`.
   */
  setStatus(status: AvatarStatus): void
  /** Bật log trạng thái/hành động ra console (§12). Cờ dev, không lưu vào settings. */
  setDebug(on: boolean): void
  /**
   * Góc hiện tại của một xương chuẩn hoá — để **đo** chuyển động, không phải để điều khiển.
   *
   * Có mặt vì biên độ xương là thứ duy nhất chứng minh được bằng số hai điều ảnh chụp không
   * cho thấy: chân có đứng yên không (lỗi "treo cổ" đã gặp), và tầng ưu tiên thấp có thật sự
   * nhường nhóm xương cho tầng cao không. `null` nếu model không có xương đó.
   */
  readBone(name: string): { x: number; y: number; z: number } | null
  /**
   * Ép một cử chỉ nhỏ chạy ngay, thay vì chờ 15–30 giây tới lượt của nó.
   *
   * Chỉ để **đo**: không có cách nào khác kiểm chứng rằng lúc cử chỉ bắt đầu và kết thúc,
   * chuyển động không bị giật — mà đó đúng là chỗ dễ giật nhất.
   */
  triggerMicro(): void
  /** Ép tự xoay một vòng ngay, thay vì chờ 2–3 phút — để xem thử từ console. */
  triggerSpin(): void
  /** Chế độ lớp tay để chẩn đoán — xem `ArmMode`. */
  setArmMode(mode: ArmMode): void
  /** Bật/tắt từng lớp của tay và hiện đích IK/khuỷu (§19). Truyền một phần, phần còn lại giữ. */
  setArmDebug(flags: Partial<ArmDebugFlags>): void
  /** Quaternion THẾ GIỚI của một xương chuẩn hoá — để đo hướng lòng bàn tay, ngón. */
  readBoneWorldQuat(name: string): { x: number; y: number; z: number; w: number } | null
  /**
   * Toạ độ THẾ GIỚI của một xương chuẩn hoá.
   *
   * `readBone` chỉ cho góc cục bộ — không nói được cẳng tay có hướng xuống hay bàn tay có nằm
   * cạnh đùi không. Muốn trả lời hai câu đó bằng số thì phải so vị trí thế giới của
   * vai/khuỷu/bàn tay/đùi với nhau.
   */
  readBoneWorld(name: string): { x: number; y: number; z: number } | null
  /**
   * Chơi một biểu cảm trong ~2 giây rồi tự về thường.
   *
   * Nhận DANH SÁCH tên theo thứ tự ưu tiên vì model chỉ khai những biểu cảm tác giả muốn, và
   * `setValue` với tên không tồn tại là **no-op im lặng**. Trả về tên đã dùng được, `null`
   * nếu model không có tên nào trong danh sách.
   */
  playExpression(names: readonly string[]): string | null
  /** Danh sách biểu cảm model thật sự khai. */
  listExpressions(): string[]
  /** Các mesh bật/tắt được (trang phục, phụ kiện). */
  listParts(): VrmPart[]
  setPartVisible(name: string, visible: boolean): void
  /** Nạp file animation `.vrma`; `null` để trở về chuyển động idle tự sinh. */
  /**
   * Chạy một file `.vrma`. `null` = tắt, về chuyển động tự sinh.
   *
   * `once` = chạy đúng một lượt rồi **tự trả quyền** cho lớp idle — dùng cho phản ứng (giật mình,
   * ăn mừng). Không có `once` thì clip lặp mãi và nhân vật mất hết phản ứng, chỉ hợp khi user
   * chủ động chọn một chuyển động để xem.
   *
   * `anchor` = **ghim nhân vật tại chỗ**. Bắt buộc cho clip tự chạy: nhiều clip dời cả người đi
   * tới 39 cm ngang, mà khung hình ôm sát thân nên nhân vật đi thẳng ra ngoài rồi mới quay lại.
   */
  playAnimation(bytes: Uint8Array | null, opts?: { once?: boolean; anchor?: boolean }): Promise<void>
  /** Dừng vòng lặp render và giải phóng toàn bộ tài nguyên GPU. */
  dispose(): void
}

/**
 * Dựng sân khấu và nạp model. Throw nếu nạp thất bại — nơi gọi hiện lỗi cho user.
 *
 * Chú ý `AbortSignal`: nạp một model 44 MB mất vài giây, đủ để user đóng panel giữa lúc chờ.
 * Không có tín hiệu huỷ thì `create()` vẫn dựng xong một scene rồi không ai dọn.
 */
export async function createVrmStage(opts: VrmStageOptions, signal?: AbortSignal): Promise<VrmStage> {
  const [THREE, vrmMod] = await Promise.all([import('three'), import('@pixiv/three-vrm')])
  if (signal?.aborted) throw new Error('aborted')

  const { container, bytes } = opts

  // Canvas MỚI cho mỗi lần dựng (xem `container` ở phần khai options): canvas đã bị
  // `forceContextLoss()` thì không bao giờ lấy lại được context nữa.
  const canvas = document.createElement('canvas')
  canvas.className = 'absolute inset-0 size-full'
  container.appendChild(canvas)

  const width = Math.max(1, container.clientWidth)
  const height = Math.max(1, container.clientHeight)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setSize(width, height, false)
  // Trần 2: màn hình 4K với devicePixelRatio 3 khiến số pixel phải vẽ tăng 9 lần mà
  // mắt gần như không thấy khác — đây là nguồn tụt FPS phổ biến nhất của three.js.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()

  // Nền TRONG SUỐT (alpha) để panel giữ được màu theme thay vì một ô xám giữa app
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 20)
  camera.position.set(0, 1.3, 2.2)
  camera.lookAt(0, 1.25, 0)

  // MToon (VRM 1.0) cần đủ sáng mới ra màu như tác giả vẽ; ánh sáng bán cầu + một đèn hướng
  // là cấu hình tối giản mà không bị bết đen ở mặt sau.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.2))
  const key = new THREE.DirectionalLight(0xffffff, 1.0)
  key.position.set(1, 2, 2)
  scene.add(key)

  /**
   * Dọn khi dựng THẤT BẠI giữa chừng.
   *
   * Mọi đường thoát phải đi qua đây: bỏ sót một chỗ là để lại một thẻ `<canvas>` chết cùng
   * một context WebGL chưa trả — mà Chromium chỉ cho ~16 context, nên vài lần nạp lỗi là
   * canvas sau đó hoá đen với lỗi trông như "ngẫu nhiên".
   */
  function abortSetup(): void {
    renderer.dispose()
    renderer.forceContextLoss()
    canvas.remove()
  }

  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  if (signal?.aborted) {
    abortSetup()
    throw new Error('aborted')
  }

  const loader: InstanceType<typeof GLTFLoader> = new GLTFLoader()
  /**
   * `VRMLoaderPlugin` là phần KHÔNG ĐƯỢC BỎ. GLTFLoader trần vẫn nạp ra hình học, nhưng mất
   * MToon (nhân vật thành nhựa bóng), mất humanoid (không xoay được đầu) và mất springBone —
   * hỏng mà không báo lỗi, đúng loại lỗi im lặng ở mục 8 CLAUDE.md.
   */
  loader.register((parser) => new vrmMod.VRMLoaderPlugin(parser))

  // Nạp từ bytes trong RAM: tạo blob URL thay vì ghi file tạm. CSP đã cho `connect-src blob:`.
  const blobUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'model/gltf-binary' }))
  let gltf: Awaited<ReturnType<typeof loader.loadAsync>>
  try {
    gltf = await loader.loadAsync(blobUrl, (ev) => {
      if (ev.total > 0) opts.onProgress?.(ev.loaded / ev.total)
    })
  } catch (e) {
    // File hỏng cũng phải trả context, không chỉ thu hồi blob
    abortSetup()
    throw e
  } finally {
    // Thu hồi ngay khi parse xong — blob URL giữ 44 MB sống tới khi tab đóng nếu quên
    URL.revokeObjectURL(blobUrl)
  }

  const maybeVrm = gltf.userData.vrm as import('@pixiv/three-vrm').VRM | undefined
  if (!maybeVrm) {
    abortSetup()
    throw new Error('File nạp được nhưng không chứa dữ liệu VRM')
  }
  // Gán sang const đã hẹp kiểu: các closure bên dưới (idle/tick/dispose) sống lâu hơn lần
  // kiểm này, mà TS không giữ được narrowing của một biến `let` qua closure.
  const vrm = maybeVrm
  if (signal?.aborted) {
    vrmMod.VRMUtils.deepDispose(vrm.scene)
    abortSetup()
    throw new Error('aborted')
  }

  // Gộp các skeleton trùng + xoá node không dùng: giảm số draw call đáng kể trên model
  // nhiều "toggle" trang phục (model thật đo được 16 mesh / 19 material).
  vrmMod.VRMUtils.combineSkeletons(gltf.scene)
  vrmMod.VRMUtils.removeUnnecessaryJoints(gltf.scene)

  // VRM 0.x quay mặt về +Z, bản 1.0 về -Z. `rotateVRM0` xoay 180° cho bản cũ để cả hai
  // cùng nhìn vào camera — bỏ bước này thì model 0.x quay lưng lại người dùng.
  vrmMod.VRMUtils.rotateVRM0(vrm)

  scene.add(vrm.scene)

  type BoneName = Parameters<NonNullable<typeof vrm.humanoid>['getNormalizedBoneNode']>[0]
  type Obj3D = import('three').Object3D
  type Vec3 = import('three').Vector3
  const bone = (b: BoneName): Obj3D | null => vrm.humanoid?.getNormalizedBoneNode(b) ?? null
  /**
   * Dấu lật trục cho euler còn dùng (vai, ngón): VRM 0.x có khung cục bộ xoay 180° quanh Y so
   * với 1.0 nên góc quanh Z đổi dấu — đo được, xem `armSignFor`. Tay/khuỷu/cổ tay KHÔNG dùng
   * dấu này nữa: IK tính hướng trong khung model rồi đổi ra quaternion cục bộ qua cha.
   */
  const armSign = armSignFor(vrm.meta.metaVersion)

  /**
   * Góc GỐC của scene (`rotateVRM0` đã xoay 180° cho model 0.x). Bắt ở ĐÂY — trước mọi phép đo
   * hướng xương — vì `modelFrame` dưới đây dựa vào nó.
   */
  const baseRotationY = vrm.scene.rotation.y

  /**
   * ==== KHUNG MODEL ====
   *
   * Một node con của `vrm.scene`, xoay `baseRotationY`: trong khung này model LUÔN nhìn về +Z dù
   * rig 1.0 hay 0.x, và khung quay theo model khi user Shift+kéo hay lúc tự xoay. Mọi hướng của
   * IK (xuống, ra trước, ra ngoài) tính trong khung này rồi mới đổi ra quaternion cục bộ qua
   * cha — **không giả định trục cục bộ của xương**. Bản euler cũ sai dấu hai trục trên 0.x đúng
   * vì nó giả định.
   */
  const modelFrame = new THREE.Object3D()
  modelFrame.rotation.y = baseRotationY
  vrm.scene.add(modelFrame)
  vrm.scene.updateMatrixWorld(true)

  /** Vị trí một xương trong khung model — `out` truyền vào để không cấp phát mỗi frame. */
  const toModel = (n: Obj3D, out: Vec3): Vec3 => modelFrame.worldToLocal(n.getWorldPosition(out))

  /**
   * Chuỗi xương một tay + hướng NGHỈ từng khúc trong khung model, bắt lúc rig còn identity (đo
   * được: rotation 0 = T-pose ở cả hai rig — xem memory mục 32).
   *
   * Hướng nghỉ + hướng đích → quaternion, không cần biết trục cục bộ của rig. Lòng bàn tay nghỉ
   * lấy là (0,−1,0): quy ước T-pose VRM úp lòng bàn tay xuống — được KIỂM bằng ảnh, sai thì lật.
   */
  interface ArmRig {
    /** Bên nào theo hình học (dấu x của khớp vai trong khung model) — không giả định trái = +x. */
    sideX: 1 | -1
    shoulder: Obj3D | null
    upper: Obj3D
    lower: Obj3D
    hand: Obj3D
    hip: Obj3D
    restUpper: Vec3
    restLower: Vec3
    restHand: Vec3
    /**
     * HƯỚNG NGHỈ của xương (quaternion thế giới lúc rig identity), đổi về khung model.
     *
     * Không phải identity trên 0.x: cha của xương tay đã mang `Ry(π)` từ `rotateVRM0`. Bản đầu
     * bỏ qua thừa số này → trục xương lật 180°, tay Carlotta chỉ THẲNG LÊN TRỜI (đo: tay trên
     * lệch dọc 154°, bàn tay cao hơn háng 81 cm). 1.0 thì identity nên không lộ.
     */
    restQUpper: import('three').Quaternion
    restQLower: import('three').Quaternion
    restQHand: import('three').Quaternion
    lenA: number
    lenB: number
    fingers: Array<{ joints: Array<Obj3D | null>; curl: readonly [number, number, number] }>
  }
  function captureArm(side: 'left' | 'right'): ArmRig | null {
    const upper = bone(`${side}UpperArm`)
    const lower = bone(`${side}LowerArm`)
    const hand = bone(`${side}Hand`)
    const hip = bone(`${side}UpperLeg`)
    if (!upper || !lower || !hand || !hip) return null
    const S = toModel(upper, new THREE.Vector3())
    const E = toModel(lower, new THREE.Vector3())
    const W = toModel(hand, new THREE.Vector3())
    const tip = bone(`${side}MiddleProximal`)
    const restUpper = E.clone().sub(S)
    const restLower = W.clone().sub(E)
    const lenA = restUpper.length()
    const lenB = restLower.length()
    if (lenA < 1e-4 || lenB < 1e-4) return null
    const mInv = modelFrame.getWorldQuaternion(new THREE.Quaternion()).invert()
    const restQ = (b: Obj3D): import('three').Quaternion => mInv.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion()))
    return {
      sideX: S.x >= 0 ? 1 : -1,
      shoulder: bone(`${side}Shoulder`),
      upper,
      lower,
      hand,
      hip,
      restUpper: restUpper.normalize(),
      restLower: restLower.normalize(),
      restHand: tip ? toModel(tip, new THREE.Vector3()).sub(W).normalize() : restLower.clone(),
      restQUpper: restQ(upper),
      restQLower: restQ(lower),
      restQHand: restQ(hand),
      lenA,
      lenB,
      fingers: (Object.keys(FINGER_JOINTS) as Array<keyof typeof FINGER_JOINTS>).map((f) => ({
        joints: FINGER_JOINTS[f].map((j) => bone(`${side}${j}` as BoneName)),
        curl: FINGER_CURL[f]
      }))
    }
  }
  const arms = { left: captureArm('left'), right: captureArm('right') }

  /** Vai: vẫn euler cộng thêm vào góc gốc (không gán đè — bẫy `hipsRest` cũ). */
  const lShoulder = arms.left?.shoulder ?? null
  const rShoulder = arms.right?.shoulder ?? null
  const restOf = (n: { rotation: { x: number; y: number; z: number } } | null): { x: number; y: number; z: number } =>
    n ? { x: n.rotation.x, y: n.rotation.y, z: n.rotation.z } : { x: 0, y: 0, z: 0 }
  const lShoulderRest = restOf(lShoulder)
  const rShoulderRest = restOf(rShoulder)

  /** Tốc độ đầu đuổi theo con trỏ (1/giây) — tương đương lerp 12%/frame ở 60fps. */
  const AIM_SPEED = 7.7

  /**
   * Căn camera theo KHUNG BAO THẬT của model, không dùng số cố định: mỗi tác giả làm một
   * chiều cao khác nhau (và nhiều model có tóc/phụ kiện cao vượt đầu), nên camera cố định là
   * cách chắc chắn để có model bị cắt đầu hoặc lọt thỏm.
   */
  const box = new THREE.Box3().setFromObject(vrm.scene)
  const modelHeight = box.max.y - box.min.y
  vrm.scene.position.y -= box.min.y

  /**
   * Khung hình TOÀN THÂN: từ chân (y=0 sau khi hạ model xuống trên) tới đỉnh đầu.
   *
   * Từng lấy nửa trên người vì panel chỉ rộng 320px, nhưng như vậy nhân vật bị cắt ngang đùi
   * và trông như đang nằm trong một ô cửa sổ — đúng thứ user phàn nàn. Khung dọc hẹp + cao
   * hợp với dáng người nên toàn thân vẫn đủ lớn để nhìn.
   */
  let targetY = modelHeight / 2
  let frameH = modelHeight * 1.08 // chừa lề trên/dưới
  /**
   * Khoảng cách phải thoả **cả hai** chiều, không chỉ chiều dọc.
   *
   * `camera.fov` là FOV DỌC, nên tính theo mình nó thì khung ngang hẹp (panel dọc) sẽ cắt mất
   * hai bên — váy xoè hoặc tay dang ra là thấy ngay. Lấy khoảng cách lớn hơn giữa hai ràng
   * buộc để model luôn lọt trọn.
   */
  /**
   * Bề ngang thật của nhân vật, **đo từ pixel đã vẽ**, theo đơn vị scene.
   *
   * Không dùng `box.max.x - box.min.x`: với skinned mesh, `Box3.setFromObject` lấy theo
   * **bind pose** — tức T-pose tay giang ngang — nên rộng gần gấp đôi thân người sau khi đã
   * hạ tay. Camera căn theo số đó thì lùi xa vô cớ và nhân vật teo lại giữa khung; khung dựng
   * theo số đó thì thừa một khoảng trống lớn hai bên mà vẫn nuốt chuột. Không lỗi nào báo.
   *
   * Chỉ lấy bề ngang theo X, **không** gộp chiều sâu Z: camera nhìn dọc Z nên độ dày
   * trước-sau không chiếm pixel ngang nào.
   */
  let bbW = box.max.x - box.min.x
  /**
   * Tính lại MỖI LẦN đổi cỡ, không một lần lúc dựng: `aspect` nằm trong ràng buộc ngang, nên
   * kéo panel hẹp lại mà giữ nguyên khoảng cách là cắt mất hai bên người.
   */
  function frameCamera(): void {
    /**
     * Camera LUÔN ôm trọn nhân vật — zoom **không** đụng tới khoảng cách này.
     *
     * Phóng to đã được làm bằng cách cho khung DOM to ra (nơi gọi nhân kích thước với `zoom`),
     * mà khung to thì `resize()` đã đẩy số pixel lớn hơn vào đây. Nếu camera cũng tiến sát
     * thêm một lần nữa thì hai phép nhân chồng lên nhau: ở zoom 2 là phóng 4 lần — đo thật
     * ra cận cảnh cái váy, mất cả đầu lẫn chân.
     */
    const dist = frameDistance({ frameH, bbW, fovDeg: camera.fov, aspect: camera.aspect })
    camera.position.set(0, targetY, dist)
    camera.lookAt(0, targetY, 0)
  }
  frameCamera()

  let springOn = opts.springBones
  let frameMs = 1000 / opts.fpsCap
  let raf = 0
  let last = performance.now()
  let acc = 0
  const clock = new THREE.Clock()
  /** `AnimationMixer` khi đang chạy file `.vrma`; `null` = dùng chuyển động idle tự sinh. */
  let mixer: import('three').AnimationMixer | null = null
  /**
   * Mốc kết thúc clip chạy-một-lần (`playAnimation(bytes, { once: true })`); 0 = clip lặp mãi.
   *
   * Dùng đồng hồ chứ không nghe sự kiện `finished` của mixer: sự kiện đó chỉ báo action dừng,
   * còn `mixer` vẫn treo ở đó và `tick` vẫn bỏ qua toàn bộ lớp tự sinh — nhân vật sẽ đứng chết
   * ở frame cuối. Phải **gỡ hẳn** mixer mới trả được quyền cho lớp idle.
   */
  let clipEndsAt = 0
  /** Giữ nhân vật tại chỗ trong lúc clip chạy — xem chú thích ở `tick`. */
  let anchorHips = false
  /**
   * ==== "Chuột có đang trên người không" — KHÔNG dùng raycast ====
   *
   * `Raycaster.intersectObject(scene, true)` quét **từng tam giác** của skinned mesh, và với model
   * nhiều đỉnh thì đo được **277 ms MỘT LẦN GỌI** (Lily: 921k đỉnh; Carlotta 1,1M đỉnh: 181 ms).
   * Mỗi cú kéo/di chuột gọi nó nhiều lần → chính là "kéo giật giật, xoay không nổi" mà user báo.
   * three.js không dựng BVH cho skinned mesh, và `boundingBox` của nó lấy theo **bind pose**
   * (T-pose, tay giang) nên cũng không cứu được.
   *
   * Thay bằng **hộp bao xương**: lấy vị trí các xương chuẩn hoá (~20 điểm, đã có sẵn `matrixWorld`
   * từ `writePose` của frame này), chiếu sang toạ độ màn hình rồi kiểm con trỏ có nằm trong hộp
   * đó không, nới thêm một biên cho phần thịt/tóc/váy quanh xương.
   *
   * Đánh đổi **có chủ ý**: hộp rộng hơn thân người thật, nên bấm vào sát mép váy vẫn tính là trúng.
   * Đổi lại nó chạy dưới 0,05 ms. Với việc đang cần — "bấm trúng người hay bấm ra nền" — thì sai
   * vài pixel ở mép không ai nhận ra, còn trễ 277 ms thì ai cũng thấy.
   */
  const HIT_BONES = [
    'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
    'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
    'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
    'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
    'rightUpperLeg', 'rightLowerLeg', 'rightFoot'
  ] as const
  /** Nới hộp ra bao nhiêu phần khung — bù phần tóc/váy/áo choàng không có xương. */
  const HIT_PAD = 0.12
  /**
   * Nới thêm phía TRÊN: xương `head` nằm ở **chân sọ**, còn đỉnh đầu, tóc mái, tai thú, phụ kiện
   * thì cao hơn nhiều và không có xương nào ở đó. Đo thật trên Lily: bấm đỉnh đầu bị trả "trượt"
   * với biên 0,12 — mà đó đúng là chỗ người ta hay chạm vào nhân vật nhất.
   */
  const HIT_PAD_TOP = 0.42
  const vHit = new THREE.Vector3()
  /** Hộp đã chiếu của frame này (toạ độ chuẩn hoá [-1,1]); dựng lại mỗi frame, dùng lại trong frame. */
  let hitBox: { minX: number; maxX: number; minY: number; maxY: number } | null = null
  let hitBoxFrame = -1
  let frameNo = 0

  function hitTestFast(nx: number, ny: number): boolean {
    if (hitBoxFrame !== frameNo) {
      hitBoxFrame = frameNo
      let minX = Infinity
      let maxX = -Infinity
      let minY = Infinity
      let maxY = -Infinity
      for (const name of HIT_BONES) {
        const b = vrm.humanoid?.getNormalizedBoneNode(name as never)
        if (!b) continue
        b.getWorldPosition(vHit).project(camera)
        if (vHit.x < minX) minX = vHit.x
        if (vHit.x > maxX) maxX = vHit.x
        if (vHit.y < minY) minY = vHit.y
        if (vHit.y > maxY) maxY = vHit.y
      }
      // Không có xương nào (rig lạ) → coi như trúng: thà phản ứng thừa còn hơn nhân vật "chết",
      // bấm mãi không ăn mà chẳng có lỗi nào báo
      hitBox =
        minX === Infinity
          ? null
          : { minX: minX - HIT_PAD, maxX: maxX + HIT_PAD, minY: minY - HIT_PAD, maxY: maxY + HIT_PAD_TOP }
    }
    if (!hitBox) return true
    return nx >= hitBox.minX && nx <= hitBox.maxX && ny >= hitBox.minY && ny <= hitBox.maxY
  }

  /**
   * Các mesh bật/tắt được (mũ, áo khoác, phụ kiện).
   *
   * Chỉ lấy mesh có tên và **bỏ phần thân/mặt**: tắt nhầm body là nhân vật biến mất một nửa
   * mà user không hiểu vì sao. Lọc theo tên là cách duy nhất có được — glTF không đánh dấu
   * "đây là trang phục", nên đành dựa vào quy ước đặt tên của tác giả.
   */
  const BODY_WORDS = /body|face|head|hair|skin|eye|mouth|teeth|tongue|brow|lash/i
  const parts: { name: string; object: import('three').Object3D }[] = []
  const seenPartNames = new Set<string>()
  vrm.scene.traverse((o) => {
    const isMesh = (o as { isMesh?: boolean }).isMesh === true
    if (!isMesh || !o.name || BODY_WORDS.test(o.name)) return
    if (seenPartNames.has(o.name)) return
    seenPartNames.add(o.name)
    parts.push({ name: o.name, object: o })
  })

  /**
   * Xoay quanh trục đứng (Shift + kéo chuột).
   *
   * Xoay **model**, không xoay camera: camera còn phải giữ khung hình đã căn, mà xoay camera
   * quanh model thì `frameCamera()` ở lần resize kế tiếp sẽ đặt lại vị trí và mất góc xoay.
   *
   * Nhớ góc GỐC (`rotateVRM0` đã xoay 180° cho model 0.x) rồi cộng góc user vào, chứ không
   * `+=` mỗi lần: cộng dồn thì mỗi lần user kéo là xoay tiếp từ chỗ cũ, không bao giờ về được
   * góc đã lưu.
   */
  /** Góc user đã Shift+kéo. Giữ riêng vì mỗi frame còn cộng thêm vòng tự xoay. (`baseRotationY` bắt ở trên, cạnh `modelFrame`.) */
  let userRotY = opts.rotationY
  vrm.scene.rotation.y = baseRotationY + userRotY

  /**
   * Tự xoay MỘT vòng mỗi 2–3 phút (yêu cầu user).
   *
   * Xoay `scene` chứ không xoay xương — không dính gì tới bộ cộng dồn tư thế. Offset về đúng 0
   * khi xong (2π ≡ 0) nên góc nhìn y như cũ, không tích luỹ lệch. Không huỷ khi user kéo giữa
   * chừng: huỷ là offset nhảy từ X về 0 = snap tới 180°; để nó xoay nốt 8 s thì kéo của user
   * vẫn cộng lên trên, không ai đè ai.
   */
  let spinAt = performance.now() + spinDelayMs(Math.random)
  /** 0 = không đang xoay. */
  let spinStart = 0
  function spinOffset(now: number): number {
    if (spinStart === 0) {
      if (now < spinAt) return 0
      spinStart = now
      if (debug) console.log('[avatar] spin')
    }
    const t = (now - spinStart) / SPIN_MS
    if (t >= 1) {
      spinStart = 0
      spinAt = now + spinDelayMs(Math.random)
      return 0
    }
    return spinAngle(t)
  }

  /** Đầu mốc để sinh chuyển động idle — model VRM thường KHÔNG mang animation sẵn. */
  const t0 = performance.now()
  const head = vrm.humanoid?.getNormalizedBoneNode('head')
  const chest = vrm.humanoid?.getNormalizedBoneNode('chest') ?? vrm.humanoid?.getNormalizedBoneNode('spine')
  const spine = vrm.humanoid?.getNormalizedBoneNode('spine')
  /**
   * Hai đốt còn lại của thân trên — **chỉ lớp KÉO dùng**.
   *
   * Cột sống trong VRM có tới 5 khớp điều khiển được (`hips → spine → chest → upperChest → neck`),
   * nhưng lớp kéo trước đây chỉ ghi vào `spine` và `chest`. Hậu quả: đoạn từ cổ xuống eo uốn như
   * MỘT khối cứng, người bị bẻ ở đúng hai chỗ thay vì cong đều — user nhìn ra ngay.
   *
   * `upperChest` là tuỳ chọn trong chuẩn VRM (nhiều model không có), `neck` thì hầu như luôn có.
   * Thiếu cái nào thì phần của nó được dồn sang khớp lân cận, xem `writePose`.
   */
  const upperChest = vrm.humanoid?.getNormalizedBoneNode('upperChest')
  const neck = vrm.humanoid?.getNormalizedBoneNode('neck')
  const hips = vrm.humanoid?.getNormalizedBoneNode('hips')
  /** Vị trí NGHỈ của xương hông — mọi chuyển động cộng lệch vào đây, không gán đè. */
  const hipsRest = hips ? hips.position.clone() : new THREE.Vector3()
  /**
   * Chân — chỉ dùng cho lớp KÉO (`tug`).
   *
   * Idle tuyệt đối không đụng vào chân: người đứng yên thì bàn chân bám sàn, cho chân đung đưa là
   * lỗi "treo cổ" đã gặp. Nhưng khi bị NÍU thì ngược lại — người thật chùng gối và dịch hông để
   * chống lại lực kéo; giữ chân cứng đơ là thứ khiến user thấy "chỉ eo trở lên phản ứng".
   */
  const legs = {
    lUpper: vrm.humanoid?.getNormalizedBoneNode('leftUpperLeg') ?? null,
    rUpper: vrm.humanoid?.getNormalizedBoneNode('rightUpperLeg') ?? null,
    lLower: vrm.humanoid?.getNormalizedBoneNode('leftLowerLeg') ?? null,
    rLower: vrm.humanoid?.getNormalizedBoneNode('rightLowerLeg') ?? null
  }
  /** Con trỏ trong khung, toạ độ chuẩn hoá [-1,1]; `null` = chuột ra ngoài. */
  let cursor: { x: number; y: number } | null = null
  let lookOn = opts.lookAtCursor
  /** Biểu cảm đang chơi tạm và thời điểm hết hạn. */
  let tempExpr: { name: string; until: number } | null = null
  /** Góc đầu đang đuổi theo con trỏ — giữ ngoài `idle` để nội suy mượt qua các frame. */
  const headAim = { yaw: 0, pitch: 0 }

  /**
   * Tư thế của MỘT frame, do các tầng **cộng dồn** vào rồi ghi xuống xương một lần.
   *
   * Đây là chỗ chặn tận gốc lỗi "hai nguồn cùng ghi một xương" — lỗi đã mắc **ba lần** trong
   * lúc làm tính năng này (gán đè `hips.position.y`, rồi `spine.rotation.y` bị cả idle lẫn
   * hướng nhìn ghi). Trước đây mỗi chuyển động tự `=` hoặc `+=` thẳng vào xương, nên thứ tự
   * các dòng code quyết định ai thắng — không nhìn ra được, và thêm chuyển động mới là lại
   * dò bằng mắt.
   *
   * Cấp phát MỘT lần ở đây, mỗi frame chỉ gán lại số 0 (§10: không cấp phát trong vòng lặp vẽ).
   */
  const pose = {
    hips: { x: 0, y: 0 },
    /** Hông NGHIÊNG — chỉ lớp kéo dùng; idle để nguyên 0 (xoay hông lúc đứng = lỗi "treo cổ"). */
    hipsRot: { x: 0, z: 0 },
    /**
     * Gối co (rad, dương = chùng xuống) — chỉ lớp kéo ghi.
     *
     * KHÔNG có "đùi nghiêng": xoay đùi làm cả cẳng chân + bàn chân đu theo như con lắc (đo được
     * 5–10 cm trượt), mà không có IK chân để ghim bàn chân xuống sàn.
     */
    legBend: 0,
    spine: { x: 0, y: 0, z: 0 },
    chest: { x: 0, y: 0, z: 0 },
    /** Hai đốt trên của thân — chỉ lớp kéo ghi; idle để 0 nên không đụng gì tới tư thế đứng. */
    upperChest: { x: 0, z: 0 },
    neck: { x: 0, z: 0 },
    head: { x: 0, y: 0, z: 0 },
    /**
     * Vai: phần NÂNG thêm (dương = nhô lên) từ thở / dồn trọng tâm / vi chuyển động.
     *
     * Tay trên, khuỷu, cổ tay, ngón KHÔNG có ở đây: IK trong `applyArms` đặt cả chuỗi từ vị trí
     * đích, chạy cuối `writePose`. Để chúng ở đây là quay lại chuyện bốn nguồn euler cộng vào
     * cùng một chuỗi xương mà không ai kiểm được kết quả — đúng thứ vừa bỏ.
     */
    shoulderL: 0,
    shoulderR: 0
  }

  function clearPose(): void {
    pose.hips.x = 0
    pose.hips.y = 0
    pose.hipsRot.x = pose.hipsRot.z = 0
    pose.legBend = 0
    pose.spine.x = pose.spine.y = pose.spine.z = 0
    pose.chest.x = pose.chest.y = pose.chest.z = 0
    pose.upperChest.x = pose.upperChest.z = 0
    pose.neck.x = pose.neck.z = 0
    pose.head.x = pose.head.y = pose.head.z = 0
    pose.shoulderL = pose.shoulderR = 0
  }

  /** Các tầng đang hoạt động trong frame này — quyết định ai bị nhường nhóm xương nào. */
  let activeLayers: Layer[] = ['idle']

  /**
   * Chế độ lớp tay (chẩn đoán). Khai ở ĐÂY, trước `writePose`, không phải cạnh `debug` ở dưới:
   * `writePose()` được gọi một lần lúc dựng (đo khung hình) — khai sau chỗ gọi là `let` còn
   * trong vùng chết (TDZ) và ném ReferenceError ngay lúc nạp model.
   */
  let armMode: ArmMode = 'natural'

  /** Tầng `self` có được phép ghi nhóm xương này không. */
  function owns(group: BoneGroup, self: Layer): boolean {
    return !isClaimedByHigher(group, self, activeLayers)
  }

  /**
   * Ghi tư thế đã cộng dồn xuống xương — **nơi DUY NHẤT** chạm vào `rotation`/`position`.
   *
   * Tay lấy tư thế nghỉ **bất đối xứng** (§1E): vai phải hơi thấp hơn vai trái. Người đứng thả
   * lỏng không bao giờ cân đối hai bên; đối xứng tuyệt đối là dấu hiệu rõ nhất của hình nộm.
   */
  /**
   * Lượng nâng hông để bù gập gối, **đo thẳng trên bộ xương** chứ không tính bằng công thức.
   *
   * Đã thử hai công thức hình học (`1−cos(θ/2)`, rồi `1−cos(θ/4)`) và cả hai đều sai: sai số tăng
   * theo bình phương góc, và **hai model lệch nhau gần gấp đôi** vì tỉ lệ đùi/cẳng chân/bàn chân
   * mỗi rig một khác. Đo thì đúng mọi rig: ghi góc gối, ép cập nhật ma trận, đọc bàn chân tụt bao
   * nhiêu so với lúc nghỉ — chính con số đó là lượng cần nâng.
   *
   * Chỉ chạy lại khi góc gối ĐỔI ĐỦ nhiều (0,01 rad): mỗi lần đo là vài `updateWorldMatrix`, mà
   * lúc đứng yên `legBend` luôn bằng 0 nên gần như không bao giờ chạy.
   */
  let kneeLift = 0
  let kneeLiftFor = -1
  const vFootRest = new THREE.Vector3()
  let footRestY: number | null = null

  function measureKneeLift(bend: number): void {
    const foot = vrm.humanoid?.getNormalizedBoneNode('leftFoot')
    if (!foot || !hips) {
      kneeLift = 0
      return
    }
    // Chiều cao bàn chân ở tư thế nghỉ — đo MỘT lần, lúc chưa ai gập gối
    if (footRestY === null) {
      hips.position.y = hipsRest.y
      if (legs.lUpper) legs.lUpper.rotation.set(0, 0, 0)
      if (legs.rUpper) legs.rUpper.rotation.set(0, 0, 0)
      if (legs.lLower) legs.lLower.rotation.set(0, 0, 0)
      if (legs.rLower) legs.rLower.rotation.set(0, 0, 0)
      hips.updateWorldMatrix(false, true)
      foot.getWorldPosition(vFootRest)
      footRestY = vFootRest.y
    }
    if (bend < 1e-4) {
      kneeLift = 0
      return
    }
    const legX = armSign
    if (legs.lUpper) legs.lUpper.rotation.set(-bend * 0.5 * legX, 0, 0)
    if (legs.rUpper) legs.rUpper.rotation.set(-bend * 0.5 * legX, 0, 0)
    if (legs.lLower) legs.lLower.rotation.set(bend * legX, 0, 0)
    if (legs.rLower) legs.rLower.rotation.set(bend * legX, 0, 0)
    hips.position.y = hipsRest.y
    hips.updateWorldMatrix(false, true)
    foot.getWorldPosition(vFootRest)
    kneeLift = footRestY - vFootRest.y
  }

  function writePose(): void {
    // Bù chiều cao do gập gối — đo lại khi góc đổi đủ nhiều (xem `measureKneeLift`)
    if (Math.abs(pose.legBend - kneeLiftFor) > 0.01) {
      kneeLiftFor = pose.legBend
      measureKneeLift(pose.legBend)
    }
    if (hips) {
      hips.position.x = hipsRest.x + pose.hips.x
      hips.position.y = hipsRest.y + pose.hips.y + kneeLift
      hips.position.z = hipsRest.z
      /**
       * ⚠️ Hông xoay **CHỈ khi bị kéo** (`pose.hipsRot`, do lớp tug ghi), idle luôn để 0.
       *
       * Xoay hông lúc đứng yên = chân vung sang hai bên như bị treo — lỗi đã gặp và đã sửa.
       * Nhưng lúc bị NÍU thì hông phải theo, nếu không nhân vật gập ở thắt lưng còn chân chôn
       * xuống đất. Khác biệt nằm ở chỗ: bị kéo thì chân cũng chống lại (xem `legs` bên dưới),
       * nên cả khối dịch cùng nhau chứ không phải thân trên đi một mình.
       */
      hips.rotation.set(pose.hipsRot.x, 0, pose.hipsRot.z)
    }
    /**
     * Chân: gối chùng + đùi nghiêng chống lại lực kéo. Bằng 0 khi không bị kéo → idle không đụng.
     *
     * **Dấu X lật giữa VRM 1.0 và 0.x** — cùng bẫy đã dính với tay, đo được: cùng một góc dương
     * làm bàn chân ra TRƯỚC ở rig này và RA SAU ở rig kia. Dùng `armSign` (đã suy từ `metaVersion`)
     * cho cả chân. Đùi và cẳng chân **ngược dấu nhau**: đùi hất ra trước thì cẳng chân phải gập
     * lại, không thì bàn chân trượt đi như đứng trên băng (ảnh chụp lần đầu đúng như vậy).
     */
    const legX = armSign
    if (legs.lUpper) legs.lUpper.rotation.set(-pose.legBend * 0.5 * legX, 0, 0)
    if (legs.rUpper) legs.rUpper.rotation.set(-pose.legBend * 0.5 * legX, 0, 0)
    if (legs.lLower) legs.lLower.rotation.set(pose.legBend * legX, 0, 0)
    if (legs.rLower) legs.rLower.rotation.set(pose.legBend * legX, 0, 0)
    if (spine) spine.rotation.set(pose.spine.x, pose.spine.y, pose.spine.z)
    if (chest) chest.rotation.set(pose.chest.x, pose.chest.y, pose.chest.z)
    // Hai đốt trên: chỉ lớp kéo ghi, đứng yên thì cả hai bằng 0 nên tư thế đứng không đổi chút nào
    if (upperChest) upperChest.rotation.set(pose.upperChest.x, 0, pose.upperChest.z)
    if (neck) neck.rotation.set(pose.neck.x, 0, pose.neck.z)
    if (head) head.rotation.set(pose.head.x, pose.head.y, pose.head.z)
    /**
     * Vai TRƯỚC tay: vai dời gốc của tay trên, IK phải đọc gốc đã dời.
     *
     * Hạ cố định (`shoulderDrop`, người thả lỏng vai không ở đúng góc rig) + phần NÂNG thêm
     * (`pose.shoulder*`: thở, dồn trọng tâm). Cùng quy ước dấu đo được với hạ tay: quanh Z,
     * `−x·armSign` hạ bên trái, `+x·armSign` hạ bên phải.
     */
    const zeroArms = armMode === 'zero' || !armDebug.arms
    const dropL = zeroArms ? 0 : NATURAL_REST.left.shoulderDrop
    const dropR = zeroArms ? 0 : NATURAL_REST.right.shoulderDrop
    if (lShoulder) lShoulder.rotation.set(lShoulderRest.x, lShoulderRest.y, lShoulderRest.z + (-dropL + pose.shoulderL) * armSign)
    if (rShoulder) rShoulder.rotation.set(rShoulderRest.x, rShoulderRest.y, rShoulderRest.z + (dropR - pose.shoulderR) * armSign)
    applyArms()
  }

  /**
   * Mục tiêu nhìn của `vrm.lookAt`, đặt trong không gian thế giới.
   *
   * `lookAt` cần một `Object3D` để dõi theo chứ không nhận thẳng toạ độ, nên phải có một node
   * rỗng làm bia. Không thêm vào `scene` cũng được vì ta tự cập nhật `matrixWorld`, nhưng thêm
   * vào thì three tự lo — đỡ một nguồn lỗi im lặng.
   */
  const lookTarget = new THREE.Object3D()
  scene.add(lookTarget)
  if (vrm.lookAt) vrm.lookAt.target = lookTarget

  /**
   * ==== TAY: IK GIẢI TÍCH HAI XƯƠNG (§3–§9) ====
   *
   * Chạy cuối `writePose`, sau khi thân + vai đã ghi (gốc tay trên phải là gốc đã dời). Mỗi frame,
   * mỗi tay: đích bàn tay tương đối khớp háng (`restTarget`) → khuỷu (`solveTwoBoneIk`, pole ra
   * ngoài–hơi sau) → quaternion cho tay trên (nếp khuỷu quay về phía gập), cẳng tay + bàn tay
   * (lòng bàn tay hướng vào đùi, cổ tay = nối tiếp), ngón cong tăng dần. Tất cả trong KHUNG MODEL,
   * đổi ra cục bộ qua cha.
   *
   * Không có máy trạng thái tư thế: chỉ MỘT tư thế RELAXED cho tới khi user nghiệm thu (§20).
   * Sway / vi chuyển động / dồn trọng tâm chỉ là vài mm dịch ĐÍCH — cả chuỗi tự đổi theo, không
   * còn góc rời nào cộng vào xương.
   */
  const armDebug: ArmDebugFlags = {
    arms: true,
    hands: true,
    fingers: true,
    weightShift: true,
    micro: true,
    interaction: true,
    swing: true,
    elbow: true,
    showTargets: false
  }
  /** Nhịp idle hiện tại — `idle()` ghi, IK đọc để đặt sway/dồn trọng tâm lên đích. */
  let idleS = 0
  let idleShift = 0
  /** Kết quả IK frame vừa rồi — cho debug log. */
  const ikInfo = { left: { bendDeg: 0, reach: 0 }, right: { bendDeg: 0, reach: 0 } }
  /** Bản sao đặc tả để ghi sway/dồn trọng tâm vào, không cấp phát object mỗi frame. */
  const liveSpec: Record<'left' | 'right', ArmRestSide> = { left: { ...NATURAL_REST.left }, right: { ...NATURAL_REST.right } }
  /** Con lắc quán tính mỗi tay (`stepArmSwing`) — tay đu khi thân xoay, tóc váy bay mà tay không đứng đơ. */
  const swing = { left: newArmSwing(), right: newArmSwing() }
  /** Kéo trần = níu nhân vật (`stepTug`): thân ngả theo tay kéo, buông thì bật về. */
  const tug = newTug()
  /** Đích kéo hiện tại (tỉ lệ khung); `null` = đã thả tay, lò xo đang đưa về. */
  let tugTarget: { x: number; y: number } | null = null
  /**
   * Giá trị kéo **trễ dần theo từng đốt** — đây là thứ biến "cả người nghiêng cùng lúc" thành
   * "sóng chạy từ hông lên đầu".
   *
   * Bản trước mọi khớp dùng chung một giá trị `tug`, chỉ khác biên độ, nên cả thân xoay **cùng
   * pha**: đúng kỹ thuật mà nhìn vẫn như một khối gỗ bị bẻ. Người thật thì gốc đi trước, mỗi đốt
   * phía trên bám theo chậm hơn một chút, và lúc buông tay cũng bật về theo thứ tự đó.
   *
   * Mỗi phần tử đuổi theo phần tử TRƯỚC nó (không phải đuổi theo `tug` gốc), nên độ trễ cộng dồn
   * dần lên ngọn. Tốc độ bám giảm dần: hông gần như tức thì, đầu chậm nhất.
   */
  const CHAIN_SPEED = [26, 20, 16, 13, 10, 8] as const
  /** Thứ tự: hông · spine · chest · upperChest · neck · head. */
  const chain: { x: number; z: number }[] = CHAIN_SPEED.map(() => ({ x: 0, z: 0 }))

  function stepChain(dt: number): void {
    let prevX = tug.x
    let prevZ = tug.z
    for (let i = 0; i < chain.length; i++) {
      const c = chain[i]!
      const k = damp(CHAIN_SPEED[i]!, dt)
      c.x += (prevX - c.x) * k
      c.z += (prevZ - c.z) * k
      prevX = c.x
      prevZ = c.z
    }
  }
  /** Tốc độ góc thân (rad/s) và dt của frame này — `tick` đo, `applyArms` đọc. */
  let bodyOmega = 0
  let frameDt = 1 / 60
  let rotPrev = userRotY

  // Vật tạm cấp MỘT lần — vòng lặp vẽ không cấp phát
  const vS = new THREE.Vector3()
  const vH = new THREE.Vector3()
  const vT = new THREE.Vector3()
  const vE = new THREE.Vector3()
  const vU = new THREE.Vector3()
  const vL = new THREE.Vector3()
  const vAxis = new THREE.Vector3()
  const vRef = new THREE.Vector3()
  const vPalm = new THREE.Vector3()
  const vA = new THREE.Vector3()
  const vB = new THREE.Vector3()
  const vC = new THREE.Vector3()
  const qM = new THREE.Quaternion()
  const qMinv = new THREE.Quaternion()
  const qW = new THREE.Quaternion()
  const qP = new THREE.Quaternion()
  const qR = new THREE.Quaternion()
  const qTwist = new THREE.Quaternion()
  const Z_AXIS = new THREE.Vector3(0, 0, 1)
  const NEG_Y = new THREE.Vector3(0, -1, 0)

  /** Cầu debug: đích bàn tay (xanh) + khuỷu (cam). Ẩn mặc định — `setArmDebug({ showTargets: true })`. */
  const sphGeo = new THREE.SphereGeometry(0.012, 12, 8)
  const mkSphere = (color: number): import('three').Mesh => {
    const m = new THREE.Mesh(sphGeo, new THREE.MeshBasicMaterial({ color, depthTest: false }))
    m.renderOrder = 999
    m.visible = false
    scene.add(m)
    return m
  }
  const sph = {
    left: { target: mkSphere(0x44ff88), elbow: mkSphere(0xffaa33) },
    right: { target: mkSphere(0x44ff88), elbow: mkSphere(0xffaa33) }
  }

  /**
   * Quaternion (khung model) đưa `restDir` về `dir`, rồi XOẮN quanh `dir` để `restRef` (sau khi
   * xoay) về gần `wantRef`. Bước xoắn quyết định lòng bàn tay hướng đâu và nếp khuỷu quay về
   * đâu — `setFromUnitVectors` một mình để lại góc xoắn tuỳ ý.
   */
  function orient(restDir: Vec3, dir: Vec3, restRef: Vec3, wantRef: Vec3, out: import('three').Quaternion): void {
    out.setFromUnitVectors(restDir, dir)
    vA.copy(restRef).applyQuaternion(out)
    vA.addScaledVector(dir, -vA.dot(dir))
    vB.copy(wantRef).addScaledVector(dir, -wantRef.dot(dir))
    if (vA.lengthSq() < 1e-8 || vB.lengthSq() < 1e-8) return
    vA.normalize()
    vB.normalize()
    const angle = Math.atan2(vC.crossVectors(vA, vB).dot(dir), vA.dot(vB))
    qTwist.setFromAxisAngle(dir, angle)
    out.premultiply(qTwist)
  }

  /**
   * Ghi quaternion (khung model) xuống xương.
   *
   * `qModel` là phép xoay ĐẶT LÊN hướng nghỉ của xương (trong khung model), nên hướng tuyệt đối
   * trong khung model = `qModel · restQ`; ra thế giới nhân `qM` bên trái; ra cục bộ nhân nghịch
   * đảo của cha bên trái. Thiếu `restQ` là lỗi "tay chỉ lên trời" trên 0.x — xem `ArmRig`.
   */
  function setFromModel(b: Obj3D, qModel: import('three').Quaternion, restQ: import('three').Quaternion): void {
    qW.copy(qM).multiply(qModel).multiply(restQ)
    b.parent!.getWorldQuaternion(qP)
    b.quaternion.copy(qP.invert().multiply(qW))
    // Con (cẳng tay, bàn tay) đọc `matrixWorld` của cha ngay sau → phải cập nhật tại chỗ
    b.updateWorldMatrix(false, false)
  }

  function applyArms(): void {
    for (const side of ['left', 'right'] as const) {
      const rig = arms[side]
      if (!rig) continue
      const sideSign = side === 'left' ? 1 : -1
      if (armMode === 'zero' || !armDebug.arms) {
        rig.upper.rotation.set(0, 0, 0)
        rig.lower.rotation.set(0, 0, 0)
        rig.hand.rotation.set(0, 0, 0)
        for (const f of rig.fingers) for (const j of f.joints) j?.rotation.set(0, 0, 0)
        continue
      }
      const spec = liveSpec[side]
      const base = NATURAL_REST[side]
      const live = armMode === 'natural'
      const s = idleS
      const ph = side === 'left' ? 0 : 1.9

      // Đích: tương đối khớp háng. Sway / dồn trọng tâm / vi chuyển động chỉ là vài mm dịch đích.
      spec.lateralM = base.lateralM
      spec.forwardM = base.forwardM
      spec.reach = base.reach
      let palmBack = base.palmBack
      if (live && armDebug.weightShift) spec.lateralM -= rig.sideX * idleShift * WEIGHT_SHIFT_ARM.lateralM
      if (live && armDebug.micro) {
        spec.lateralM += Math.sin(s * 0.52 + ph) * MICRO_ARM.lateralM
        spec.forwardM += Math.sin(s * 0.37 + ph) * MICRO_ARM.forwardM
        spec.reach += Math.sin(s * 0.29 + ph) * MICRO_ARM.reach
        palmBack += Math.sin(s * 0.61 + ph) * MICRO_ARM.palmRad
      }
      /**
       * Khuỷu SỐNG: pole quay quanh trục vai→tay theo hai sóng chậm, kèm đổi độ với vài mm.
       *
       * Bản trước pole là hằng số nên khuỷu nằm chết một chỗ dù bàn tay có nhúc nhích — user chỉ
       * đúng chỗ đó ("tay vẫn đơ ở cùi chỏ"). Quay pole không dời bàn tay: đây là bậc tự do thứ
       * ba của khớp vai, thứ làm cẳng tay Live2D trôi liên tục.
       */
      let poleRot = 0
      if (live && armDebug.elbow) {
        poleRot = elbowDrift(s, ph)
        spec.reach += elbowDriftReach(s, ph)
        // Tay đi theo hướng NHÌN: quay đầu sang trái thì tay trái lùi, tay phải đưa tới
        const lo = lookArmOffset(headAim.yaw, rig.sideX)
        spec.forwardM += lo.forwardM
        spec.lateralM += lo.lateralM
        poleRot += headAim.yaw * rig.sideX * LOOK_ARM.polePerRad
      }

      modelFrame.updateWorldMatrix(true, false)
      modelFrame.getWorldQuaternion(qM)
      qMinv.copy(qM).invert()
      toModel(rig.upper, vS)
      toModel(rig.hip, vH)
      // Quán tính khi thân xoay: tay bị kéo ngược chiều xoay rồi lò xo đưa về. Tính trên đích GỐC
      // rồi cộng lệch vào đặc tả và giải lại — `restTarget` giữ nguyên tầm với nên tay văng theo
      // mặt cầu quanh vai như con lắc, không phải duỗi thẳng khớp ra cho tới đích.
      const sw = swing[side]
      if (live && armDebug.swing) {
        const t0 = restTarget(rig.sideX, vS, vH, spec, rig.lenA + rig.lenB)
        stepArmSwing(sw, t0.x, t0.z, bodyOmega, frameDt)
        spec.lateralM += rig.sideX * sw.x
        spec.forwardM += sw.z
      } else if (sw.x !== 0 || sw.z !== 0) {
        sw.x = sw.z = sw.vx = sw.vz = 0
      }
      const t = restTarget(rig.sideX, vS, vH, spec, rig.lenA + rig.lenB)
      // Pole khuỷu: ra ngoài, hơi xuống, ra sau (`vPalm` dùng tạm, gán lại ngay dưới)
      vPalm.set(rig.sideX * base.poleOut, -0.15, -base.poleBack).normalize()
      /**
       * Quay pole quanh CHÍNH trục vai→đích: khuỷu trôi trên đường tròn quanh trục đó mà bàn tay
       * đứng yên tuyệt đối. Quay quanh trục khác thì đích cũng bị kéo theo và cả cánh tay trượt.
       */
      if (poleRot !== 0) {
        vAxis.set(t.x - vS.x, t.y - vS.y, t.z - vS.z).normalize()
        vPalm.applyAxisAngle(vAxis, poleRot)
      }
      const ik = solveTwoBoneIk(vS, t, rig.lenA, rig.lenB, vPalm)
      ikInfo[side].bendDeg = (ik.bendRad * 180) / Math.PI
      ikInfo[side].reach = ik.reachFrac
      vT.set(ik.end.x, ik.end.y, ik.end.z)
      vE.set(ik.elbow.x, ik.elbow.y, ik.elbow.z)
      vU.copy(vE).sub(vS).normalize()
      vL.copy(vT).sub(vE).normalize()

      // Tay trên: nếp khuỷu (T-pose: +Z) quay về phía gập = ngược hướng khuỷu lệch khỏi trục vai→đích
      vAxis.copy(vT).sub(vS).normalize()
      vRef.copy(vE).sub(vS)
      vRef.addScaledVector(vAxis, -vRef.dot(vAxis)).negate()
      orient(rig.restUpper, vU, Z_AXIS, vRef, qR)
      setFromModel(rig.upper, qR, rig.restQUpper)

      // Cẳng tay + bàn tay: lòng bàn tay (T-pose: −Y) hướng vào đùi, pha ra sau; cổ tay = nối tiếp
      vPalm.set(-rig.sideX, 0, -palmBack).normalize()
      orient(rig.restLower, vL, NEG_Y, vPalm, qR)
      setFromModel(rig.lower, qR, rig.restQLower)
      if (armDebug.hands) {
        orient(rig.restHand, vL, NEG_Y, vPalm, qR)
        setFromModel(rig.hand, qR, rig.restQHand)
      } else rig.hand.rotation.set(0, 0, 0)

      // Ngón: cong về phía lòng bàn tay — cùng quy ước dấu với hạ tay (xương ±X, lòng −Y ở T-pose)
      const fScale = side === 'right' ? FINGER_CURL_RIGHT_SCALE : 1
      const fMicro = live && armDebug.micro ? Math.sin(s * 0.29 + ph) * MICRO_ARM.fingerRad : 0
      for (const f of rig.fingers) {
        for (let i = 0; i < 3; i++) {
          const j = f.joints[i]
          if (!j) continue
          if (!armDebug.fingers) j.rotation.set(0, 0, 0)
          else j.rotation.set(0, 0, -(f.curl[i] * fScale + fMicro) * sideSign * armSign)
        }
      }

      if (armDebug.showTargets) {
        sph[side].target.position.copy(modelFrame.localToWorld(vA.copy(vT)))
        sph[side].elbow.position.copy(modelFrame.localToWorld(vA.copy(vE)))
      }
    }
  }

  /**
   * Chuyển động idle sinh bằng code: thở (chest) + nghiêng đầu + nháy mắt.
   *
   * Model mức 1 không có animation clip (file thật đo được `animations: 0`), nên nếu không tự
   * sinh thì nhân vật đứng bất động như ảnh — trông như app bị treo.
   *
   * Khi đang chạy animation ngoài (`.vrma`) thì **bỏ qua toàn bộ**: clip đã điều khiển xương,
   * chen tư thế tay/đầu vào giữa là giật cục hai nguồn tranh nhau.
   */
  function idle(now: number, dt: number): void {
    const s = (now - t0) / 1000

    /**
     * Đứng yên với **trọng tâm ở chân**, không phải đung đưa treo lơ lửng.
     *
     * ⚠️ **KHÔNG xoay `hips.rotation.z`.** Hông là gốc của cả bộ xương, xoay nó là lật nghiêng
     * toàn thân quanh một điểm ở hông — chân theo đó vung sang hai bên, trông đúng như user tả:
     * "nhân vật đang bị treo cổ". Chân người đứng thì bám sàn, không đung đưa.
     *
     * Cách đúng: hông **dịch ngang** rất nhẹ (dồn trọng tâm sang một chân), còn phần đung đưa
     * dồn lên `spine`/`chest` — thân trên mới là chỗ được phép lắc.
     */
    const shift = Math.sin(s * 0.42)
    if (owns('hips', 'idle')) {
      // Chỉ TỊNH TIẾN, không xoay: biên độ rất nhỏ vì bàn chân không được trượt trên sàn
      pose.hips.x += shift * 0.012
      pose.hips.y += -Math.abs(shift) * 0.004
    }
    if (owns('spine', 'idle')) {
      // Thân trên nghiêng NGƯỢC chiều hông — đây là cách người thật giữ thăng bằng khi dồn
      // trọng tâm sang một chân, và là nơi duy nhất nên thấy chuyển động đu đưa
      pose.spine.z += -shift * 0.03
      pose.spine.y += Math.sin(s * 0.23) * 0.035
      // Thở: chu kỳ ~4s. Biên độ nhỏ — lớn hơn chút là thành "phồng xẹp" kỳ dị.
      pose.chest.x += Math.sin(s * (Math.PI / 2)) * 0.025
      pose.chest.z += -shift * 0.02
    }

    /**
     * Bị NÍU: thân ngả theo tay kéo, buông thì lò xo bật về (§ yêu cầu user "kéo để tác động,
     * bỏ ra trở về chỗ cũ").
     *
     * Chia cho spine/chest chứ không dồn một xương: ngả cả thân trên trông như bị níu áo, còn dồn
     * hết vào một khớp là gãy gập tại đó. Hông vẫn KHÔNG xoay — chân phải bám sàn.
     */
    stepTug(tug, tugTarget, dt)
    // Sóng trễ dần lên từng đốt — phải chạy MỖI frame, kể cả lúc đã buông tay, để chuỗi còn bật về
    stepChain(dt)
    const [cHips, cSpine, cChest, cUpper, cNeck, cHead] = chain as [
      { x: number; z: number },
      { x: number; z: number },
      { x: number; z: number },
      { x: number; z: number },
      { x: number; z: number },
      { x: number; z: number }
    ]
    // Xét cả chuỗi, không chỉ `tug`: buông tay thì `tug` về 0 trước, còn ngọn vẫn đang đuổi theo
    const tugMag = Math.max(Math.hypot(tug.x, tug.z), Math.hypot(cHead.x, cHead.z))
    if (tugMag > 1e-4) {
      /**
       * Lực kéo chia cho **CẢ NGƯỜI**, không chỉ thân trên.
       *
       * Bản trước chỉ cộng vào `spine`/`chest`/`head` nên nhân vật gập ở thắt lưng còn chân chôn
       * xuống đất — user tả đúng: "chỉ eo trở lên phản ứng, không tự nhiên". Người thật bị níu thì
       * cả khối dịch theo: **hông trượt** về phía bị kéo, **gối chùng** để hạ trọng tâm, đùi
       * nghiêng chống lại, rồi thân trên mới uốn. Càng gần gốc (chân) biên độ càng nhỏ nhưng có
       * mặt — chính cái "có mặt" đó làm chuyển động ra dáng người.
       */
      if (owns('hips', 'idle')) {
        // Hông TRƯỢT ngang/trước theo hướng kéo — mét, không phải radian
        pose.hips.x += cHips.z * -0.055
        /**
         * ⚠️ **KHÔNG hạ hông ở đây.** Hạ hông là dời gốc bộ xương xuống → **cả người tụt**, bàn
         * chân lún qua mép khung (user chụp được: chân xuyên thanh trạng thái). Trọng tâm phải
         * hạ **do gối gập**, và phần bù để bàn chân đứng yên tính ở `writePose` từ chính góc gối.
         */
        // Hông nghiêng nhẹ theo — nhưng ÍT hơn thân trên nhiều, và chỉ khi bị kéo
        pose.hipsRot.x += cHips.x * 0.18
        pose.hipsRot.z += cHips.z * 0.18
      }
      /**
       * Chân chống lại bằng **gối chùng**, KHÔNG nghiêng đùi.
       *
       * Xương chân là chuỗi treo từ hông: xoay đùi thì cả cẳng chân + bàn chân đu theo như con
       * lắc. Đo được: nghiêng đùi 0,22 → bàn chân dịch **10,7 cm**, giảm còn 0,08 vẫn **5 cm** —
       * chân trượt trên sàn, đúng dáng đứng trên băng (ảnh chụp thấy rõ). Không có IK chân nên
       * không ghim được bàn chân xuống sàn; cách đúng là **đừng xoay đùi chút nào**.
       *
       * Gối chùng thì khác: đùi và cẳng chân ngược dấu nhau nên bàn chân gần như đứng yên, chỉ
       * hạ xuống — đúng thứ người thật làm khi bị níu.
       *
       * Biên độ 1,4 rad/đơn-vị-kéo: với `TUG.maxRad` 0,3 thì kéo hết cỡ ra **~24° gập thêm** —
       * nhìn rõ là đang nhún. Mức 0,3 cũ chỉ cho 4,8°, đo được mà mắt không thấy (user: "không
       * thấy đầu gối nhún").
       */
      // Gối theo HÔNG, không theo ngọn: chân là phần dưới hông, nó không việc gì phải đợi đầu
      pose.legBend += Math.hypot(cHips.x, cHips.z) * 1.4

      /**
       * Thân trên uốn qua **cả 5 khớp**, không chỉ 2.
       *
       * Cột sống VRM là `hips → spine → chest → upperChest → neck → head`. Bản trước chỉ ghi
       * `spine` và `chest`, nên đoạn từ cổ xuống eo cong đúng hai chỗ rồi thẳng đơ — user tả là
       * "cứng đờ". Chia nhỏ ra nhiều khớp thì cùng một tổng góc lại thành một đường cong mềm.
       *
       * **Tổng các hệ số giữ nguyên ~0,68** như trước (0,42 + 0,26), chỉ rải ra — nên độ ngả tổng
       * thể không đổi, chỉ khác ở chỗ nó cong đều thay vì gãy khúc.
       *
       * Model thiếu `upperChest` (chuẩn VRM cho phép) thì phần của nó dồn vào `chest`, thiếu
       * `neck` thì dồn vào `head` — không để mất góc, cũng không ghi vào xương không tồn tại.
       */
      if (owns('spine', 'idle')) {
        pose.spine.x += cSpine.x * 0.2
        pose.spine.z += cSpine.z * 0.2
        const chestShare = upperChest ? 0.16 : 0.28
        pose.chest.x += cChest.x * chestShare
        pose.chest.z += cChest.z * chestShare
        if (upperChest) {
          pose.upperChest.x += cUpper.x * 0.14
          pose.upperChest.z += cUpper.z * 0.14
        }
        if (neck) {
          pose.neck.x += cNeck.x * 0.11
          pose.neck.z += cNeck.z * 0.11
        }
      }
      /**
       * Đầu đi sau thân một nhịp — khối nặng nhất nên trễ nhất. Khi model KHÔNG có `neck` thì
       * đầu gánh luôn phần cổ, nếu không đoạn trên cùng lại thành cứng đúng như lỗi vừa sửa.
       */
      if (owns('head', 'idle')) {
        const headShare = neck ? 0.07 : 0.18
        pose.head.x += cHead.x * headShare
        pose.head.z += cHead.z * headShare
      }
    }

    /**
     * Tay KHÔNG còn ở đây: IK trong `applyArms` (cuối `writePose`) đặt cả chuỗi từ vị trí đích.
     * Idle chỉ để lại hai thứ IK cần — nhịp `s` (sway đích) và `shift` (dồn trọng tâm) — và vai.
     */
    idleS = s
    idleShift = shift
    if (owns('arms', 'idle') && armMode === 'natural') {
      /**
       * Vai theo nhịp THỞ (§12): hít vào nhô lên (dương = nâng), thở ra thả xuống. Cùng tần số
       * `π/2` với lồng ngực để là MỘT chuyển động; lệch pha nhẹ vì vai đi sau ngực một nhịp. Vai
       * nhô thì gốc tay trên dời → IK kéo cả chuỗi theo — tay "bám" thân, không phải gắn vào.
       */
      const breath = Math.sin(s * (Math.PI / 2) - 0.3) * 0.012
      pose.shoulderL += breath
      pose.shoulderR += breath * 0.85
      // Dồn trọng tâm (§11): `shift` > 0 = hông dịch sang trái = chân trụ trái → vai trái hạ,
      // vai phải nâng bù. Bàn tay bên trụ sát thân hơn — `applyArms` đọc `idleShift`.
      if (armDebug.weightShift) {
        pose.shoulderL -= shift * WEIGHT_SHIFT_ARM.shoulderRad
        pose.shoulderR += shift * WEIGHT_SHIFT_ARM.shoulderRad
      }
    }

    /**
     * Đầu xoay theo con trỏ — **tự xoay xương, không trông chờ `vrm.lookAt`**.
     *
     * `lookAt` của nhiều model (nhất là VRM 0.x) chỉ điều khiển **mắt** qua blendshape
     * `lookLeft/lookRight`, không hề xoay đầu — nên dù nó chạy đúng thì nhìn vẫn gần như không
     * thấy gì, đúng như user phản hồi hai lần. Xoay thẳng xương `head` thì model nào cũng thấy.
     *
     * Đuổi theo dần chứ không gán thẳng: gán thẳng thì đầu giật theo từng pixel chuột.
     * Hệ số tính theo **thời gian** (`damp`) chứ không theo frame — nhân `0.12` mỗi frame thì ở
     * 60fps đuổi nhanh gấp đôi 30fps, mà FPS là tuỳ chọn của user.
     */
    const aimYaw = lookOn && cursor ? Math.max(-0.55, Math.min(0.55, cursor.x * 0.5)) : 0
    const aimPitch = lookOn && cursor ? Math.max(-0.3, Math.min(0.3, -cursor.y * 0.28)) : 0
    const kAim = damp(AIM_SPEED, dt)
    headAim.yaw += (aimYaw - headAim.yaw) * kAim
    headAim.pitch += (aimPitch - headAim.pitch) * kAim

    if (owns('head', 'idle')) {
      // Nhiều tần số không chia hết cho nhau → nhịp không lặp lại thấy rõ
      pose.head.y += Math.sin(s * 0.31) * 0.1 + Math.sin(s * 0.13) * 0.05 + glance.yaw + headAim.yaw
      pose.head.x += Math.sin(s * 0.23) * 0.05 + glance.pitch + headAim.pitch
      pose.head.z += Math.sin(s * 0.19) * 0.05
    }
    // Thân trên hơi xoay theo hướng nhìn — người thật không vặn mỗi cổ
    if (owns('spine', 'idle')) pose.spine.y += headAim.yaw * 0.25
  }

  /**
   * Cử chỉ nhỏ, thưa (§3): thỉnh thoảng nhúc nhích vai/khuỷu một nhịp rồi thôi.
   *
   * Tần suất thấp là **cố ý** — cử chỉ gặp thường xuyên thì hết là cử chỉ và thành tật máy móc.
   * Vào/ra bằng `pulse` nên không có điểm gãy nào.
   */
  let microAt = performance.now() + 8000
  let microEnd = 0
  let microSide = 1
  function microTick(now: number): void {
    if (now >= microAt) {
      microEnd = now + 1600
      microSide = Math.random() < 0.5 ? 1 : -1
      microAt = nextActionAt('micro', now, Math.random)
    }
    if (now >= microEnd) return
    const g = pulse(1 - (microEnd - now) / 1600)
    if (owns('arms', 'micro') && armMode === 'natural' && armDebug.micro) {
      // Một bên vai nhích lên một nhịp — chỉ một bên. Tay không tự cử động: IK giữ bàn tay yên,
      // vai nhô làm cả chuỗi khẽ đổi dáng — đúng cách người thật "nhúc nhích" (§16)
      if (microSide > 0) pose.shoulderL += g * 0.02
      else pose.shoulderR += g * 0.02
    }
    if (owns('head', 'micro')) pose.head.z += g * 0.02 * microSide
  }

  /**
   * Tư thế theo trạng thái hệ thống (§7) — **giữ liên tục**, không phải một cú giật.
   *
   * Khác với phản ứng khi click: cái đó là một nhịp rồi hết, còn cái này là dáng người trong
   * suốt lúc hệ thống đang có vấn đề, nên phải nội suy vào/ra chứ không bật tắt.
   *
   * Chỉ có ba mức (normal/warning/critical) vì app chỉ cấp được ngần đó tín hiệu — xem
   * `statusForEvent`.
   */
  let status: AvatarStatus = 'normal'
  let statusUntil = 0
  /** Mức độ tư thế lo lắng đang hiện, 0..1 — nội suy để đổi trạng thái không giật. */
  let statusAmt = 0
  function statusTick(now: number, dt: number): void {
    if (status !== 'normal' && now >= statusUntil) status = 'normal'
    const target = status === 'critical' ? 1 : status === 'warning' ? 0.45 : 0
    statusAmt += (target - statusAmt) * damp(1.2, dt)
    if (statusAmt < 0.01) return
    if (owns('head', 'status')) {
      // Hơi cúi và nghiêng đầu: dáng "đang chú ý vào chuyện gì đó không ổn"
      pose.head.x += statusAmt * 0.06
      pose.head.z += statusAmt * 0.03
    }
    if (owns('spine', 'status')) pose.spine.x += statusAmt * 0.02
  }

  /**
   * Phản ứng khi bị chạm vào (§4): **một nhịp rồi trả về chỗ cũ**.
   *
   * Đã thử hai kiểu trước và bỏ: nhún lên xuống (trông như bị đè), rồi lắc nghiêng qua lại
   * (user nói giật — vì nghiêng người là chuyển động của mất thăng bằng). Xoay quanh trục đứng
   * là phản xạ "quay lại xem ai đụng mình", mềm hơn hẳn.
   *
   * Đi MỘT chiều rồi về, không dao động: đi-về một lần đọc ra là một cử chỉ có chủ ý, còn dao
   * động qua lại luôn ra vẻ bị va đập. Mỗi lần bốc một kiểu khác trong `REACTIONS`.
   */
  function reactTick(now: number): void {
    if (!reaction || now >= reaction.until) return
    const g = pulse(1 - (reaction.until - now) / reaction.kind.durationMs)
    const dir = reaction.dir
    if (owns('spine', 'interaction')) {
      pose.spine.y += g * dir * reaction.kind.turn
      pose.chest.y += g * dir * reaction.kind.turn * 0.6
    }
    if (owns('head', 'interaction')) {
      // Đầu xoay NGƯỢC chiều thân một chút: mắt vẫn hướng về phía trước trong lúc người xoay
      pose.head.y -= g * dir * reaction.kind.turn * 0.3
      pose.head.z += g * dir * reaction.kind.tilt
      pose.head.x += g * reaction.kind.nod
    }
  }

  /**
   * Hành động rời lúc rảnh: cứ 6–14 giây lại ngoái nhìn đâu đó rồi quay về.
   *
   * Chuyển động tuần hoàn thuần tuý (sin) dù biên độ lớn vẫn bị nhận ra là máy móc sau vài
   * chục giây. Một cử chỉ **không đoán trước được** mới là thứ khiến nhân vật có vẻ đang nghĩ
   * gì đó. Giữ ở mức cử động đầu — không đụng tay chân để khỏi tranh với `applyArmPose`.
   */
  const glance = { yaw: 0, pitch: 0 }
  let glanceAt = performance.now() + 3000
  /** Phản ứng đang chạy khi bị click; `null` = không có. */
  let reaction: { kind: Reaction; until: number; dir: number } | null = null
  /** Kiểu phản ứng lần trước — để không bốc trúng nó hai lần liền. */
  let lastReactionId: string | null = null
  let glanceFrom = { yaw: 0, pitch: 0 }
  let glanceTo = { yaw: 0, pitch: 0 }
  let glanceEnd = 0
  /** Thời lượng cú ngoái đang chạy — `poke` đặt ngắn hơn cú ngoái lúc rảnh. */
  const GLANCE_MS = 700
  let glanceMs = GLANCE_MS

  function glanceTick(now: number, dt: number): void {
    if (now >= glanceAt) {
      glanceFrom = { ...glance }
      // Nhìn về một phía ngẫu nhiên, thỉnh thoảng ngước lên/cúi xuống
      glanceTo = {
        yaw: (Math.random() * 2 - 1) * 0.45,
        pitch: (Math.random() * 2 - 1) * 0.12
      }
      glanceEnd = now + GLANCE_MS
      glanceMs = GLANCE_MS
      glanceAt = nextActionAt('look', now, Math.random)
    }
    if (now < glanceEnd) {
      // Ease-in-out: vào/ra mượt, giữa nhanh — cử động máy móc là do chạy tuyến tính
      const e = smoothStep(1 - (glanceEnd - now) / glanceMs)
      glance.yaw = glanceFrom.yaw + (glanceTo.yaw - glanceFrom.yaw) * e
      glance.pitch = glanceFrom.pitch + (glanceTo.pitch - glanceFrom.pitch) * e
    } else if (now < glanceAt - 3000) {
      // Giữ một lúc rồi thả dần về giữa. Theo THỜI GIAN: `*= 0.985` mỗi frame thì ở 60fps
      // tan nhanh gấp đôi 30fps — cùng cấu hình cho hai cảm giác khác nhau.
      const k = 1 - damp(0.9, dt)
      glance.yaw *= k
      glance.pitch *= k
    }
  }

  /**
   * Nháy mắt + biểu cảm tạm. Tách khỏi `idle` vì phần này vẫn chạy KỂ CẢ khi có animation
   * ngoài: clip `.vrma` điều khiển xương, không điều khiển biểu cảm khuôn mặt.
   */
  /** Bật thì in trạng thái/hành động ra console (§12) — cờ dev, không lưu vào settings. */
  let debug = false
  let lastDebugAt = 0

  let blinkAt = performance.now() + 1200
  let blinkStart = -1
  /** Còn mấy cái chớp nữa trong loạt này (chớp đúp = 1). */
  let blinkLeft = 0

  function faceTick(now: number): void {
    const em = vrm.expressionManager
    if (!em) return

    if (tempExpr) {
      if (now >= tempExpr.until) {
        em.setValue(tempExpr.name, 0)
        tempExpr = null
      } else {
        // Vào nhanh ra chậm: nửa đầu giữ nguyên 1, nửa sau tắt dần cho đỡ cụt
        const left = (tempExpr.until - now) / 2000
        em.setValue(tempExpr.name, Math.min(1, left * 2))
      }
    }

    /**
     * Nháy mắt **ngẫu nhiên 3–7 giây**, thỉnh thoảng chớp đúp.
     *
     * Bản cũ dùng `s % 4.3` — chu kỳ cố định tuyệt đối. Dù 4,3 là số lẻ, mắt vẫn bắt được nhịp
     * sau vài chục giây và nhân vật lộ ra là đang chạy vòng lặp. Người thật chớp không đều, và
     * đôi khi chớp hai cái liền.
     */
    if (now >= blinkAt) {
      blinkStart = now
      blinkLeft = isDoubleBlink(Math.random) ? 1 : 0
      blinkAt = nextActionAt('blink', now, Math.random)
    }
    const bp = (now - blinkStart) / 180
    if (bp >= 0 && bp <= 1) {
      em.setValue('blink', Math.sin(bp * Math.PI))
    } else {
      em.setValue('blink', 0)
      // Cái thứ hai của chớp đúp: cách cái đầu một khoảng rất ngắn
      if (blinkLeft > 0 && now - blinkStart > 240) {
        blinkLeft -= 1
        blinkStart = now
      }
    }
  }

  /**
   * Đưa bia nhìn tới chỗ con trỏ — phần **MẮT**.
   *
   * Xương đầu đã do `idle()` tự xoay (xem `headAim`), vì `lookAt` của nhiều model chỉ điều
   * khiển mắt chứ không xoay đầu. Giữ `lookAt` ở đây để mắt cũng liếc theo trên những model
   * có khai — hai thứ cộng lại mới ra cảm giác thật sự đang nhìn mình.
   */
  function aimLook(): void {
    if (!vrm.lookAt) return
    if (!lookOn || !cursor) {
      // Không có con trỏ → nhìn thẳng vào người xem
      lookTarget.position.set(0, targetY, camera.position.z)
    } else {
      lookTarget.position.set(cursor.x * 2.2, targetY + cursor.y * 1.2, camera.position.z * 0.55)
    }
    lookTarget.updateMatrixWorld(true)
  }

  const tick = (): void => {
    raf = requestAnimationFrame(tick)
    const now = performance.now()
    acc += now - last
    last = now
    // Giới hạn FPS bằng cách BỎ frame chứ không bằng setTimeout: rAF đồng bộ với màn hình,
    // xen setTimeout vào là được giật thay vì được mượt.
    if (acc < frameMs) return
    acc = 0
    // Xương vừa dời → hộp bao của `hitTestFast` phải dựng lại; đếm frame là cách rẻ nhất báo nó
    frameNo++

    const dt = clock.getDelta()
    frameDt = dt
    /**
     * Góc thân frame này = Shift+kéo + vòng tự xoay, tính MỘT lần ở đầu: IK cần tốc độ góc để
     * tay đu theo quán tính, và cuối frame ghi đúng số này xuống scene (không gọi `spinOffset`
     * hai lần — nó có tác dụng phụ đặt mốc bắt đầu vòng xoay).
     */
    const rotY = userRotY + spinOffset(now)
    if (dt > 1e-4) {
      let d = rotY - rotPrev
      // Quấn về (−π, π]: vòng tự xoay kết thúc nhảy 2π → 0, không phải một cú giật 360°
      d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI
      // Lọc thấp: pointer event tới theo nhịp khác rAF nên góc lên theo bậc, lấy thô là tay giật
      bodyOmega += (d / dt - bodyOmega) * damp(18, dt)
    }
    rotPrev = rotY
    // Clip chạy-một-lần đã hết → GỠ mixer, trả xương lại cho lớp tự sinh ngay frame này
    if (mixer && clipEndsAt > 0 && now >= clipEndsAt) {
      mixer.stopAllAction()
      mixer = null
      clipEndsAt = 0
    }
    // Animation ngoài điều khiển xương → bỏ tư thế idle để hai nguồn không tranh nhau
    if (mixer) {
      mixer.update(dt)
      /**
       * **NEO HÔNG** khi clip yêu cầu (`anchorHips`).
       *
       * Nhiều clip `.vrma` dời cả nhân vật đi trong không gian — đo được: `reaction-startle` dời
       * **39 cm ngang và 92 cm về sau**, `pose-motion` 36 cm. Trong một game thì đúng, nhưng ở đây
       * nhân vật đứng trong khung hình hẹp ôm sát người, nên nó **đi thẳng ra khỏi khung** rồi vài
       * giây sau mới quay lại — user tả đúng: "click phát nhân vật mất tiu".
       *
       * Ghi đè SAU `mixer.update` chứ không tắt kênh: tắt kênh phải mổ clip lúc nạp, còn ghi đè
       * thì một dòng và giữ nguyên phần nhún theo trục đứng (clip ngồi xổm vẫn hạ xuống được).
       */
      if (anchorHips && hips) {
        hips.position.x = hipsRest.x
        hips.position.z = hipsRest.z
      }
    } else {
      /**
       * Một lượt cộng dồn: xoá tư thế → từng tầng CỘNG vào → ghi xuống xương MỘT lần.
       *
       * Tầng nào đang chạy thì có mặt trong `activeLayers`, và tầng ưu tiên thấp sẽ tự bỏ qua
       * những nhóm xương mà tầng cao hơn đã giành (§8). Nhờ vậy "hai animation cùng điều khiển
       * một xương" là chuyện **không thể xảy ra** chứ không phải chuyện phải nhớ tránh.
       */
      clearPose()
      activeLayers = ['idle']
      if (now < microEnd) activeLayers.push('micro')
      if (statusAmt > 0.01) activeLayers.push('status')
      if (reaction && now < reaction.until) activeLayers.push('interaction')

      glanceTick(now, dt)
      idle(now, dt)
      microTick(now)
      statusTick(now, dt)
      // Tắt được để test tư thế nghỉ không bị phản ứng chen vào (§19 "Disable interaction")
      if (armDebug.interaction) reactTick(now)
      writePose()

      // Nhịp chậm (1s) — in mỗi frame thì console ngập và chính nó làm tụt FPS
      if (debug && now - lastDebugAt > 1000) {
        lastDebugAt = now
        console.log('[avatar]', {
          layers: activeLayers.join('>'),
          status,
          gaze: { yaw: +headAim.yaw.toFixed(3), pitch: +headAim.pitch.toFixed(3) },
          glance: { yaw: +glance.yaw.toFixed(3) },
          reaction: reaction && now < reaction.until ? reaction.kind.id : null,
          expression: tempExpr?.name ?? null,
          micro: now < microEnd,
          armMode,
          armIk: {
            L: `bend ${ikInfo.left.bendDeg.toFixed(0)}° reach ${ikInfo.left.reach.toFixed(3)}`,
            R: `bend ${ikInfo.right.bendDeg.toFixed(0)}° reach ${ikInfo.right.reach.toFixed(3)}`
          },
          // Lớp nào đang bị tắt bằng `setArmDebug`
          armOff:
            Object.entries(armDebug)
              .filter(([k, v]) => k !== 'showTargets' && !v)
              .map(([k]) => k)
              .join(',') || 'none',
          // Tốc độ góc thân (rad/s) và độ đu của mỗi tay (cm) — kéo xoay mà hai số này đứng 0 là lớp quán tính không chạy
          omega: +bodyOmega.toFixed(2),
          swingCm: {
            L: +(Math.hypot(swing.left.x, swing.left.z) * 100).toFixed(1),
            R: +(Math.hypot(swing.right.x, swing.right.z) * 100).toFixed(1)
          },
          spin: spinStart ? +Math.min(1, (now - spinStart) / SPIN_MS).toFixed(2) : `in ${Math.max(0, Math.round((spinAt - now) / 1000))}s`
        })
      }
    }
    // Góc user + vòng tự xoay, ghi MỖI frame (không chỉ lúc `setRotationY`) vì offset đổi liên tục
    vrm.scene.rotation.y = baseRotationY + rotY
    faceTick(now)
    aimLook()
    // `vrm.update` chạy cả springBone; muốn tắt tóc đu đưa thì bỏ qua và tự cập nhật expression
    if (springOn) {
      vrm.update(dt)
    } else {
      vrm.expressionManager?.update()
      vrm.humanoid?.update()
    }
    /**
     * `lookAt.update` gọi TƯỜNG MINH ở CẢ HAI nhánh, sau `vrm.update`.
     *
     * Từng chỉ đặt trong nhánh springBones-tắt và tin rằng `vrm.update()` tự lo phần này —
     * **sai**: đo thật thấy `lookAt.yaw` đứng im ở 14.94 dù con trỏ ở hai phía đối nghịch, tức
     * nhìn-theo-chuột chết hẳn với mọi user để mặc định (springBones BẬT). Không lỗi nào báo.
     * Phải chạy SAU `humanoid.update()` vì nó ghi đè xương đầu.
     */
    vrm.lookAt?.update(dt)
    renderer.render(scene, camera)
  }
  /**
   * Đo bề ngang MỘT lần ở tư thế nghỉ, rồi cộng lề rộng cho chuyển động.
   *
   * Lề `WIDTH_MARGIN` = 18%, không phải 4% như bản đầu: springBone làm tóc/váy vung ra và
   * chuyển động idle còn xoay người. Đo thật trên model tóc dài thấy bề ngang nở tới **30%**
   * so với lúc đứng yên (0,42 → 0,55), nên 4% là thiếu — tóc và tay bị cắt đúng như user thấy.
   *
   * Từng thử đo nhiều mẫu rồi lấy max: **hỏng**. Mỗi vòng lặp lại thay `frameH`, nên các lần
   * đo không cùng hệ quy chiếu, sai số tích luỹ và nhân vật bị đẩy lệch hẳn khỏi tâm khung
   * (đo thật: người chỉ còn chiếm nửa dưới, chân bị cắt). Một phép đo + lề rộng thì đơn giản
   * và đúng.
   *
   * Thứ tự bắt buộc: căn camera tạm (ở trên) → đo → thay `bbW` → căn lại. Phép đo cần một
   * khung hình chắc chắn chứa trọn nhân vật, mà `Box3` tuy rộng quá nhưng **không bao giờ
   * hụt**, nên là điểm xuất phát an toàn.
   */
  // Đo ở đúng tư thế NGHỈ (mọi tầng = 0), không phải giữa một nhịp đu đưa
  clearPose()
  writePose()
  vrm.update(0.016)
  bbW = measureDrawn(THREE, renderer, scene, camera, frameH).w * WIDTH_MARGIN
  frameCamera()

  raf = requestAnimationFrame(tick)

  return {
    // Khung hình gồm cả lề, nên tỉ lệ khung = bề ngang thật ÷ chiều cao khung hình
    aspect: bbW / frameH,
    resize(w, h) {
      const nw = Math.max(1, Math.floor(w))
      const nh = Math.max(1, Math.floor(h))
      renderer.setSize(nw, nh, false)
      camera.aspect = nw / nh
      camera.updateProjectionMatrix()
      frameCamera()
    },
    setFpsCap(cap) {
      frameMs = 1000 / cap
    },
    setSpringBones(on) {
      springOn = on
    },
    setRotationY(rad) {
      // Chỉ ghi biến: `tick` cộng thêm vòng tự xoay rồi mới ghi xuống scene, nên Shift+kéo giữa
      // lúc đang tự xoay vẫn ăn — không cái nào đè cái nào
      userRotY = rad
      vrm.scene.rotation.y = baseRotationY + rad
    },
    setLookAtCursor(on) {
      lookOn = on
    },
    setTug(frac) {
      tugTarget = frac
    },
    setCursor(nx, ny) {
      cursor = nx === null || ny === null ? null : { x: nx, y: ny }
    },
    hitTest(nx, ny) {
      return hitTestFast(nx, ny)
    },
    poke() {
      const now = performance.now()
      // Mỗi lần một kiểu khác — click liên tiếp ra cùng một phản ứng thì hỏng hết vẻ tự nhiên
      const kind = pickReaction(Math.random, lastReactionId)
      lastReactionId = kind.id
      // Xoay về phía con trỏ đang đứng — quay về phía thứ vừa chạm mình mới hợp lẽ; không có
      // con trỏ thì đổi chiều so với lần trước cho đỡ lặp
      const dir = cursor ? (cursor.x >= 0 ? 1 : -1) : -(reaction?.dir ?? -1)
      reaction = { kind, until: now + kind.durationMs, dir }
      /**
       * Ngoái nhìn theo luôn — nhưng **đi qua đúng đường nội suy** của `glanceTick`, không gán
       * thẳng vào `glance`.
       *
       * Gán thẳng là một cú nhảy trong đúng một frame. Đo được: với con trỏ ở mép màn hình,
       * bước nhảy lớn nhất của `head.y` là **0,118 rad/frame** — gấp 6 lần ngưỡng mắt nhận ra
       * (0,02). Đó chính là cảm giác "giật" mà bốn vòng chỉnh biên độ trước không chạm tới,
       * vì vấn đề chưa bao giờ nằm ở biên độ mà ở chỗ chuyển động **bắt đầu** đột ngột.
       */
      glanceFrom = { ...glance }
      glanceTo = { yaw: dir * 0.12, pitch: 0.06 }
      glanceMs = 450
      glanceEnd = now + glanceMs
      glanceAt = now + 7000
      // Biểu cảm đi kèm đúng kiểu phản ứng vừa bốc, thay vì một danh sách cố định ở nơi gọi
      const em = vrm.expressionManager
      const name = em ? kind.expressions.find((n) => em.getExpression(n)) : undefined
      if (em && name) {
        if (tempExpr && tempExpr.name !== name) em.setValue(tempExpr.name, 0)
        tempExpr = { name, until: now + 2000 }
      }
      if (debug) console.log('[avatar] poke', { reaction: kind.id, dir, expression: name ?? null })
    },
    setStatus(next) {
      if (next !== status && debug) console.log('[avatar] status', status, '->', next)
      status = next
      statusUntil = performance.now() + STATUS_HOLD_MS
    },
    setDebug(on) {
      debug = on
    },
    triggerMicro() {
      microAt = performance.now()
    },
    triggerSpin() {
      spinAt = performance.now()
    },
    setArmMode(mode) {
      armMode = mode
      if (debug) console.log('[avatar] arm mode', mode)
    },
    setArmDebug(flags) {
      Object.assign(armDebug, flags)
      for (const s of ['left', 'right'] as const) {
        sph[s].target.visible = armDebug.showTargets
        sph[s].elbow.visible = armDebug.showTargets
      }
      if (debug) console.log('[avatar] arm debug', { ...armDebug })
    },
    readBoneWorldQuat(name) {
      const n = vrm.humanoid?.getNormalizedBoneNode(name as BoneName)
      if (!n) return null
      const q = n.getWorldQuaternion(new THREE.Quaternion())
      return { x: q.x, y: q.y, z: q.z, w: q.w }
    },
    readBoneWorld(name) {
      const n = vrm.humanoid?.getNormalizedBoneNode(name as BoneName)
      if (!n) return null
      // `getWorldPosition` tự cập nhật matrixWorld — không cần đợi frame kế
      const v = n.getWorldPosition(new THREE.Vector3())
      return { x: v.x, y: v.y, z: v.z }
    },
    readBone(name) {
      const n = vrm.humanoid?.getNormalizedBoneNode(name as BoneName)
      return n ? { x: n.rotation.x, y: n.rotation.y, z: n.rotation.z } : null
    },
    playExpression(names) {
      const em = vrm.expressionManager
      if (!em) return null
      // Dò xuống danh sách: `setValue` với tên model không khai là no-op IM LẶNG
      const name = names.find((n) => em.getExpression(n))
      if (!name) return null
      if (tempExpr && tempExpr.name !== name) em.setValue(tempExpr.name, 0)
      tempExpr = { name, until: performance.now() + 2000 }
      return name
    },
    listExpressions() {
      return vrm.expressionManager?.expressions.map((e) => e.expressionName) ?? []
    },
    listParts() {
      return parts.map((p) => ({ name: p.name, visible: p.object.visible }))
    },
    setPartVisible(name, visible) {
      const p = parts.find((x) => x.name === name)
      if (p) p.object.visible = visible
    },
    async playAnimation(bytes, opts) {
      // Bỏ clip đang chạy trước, kể cả khi lượt mới lỗi — thà về idle còn hơn kẹt nửa vời
      mixer?.stopAllAction()
      mixer = null
      clipEndsAt = 0
      anchorHips = opts?.anchor === true
      if (!bytes) return

      const vrmaMod = await import('@pixiv/three-vrm-animation')
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
      const l: InstanceType<typeof GLTFLoader> = new GLTFLoader()
      l.register((parser) => new vrmaMod.VRMAnimationLoaderPlugin(parser))

      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'model/gltf-binary' }))
      try {
        const g = await l.loadAsync(url)
        const anim = (g.userData.vrmAnimations as unknown[] | undefined)?.[0]
        if (!anim) throw new Error('File không chứa animation VRM (.vrma)')
        const clip = vrmaMod.createVRMAnimationClip(anim as never, vrm)
        const m = new THREE.AnimationMixer(vrm.scene)
        const action = m.clipAction(clip)
        /**
         * **Chạy MỘT lần rồi tự về idle** khi `opts.once` — đây là thứ biến một clip thành "phản
         * ứng" thay vì một vòng lặp bất tận.
         *
         * `clampWhenFinished` để tư thế không giật về frame 0 ở nhịp cuối; việc trả quyền cho lớp
         * tự sinh do `clipEndsAt` trong `tick` lo, vì `mixer` phải bị gỡ hẳn chứ không chỉ dừng.
         */
        if (opts?.once) {
          action.setLoop(THREE.LoopOnce, 1)
          action.clampWhenFinished = true
          clipEndsAt = performance.now() + clip.duration * 1000
        }
        action.play()
        mixer = m
      } finally {
        URL.revokeObjectURL(url)
      }
    },
    dispose() {
      cancelAnimationFrame(raf)
      mixer?.stopAllAction()
      mixer = null
      // `deepDispose` đi hết cây con để giải phóng geometry/material/texture. Bỏ bước này
      // thì mỗi lần mở lại panel là thêm ~44 MB VRAM không ai thu hồi.
      vrmMod.VRMUtils.deepDispose(vrm.scene)
      // Cầu debug nằm ở `scene` (không phải `vrm.scene`) nên `deepDispose` không đụng tới
      sphGeo.dispose()
      for (const s of ['left', 'right'] as const) {
        ;(sph[s].target.material as import('three').Material).dispose()
        ;(sph[s].elbow.material as import('three').Material).dispose()
      }
      scene.clear()
      renderer.dispose()
      // Trả context WebGL ngay: Chromium chỉ cho ~16 context đồng thời, hết thì context cũ
      // bị thu hồi và canvas khác hoá đen — lỗi trông như "ngẫu nhiên".
      renderer.forceContextLoss()
      // Gỡ luôn canvas: nó đã chết hẳn sau `forceContextLoss`, để lại chỉ tổ chồng thẻ rỗng
      canvas.remove()
    }
  }
}

/**
 * Đo bề ngang mà nhân vật **thật sự chiếm**, theo đơn vị scene, bằng cách render ra một
 * target ngoài màn hình rồi quét alpha.
 *
 * Vì sao không dùng `Box3`: với skinned mesh nó lấy theo **bind pose** (T-pose, tay giang
 * ngang), nên rộng gần gấp đôi thân người sau khi đã hạ tay. Không có lỗi nào báo; chỉ nhìn
 * mới thấy.
 *
 * Render vuông (aspect 1) và khớp chiều cao khung hình `frameH`, nên tỉ lệ pixel ngang quy
 * thẳng ra đơn vị scene: `bề ngang = tỉ lệ pixel × frameH`.
 *
 * Quét ở 192px vì chỉ cần mép trái/phải — đọc một lần lúc dựng là rẻ.
 */
function measureDrawn(
  THREE: typeof import('three'),
  renderer: import('three').WebGLRenderer,
  scene: import('three').Scene,
  camera: import('three').PerspectiveCamera,
  frameH: number
): { w: number; h: number; cy: number } {
  const S = 192
  const target = new THREE.WebGLRenderTarget(S, S)
  const prevTarget = renderer.getRenderTarget()
  // Camera dùng chung với sân khấu thật: phải trả `aspect` + vị trí về đúng cũ, nếu không
  // khung hình trên màn hình méo sau phép đo.
  const prevAspect = camera.aspect
  const prevZ = camera.position.z

  try {
    // Khung hình vuông cao đúng `frameH`: quy đổi pixel → đơn vị scene mới thẳng được
    camera.aspect = 1
    camera.updateProjectionMatrix()
    camera.position.z = frameH / 2 / Math.tan((camera.fov * Math.PI) / 360)
    renderer.setRenderTarget(target)
    renderer.render(scene, camera)

    const buf = new Uint8Array(S * S * 4)
    renderer.readRenderTargetPixels(target, 0, 0, S, S, buf)

    let minX = S
    let maxX = -1
    let minY = S
    let maxY = -1
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        // Ngưỡng 8 thay vì 0: viền khử răng cưa để lại alpha rất nhỏ quanh bóng nhân vật,
        // lấy > 0 là bắt luôn cả sương mờ và khung lại phình ra như cũ.
        if (buf[(y * S + x) * 4 + 3] > 8) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }

    // Không vẽ được gì (model rỗng, đo hụt): giữ nguyên ước lượng cũ thay vì trả 0 làm khung
    // sập còn 0px — thà rộng thừa còn hơn biến mất
    if (maxX < 0 || maxY < 0) return { w: frameH * 0.6, h: frameH, cy: 0 }

    // +1 vì cả hai mép đều là pixel có vẽ.
    // `cy` = tâm dọc của bóng nhân vật lệch bao nhiêu so với tâm khung hình, theo đơn vị
    // scene. Thiếu số này thì khung hình mới ôm đúng cỡ nhưng đặt sai chỗ, người lệch lên
    // hoặc xuống. Trục Y của ảnh WebGL hướng LÊN nên không đảo dấu.
    const midPix = (minY + maxY + 1) / 2
    return {
      w: ((maxX - minX + 1) / S) * frameH,
      h: ((maxY - minY + 1) / S) * frameH,
      cy: ((midPix - S / 2) / S) * frameH
    }
  } finally {
    renderer.setRenderTarget(prevTarget)
    camera.aspect = prevAspect
    camera.position.z = prevZ
    camera.updateProjectionMatrix()
    target.dispose()
  }
}
