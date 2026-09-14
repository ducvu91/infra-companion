# F70 — Nhân vật VRM: sổ tay chỉnh sửa

Tài liệu này để **quay lại chỉnh nhanh**, không phải để học lại từ đầu. Mỗi mục nói: muốn đổi cái
gì thì sửa ở đâu, con số hiện tại là bao nhiêu, và **vì sao nó là con số đó** — phần cuối quan
trọng nhất, vì gần như mọi con số ở đây đều là kết quả đo, không phải chọn cho đẹp.

Quy ước: đường dẫn tương đối từ gốc repo. "Đo được" nghĩa là có script đo thật trên model thật,
không phải ước lượng.

---

## 1. Bản đồ file

| File | Chứa gì |
|---|---|
| `packages/shared/src/vrmArmPose.ts` | **Toàn bộ số liệu tư thế tay** + IK + 3 mô phỏng vật lý. Hàm thuần, có test. |
| `packages/shared/src/vrmIdle.ts` | Tầng ưu tiên, nhịp chớp mắt/liếc/cử chỉ, phản ứng khi click, vòng tự xoay. |
| `packages/shared/src/vrmChat.ts` | Chat AI trên đầu nhân vật, nhận lệnh "mở tunnel…", câu gợi ý thao tác. |
| `packages/shared/src/vrmOutfit.ts` | Bộ trang phục user tự lưu. |
| `packages/shared/src/vrmFraming.ts` | Căn khung hình, biểu cảm theo sự kiện, dấu xoay theo phiên bản VRM. |
| `packages/shared/src/vrm.ts` | DTO cấu hình (`VrmSettingsDto`). |
| `apps/desktop/src/renderer/src/lib/vrmStage.ts` | **Sân khấu 3D**. Không phụ thuộc React. Nơi duy nhất chạm vào xương. |
| `apps/desktop/src/renderer/src/components/VrmPanel.tsx` | Khung React, chuột/phím, menu tròn, cài đặt. |
| `apps/desktop/src/renderer/src/components/VrmRadialMenu.tsx` | Menu tròn, bảng hai bên, bong bóng chat + bong bóng thoại. |
| `apps/desktop/src/renderer/src/components/VrmOverlayApp.tsx` | Nhân vật hiện **ngoài desktop** khi app ở khay. |
| `apps/desktop/src/main/overlay.ts` | Cửa sổ overlay ở main: khi nào hiện, khi nào ẩn. |
| `apps/desktop/src/main/ipc/vrm.ts` | Danh bạ model, cấu hình, trang phục — ghi xuống `userData`. |
| `packages/core/src/vrm/*.test.ts` | Test cho mọi hàm thuần ở trên. |

**Ranh giới bắt buộc**: mọi thứ tính toán nằm ở `packages/shared` (renderer dùng được, có test).
`apps/**` không được vitest quét nên đừng đặt logic ở đó.

---

## 2. Kiến trúc tư thế — đọc mục này trước khi sửa bất cứ chuyển động nào

Mỗi frame chạy đúng một vòng: **xoá tư thế → từng tầng CỘNG vào → ghi xuống xương một lần**.

```
clearPose()                       // mọi giá trị về 0
  ↓ idle()        — thở, đung đưa, nhìn theo chuột, lớp kéo
  ↓ microTick()   — cử chỉ nhỏ thưa thớt
  ↓ statusTick()  — dáng người khi hệ thống có cảnh báo
  ↓ reactTick()   — phản ứng khi bị click
writePose()                       // NƠI DUY NHẤT gán vào bone.rotation / bone.position
  └── applyArms()                 // IK tay, chạy cuối vì cần vai đã dời xong
```

**Vì sao phải vậy**: trước đây mỗi chuyển động tự ghi thẳng vào xương, nên thứ tự dòng code quyết
định ai thắng — đã mắc lỗi "hai nguồn cùng ghi một xương" **ba lần**. Giờ muốn thêm chuyển động
mới thì cộng vào `pose`, không bao giờ gán thẳng vào xương ngoài `writePose`.

**Tầng ưu tiên** (`vrmIdle.ts`, hàm `isClaimedByHigher`): chỉ tầng `critical` mới giành xương.
Các tầng còn lại cộng dồn. Đây là bài học đau: lúc đầu cho `micro`/`status`/`interaction` giành
xương đầu, kết quả là click một cái thì đầu giật 31 độ và đứng hình 16 giây khi có cảnh báo.

