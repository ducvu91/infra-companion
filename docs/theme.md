# Theme bố cục — ý tưởng để dành làm sau

> Ghi lại đề xuất theme thứ 3 (2026-09-05) sau khi v0.2.18 ra hai theme đầu. **Bản đầu của Workbench đã làm
> ở v0.2.20** (activity bar + panel phụ kéo được); **panel đáy đã làm ở v0.2.22** (`components/workbench/BottomPanel.tsx`,
> 3 tab Monitoring / Log / Tunnels, `Ctrl+J`, state `ui.workbenchBottom*`). Đọc kèm
> [TIEP-TUC-PHIEN-SAU.md](./TIEP-TUC-PHIEN-SAU.md) để biết các theme được nối vào đâu.

## Hiện có gì (v0.2.18)

| Theme | Cột trái | Vùng chính khi không tab nào mở | Điểm thiếu |
|---|---|---|---|
| **Infra mặc định** | Cây host theo nhóm, sổ ra tại chỗ, có khối tunnel/snippet/workspace bật tắt | Dashboard | Muốn xem tunnel/snippet thì bật khối → cột dài ra |
| **Navigator** (kiểu Termius) | Menu 9 mục (Dashboard · Hosts · SFTP · Tunnels · Snippets · Keys · Workspaces · History · Tools — **Dashboard mặc định TẮT** từ v0.2.21, home = Hosts, thanh tab không có 🏠), không sổ gì; **sửa được** qua ⚙ (tick/kéo, Hosts khoá tick; `stores/navMenu.ts` + `visibleNavMenu`/`startupNavSection` ở shared) | Mục đang chọn (trang Hosts, History, Tunnels…); trang danh sách xếp **2 cột** khi vùng chính ≥ 48rem (container query `@3xl`) | Bấm mục nào là **rời terminal** để về vùng chính |
| **Workbench** (kiểu VS Code, v0.2.20) | Activity bar 48px + panel phụ kéo được 200–520px (Hosts = Sidebar cũ `fluid`; Tunnels/Snippets/Workspaces = khối + Quản lý…; Keys/Tools gọn; History) | Dashboard; **panel đáy** (v0.2.22, `Ctrl+J`): Monitoring (card lưới, thay dock nổi ở theme này) · Xem log (`LogTailModal embedded fill`) · Tunnels (`TunnelsModal embedded`), kéo mép trên 120–600px | Pill AI chẩn đoán vẫn nổi (chưa vào panel đáy) |

Cách nối: `settings.layout` (`infra.layout`) → `App.tsx` chọn `<NavRail/>` hay `<Sidebar/>`,
`HomeView` (`features/navigator/NavigatorHome.tsx`) chọn vùng chính; mục đang chọn ở `ui.navSection`;
danh sách mục ở `features/navigator/nav.ts`. Thêm theme = thêm một giá trị `LayoutTheme` + một nhánh ở
hai chỗ đó + một ô chọn kèm hình xem trước trong `SettingsModal` (`LayoutPreview.tsx`).

---

## Đề xuất chính: **Workbench** (kiểu VS Code) — ✅ bản đầu đã làm ở v0.2.20

> **Đã làm:** activity bar (`components/workbench/ActivityBar.tsx`), panel phụ kéo được (`SidePanel.tsx`),
> state `ui.workbenchPanel` / `ui.workbenchPanelWidth`, `Sidebar fluid`, khối SidebarBlocks có prop `limit`,
> lệnh palette `wb-*`, hình xem trước. **v0.2.22:** panel đáy (`BottomPanel.tsx`, 3 tab, `Ctrl+J`, nút ⬒ trên
> activity bar, palette `wb-bottom-*`; Monitoring ở theme này vào panel thay dock nổi — quyết định 3 nghiêng
> về "một chỗ thôi" đã chọn). **v0.2.25 — hai lỗi phát hiện khi dùng thật:** (1) **danh sách host không
> cuộn được** — `Sidebar fluid` thiếu `h-full min-h-0 flex-1`, mà `min-height:auto` mặc định của flex item
> cho nó cao bằng nội dung nên khu `flex-1 overflow-y-auto` bên trong **không có trần để cuộn**: fleet
> nhiều host thì mấy host cuối tràn khỏi panel và không cách nào tới được (nhánh không-fluid không bị vì
> nó là con trực tiếp của `flex min-h-0 flex-1` ở App); thêm luôn `shrink-0` cho hàng ô tìm và hàng nút
> đáy để danh sách dài không bóp chúng. (2) **panel đáy không có cách nào tự lộ ra** — mặc định đóng,
> mà chỗ bật duy nhất là icon `⬒` không nhãn ở đáy activity bar, tức phải đoán ra là có panel rồi mới đi
> tìm nút; nay có nút **⬒ Panel có CHỮ trên StatusBar** (chỉ theme này) và `Ctrl+J` đã vào
> `lib/shortcutList.ts` → hiện ở cheat sheet Dashboard + thẻ Phím tắt của Trợ giúp — đó mới là nơi người
> ta đến tra khi không tìm được đường vào. **Chưa làm:** pill AI chẩn đoán vào panel đáy; quyết định 2
> (Dashboard vẫn là home).

