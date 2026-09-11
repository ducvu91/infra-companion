/** Tên các kênh IPC giữa main ↔ renderer. Mọi nơi phải dùng hằng số này, không hardcode chuỗi. */
export const IPC = {
  SHELLS_LIST: 'shells:list',

  VAULT_STATUS: 'vault:status',
  VAULT_SETUP: 'vault:setup',
  VAULT_UNLOCK: 'vault:unlock',
  VAULT_LOCK: 'vault:lock',
  VAULT_LOCKED_EVENT: 'vault:locked',

  GROUPS_LIST: 'groups:list',
  GROUPS_SAVE: 'groups:save',
  GROUPS_DELETE: 'groups:delete',

  HOSTS_LIST: 'hosts:list',
  HOSTS_SAVE: 'hosts:save',
  HOSTS_DELETE: 'hosts:delete',

  KEYS_LIST: 'keys:list',
  KEYS_GENERATE: 'keys:generate',
  KEYS_IMPORT: 'keys:import',
  KEYS_DELETE: 'keys:delete',

  HISTORY_LIST: 'history:list',

  SNIPPETS_LIST: 'snippets:list',
  SNIPPETS_SAVE: 'snippets:save',
  SNIPPETS_DELETE: 'snippets:delete',

  TUNNELS_LIST: 'tunnels:list',
  TUNNELS_SAVE: 'tunnels:save',
  TUNNELS_DELETE: 'tunnels:delete',
  TUNNELS_START: 'tunnels:start',
  TUNNELS_STOP: 'tunnels:stop',
  TUNNELS_STATES: 'tunnels:states',
  TUNNELS_EVENT: 'tunnels:event',
  /** Bật mọi tunnel có cờ `autoStart` — renderer gọi MỘT lần sau khi vault mở (main tự chặn lần 2). */
  TUNNELS_AUTOSTART: 'tunnels:autostart',
  /** Tách bảng tunnel ra CỬA SỔ RIÊNG always-on-top (như monitor) để theo dõi khi app bị che. */
  TUNNELS_OPEN_DETACHED: 'tunnels:open-detached',
  TUNNELS_CLOSE_DETACHED: 'tunnels:close-detached',
  /** Event → cửa sổ chính: cửa sổ tách rời đang mở hay đã đóng (để đổi nhãn nút). */
  TUNNELS_DETACHED_STATE: 'tunnels:detached-state',

  TERM_CREATE: 'terminal:create',
  TERM_WRITE: 'terminal:write',
  TERM_RESIZE: 'terminal:resize',
  TERM_KILL: 'terminal:kill',
  TERM_DATA: 'terminal:data',
  TERM_EXIT: 'terminal:exit',
  TERM_STATUS: 'terminal:status',
  TERM_LOG_TOGGLE: 'terminal:log-toggle',
  TERM_LOG_OPEN_FOLDER: 'terminal:log-open-folder',
  TERM_RECORD_TOGGLE: 'terminal:record-toggle',
  TERM_SET_ACTIVE: 'terminal:set-active',

  REC_LIST: 'rec:list',
  REC_READ: 'rec:read',
  REC_OPEN_FOLDER: 'rec:open-folder',
  REC_DELETE: 'rec:delete',

  SERIAL_LIST: 'serial:list',

  SFTP_OPEN: 'sftp:open',
  SFTP_CLOSE: 'sftp:close',
  SFTP_LIST: 'sftp:list',
  SFTP_HOME: 'sftp:home',
  SFTP_MKDIR: 'sftp:mkdir',
  SFTP_RENAME: 'sftp:rename',
  SFTP_DELETE: 'sftp:delete',
  SFTP_CHMOD: 'sftp:chmod',
  SFTP_DOWNLOAD: 'sftp:download',
  SFTP_UPLOAD: 'sftp:upload',
  SFTP_EDIT: 'sftp:edit',
  TRANSFER_EVENT: 'transfer:event',

  VNC_OPEN: 'vnc:open',
  VNC_CLOSE: 'vnc:close',

  RDP_OPEN: 'rdp:open',
  RDP_CLOSE: 'rdp:close',
  RDP_LIST: 'rdp:list',
  RDP_EVENT: 'rdp:event',

  FS_ROOTS: 'fs:roots',
  FS_HOME: 'fs:home',
  FS_LIST: 'fs:list',
  FS_MKDIR: 'fs:mkdir',
  FS_RENAME: 'fs:rename',
  FS_DELETE: 'fs:delete',

  IMPORT_SSH_CONFIG: 'import:ssh-config',
  /** Nhập từ client SSH khác: chọn file → xem trước; đọc PuTTY Registry (Windows); ghi vault. */
  IMPORT_CLIENT_PICK: 'import:client-pick',
  IMPORT_CLIENT_PUTTY_REGISTRY: 'import:client-putty-registry',
  IMPORT_CLIENT_COMMIT: 'import:client-commit',
  IMPORT_DO_CONFIG: 'import:do-config',
  IMPORT_DO_SAVE_ACCOUNT: 'import:do-save-account',
  IMPORT_DO_DELETE_ACCOUNT: 'import:do-delete-account',
  IMPORT_DO_LIST: 'import:do-list',
  IMPORT_DO_RUN: 'import:do-run',

  BULK_RUN: 'bulk:run',
  BULK_CANCEL: 'bulk:cancel',
  BULK_EVENT: 'bulk:event',

  NET_PING: 'net:ping',
  NET_DNS: 'net:dns',
  NET_PORT: 'net:port',
  NET_SCAN: 'net:scan',
  NET_FETCH_IMAGE: 'net:fetchImage',

  MONITOR_START: 'monitor:start',
  MONITOR_STOP: 'monitor:stop',
  MONITOR_STOP_ALL: 'monitor:stop-all',
  MONITOR_SAMPLE: 'monitor:sample',
  MONITOR_ALERT: 'monitor:alert',
  // Cửa sổ chỉ-nhận-sample (không tự start SSH) — dùng cho cửa sổ monitor tách rời
  MONITOR_SUBSCRIBE: 'monitor:subscribe',
  MONITOR_STOPPED: 'monitor:stopped',
  MONITOR_OPEN_DETACHED: 'monitor:open-detached',
  MONITOR_CLOSE_DETACHED: 'monitor:close-detached',
  MONITOR_DETACHED_INIT: 'monitor:detached-init',
  MONITOR_DETACHED_STATE: 'monitor:detached-state',
  MONITOR_GET_SETTINGS: 'monitor:get-settings',
  MONITOR_SET_SETTINGS: 'monitor:set-settings',
  MONITOR_TEST_WEBHOOK: 'monitor:test-webhook',
  METRICS_QUERY: 'metrics:query',
  METRICS_HOSTS: 'metrics:hosts',

  // F39 — uptime/port watcher nền: check TCP cả fleet định kỳ, không mở session
  WATCHER_START: 'watcher:start',
  WATCHER_STOP: 'watcher:stop',
  WATCHER_STATUS: 'watcher:status',

  // F33/F34 — công cụ host qua kênh exec riêng (process viewer + systemd manager)
  HTOOLS_PROCS: 'htools:procs',
  HTOOLS_KILL: 'htools:kill',
  HTOOLS_SERVICES: 'htools:services',
  HTOOLS_SERVICE_ACTION: 'htools:service-action',
  HTOOLS_SERVICE_LOGS: 'htools:service-logs',
  // F49 — đọc nội dung 1 file trên host qua kênh exec riêng (cho tính năng so sánh config)
  HTOOLS_READ_FILE: 'htools:read-file',

  // F55 — theo dõi bất đồng bộ master ↔ slave (MySQL/MariaDB)
  REPL_LIST_PAIRS: 'repl:list-pairs',
  REPL_SAVE_PAIR: 'repl:save-pair',
  REPL_DELETE_PAIR: 'repl:delete-pair',
  REPL_TEST_PAIR: 'repl:test-pair',
  REPL_WATCH: 'repl:watch',
  REPL_UNWATCH: 'repl:unwatch',
  REPL_POLL_NOW: 'repl:poll-now',
  REPL_SAMPLE: 'repl:sample',
  REPL_ALERT: 'repl:alert',
  // Cửa sổ chỉ-nhận-sample (không tự mở kết nối) — cùng cơ chế MONITOR_SUBSCRIBE
  REPL_SUBSCRIBE: 'repl:subscribe',
  REPL_GET_SETTINGS: 'repl:get-settings',
  REPL_SET_SETTINGS: 'repl:set-settings',
  REPL_COMPARE: 'repl:compare',
  REPL_CHECKSUM: 'repl:checksum',
  // F59 — lịch sử các lần so lệch (để đối chiếu khi vá dữ liệu qua nhiều ngày)
  REPL_HISTORY_LIST: 'repl:history-list',
  REPL_HISTORY_GET: 'repl:history-get',
  REPL_HISTORY_DELETE: 'repl:history-delete',
  REPL_HISTORY_CLEAR: 'repl:history-clear',

  AI_GET_CONFIG: 'ai:get-config',
  AI_SET_CONFIG: 'ai:set-config',
  AI_ASK: 'ai:ask',
  AI_DIAGNOSE_EXEC: 'ai:diagnose:exec',
  AI_DIAGNOSE_SAVE: 'ai:diagnose:save',
  AI_DIAGNOSE_LIST: 'ai:diagnose:list',
  AI_DIAGNOSE_GET: 'ai:diagnose:get',
  AI_DIAGNOSE_DELETE: 'ai:diagnose:delete',

  // Codex agent — nhúng `codex app-server` (JSON-RPC/JSONL qua stdio).
  // Xác thực kế thừa từ `codex login` của user; app KHÔNG đọc ~/.codex/auth.json và không có
  // API key nào ở đây.
  CODEX_STATUS: 'codex:status',
  // Probe ĐẦY ĐỦ (có chạy một turn thật) — TỐN TOKEN của gói user, chỉ gọi khi user chủ động bấm.
  CODEX_PROBE: 'codex:probe',
  CODEX_PICK_BINARY: 'codex:pick-binary',
  /**
   * Tải/cập nhật Codex CLI vào thư mục app (qua npm).
   *
   * Cần vì `codex update` của chính CLI **không dùng được** với bản do Codex desktop app quản
   * ("Could not detect the Codex installation method"), mà bản cũ thì làm mọi model lỗi.
   */
  CODEX_INSTALL_CLI: 'codex:install-cli',
  /** main → renderer: từng dòng output của npm, để UI hiện tiến độ. */
  CODEX_INSTALL_EVENT: 'codex:install-event',
  CODEX_PICK_CWD: 'codex:pick-cwd',
  /**
   * Thư mục làm việc mặc định — thư mục vừa dùng, hoặc một thư mục code hay gặp mà TỒN TẠI THẬT.
   * Kênh riêng chứ không nhồi vào settings: settings là thứ user ghi, còn cái này app suy ra.
   */
  CODEX_DEFAULT_CWD: 'codex:default-cwd',
  /** Model dùng được + mức suy luận của từng cái (từ model/list). */
  CODEX_MODELS: 'codex:models',
  /** Đổi model/mức suy luận cho phiên đang mở. */
  CODEX_SET_MODEL: 'codex:set-model',
  /** Liệt kê phiên cũ (Codex tự lưu ở ~/.codex/sessions). */
  CODEX_THREADS: 'codex:threads',
  /** Mở lại một phiên cũ và chat tiếp. */
  CODEX_RESUME: 'codex:resume',
  CODEX_GET_SETTINGS: 'codex:get-settings',
  CODEX_SET_SETTINGS: 'codex:set-settings',
  CODEX_SESSION_START: 'codex:session:start',
  CODEX_SESSION_STOP: 'codex:session:stop',
  /** Snapshot để renderer dựng lại UI sau reload (phiên vẫn sống ở main). */
  CODEX_SNAPSHOT: 'codex:snapshot',
  // Ba kênh dưới là `ipcMain.on` (fire-and-forget) — không có gì để trả, kết quả về qua
  // CODEX_EVENT. Khuôn TERM_WRITE / LOCALDEV_RUNTIME_CANCEL.
  CODEX_TURN_SEND: 'codex:turn:send',
  CODEX_TURN_CANCEL: 'codex:turn:cancel',
  /** main → renderer, gộp 100ms (trừ `closed` phải đi ngay). */
  CODEX_EVENT: 'codex:event',
  // Tài khoản: đăng nhập / đổi tài khoản / đăng xuất NGAY TRONG APP.
  // App-server có sẵn `account/*` qua JSON-RPC nên không phải bắt user mở terminal chạy
  // `codex login` — và `account/read` KHÔNG tốn token (không gọi model).
  CODEX_LOGIN_START: 'codex:login:start',
  CODEX_LOGIN_CANCEL: 'codex:login:cancel',
  CODEX_LOGOUT: 'codex:logout',
  /** main → renderer: login xong (thành công/thất bại) hoặc tài khoản vừa đổi. */
  CODEX_LOGIN_EVENT: 'codex:login-event',
  // Profile = một CODEX_HOME riêng, để giữ NHIỀU tài khoản song song.
  CODEX_PROFILES: 'codex:profiles',
  CODEX_PROFILE_ADD: 'codex:profile:add',
  CODEX_PROFILE_REMOVE: 'codex:profile:remove',
  CODEX_PROFILE_USE: 'codex:profile:use',

  SYNC_STATUS: 'sync:status',
  SYNC_PICK_FOLDER: 'sync:pick-folder',
  SYNC_CONFIGURE: 'sync:configure',
  SYNC_NOW: 'sync:now',
  SYNC_DISABLE: 'sync:disable',
  // Google Drive backend — đăng nhập OAuth (loopback+PKCE) + bật sync qua Drive
  SYNC_GDRIVE_STATUS: 'sync:gdrive-status',
  SYNC_GDRIVE_LOGIN: 'sync:gdrive-login',
  SYNC_GDRIVE_LOGOUT: 'sync:gdrive-logout',
  SYNC_CONFIGURE_GDRIVE: 'sync:configure-gdrive',
  SYNC_CONFIGURE_WEBDAV: 'sync:configure-webdav',
  SYNC_CONFIGURE_S3: 'sync:configure-s3',

  // F05 — cloud import AWS/GCP/Azure (DigitalOcean có bộ kênh IMPORT_DO_* riêng từ trước)
  CLOUD_ACCOUNTS: 'cloud:accounts',
  CLOUD_SAVE_ACCOUNT: 'cloud:save-account',
  CLOUD_DELETE_ACCOUNT: 'cloud:delete-account',
  CLOUD_LIST_INSTANCES: 'cloud:list-instances',
  /** P30 — xuất hosts ra ssh_config/CSV/JSON (bản xuất KHÔNG chứa bí mật). */
  EXPORT_HOSTS: 'export:hosts',
  /**
   * Xem lại bí mật đã lưu — đường DUY NHẤT mật khẩu được phép qua IPC sang renderer,
   * và chỉ cho MỘT bản ghi mỗi lần, sau khi nhập lại master password.
   */
  /** F43 — đẩy public key lên host rồi đăng nhập thử bằng chính key đó. */
  KEY_COPY_ID: 'key:copy-id',
  /** F42 — xoay vòng key trên MỘT host (đẩy mới → xác minh → mới gỡ cũ). */
  KEY_ROTATE: 'key:rotate',
  /** F30 — theo dõi file log qua kênh exec chạy dài (không chiếm tab terminal). */
  LOG_TAIL_START: 'log-tail:start',
  LOG_TAIL_STOP: 'log-tail:stop',
  LOG_TAIL_EVENT: 'log-tail:event',
  /** F36/F37 — chẩn đoán chỉ-đọc trên host: đĩa đầy ở đâu, máy nào cần vá gì. */
  DIAG_DISK: 'diag:disk',
  DIAG_UPDATES: 'diag:updates',
  /** F35 — đọc/ghi crontab. GHI là ghi vào production: renderer phải xác nhận trước. */
  CRON_READ: 'cron:read',
  CRON_WRITE: 'cron:write',
  /** F44 — xem / quên fingerprint đã TOFU. */
  KNOWN_HOSTS_LIST: 'known-hosts:list',
  KNOWN_HOSTS_DELETE: 'known-hosts:delete',
  SECRET_REVEAL: 'secret:reveal',
  /** Chép bí mật thẳng vào clipboard TỪ MAIN — giá trị không hề đi qua renderer. */
  SECRET_COPY: 'secret:copy',
  SYNC_SET_AUTO: 'sync:set-auto',
  /** Auto-sync vừa kéo về dữ liệu mới → renderer phải nạp lại, nếu không UI đứng ở bản cũ. */
  SYNC_PULLED_EVENT: 'sync:pulled',
  SYNC_EXPORT_FILE: 'sync:export-file',
  SYNC_IMPORT_FILE: 'sync:import-file',

  PROMPT_HOSTKEY: 'prompt:hostkey',
  PROMPT_PASSWORD: 'prompt:password',
  PROMPT_ANSWER: 'prompt:answer',

  UPDATE_CHECK: 'update:check',
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_INSTALL: 'update:install',
  UPDATE_AVAILABLE: 'update:available',
  UPDATE_PROGRESS: 'update:progress',
  UPDATE_DOWNLOADED: 'update:downloaded',

  /** Trợ giúp → Gỡ rối: mở thư mục dữ liệu app. Main tự tính path, renderer KHÔNG truyền vào. */
  HELP_OPEN_USER_DATA: 'help:open-user-data',

  PLUGINS_LIST: 'plugins:list',
  PLUGINS_SET_ENABLED: 'plugins:set-enabled',
  PLUGINS_RELOAD: 'plugins:reload',
  PLUGINS_RESCAN: 'plugins:rescan',
  PLUGINS_OPEN_FOLDER: 'plugins:open-folder',
  PLUGINS_INVOKE_COMMAND: 'plugins:invoke-command',
  PLUGINS_CONTRIBUTIONS: 'plugins:contributions',
  PLUGINS_CONTRIBUTIONS_CHANGED: 'plugins:contributions-changed',
  PLUGINS_PANEL_SHOW: 'plugins:panel-show',
  PLUGINS_NOTIFY: 'plugins:notify',
  PLUGINS_PROMPT: 'plugins:prompt',

  MARKETPLACE_LIST: 'marketplace:list',
  MARKETPLACE_INSTALL: 'marketplace:install',

  // Local dev stack (Laragon/LocalWP-style): runtime tự tải, service tự supervise, site local.
  // Toàn bộ chạy trên MÁY LOCAL — không liên quan SSH. Xem plan localdev.
  LOCALDEV_ENABLED: 'localdev:enabled',
  LOCALDEV_HEALTH: 'localdev:health',
  LOCALDEV_OPEN_FOLDER: 'localdev:open-folder',

  LOCALDEV_RUNTIME_CATALOG: 'localdev:runtime-catalog',
  LOCALDEV_RUNTIME_INSTALL: 'localdev:runtime-install',
  LOCALDEV_RUNTIME_CANCEL: 'localdev:runtime-cancel',
  LOCALDEV_RUNTIME_REMOVE: 'localdev:runtime-remove',
  /** Event: tiến độ tải/giải nén runtime. */
  LOCALDEV_RUNTIME_PROGRESS: 'localdev:runtime-progress',

  LOCALDEV_SERVICES: 'localdev:services',
  LOCALDEV_SERVICE_ACTION: 'localdev:service-action',
  LOCALDEV_STOP_ALL: 'localdev:stop-all',
  /** Event: trạng thái 1 service đổi (start/stop/crash/unhealthy). */
  LOCALDEV_SERVICE_EVENT: 'localdev:service-event',

  LOCALDEV_SITES: 'localdev:sites',
  LOCALDEV_SITE_SAVE: 'localdev:site-save',
  LOCALDEV_SITE_DELETE: 'localdev:site-delete',
  LOCALDEV_SITE_OPEN: 'localdev:site-open',
  /** Mở site bằng browser Chromium có DNS override → URL không có :port, không cần hosts. */
  LOCALDEV_SITE_OPEN_NOPORT: 'localdev:site-open-noport',
  /** Dò lại loại site (static/php/wordpress) + lý do, cho form sửa site. */
  LOCALDEV_SITE_DETECT: 'localdev:site-detect',
  LOCALDEV_SITE_PICK_FOLDER: 'localdev:site-pick-folder',
  LOCALDEV_SITE_SHELL_ENV: 'localdev:site-shell-env',
  /** Event: tiến độ 1 thao tác dài trên site (tạo/xoá/clone). */
  LOCALDEV_SITE_EVENT: 'localdev:site-event',

  // Database (MariaDB do app quản) — mỗi site 1 DB + 1 user riêng
  LOCALDEV_DB_STATUS: 'localdev:db-status',
  LOCALDEV_DB_PROVISION: 'localdev:db-provision',
  LOCALDEV_DB_DUMP: 'localdev:db-dump',
  LOCALDEV_DB_IMPORT: 'localdev:db-import',
  LOCALDEV_DB_LIST: 'localdev:db-list',
  /** Mở Adminer (công cụ DB nhẹ, 1 file) để xem/sửa database bằng browser. */
  LOCALDEV_DB_ADMINER: 'localdev:db-adminer',
  /** Mở phpMyAdmin — cùng vai trò với Adminer, cho ai đã quen giao diện của XAMPP. */
  LOCALDEV_DB_PMA: 'localdev:db-pma',
  /** Ghi credential DB vào wp-config.php của site (có backup file cũ). */
  LOCALDEV_SITE_WP_CONFIG: 'localdev:site-wp-config',
  /** Đọc wp-config.php của site đang trỏ vào DB nào. */
  LOCALDEV_SITE_WP_CONFIG_READ: 'localdev:site-wp-config-read',

  LOCALDEV_LOG_TAIL: 'localdev:log-tail',
  LOCALDEV_SETTINGS_GET: 'localdev:settings-get',
  LOCALDEV_SETTINGS_SET: 'localdev:settings-set',

  /**
   * HostMap — trỏ domain sang IP chỉ định KHÔNG sửa file hosts, KHÔNG cần admin (mở browser
   * Chromium với --host-resolver-rules). Tên kênh cố ý KHÔNG phải `hosts:*` — nhóm đó là
   * server SSH trong vault, khác hoàn toàn.
   */
  HOSTMAP_STATE: 'hostmap:state',
  HOSTMAP_SAVE_GROUP: 'hostmap:save-group',
  HOSTMAP_DELETE_GROUP: 'hostmap:delete-group',
  HOSTMAP_SET_ACTIVE: 'hostmap:set-active',
  /** Mở 1 cửa sổ browser đã map domain → IP của target. */
  HOSTMAP_OPEN: 'hostmap:open',
  /** Mở song song mỗi target 1 cửa sổ (so sánh 5 con LB cùng lúc). */
  HOSTMAP_OPEN_ALL: 'hostmap:open-all',
  /** Lệnh curl --resolve tương đương để dán vào terminal. */
  HOSTMAP_CURL: 'hostmap:curl',
  /** Xoá profile browser đã sinh (đăng nhập lại từ đầu / giải phóng đĩa). */
  HOSTMAP_CLEAR_PROFILES: 'hostmap:clear-profiles',

  // ── F57: chọn font terminal ──────────────────────────────────────────────
  /** Danh sách font trên máy (đã nhớ đệm) + font user tự thêm kèm data URL. */
  FONTS_LIST: 'fonts:list',
  /** Quét lại thư mục font của hệ điều hành (sau khi user vừa cài font mới). */
  FONTS_RESCAN: 'fonts:rescan',
  /** Thêm font từ file user chọn (renderer gửi bytes, main tự đặt tên file). */
  FONTS_ADD: 'fonts:add',
  /** Đổi tên họ font đã thêm (tên này là thứ đi vào CSS font-family). */
  FONTS_RENAME: 'fonts:rename',
  FONTS_REMOVE: 'fonts:remove',

  // ── F53: khay hệ thống + chạy nền ────────────────────────────────────────
  /** Renderer báo main tuỳ chọn khay (đóng cửa sổ có thu vào khay không, ngôn ngữ menu khay). */
  APP_TRAY_PREFS: 'app:tray-prefs',

  // ── Trung tâm thông báo + đánh dấu sự kiện ───────────────────────────────
  EVENTS_LIST: 'events:list',
  EVENTS_UNREAD: 'events:unread',
  EVENTS_ACK: 'events:ack',
  EVENTS_ACK_ALL: 'events:ack-all',
  EVENTS_DELETE: 'events:delete',
  EVENTS_ADD_MARKER: 'events:add-marker',
  EVENTS_TIMELINE: 'events:timeline',
  /** main → renderer: một sự kiện vừa ghi. */
  EVENTS_NEW: 'events:new',
  /** main → renderer: số chưa đọc đổi (sau ack/xoá). */
  EVENTS_CHANGED: 'events:changed',

  // ── Theo dõi URL (synthetic HTTP monitoring) ─────────────────────────────
  HTTP_CHECKS_LIST: 'http-checks:list',
  HTTP_CHECKS_SAVE: 'http-checks:save',
  HTTP_CHECKS_DELETE: 'http-checks:delete',
  HTTP_CHECKS_RUN_NOW: 'http-checks:run-now',
  HTTP_CHECKS_RESULTS: 'http-checks:results',
  HTTP_CHECKS_SUMMARIES: 'http-checks:summaries',
  /** main → renderer: một kết quả đo vừa có. */
  HTTP_CHECKS_RESULT_EVENT: 'http-checks:result',
  /** main → renderer: tóm tắt của check vừa đo (uptime, fail liên tiếp, đang cảnh báo). */
  HTTP_CHECKS_SUMMARY_EVENT: 'http-checks:summary',

  // ── Kiểm kê fleet ────────────────────────────────────────────────────────
  INVENTORY_LIST: 'inventory:list',
  INVENTORY_COLLECT: 'inventory:collect',
  INVENTORY_EXPORT_CSV: 'inventory:export-csv',
  INVENTORY_DELETE: 'inventory:delete',
  /** main → renderer: xong thêm một host trong đợt thu. */
  INVENTORY_PROGRESS: 'inventory:progress',

  // ── Sổ tay vận hành (sổ tay riêng của user lưu trong vault meta) ─────────
  RUNBOOKS_LIST_CUSTOM: 'runbooks:list-custom',
  RUNBOOKS_SAVE_CUSTOM: 'runbooks:save-custom',
  RUNBOOKS_DELETE_CUSTOM: 'runbooks:delete-custom',

  // ── Lịch chạy tự động (F40) ──────────────────────────────────────────────
  JOBS_LIST: 'jobs:list',
  JOBS_SAVE: 'jobs:save',
  JOBS_DELETE: 'jobs:delete',
  /** Chạy ngay một job (không đợi lịch) — để thử trước khi để nó tự chạy. */
  JOBS_RUN_NOW: 'jobs:run-now',
  JOBS_RUNS: 'jobs:runs',
  /** main → renderer: một job vừa bắt đầu / vừa xong. */
  JOBS_RUN_EVENT: 'jobs:run-event',

  // ── F38: kiểm an ninh nhanh cả fleet ─────────────────────────────────────
  SECURITY_SCAN: 'security:scan',
  SECURITY_PROGRESS: 'security:progress',

  // ── F28/F29: so lệch thư mục local ↔ remote, theo dõi và tự đẩy ──────────
  FOLDERSYNC_LIST: 'folder-sync:list',
  FOLDERSYNC_SAVE: 'folder-sync:save',
  FOLDERSYNC_DELETE: 'folder-sync:delete',
  FOLDERSYNC_PICK_LOCAL: 'folder-sync:pick-local',
  FOLDERSYNC_SCAN: 'folder-sync:scan',
  FOLDERSYNC_PUSH: 'folder-sync:push',
  /** Bật/tắt theo dõi thư mục local của một cặp. */
  FOLDERSYNC_WATCH: 'folder-sync:watch',
  /** main → renderer: trạng thái watch / file vừa đẩy / lỗi. */
  FOLDERSYNC_EVENT: 'folder-sync:event',

  // ── F24: lịch sử lệnh theo host (ô tìm Ctrl+Shift+R) ─────────────────────
  CMDHIST_ADD: 'cmd-history:add',
  CMDHIST_LIST: 'cmd-history:list',
  CMDHIST_DELETE: 'cmd-history:delete',
  CMDHIST_CLEAR: 'cmd-history:clear',
  /** Xuất ra file JSON — lịch sử KHÔNG đi qua sync, đây là đường mang sang máy khác. */
  CMDHIST_EXPORT: 'cmd-history:export',
  CMDHIST_IMPORT: 'cmd-history:import'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