---

## 3. Tay — bảng số liệu

Tất cả ở `packages/shared/src/vrmArmPose.ts`. Sửa số ở đây là đổi ngay, không cần đụng stage.

### 3.1 Tư thế nghỉ (`NATURAL_REST`)

| Tham số | Trái | Phải | Ý nghĩa |
|---|---|---|---|
| `lateralFrac` | 0.75 | 0.85 | Bàn tay cách tâm thân, theo tỉ lệ bề rộng hông |
| `lateralM` | 0.015 | 0.02 | Cộng thêm (mét) |
| `forwardM` | 0.05 | 0.065 | Bàn tay ra trước hông (mét) |
| `reach` | 0.988 | 0.992 | Với bao nhiêu phần chiều dài tay |
| `poleOut` | 0.2 | 0.25 | Khuỷu hé ra ngoài |
| `poleBack` | 0.95 | 0.92 | Khuỷu hé ra sau |
| `palmBack` | 0.25 | 0.45 | Lòng bàn tay xoay ra sau |
| `shoulderDrop` | 0.035 | 0.03 | Vai hạ (radian) |

**Hai bên cố ý lệch nhau.** Đối xứng tuyệt đối là dấu hiệu rõ nhất của hình nộm. Có test chặn
việc vô tình làm chúng bằng nhau.

**`reach` phải 0.98–0.995, đừng hạ thấp.** Định lý cos: hai khúc bằng nhau, với 95,5% chiều dài
thì khuỷu gập **34 độ** (đo đúng vậy trên model thật, user gọi là "cong rõ rệt"). 99% mới ra 15
độ. Người đứng thả lỏng gập 10–18 độ.

**Muốn khuỷu sát eo hơn nữa**: giảm `poleOut`, tăng `poleBack`. Đừng để `poleOut` về 0, khuỷu sẽ
ép vào sườn và xuyên qua thân ở model gầy. Test chặn ở mức 0.1.

### 3.2 Khuỷu trôi (`ELBOW_DRIFT`) — chống "đơ ở cùi chỏ"

| Tham số | Giá trị | Ý nghĩa |
|---|---|---|
| `swingRad` | 0.2 | Biên độ quay khuỷu quanh trục vai→tay (~11 độ) |
| `freqA` / `freqB` | 0.21 / 0.34 | Hai tần số, cố ý không chia hết cho nhau |
| `reachAmp` | 0.006 | Đổi độ với đi kèm (mét) |

**Đây là bậc tự do thứ ba của khớp vai.** IK hai xương chỉ quyết định được vị trí bàn tay; khuỷu
còn xoay tự do quanh trục vai→tay mà không làm bàn tay nhúc nhích. Bản đầu để cố định nên khuỷu
nằm chết một điểm — user nhìn ra ngay.

**Đo được**: dải quét của khuỷu trong 12 giây đi từ 0 lên **2,6–3,9 cm ngang, 2,1–2,8 cm
trước-sau, độ gập đổi 9–14 độ**. Muốn kiểm lại thì đo **khuỷu**, đừng đo bàn tay — bàn tay đứng
yên theo thiết kế.

### 3.3 Tay theo hướng nhìn (`LOOK_ARM`)

| Tham số | Giá trị | Ý nghĩa |
|---|---|---|
| `forwardPerRad` | 0.055 | Tay đưa trước/lùi sau mỗi radian góc nhìn (mét) |
| `lateralPerRad` | 0.022 | Tay sát thân thêm |
| `polePerRad` | 0.35 | Khuỷu mở theo |

Quay đầu sang trái thì thân vặn theo: tay trái lùi, tay phải đưa tới. Đo được bàn tay dịch
**5,7 cm** giữa nhìn hết trái và hết phải.

### 3.4 Tay đu quán tính khi xoay người (`ARM_SWING`)

Con lắc tắt dần. Lực vào là vận tốc góc của thân, đầu ra là độ lệch đích bàn tay.