**Một câu:** thanh icon dọc bên trái chọn *panel phụ* hiện gì, panel phụ nằm cạnh, còn vùng chính
**luôn là terminal**. Duyệt danh bạ mà không phải rời màn hình đang làm việc.

```
┌──┬──────────┬──────────────────────────────────┐
│🖥│ HOSTS    │ tab1 │ tab2 │ tab3            🏠  │
│🔀│ ▾ Prod   │                                  │
│📝│   app-01 │      terminal / dashboard        │
│🔑│   app-02 │                                  │
│🪟│ ▸ Staging│                                  │
│🕒│          ├──────────────────────────────────┤
│⊞ │          │ 📊 Monitoring · 🪵 Log · 🔀 Tunnel│  ← panel đáy (Ctrl+J)
│⚙ │          │  app-01 load 0.4  RAM 62%  ...   │
└──┴──────────┴──────────────────────────────────┘
```

### Vì sao đáng làm
Hai theme hiện có cùng thiếu một thứ: **duyệt một loại khác (tunnel, snippet, key) trong khi terminal
vẫn đang hiện**. Infra thì phải bật thêm khối làm cột dài; Navigator thì phải về home. Workbench tách
ba việc ra ba vùng: *chọn loại* (activity bar) · *duyệt* (panel phụ) · *làm việc* (vùng chính). Đây là
bố cục người dùng terminal cả ngày quen tay nhất.

### Từng vùng
- **Activity bar** (48px): chính là NavRail thu gọn. Mục đang chọn sáng; bấm lại mục đang chọn thì
  đóng/mở panel phụ. Cài đặt + Trợ giúp ghim đáy.
- **Panel phụ** (240–320px, **kéo đổi bề rộng**, nhớ qua localStorage): mỗi mục một nội dung.
  - Hosts = cây group sổ tại chỗ như Infra, có ô tìm + quick-connect (dùng lại `renderGroups` của
    `Sidebar.tsx`, cần tách ra component riêng).
  - Tunnels / Snippets / Workspaces = ba khối đã có trong `SidebarBlocks.tsx`, bỏ giới hạn 8 dòng.
  - Keys = `KeysModal embedded`. History = `HistoryView`. Tools = danh mục công cụ (`FeaturesTabView`
    hoặc bản hẹp của `ToolsMenu`).
  - `Ctrl+Shift+H` đóng panel phụ nhưng **giữ activity bar**.
- **Panel đáy** (mới, tuỳ chọn): chỗ ở cố định cho những thứ hôm nay đang **nổi lơ lửng**: MonitorDock,
  pill AI chẩn đoán, Watch a log, Tunnels. Có tab như VS Code, `Ctrl+J` ẩn/hiện, kéo cao thấp. Mở
  Monitoring ở theme này là vào panel đáy thay vì dock góc phải.
- **Vùng chính**: y hệt hiện tại; Dashboard vẫn là home khi không tab nào mở.

### Tận dụng được gì
Gần như toàn bộ: activity bar = NavRail; cây host = phần render group của Sidebar; ba khối =
SidebarBlocks; Keys/History đã nhúng được; Monitoring đã tách khỏi vòng đời modal từ v0.1.9. Phần
**thật sự mới**: panel đáy có tab + kéo cao thấp, và kéo đổi bề rộng panel phụ. Ước lượng công: **vừa**,
nhỏ hơn Navigator vì không có trang mới.