| Tham số | Giá trị | Ý nghĩa |
|---|---|---|
| `drag` | 5.5 | Kéo ngược theo vận tốc tiếp tuyến |
| `stiffness` | 40 | Lò xo kéo về (chu kỳ ~1 giây) |
| `damping` | 7 | Giảm chấn, hệ số tắt ~0,55 → lố một nhịp rồi yên |
| `maxM` | 0.06 | Biên tối đa (mét) |
| `maxDt` | 0.05 | Kẹp bước thời gian |

**`maxDt` bắt buộc phải có.** Tab ẩn rồi hiện lại cho bước thời gian hàng giây, tích phân Euler sẽ
nổ và tay văng ra ngoài.

Đo được ở ~6 rad/s: tay trái +5,5 cm, tay phải −5,6 cm (cùng hướng thế giới, đúng kiểu tay treo
lỏng), dừng 2,5 giây thì về chỗ cũ.

### 3.5 Các lớp nhỏ

- `WEIGHT_SHIFT_ARM` — dồn trọng tâm: chân trụ bên nào thì vai bên đó hạ, tay sát thân hơn.
- `MICRO_ARM` — vi chuyển động khi giữ tư thế, vài mm chu kỳ dài.
- `FINGER_CURL` — ngón cong tăng dần trỏ < giữa < nhẫn < út, tất cả dưới 30 độ.
  `FINGER_CURL_RIGHT_SCALE` 0.92 cho tay phải cong ít hơn chút.

---

## 4. Kéo nhân vật (`TUG`) — thao tác và vật lý

### 4.1 Ba kiểu kéo

| Thao tác | Kết quả |
|---|---|
| **Kéo trần** trên thân người | Níu nhân vật: cả người nghiêng, buông là bật về |
| **Ctrl + kéo** | Dời nhân vật đi chỗ khác (nhớ vị trí) |
| **Shift + kéo** | Xoay người |
| Kéo trần ở **góc khung trống** | Vẫn dời như cũ |

Đổi phím ở `VrmPanel.tsx` (`onPointerDown`) và `useDraggablePanel.ts` (cờ `requireCtrl`).

### 4.2 Số liệu lò xo

| Tham số | Giá trị | Ý nghĩa |
|---|---|---|
| `radPerFrac` | 0.55 | Kéo 1 phần bề rộng khung = bao nhiêu radian nghiêng |
| `maxRad` | 0.3 | Trần nghiêng (~17 độ) |
| `stiffness` | 36 | Lò xo về 0 |
| `damping` | 5 | Hệ số tắt ~0,42 → nảy một nhịp |
| `followSpeed` | 14 | Bám theo chuột lúc đang giữ |

### 4.3 Phân bổ lên cơ thể (trong `vrmStage.ts`, hàm `idle`)

| Bộ phận | Hệ số | Ghi chú |
|---|---|---|
| Cột sống | 0.42 | |
| Ngực | 0.26 | |
| Đầu | 0.2 | Đi sau thân một nhịp |
| Hông xoay | 0.18 | **Chỉ lớp kéo.** Idle luôn để 0 |
| Hông trượt ngang | 0.055 | Mét |
| Gối gập | 1.4 | Kéo hết cỡ ra 23–27 độ |

**Ba điều tuyệt đối không làm với chân** (mỗi điều đều đã mắc và đã sửa):

1. **Không xoay hông lúc đứng yên.** Hông là gốc bộ xương, xoay là chân vung sang hai bên như bị
   treo cổ. Chỉ lớp kéo được xoay, và khi đó chân cũng chống lại nên cả khối dịch cùng nhau.
2. **Không xoay đùi.** Xương chân treo từ hông nên xoay đùi làm cẳng chân và bàn chân đu như con
   lắc: đo được **trượt 10,7 cm**, giảm hệ số xuống vẫn 5 cm. Không có IK chân để ghim bàn chân.
   Chỉ gập gối, với đùi và cẳng chân ngược dấu nhau.
3. **Không hạ hông để "hạ trọng tâm".** Hạ gốc bộ xương là cả người tụt, chân lún qua mép khung.
   Trọng tâm hạ do gối gập, rồi bù lại bằng `measureKneeLift`.

### 4.4 `measureKneeLift` — vì sao phải đo chứ không tính

Gập gối làm người thấp xuống, phải nâng hông đúng lượng đó thì bàn chân mới đứng yên.

Đã thử hai công thức hình học, cả hai sai:

| Cách | Kết quả |
|---|---|
| `legLen · (1 − cos(θ/2))` | Chân **nhấc lên 4,6 cm** |
| `legLen · (1 − cos(θ/4))` | Vẫn nhấc 2–3,3 cm, hai model lệch nhau gần gấp đôi |
| **Đo trên rig** | Lệch **dưới 0,33 cm** ở mọi mức kéo, mọi model |

Cách đo: ghi góc gối lên xương, gọi `updateWorldMatrix`, đọc `leftFoot.y` tụt bao nhiêu so với
lúc nghỉ. Chính con số đó là lượng cần nâng. Có nhớ đệm theo góc gối nên lúc đứng yên không chạy.

**Bài học chung**: hình học đúng trên giấy vẫn sai khi tỉ lệ đùi/cẳng chân/bàn chân mỗi rig một
khác. Đo thẳng trên rig rẻ hơn và đúng mọi model.

---

## 5. Hiệu năng — hai cái bẫy đã sập

### 5.1 `hitTest` từng làm app đứng hình

Bản đầu dùng `Raycaster.intersectObject(scene, true)` — quét **từng tam giác** của skinned mesh.

| Model | Một lần gọi |
|---|---|
| Lily (921 nghìn đỉnh) | **277 ms** |
| Carlotta (1,1 triệu đỉnh) | **181 ms** |

Mỗi cú di chuột gọi nhiều lần, nên mỗi lần chạm là đứng hình hơn một phần tư giây. Người dùng báo
là "model lag, kéo giật" và tưởng model lỗi.

Nay dùng **hộp bao xương** (`hitTestFast`): lấy ~20 khớp đã có sẵn ma trận từ `writePose`, chiếu
lên màn hình, kiểm con trỏ trong hộp. **200 lần gọi tốn 0,2–0,9 ms tổng.**

Hai hằng số:

- `HIT_PAD` = 0.12 — nới hộp bù tóc/váy không có xương.
- `HIT_PAD_TOP` = 0.42 — nới **riêng phía trên**, vì xương đầu nằm ở chân sọ còn đỉnh đầu, tóc mái,
  tai thú thì cao hơn nhiều. Với biên 0.12 thì bấm đỉnh đầu bị trả "trượt", mà đó là chỗ người ta
  hay chạm nhất.

Đánh đổi có chủ ý: hộp rộng hơn thân thật nên bấm sát mép váy vẫn tính trúng. Chấp nhận được cho
việc "trúng người hay trúng nền".

### 5.2 Model nặng không phải là nguyên nhân lag

Đo Lily 75 MB, 921 nghìn đỉnh, 585 morph target, 35,9 triệu phép morph mỗi frame (gấp 12 lần model
thường): vẫn chạy **120 FPS** ở khung to, vừa xoay vừa bật vật lý tóc váy.

**Bài học đo**: đừng chỉ đo FPS. Ở đây FPS hoàn toàn bình thường trong khi một lần gọi chuột tốn
277 ms. Phải đo thẳng hàm bị nghi, và đo ở kích thước khung thật — harness khung nhỏ cho 120 FPS ở
mọi model nên không phân biệt được gì.

---

## 6. Hai loại rig — bẫy dấu xoay

VRM 1.0 và VRM 0.x **lật dấu trục X và Z** của xương tay và chân. Cùng một góc dương làm bàn chân
ra trước ở rig này, ra sau ở rig kia. Trục Y không lật.

Xử lý: `armSignFor(metaVersion)` trong `vrmFraming.ts` trả về 1 hoặc −1. Dùng cho vai, ngón tay,
và **cả chân**.

Với 0.x còn một bẫy nữa: `VRMUtils.rotateVRM0` xoay scene 180 độ quanh Y, nên quaternion thế giới
của xương cha mang sẵn phép xoay đó. Công thức ghi xương phải là `Q_world = qM · R_model · restQ`.
Thiếu `restQ` thì tay chỉ thẳng lên trời — đã mắc thật.

**Luôn kiểm trên cả hai loại model trước khi tin.** Trong `D:/vrm` có sẵn cả hai.

---

## 7. Các lớp khác

### 7.1 Nhịp idle (`vrmIdle.ts`)