### Việc cần tách trước khi làm (refactor không đổi hành vi)
1. Tách `renderGroups` + `HostRow` khỏi `Sidebar.tsx` thành `HostTree.tsx` để Infra và Workbench dùng chung.
2. Bỏ `BLOCK_LIMIT` thành prop của ba khối trong `SidebarBlocks.tsx` (sidebar giữ 8, panel phụ không giới hạn).
3. Cho `MonitorDock` render được ở chế độ "nhúng" (không `absolute` góc phải).

### Phải quyết trước khi làm
1. Panel đáy có trong bản đầu không, hay đợt sau (bản đầu chỉ activity bar + panel phụ đã là một theme trọn vẹn).
2. Dashboard giữ làm home, hay đổi thành "trang trống + gợi ý" như VS Code.
3. Mở Monitoring ở panel đáy thì có bỏ MonitorDock nổi **ở theme này** không (nghiêng về bỏ: một chỗ thôi).
4. Tên hiển thị: "Workbench" / "Bàn làm việc" / "IDE".

### Checklist test GUI (khi làm xong)
- Đổi theme → activity bar hiện, panel phụ mở đúng mục đã nhớ, terminal đang mở không bị đụng.
- Bấm mục đang chọn → panel đóng; bấm lại → mở, bề rộng như cũ; `Ctrl+Shift+H` tương tự.
- Kéo bề rộng panel phụ → terminal fit lại (ResizeObserver sẵn có), khởi động lại vẫn giữ.
- Mở Monitoring → xuất hiện ở panel đáy, không có dock nổi; `Ctrl+J` ẩn/hiện; đóng tab monitoring thì
  polling vẫn chạy như quy ước hiện tại (chỉ nút Dừng mới tắt).
- Đổi về Infra/Navigator → mọi thứ như cũ; MonitorDock nổi quay lại.

---

## Hai hướng khác (chỉ ghi ý)

### Ops Console (ba cột, cho người trực production)
Trái: danh bạ. Giữa: terminal. **Phải: cột trạng thái sống** (dải Cần chú ý, Monitoring, Tunnels
bật/tắt tại chỗ, replication). Home là **bảng fleet**: mỗi host một ô có chấm sống/chết + sparkline
load 24h, bấm là mở. Thêm **thanh lệnh** dưới cùng kiểu Spotlight (quick-connect, chạy snippet, bulk).
Đây là thứ Termius không có. Công: **lớn** vì cột phải và bảng fleet là hai thứ mới hoàn toàn (dữ liệu
thì đã có: `useWatcherStore`, `useMonitorStore`, `collectAttention`, `metrics.db`).

### Launcher / Zen (bàn phím là chính)
Không sidebar, thanh tab tự ẩn khi không hover, điều hướng duy nhất là **ô tìm ở giữa màn hình** kiểu
Spotlight: gõ ra host, snippet, tunnel, công cụ. Home = ô tìm lớn + vài dòng gần đây. Công: **nhỏ** vì
Command Palette đã có; giá phải trả là người mới khó khám phá tính năng. Hợp làm theme phụ, không nên
là mặc định.

---

## Lưu ý chung khi thêm bất kỳ theme nào
- Theme là **bố cục**, không đụng dữ liệu: host/nhóm/tunnel giữ nguyên, chỉ đổi cách bày. Ghi rõ trong
  mô tả ô chọn để người dùng dám thử.
- Mọi mảnh nên là component **nhúng được** (`embedded`) thay vì viết bản thứ hai — bài học từ
  `ModalOrPanel` và v0.2.18.
- Vẽ xong phải **tự chụp màn hình** bằng harness Electron (`apps/desktop/out/harness`, cách dựng ghi
  trong handoff v0.2.18): cả ba bẫy layout của v0.2.17 lẫn lỗi menu bị cắt của v0.2.18 đều chỉ lộ khi
  nhìn hình, typecheck/test không thấy.
- Hình xem trước trong Settings vẽ bằng div (`LayoutPreview.tsx`) để đổi màu theo dark/light + accent.