| Hằng số | Giá trị |
|---|---|
| Chớp mắt | 3–7 giây, 15% là chớp đúp |
| Liếc nhìn | 8–15 giây |
| Cử chỉ nhỏ | 15–30 giây |
| Giữ dáng khi có cảnh báo | 12 giây |
| Tự xoay một vòng | mỗi 2–3 phút, quay trong 8 giây |

### 7.2 Chat và gợi ý (`vrmChat.ts`)

- Giữ 8 lượt hội thoại, không ghi xuống đĩa.
- Nhận lệnh mở công cụ bằng **so khớp từ khoá, không gọi AI**: mở panel là việc chắc đúng hoặc
  chắc sai, qua AI chỉ thêm độ trễ và chỗ để đoán sai.
- **Không dùng `\b` trong regex tiếng Việt.** `\b` của JS chỉ biết ASCII nên `\bmở\b` không bao giờ
  khớp — mọi câu có dấu lặng lẽ bị bỏ qua, không lỗi nào báo. Dùng lookaround `\p{L}` với cờ `u`.
- Gợi ý thao tác: lần đầu sau 25 giây, rồi 3–6 phút một câu, **chỉ gợi thao tác chưa làm**, làm hết
  thì im hẳn. Nhớ qua `localStorage`.

### 7.3 Nhân vật ngoài desktop

Khi app thu vào khay hoặc thu nhỏ mà có thông báo, một cửa sổ trong suốt hiện ở góc phải dưới.

- Điều kiện: có model đang chọn, bật "Phản ứng khi có cảnh báo" và "Hiện ngoài desktop khi app ở khay".
- Không cướp focus (`showInactive`), tự ẩn sau 15 giây, chuột để lên thì giữ.
- Bấm vào nhân vật là mở lại app.
- Cửa sổ tạo lười ở thông báo đầu tiên rồi giữ lại, vì nạp model mất 4–7 giây.
- Bong bóng thoại ở đây dùng nền **đục** (`opaque`), vì nền 20% alpha đặt trên wallpaper thì không
  đọc được — đã chụp thử và thấy.

### 7.4 Công tắc chẩn đoán

Gõ trong console khi app đang chạy, không cần build lại:

```js
avatarArmMode('natural')            // đầy đủ (mặc định)
avatarArmMode('rest')               // tay buông cạnh đùi, đứng yên
avatarArmMode('zero')               // T-pose, thấy rest pose thật của rig
avatarArmDebug({ elbow: false })    // tắt khuỷu trôi + tay theo hướng nhìn
avatarArmDebug({ swing: false })    // tắt quán tính đu khi xoay
avatarArmDebug({ showTargets: true })  // hiện cầu đánh dấu đích tay và khuỷu
avatarDebug(true)                   // in trạng thái mỗi giây
avatarSpin()                        // xoay một vòng ngay
```

---

## 8. Cách đo lại khi sửa

Có sẵn bộ đo ở `apps/desktop/_harness/` (không commit). Cách dùng:

```bash
cd apps/desktop
pnpm exec vite build --config _harness/vite.config.ts
cd _harness
# QUAN TRỌNG: bỏ biến này, nó đang được set sẵn cho vitest và sẽ làm require('electron') hỏng
unset ELECTRON_RUN_AS_NODE
../../../node_modules/.bin/electron.cmd run.cjs "D:/vrm/<file>.vrm" <tên>
```

Kết quả in ra console, ảnh lưu ở `_harness/shots/`.

**Bốn cái bẫy của harness** (đều đã sập ít nhất một lần):

1. Đặt harness **trong** `apps/desktop`, không phải gốc repo — nếu không Tailwind không sinh class.
2. `show: true` bắt buộc. `show: false` chặn `requestAnimationFrame`, animation đứng im và trông
   như không render.
3. `capturePage` ném lỗi khi cửa sổ đang vẽ WebGL liên tục — phải thử lại vài lần, đừng kết luận
   trang hỏng.
4. Đo ở **kích thước khung thật**. Khung nhỏ cho 120 FPS ở mọi model.

---

## 9. Thêm trường vào cấu hình — nhớ đủ 3 chỗ

`VrmSettingsDto` phải sửa ở **ba** nơi, thiếu một chỗ là giá trị bị nuốt lúc ghi mà không lỗi nào báo:

1. `packages/shared/src/vrm.ts` — khai báo + `DEFAULT_VRM_SETTINGS`
2. `apps/desktop/src/main/ipc/vrm.ts` — hàm `readSettings()`
3. `apps/desktop/src/main/ipc/vrm.ts` — object `clean` trong handler ghi

---

## 10. Giấy phép model — kiểm trước khi đưa bất cứ file nào vào repo

Repo này **public**. Đưa một file `.vrm` vào là phát tán nó cho mọi người tải, nên phải chắc chắn
giấy phép cho phép **phân phối lại**, không chỉ "cho dùng".

Có sẵn công cụ đọc giấy phép nhúng trong file:

```bash
node scripts/vrm-license.cjs "đường/dẫn/model.vrm"
```

Nó đọc `VRMC_vrm.meta` (VRM 1.0) hoặc `VRM.meta` (0.x) và kết luận ngắn gọn. Quét bộ model thử
nghiệm cho thấy khoảng một nửa ghi rõ **cấm phân phối lại**, nên đừng bỏ qua bước này.

⚠️ **Metadata không phải là giấy phép hợp lệ trong mọi trường hợp.** Với nhân vật game thương mại
được ai đó chuyển sang VRM, metadata do **người chuyển đổi** tự điền, mà họ không phải chủ sở hữu
bản quyền nhân vật. Một file ghi "cho phân phối lại" vẫn có thể vi phạm bản quyền của hãng game.
Chỉ đưa vào repo những model mà **tác giả gốc** công bố giấy phép cho phép, tốt nhất là CC0.

### 10.1 Model mẫu nên dùng

**Sendagaya Shino (千駄ヶ谷篠)** — nhân vật nữ anime, đồng phục học sinh, tóc dài đen.

| | |
|---|---|
| Tác giả | pixiv Inc. (dự án VRoid) |
| Giấy phép | **CC0** — pixiv tuyên bố từ bỏ toàn bộ quyền |
| Tải | `https://opengameart.org/sites/default/files/sendagaya_shino.zip` |
| Kích thước | 14,2 MB (zip 11,7 MB) |
| sha256 (file .vrm) | `f11b2648e7e588ae171ad1c32e465f84e5b130b1d1789e3a3702946c0981d2a9` |
| Phiên bản | VRM 0.x |

Metadata nhúng đã tự kiểm bằng `scripts/vrm-license.cjs`: `redistribution=allow`,
`credit=unnecessary`, `modification=allow`, `corporate_commercial_use=allow`. Vì là CC0 nên
**không bắt buộc ghi công**, nhưng vẫn nên ghi tên pixiv trong tài liệu cho phải phép.

Đã chạy thật qua bộ đo: khuỷu gập 11,8 và 19,3 độ, lòng bàn tay hướng vào thân, tay buông cạnh
đùi đúng thiết kế. Nhẹ hơn nhiều so với model nặng (708 nghìn đỉnh, 10 MB texture).

**Phương án hai**: `VRM1_Constraint_Twist_Sample.vrm` của pixiv, chính là model demo mà thư viện
`three-vrm` dùng. Ưu điểm là **VRM 1.0 gốc**, tránh hẳn bẫy lật dấu ở mục 6. Nhược điểm là nhân
vật mẫu kỹ thuật, áo thun quần đùi, không đẹp bằng. Tải từ
`https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm`.

⚠️ **Bẫy trùng tên**: bộ mẫu `AvatarSample_A–G` và `VRoidPreset_A–Z` **của VRoid Studio bản hiện
tại KHÔNG phải CC0** — trang chính thức của VRoid cấm rõ việc phát tán lại chúng dưới danh nghĩa
CC0. Chỉ bộ alpha cũ đăng trên OpenGameArt mới là CC0, mà chúng **trùng tên** với bộ mới. Luôn
kiểm metadata của đúng file mình có, đừng tin cái tên.

### 10.2 Cách đăng model mẫu lên GitHub Release

Model **không nhúng vào app** — 14 MB sẽ vào mọi bản cài của mọi người, kể cả phần lớn không bao
giờ bật nhân vật. App tải về khi user bấm nút, lưu vào `userData/vrm-samples/`.

App tải từ **release của chính repo này**, không trỏ thẳng sang trang gốc: link bên thứ ba chắc
chắn sẽ chết theo thời gian (đã dính với runtime của local dev), và tải từ domain mình không kiểm
soát thì không bảo đảm được nội dung. Giấy phép CC0 cho phép host lại.

Làm một lần, không cần lặp mỗi lần phát hành app.

**File đã chuẩn bị sẵn**: `D:\vrm\_release\sendagaya-shino.vrm` (14.870.776 byte, sha256 đã đối
chiếu khớp hằng số trong code). Nếu cần làm lại từ đầu:

```bash
curl -L -o shino.zip "https://opengameart.org/sites/default/files/sendagaya_shino.zip"
unzip shino.zip                               # ra "Sendagaya Shino.vrm"
mv "Sendagaya Shino.vrm" sendagaya-shino.vrm
sha256sum sendagaya-shino.vrm                 # phải ra f11b2648e7e5…
node scripts/vrm-license.cjs sendagaya-shino.vrm
```

**Đăng lên GitHub** (máy này chưa cài `gh` CLI nên làm qua trang web):

1. Mở https://github.com/xShiroeNguyenx/infra-companion/releases/new
2. Ô **Choose a tag**: gõ `vrm-sample-v1` rồi bấm **Create new tag: vrm-sample-v1 on publish**
3. **Release title**: `Model mẫu VRM`
4. **Describe this release**:
   ```
   Sendagaya Shino — model mẫu cho tính năng nhân vật 3D.
   Tác giả: pixiv Inc. (dự án VRoid). Giấy phép: CC0.
   https://vroid.pixiv.help/hc/en-us/articles/360013482714-Sendagaya-Shino
   ```
5. Kéo thả file `D:\vrm\_release\sendagaya-shino.vrm` vào ô **Attach binaries**
6. Chờ tải xong 14 MB rồi bấm **Publish release**

Sau đó kiểm link app sẽ gọi:

```bash
curl -sIL "https://github.com/xShiroeNguyenx/infra-companion/releases/download/vrm-sample-v1/sendagaya-shino.vrm" | grep -i "^HTTP\|^content-length"
```

Phải thấy `HTTP/2 200` và `content-length: 14870776`.

Nếu muốn dùng `gh` CLI cho nhanh (cài từ https://cli.github.com), lệnh tương đương:

```bash
gh release create vrm-sample-v1 "D:/vrm/_release/sendagaya-shino.vrm" \
  --title "Model mẫu VRM" \
  --notes "Sendagaya Shino (CC0) — pixiv Inc."
```

**Tag tách riêng (`vrm-sample-v1`) là cố ý**: model không đổi theo phiên bản app, gắn nó vào tag
phát hành thì mỗi lần ra bản mới lại phải đính kèm 14 MB đó thêm một lần.

**Thay model khác thì phải sửa 2 chỗ cùng lúc**: `sha256` và `url` trong
`packages/shared/src/vrmSample.ts`. Sai mã băm thì mọi lượt tải đều bị từ chối ở bước kiểm — đúng
theo thiết kế, nhưng sẽ khó hiểu nếu quên vì sao.

**Cơ chế bảo vệ khi tải** (đã kiểm bằng server giả lập, cả 4 tình huống):

| Tình huống | App làm gì |
|---|---|
| Tải đúng | Nhận, kiểm mã băm, thêm vào danh bạ, chọn luôn |
| File bị sửa dù chỉ 1 byte | Mã băm lệch → xoá file, báo rõ lý do |
| Link chuyển hướng sai (trang lỗi, trang đăng nhập) | Dừng khi vượt 130% dung lượng dự kiến |
| Link chết | Thử mirror, hết thì báo lỗi mạng |

Ghi ra file `.part` rồi mới đổi tên, nên đứt mạng giữa chừng không để lại file cụt mà lần sau app
tưởng là model hợp lệ.

---

## 10.3 Thư viện chuyển động `.vrma`

13 clip **CC0** tải theo yêu cầu vào `userData/vrm-motions/`. Danh mục ở
`packages/shared/src/vrmMotion.ts`, nối vào nhân vật qua `lib/useVrmMotion.ts`.

⚠️ **Bộ "VRMA_MotionPack" chính thức của pixiv KHÔNG được đưa vào repo.** Điều khoản của nó cấm
*"distributing these motions or their alterations without permission in a way that can be rigged
or extracted"* — đặt file vào repo hay release là đúng hành vi đó. User tự tải rồi dùng nút "Nạp
file .vrma" thì hợp lệ, đó là chuyện giữa họ và pixiv.

**Vai trò clip** (`VrmMotionRole`): `idle` · `chat` · `poke` · `alert` · `recover` · `inspect` ·
`manual`. Vai trò `idle` có **nhiều clip luân phiên** — xoay vòng qua `nextMotionForRole`, không
bốc ngẫu nhiên vì ngẫu nhiên sẽ ra cùng một clip hai ba lần liền.

**Ba điều bắt buộc khi thêm clip mới:**

1. **Đo `sha256` và `durationSec` từ chính file đã tải**, đừng chép từ mô tả. Nhiều clip không khai
   `min`/`max` trong accessor nên phải đọc thẳng buffer mới ra thời lượng thật.
2. **Đo bề ngang lúc clip chạy.** Khung hình chỉ rộng `WIDTH_MARGIN` (2,2×) so với tư thế đứng —
   clip rộng hơn thế bị cắt tay. Đo được: xem điện thoại 0,92× · đứng thư giãn 1,32× · tạo dáng
   1,92× · ăn mừng 2,16× · **máy bay 3,55×** (vì vậy máy bay chỉ ở nhóm `manual`).
3. **Kiểm clip có dời nhân vật đi không.** Đo `hips` translation: `reaction-startle` dời **53 cm
   ngang, 97 cm sau**. Clip tự chạy luôn bật `anchor: true` để ghim tại chỗ; chỉ clip
   `locomotion` do user chọn tay mới được đi.

**Chạy một lần rồi trả quyền** (`playAnimation(bytes, { once: true })`): stage tự gỡ mixer khi hết
clip. Dùng đồng hồ chứ không nghe sự kiện `finished` — sự kiện đó chỉ dừng action, mixer vẫn treo
và lớp tự sinh vẫn bị bỏ qua, nhân vật đứng chết ở frame cuối.

⚠️ **Clip chạy = tắt toàn bộ lớp tự sinh** (nhìn theo chuột, kéo níu, tay đu quán tính). Chỉ chớp
mắt và biểu cảm còn chạy vì chúng nằm ngoài khối đó. Vì vậy clip `idle` chạy **thưa** (90–180s một
lần) chứ không lặp liên tục, và có trần 25s cho clip tự chạy.

---

## 11. Danh sách lỗi đã sửa, để không lặp lại

| Triệu chứng | Nguyên nhân thật |
|---|---|
| Model lag, kéo giật, tưởng model lỗi | `Raycaster` trên skinned mesh, 277 ms mỗi lần gọi |
| Chỉ eo trở lên phản ứng khi kéo | Lực kéo chỉ cộng vào cột sống/ngực/đầu |
| Chân lệch xuống, xuyên thanh trạng thái | Hạ hông = hạ gốc bộ xương |
| Không thấy gối nhún | Biên độ 0.3 chỉ cho 4,8 độ |
| Chân trượt như đứng trên băng | Xoay đùi làm cả chân đu như con lắc |
| Tay đơ ở cùi chỏ | Vector định hướng khuỷu là hằng số |
| Khuỷu chìa ra như chống nạnh | `poleOut` 0.7 quá cao |
| Tay chỉ thẳng lên trời ở VRM 0.x | Thiếu `restQ` trong công thức ghi xương |
| Nhân vật như bị treo cổ | Xoay `hips.rotation.z` lúc đứng yên |
| Đầu giật 31 độ khi click | Tầng thấp giành nhóm xương của tầng idle |
| Chuyển động nhanh gấp đôi ở 60 FPS | Nội suy theo frame thay vì theo thời gian |
| Câu tiếng Việt có dấu không nhận lệnh | `\b` của JS chỉ biết ASCII |
| Tích vào ô "Hiện lúc mở app" không ăn | `setPointerCapture` làm đứt chuỗi sinh `click` |
| Ctrl+R làm mất hết tab | Menu mặc định của Electron nuốt phím trước trang |
| Đổi model báo lỗi `precision` | `forceContextLoss` giết vĩnh viễn canvas cũ |
| Khung hình rộng gấp đôi | `Box3` đo theo bind pose (T-pose, tay giang) |
