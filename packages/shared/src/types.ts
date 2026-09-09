export type ShellIcon = 'powershell' | 'cmd' | 'bash' | 'wsl' | 'zsh' | 'fish' | 'shell'

/** Một loại shell local phát hiện được trên máy (PowerShell, cmd, Git Bash, WSL…). */
export interface ShellProfile {
  id: string
  label: string
  shellPath: string
  args?: string[]
  cwd?: string
  icon: ShellIcon
}

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

export type VaultState = 'uninitialized' | 'locked' | 'unlocked'

export interface VaultStatus {
  state: VaultState
  /** DEK đang được ghi nhớ qua OS keychain (Electron safeStorage). */
  remembered: boolean
}

// ---------------------------------------------------------------------------
// Hosts / Groups / Keys / Snippets / History
// ---------------------------------------------------------------------------

/** 'none' = server cho vào không cần xác thực. 'secret' = lấy password từ secret manager (op/bw/vault).
 *  'key+password' = MFA: server bắt buộc CẢ publickey LẪN password (AuthenticationMethods publickey,password). */
export type AuthType = 'password' | 'key' | 'agent' | 'none' | 'secret' | 'key+password'

/** Giao thức của host. serial: hostname = COM port, port = baud rate.
 *  vnc/rdp (F13): remote desktop — hostname:port của máy đích, có thể xuyên jump host. */
export type HostProtocol = 'ssh' | 'telnet' | 'serial' | 'vnc' | 'rdp'

/** Group với các field cấu hình kế thừa — null nghĩa là "kế thừa tiếp từ group cha". */
export interface GroupDto {
  id: string
  parentId: string | null
  name: string
  username: string | null
  authType: AuthType | null
  keyId: string | null
  env: Record<string, string> | null
  startupSnippetId: string | null
  jumpChain: string[] | null
  /** Màu nhận diện (hex) — tô tab/pane/sidebar của host trong group (vd production đỏ). null = không màu. */
  color: string | null
  /**
   * F27 — nhóm này là PRODUCTION: guard lệnh nguy hiểm siết chặt hơn (bắt gõ xác nhận thay vì
   * bấm một nút). Host kế thừa qua chuỗi group giống username/keyId.
   */
  production: boolean
}

export interface GroupInput {
  id?: string
  parentId?: string | null
  name: string
  username?: string | null
  authType?: AuthType | null
  keyId?: string | null
  env?: Record<string, string> | null
  startupSnippetId?: string | null
  jumpChain?: string[] | null
  color?: string | null
  production?: boolean
}

/**
 * Host trả về renderer — KHÔNG bao giờ chứa secret (password/private key).
 * username/authType/keyId/jumpChain/startupSnippetId = null → kế thừa từ group.
 */
export interface HostDto {
  id: string
  groupId: string | null
  label: string
  protocol: HostProtocol
  hostname: string
  port: number
  username: string | null
  authType: AuthType | null
  keyId: string | null
  hasPassword: boolean
  /** authType=secret: tham chiếu (op://… / bw://… / vault://…). */
  secretRef: string | null
  favorite: boolean
  lastConnectedAt: number | null
  jumpChain: string[] | null
  env: Record<string, string> | null
  startupSnippetId: string | null
  agentForward: boolean
  /** Bật: sau login tự chạy `tmux new-session -A` để phiên sống sót/khôi phục khi rớt mạng. */
  tmux: boolean
  /** Ghi chú Markdown (đã giải mã khi vault mở) — null nếu trống. */
  notes: string | null
  /** F41: đã lưu TOTP seed (seed thật không rời main — login script dùng token {{totp}}). */
  hasTotp: boolean
  /** Bước secret có send='' (giá trị thật không rời main process). */
  loginSteps: LoginStep[] | null
}

/** Payload lưu host. password: undefined = giữ nguyên, null = xoá, string = đặt mới. */
export interface HostInput {
  id?: string
  groupId?: string | null
  label: string
  protocol?: HostProtocol
  hostname: string
  port: number
  username?: string | null
  authType?: AuthType | null
  password?: string | null
  keyId?: string | null
  secretRef?: string | null
  favorite?: boolean
  jumpChain?: string[] | null
  env?: Record<string, string> | null
  startupSnippetId?: string | null
  agentForward?: boolean
  tmux?: boolean
  /** Ghi chú: undefined = giữ nguyên, null/'' = xoá, string = đặt mới. */
  notes?: string | null
  /** F41 TOTP seed (base32): undefined = giữ nguyên, null/'' = xoá, string = đặt mới. */
  totpSecret?: string | null
  /** Bước secret với send='' = giữ nguyên giá trị cũ (merge theo vị trí). */
  loginSteps?: LoginStep[] | null
}

/**
 * Một bước trong login script chạy sau khi shell mở (vd: su sang user khác rồi ssh tiếp).
 * Engine chờ `expect` xuất hiện trong output rồi gửi `send` + Enter.
 */
export interface LoginStep {
  /** Chuỗi chờ trong output trước khi gửi. Bỏ trống = gửi sau ~800ms. */
  expect?: string
  /** Nội dung gửi (kèm Enter). Với secret: renderer luôn nhận '' — giá trị thật chỉ ở main. */
  send: string
  /** Là mật khẩu: lưu mã hoá trong vault, không trả về renderer. */
  secret?: boolean
}

export interface SshKeyDto {
  id: string
  label: string
  keyType: string
  /** Dòng public key dạng OpenSSH ("ssh-ed25519 AAAA… label") — dán thẳng vào authorized_keys. */
  publicKey: string
  hasPassphrase: boolean
  source: 'generated' | 'imported'
  createdAt: number
}

export interface KeyImportInput {
  label: string
  privateKey: string
  passphrase?: string
}

export interface SnippetDto {
  id: string
  label: string
  /** Script có thể chứa biến dạng {{ten_bien}} — được hỏi giá trị lúc chạy. */
  script: string
}

export interface SnippetInput {
  id?: string
  label: string
  script: string
}

export interface HistoryEntry {
  id: string
  /** Chuỗi hiển thị, vd "root@1.2.3.4:22". */
  target: string
  hostId: string | null
  connectedAt: number
}

// ---------------------------------------------------------------------------
// Tunnels (port forwarding)
// ---------------------------------------------------------------------------

export type TunnelType = 'L' | 'R' | 'D'

export interface TunnelRuleDto {
  id: string
  hostId: string
  type: TunnelType
  label: string
  bindHost: string
  bindPort: number
  /** Không dùng với type=D. */
  destHost: string | null
  destPort: number | null
  autoStart: boolean
}

export interface TunnelRuleInput {
  id?: string
  hostId: string
  type: TunnelType
  label?: string
  bindHost?: string
  bindPort: number
  destHost?: string | null
  destPort?: number | null
  autoStart?: boolean
}

// ---------------------------------------------------------------------------
// F55 — Theo dõi bất đồng bộ master ↔ slave (MySQL/MariaDB)
// ---------------------------------------------------------------------------

/** `auto` = thử driver mysql2 trước, hỏng thì rơi sang chạy `mysql` CLI qua SSH. */
export type ReplProbeMode = 'auto' | 'driver' | 'cli'

/**
 * Một slave trong cụm. `hostId` luôn có (dùng làm nhãn + để biết máy nào); `tunnelId` có giá trị
 * nghĩa là đọc MySQL qua tunnel đó thay vì bắc cầu tới `127.0.0.1:dbPort` trên host.
 */
export interface ReplReplicaDto {
  id: string
  /** Nhãn tự đặt; rỗng thì UI lấy tên host/tunnel. */
  label: string
  hostId: string
  /**
   * Có giá trị = đọc MySQL của slave này **qua tunnel đã lưu** (nối vào đầu local của tunnel).
   *
   * Cần khi MySQL nằm ở MÁY KHÁC trong mạng trong (vd `10.20.30.40:3306`) — tunnel đã có logic
   * định tuyến đúng cho ca đó (`nc` trên máy sâu trước, xem `chooseLocalForwardRoute`), còn cách
   * bắc cầu thẳng từ host chỉ là `direct-tcpip` phát từ gate và sẽ đi sai mạng.
   */
  tunnelId: string | null
  dbPort: number
  /** Rỗng = dùng user của cụm. Có giá trị = máy này đăng nhập bằng tài khoản riêng. */
  dbUser: string
  /** Chỉ báo có mật khẩu RIÊNG hay không — mật khẩu thật không bao giờ ra khỏi main process. */
  hasDbPassword: boolean
}

/**
 * Một CỤM replication: 1 master + N slave.
 *
 * Vì sao không phải "cặp 1-1": thực tế gần như luôn là một master nhiều slave. Gom vào một cụm
 * thì master chỉ khai MỘT lần, mỗi chu kỳ chỉ đọc master MỘT lần rồi so cho mọi slave — nhẹ cho
 * master và các slave được so trên CÙNG một mốc vị trí binlog (so lệch nhau mới có nghĩa).
 */
export interface ReplPairDto {
  id: string
  name: string
  /** null = chỉ theo dõi slave (không có quyền/đường tới master). */
  masterHostId: string | null
  masterTunnelId: string | null
  /** Ít nhất 1 slave; thứ tự do user sắp. */
  replicas: ReplReplicaDto[]
  /** Cổng mặc định: dùng cho master và điền sẵn khi thêm slave mới. */
  dbPort: number
  /**
   * Credential MẶC ĐỊNH của cụm — dùng cho mọi đầu không khai riêng.
   *
   * Rỗng = dùng credential sẵn trên server (~/.my.cnf hoặc unix_socket auth). Thực tế thường là
   * một tài khoản giám sát chung, nhưng master và từng slave đều ghi đè được (xem `masterDbUser`
   * và `ReplReplicaDto.dbUser`) cho trường hợp mỗi máy một tài khoản.
   */
  dbUser: string
  /** Chỉ báo có mật khẩu hay không — mật khẩu thật KHÔNG BAO GIỜ ra khỏi main process. */
  hasDbPassword: boolean
  /** Credential riêng của master. Rỗng = dùng của cụm. */
  masterDbUser: string
  masterHasDbPassword: boolean
  /** Binary client cho chế độ CLI: `mysql` (mặc định) hoặc `mariadb`. */
  cliBinary: string
  probeMode: ReplProbeMode
  pollIntervalSec: number
  /** Theo dõi nền: vẫn chạy khi đóng tab, sống sót cả khi vault tự khoá. */
  watchEnabled: boolean
}

export interface ReplReplicaInput {
  /** Thiếu = slave mới, main tự sinh id. */
  id?: string
  label?: string
  hostId: string
  tunnelId?: string | null
  dbPort?: number
  /** Rỗng = dùng user của cụm. */
  dbUser?: string
  /** undefined = giữ nguyên · null hoặc '' = xoá (về dùng của cụm) · chuỗi = đặt mới. */
  dbPassword?: string | null
}

export interface ReplPairInput {
  id?: string
  name: string
  masterHostId?: string | null
  masterTunnelId?: string | null
  /** Thay TOÀN BỘ danh sách slave (slave không còn trong danh sách = bị xoá khỏi cụm). */
  replicas: ReplReplicaInput[]
  dbPort?: number
  /** Credential mặc định của cụm. */
  dbUser?: string
  /** undefined = giữ nguyên · null hoặc '' = xoá · chuỗi = đặt mới. */
  dbPassword?: string | null
  /** Credential riêng của master; rỗng = dùng của cụm. Semantics mật khẩu như trên. */
  masterDbUser?: string
  masterDbPassword?: string | null
  cliBinary?: string
  probeMode?: ReplProbeMode
  pollIntervalSec?: number
  watchEnabled?: boolean
}

export type ReplThreadState = 'yes' | 'no' | 'connecting' | 'unknown'

export interface ReplFiltersDto {
  doDb: string
  ignoreDb: string
  doTable: string
  ignoreTable: string
  wildDoTable: string
  wildIgnoreTable: string
  any: boolean
}

export interface ReplicaStatusDto {
  ioState: string | null
  masterHost: string | null
  masterPort: number | null
  masterServerId: number | null
  ioRunning: ReplThreadState
  sqlRunning: ReplThreadState
  readFile: string | null
  readPos: number | null
  execFile: string | null
  execPos: number | null
  secondsBehind: number | null
  sqlRunningState: string | null
  relayLogSpace: number | null
  lastErrno: number
  lastError: string | null
  lastIoErrno: number
  lastIoError: string | null
  lastSqlErrno: number
  lastSqlError: string | null
  sqlDelaySec: number
  remainingDelaySec: number | null
  usingGtid: string | null
  filters: ReplFiltersDto
}

export interface MasterStatusDto {
  file: string | null
  position: number | null
  doDb: string
  ignoreDb: string
}

export interface ReplVarsDto {
  serverId: number | null
  readOnly: boolean | null
  superReadOnly: boolean | null
  binlogFormat: string | null
  logBin: boolean | null
  logSlaveUpdates: boolean | null
  gtidMode: string | null
  version: string | null
  slaveParallelWorkers: number | null
  binlogExpireSeconds: number | null
}

export interface ReplDriftDto {
  lagSec: number | null
  /** Trễ thật sau khi trừ phần trễ CỐ Ý (MASTER_DELAY). */
  effectiveLagSec: number | null
  fetchGapBytes: number | null
  applyGapBytes: number | null
  fetchFilesBehind: number | null
  applyFilesBehind: number | null
  healthy: boolean
}

export interface ReplSampleDto {
  pairId: string
  /** Slave nào trong cụm — mỗi chu kỳ phát N sample, một cái cho mỗi slave. */
  replicaId: string
  replicaLabel: string
  ts: number
  ok: boolean
  mode: 'driver' | 'cli' | null
  master: MasterStatusDto | null
  replica: ReplicaStatusDto | null
  masterVars: ReplVarsDto | null
  replicaVars: ReplVarsDto | null
  drift: ReplDriftDto | null
  error?: string
  /** Đọc được replica nhưng không đọc được master — lần đo vẫn hợp lệ. */
  masterError?: string
}

export type ReplSeverity = 'critical' | 'warn' | 'info'
/** safe = đảo ngược được · caution = đổi trạng thái · destructive = mất dữ liệu hoặc downtime. */
export type ReplDanger = 'safe' | 'caution' | 'destructive'

export interface ReplCmdDto {
  label: string
  kind: 'sql' | 'shell'
  on: 'master' | 'replica'
  text: string
  danger: ReplDanger
  note?: string
}

export interface ReplDiagnosisDto {
  id: string
  severity: ReplSeverity
  title: string
  why: string
  checks: ReplCmdDto[]
  fixes: ReplCmdDto[]
}

export interface ReplTestResultDto {
  ok: boolean
  /** Đường đã dùng được — hiện trên UI để user biết đang chạy driver hay CLI. */
  mode: 'driver' | 'cli' | null
  message: string
}

/**
 * Những gì renderer nhận sau mỗi lần đo. Chẩn đoán tính ở MAIN chứ không phải renderer:
 * bảng luật nằm trong `@infra/core` (package Node-only), và tính một lần ở main thì cửa sổ
 * tách rời cũng dùng chung kết quả.
 */
export interface ReplSnapshotDto {
  sample: ReplSampleDto
  diagnoses: ReplDiagnosisDto[]
}

// --- So lệch thực tế (chạy theo yêu cầu) ---

export interface ReplTableInfoDto {
  schema: string
  name: string
  engine: string | null
  /** ƯỚC LƯỢNG với InnoDB — chỉ để khoanh vùng, không dùng để kết luận. */
  rowsEstimate: number | null
  dataBytes: number | null
  indexBytes: number | null
  collation: string | null
}

export type ReplTableDiffStatus =
  | 'missing-on-replica'
  | 'missing-on-master'
  | 'engine-differs'
  | 'collation-differs'
  | 'rows-differ'
  | 'same'

export interface ReplTableDiffDto {
  schema: string
  name: string
  status: ReplTableDiffStatus
  master: ReplTableInfoDto | null
  replica: ReplTableInfoDto | null
  rowDelta: number | null
  /** Nằm ngoài phạm vi replication → chênh lệch là CỐ Ý. */
  filtered: boolean
}

export interface ReplSchemaDiffDto {
  table: string
  item: string
  status: 'missing-on-replica' | 'missing-on-master' | 'differs'
  masterSignature: string | null
  replicaSignature: string | null
}

export interface ReplVarDiffDto {
  name: string
  master: string
  replica: string
  /** Khác nhau ở biến này là bình thường (server_id, read_only…). */
  expected: boolean
  note: string
}

export interface ReplCompareResultDto {
  ok: boolean
  error?: string
  tables: ReplTableDiffDto[]
  columns: ReplSchemaDiffDto[]
  indexes: ReplSchemaDiffDto[]
  variables: ReplVarDiffDto[]
  /** Có bộ lọc replication → một số chênh lệch là cố ý. */
  hasFilters: boolean
}

export interface ReplChecksumRowDto {
  schema: string
  name: string
  masterCount: number | null
  replicaCount: number | null
  masterChecksum: number | null
  replicaChecksum: number | null
  /** Tên bảng có ký tự ngoài [A-Za-z0-9_] → không kiểm tự động được (không im lặng bỏ qua). */
  error?: string
}

// --- Lịch sử so lệch (F59) ---

/** `scan` = quét nhanh information_schema · `count` = COUNT(*) · `checksum` = CHECKSUM TABLE. */
export type ReplRunKind = 'scan' | 'count' | 'checksum'

/**
 * Một lần so lệch ĐÃ LƯU. Phần metadata nằm ở cột thường (danh sách hiện được ngay), chi tiết
 * nằm trong payload mã hoá và chỉ đọc khi user bung dòng đó ra.
 *
 * Nhãn cụm/slave/master lưu SAO CHÉP tại thời điểm chạy: cụm bị xoá hay đổi tên thì bản ghi cũ
 * vẫn nói đúng lúc đó nó so cái gì với cái gì.
 */
export interface ReplRunDto {
  id: string
  /** Cụm lúc chạy — có thể đã bị xoá, nên KHÔNG có FK. */
  pairId: string
  pairName: string
  replicaId: string
  replicaLabel: string
  /** Rỗng = cụm chỉ theo dõi slave, không khai master. */
  masterLabel: string
  kind: ReplRunKind
  /** Bảng lệch, không tính bảng ngoài phạm vi replication. */
  tableDiffs: number
  columnDiffs: number
  indexDiffs: number
  /** Không tính các biến vốn phải khác nhau (server_id, read_only…). */
  varDiffs: number
  /** Số bảng đã đếm/checksum (kind ≠ 'scan'). */
  checked: number
  /** Số bảng lệch thật trong lần đếm/checksum đó. */
  mismatches: number
  createdAt: number
}

export interface ReplRunDetailDto extends ReplRunDto {
  /** CHỈ chứa mục lệch — bảng khớp không được lưu, để vault không phình sau mỗi lần quét. */
  tables: ReplTableDiffDto[]
  columns: ReplSchemaDiffDto[]
  indexes: ReplSchemaDiffDto[]
  variables: ReplVarDiffDto[]
  rows: ReplChecksumRowDto[]
  hasFilters: boolean
  /** Kết quả vượt trần nên đã cắt bớt — hiện thẳng, đừng để tưởng danh sách là đầy đủ. */
  truncated: boolean
  /** Vault đang khoá → không giải mã được chi tiết (metadata vẫn đúng). */
  locked?: boolean
}

export type ReplAlertMetricDto = 'lag' | 'applyGap' | 'threads' | 'error' | 'writable' | 'probe'

export interface ReplThresholdsDto {
  /** Trễ thật (giây). null = tắt. */
  lagSec: number | null
  /** Byte đã tải về mà chưa apply. null = tắt. */
  applyGapBytes: number | null
  threads: boolean
  error: boolean
  writable: boolean
  probe: boolean
}

export interface ReplSettingsDto {
  defaults: ReplThresholdsDto
  /** Override từng cặp — thiếu field nào thì kế thừa defaults. */
  perPair: Record<string, Partial<ReplThresholdsDto>>
  webhookUrl: string
  osNotify: boolean
}

export interface ReplAlertDto {
  pairId: string
  replicaId: string
  replicaLabel: string
  /** "<tên cụm> · <tên slave>" — ghi lúc bắt đầu theo dõi để dựng thông báo không cần mở vault. */
  label: string
  metric: ReplAlertMetricDto
  kind: 'breach' | 'recover'
  value: number | null
  threshold: number | null
  detail: string | null
  /**
   * Text hiển thị, dựng sẵn ở main. Renderer KHÔNG tự dựng lại: bảng thông điệp nằm trong
   * `@infra/core` (Node-only) và một bản thứ hai ở renderer chắc chắn sẽ trôi lệch.
   */
  text: string
  ts: number
}

export type TunnelStatus = 'stopped' | 'starting' | 'active' | 'error'

export interface TunnelStateDto {
  ruleId: string
  status: TunnelStatus
  detail?: string
}

// ---------------------------------------------------------------------------
// SFTP & file system local
// ---------------------------------------------------------------------------

export interface FileEntryDto {
  name: string
  kind: 'file' | 'dir' | 'symlink' | 'other'
  size: number
  mtimeMs: number
  /** Mode dạng octal "755" (chỉ có với SFTP). */
  mode?: string
}

export interface SftpOpenResponse {
  sessionId: string
  title: string
  /** Thư mục home trên server. */
  home: string
}

export interface TransferEvent {
  id: string
  kind: 'upload' | 'download' | 'edit-upload'
  /** Tên hiển thị, vd "nginx.conf → /etc/nginx". */
  label: string
  transferred: number
  total: number
  status: 'running' | 'done' | 'error'
  error?: string
}

// ---------------------------------------------------------------------------
// Bulk execution (chạy 1 lệnh trên nhiều host)
// ---------------------------------------------------------------------------

export type BulkPhase = 'pending' | 'running' | 'done' | 'error'

export interface BulkHostResult {
  hostId: string
  label: string
  phase: BulkPhase
  stdout: string
  stderr: string
  code: number | null
  error?: string
  durationMs?: number
}

export interface BulkRunEvent {
  runId: string
  hostId: string
  phase: BulkPhase
  stdout?: string
  stderr?: string
  code?: number | null
  error?: string
  durationMs?: number
}

// ---------------------------------------------------------------------------
// AI assistant
// ---------------------------------------------------------------------------

export type AiProviderDto = 'claude' | 'openai' | 'gemini' | 'ollama'
export type AiModeDto = 'generate' | 'explain' | 'explain-error' | 'diagnose'

export interface AiConfigDto {
  provider: AiProviderDto
  model: string
  baseUrl: string
  hasApiKey: boolean
}

export interface AiConfigInput {
  provider: AiProviderDto
  model: string
  baseUrl: string
  /** undefined = giữ nguyên, '' = xoá, string = đặt mới. */
  apiKey?: string
}

export interface AiAskResultDto {
  text: string
  command?: string
}

/** F48 — kết quả chạy MỘT lệnh chẩn đoán read-only qua kênh exec riêng. */
export interface AiDiagnoseExecResultDto {
  /** false = lệnh bị guard read-only chặn (blocked), không hề chạy trên remote. */
  ok: boolean
  /** Lý do chặn khi ok=false. */
  blockedReason?: string
  stdout: string
  stderr: string
  code: number | null
  /** Lỗi kết nối/timeout khi chạy (khác blockedReason). */
  error?: string
}

/** F48 — trạng thái kết thúc của một phiên chẩn đoán được lưu lại. */
export type AiDiagnoseStatusDto = 'done' | 'stopped' | 'error'

/** F48 — một bước trong phiên chẩn đoán (mirror của DiagnoseStep ở renderer để lưu/khôi phục). */
export interface AiDiagnoseStepDto {
  reasoning: string
  command: string
  status: 'proposed' | 'running' | 'done' | 'skipped' | 'blocked' | 'error'
  blockedReason?: string
  output?: string
  code?: number | null
  error?: string
}

/** F48 — payload lưu một phiên chẩn đoán vào lịch sử (steps + conclusion mã hoá bằng DEK ở vault). */
export interface AiDiagnoseSaveInput {
  hostId: string
  hostLabel: string
  symptom: string
  status: AiDiagnoseStatusDto
  steps: AiDiagnoseStepDto[]
  conclusion?: string
  error?: string
}

/** F48 — mục danh sách lịch sử chẩn đoán (nhẹ: chỉ metadata + trích kết luận để xem nhanh). */
export interface AiDiagnoseRecordDto {
  id: string
  hostLabel: string
  symptom: string
  status: AiDiagnoseStatusDto
  /** Vài trăm ký tự đầu của kết luận (đã giải mã) để hiển thị preview. */
  conclusionSnippet: string
  stepCount: number
  createdAt: number
}

/** F48 — chi tiết đầy đủ một phiên chẩn đoán đã lưu (để xem lại read-only). */
export interface AiDiagnoseDetailDto extends AiDiagnoseSaveInput {
  id: string
  createdAt: number
}

// ---------------------------------------------------------------------------
// Remote desktop — VNC + RDP (F13)
// ---------------------------------------------------------------------------

/** VNC nhúng: main mở cầu WebSocket↔TCP (qua jump host), noVNC ở renderer nối vào. */
export interface VncOpenResultDto {
  sessionId: string
  /** Cổng WebSocket local (127.0.0.1) để noVNC nối: ws://127.0.0.1:<wsPort>/?token=… */
  wsPort: number
  /** Token 1 phiên — ws server chỉ nhận kết nối có token đúng. */
  token: string
  title: string
}

/** RDP qua tunnel: main forward cổng 3389 rồi mở client RDP hệ điều hành trỏ vào cổng local. */
export interface RdpOpenResultDto {
  sessionId: string
  /** Cổng local (127.0.0.1) đã forward tới 3389 của đích. */
  localPort: number
  label: string
  /** true = đã tự mở client RDP (mstsc…); false = không mở được, user tự nối vào localPort. */
  launched: boolean
  /** Hướng dẫn khi launched=false (vd macOS/Linux không có client). */
  hint?: string
}

/** Một phiên RDP đang mở (tunnel còn sống) — cho danh sách quản lý/Dừng. */
export interface RdpSessionDto {
  sessionId: string
  label: string
  localPort: number
}

// ---------------------------------------------------------------------------
// Sync E2EE
// ---------------------------------------------------------------------------

/** Trạng thái MỘT kênh đồng bộ (từ v0.2.15 nhiều kênh chạy song song). */
export interface SyncChannelStatusDto {
  id: string
  backend: string
  /** backend 'folder': đường dẫn thư mục. */
  folder?: string
  /** backend 'gdrive': email tài khoản đang kết nối (chỉ để hiển thị). */
  gdriveEmail?: string | null
  /** backend 'webdav'/'s3': mô tả đích (URL / bucket@host) — chỉ để hiển thị. */
  detail?: string
  lastSyncAt?: number
  lastMessage?: string
}

export interface SyncStatusDto {
  /** Có ít nhất một kênh đang bật. */
  configured: boolean
  channels: SyncChannelStatusDto[]
  /** Tự đồng bộ mỗi N phút — lịch chung cho mọi kênh; 0 = tắt. */
  autoMinutes?: number
}

/** Trạng thái kết nối Google (token thật không bao giờ qua IPC — chỉ có cờ + email). */
export interface GdriveStatusDto {
  connected: boolean
  email: string | null
}

/** Kết quả đăng nhập Google — lỗi dạng MÃ để renderer dịch lúc render. */
export type GdriveLoginResult =
  | { ok: true; email: string | null }
  | {
      ok: false
      error: 'clientNotConfigured' | 'vaultLocked' | 'timeout' | 'denied' | 'stateMismatch' | 'network' | 'badResponse'
      detail?: string
    }

export interface SyncRunResult {
  ok: boolean
  pulled: number
  message: string
  /**
   * Đã bị chặn vì nghi ngờ ghi đè mất dữ liệu (không thấy blob nhưng có dấu hiệu nó phải có
   * ở đó). Renderer hỏi lại user rồi gọi lại với `force`.
   */
  needsConfirm?: boolean
}

// ---------------------------------------------------------------------------
// Network toolbox
// ---------------------------------------------------------------------------

export interface PingResultDto {
  alive: boolean
  output: string
  avgMs: number | null
}

export interface DnsResultDto {
  a: string[]
  aaaa: string[]
  reverse: string[]
  error?: string
}

export interface PortScanEntryDto {
  port: number
  service: string
  open: boolean
}

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------

export interface MetricSampleDto {
  hostId: string
  ts: number
  ok: boolean
  load1: number | null
  loadText: string | null
  memUsedPct: number | null
  /** % dùng cao nhất trong các mount thật (bỏ tmpfs…) — mount tương ứng ở diskMount. */
  diskUsedPct: number | null
  diskMount: string | null
  inodeUsedPct: number | null
  uptimeSec: number | null
  cpuCount: number | null
  /** CPU thật từ delta /proc/stat (null ở lần poll đầu). cpuPct = 100 − idle − iowait. */
  cpuPct: number | null
  cpuUserPct: number | null
  cpuSystemPct: number | null
  cpuIowaitPct: number | null
  /** % CPU bị hypervisor lấy (VPS) — ≥10% kéo dài là bất thường. */
  cpuStealPct: number | null
  /** Số tiến trình chờ CPU (cột r của vmstat). */
  runQueue: number | null
  swapUsedMb: number | null
  swapTotalMb: number | null
  netRxKbps: number | null
  netTxKbps: number | null
  tcpConns: number | null
  tcpTimeWait: number | null
  topProc: string | null
  /** Uptime service quen thuộc (httpd/nginx/java…) — tiến trình lâu đời nhất mỗi tên,
   *  sort giảm dần. Khác uptimeSec: service restart không đụng uptime server. */
  services: { name: string; uptimeSec: number }[] | null
  error?: string
}

export type MonitorAlertMetric = 'load' | 'mem' | 'disk' | 'steal' | 'conn' | 'offline'

/** Ngưỡng cảnh báo — null = tắt metric đó. loadPct chuẩn hoá theo core: load1/cpuCount*100
 *  (KHÔNG chặn 100 — server bận thường trực 300-400%+). connCount là số tuyệt đối. */
export interface MonitorThresholdsDto {
  loadPct: number | null
  memPct: number | null
  diskPct: number | null
  /** % CPU steal (VPS bị oversubscribe). */
  stealPct: number | null
  /** Số kết nối TCP ESTABLISHED. */
  connCount: number | null
  offline: boolean
}

/** Cài đặt cảnh báo monitoring — lưu file JSON userData (KHÔNG vault: alert phải chạy cả khi vault khoá). */
export interface MonitorSettingsDto {
  defaults: MonitorThresholdsDto
  /** Override từng host — thiếu field nào dùng defaults. Key của host đã xoá là vô hại (bị bỏ qua). */
  perHost: Record<string, Partial<MonitorThresholdsDto>>
  /** '' = tắt webhook. Tự nhận diện Google Chat/Slack/Discord/Telegram/generic theo URL. */
  webhookUrl: string
  /** Thông báo hệ điều hành (Windows toast) khi breach. */
  osNotify: boolean
}

export interface MonitorAlertDto {
  hostId: string
  label: string
  metric: MonitorAlertMetric
  kind: 'breach' | 'recover'
  /** Giá trị đo được lúc chốt cảnh báo (%; null với offline). */
  value: number | null
  /** Ngưỡng hiệu lực (null với offline). */
  threshold: number | null
  ts: number
}

/** 1 host có dữ liệu lịch sử metrics (từng được monitor, còn trong hạn giữ 30 ngày). */
export interface MetricHistoryHostDto {
  hostId: string
  firstTs: number
  lastTs: number
}

/** Một bucket lịch sử metrics (đầu bucket, giá trị trung bình trong bucket). */
export interface MetricHistoryPointDto {
  ts: number
  loadPct: number | null
  cpuPct: number | null
  stealPct: number | null
  memPct: number | null
  diskPct: number | null
  conns: number | null
  /** ok_count/total_count trong bucket (0..1). */
  okRatio: number
}

export interface SshConfigImportResult {
  hostsImported: number
  keysImported: number
  groupName: string
  warnings: string[]
}

/**
 * F05 — một máy ảo trên cloud (droplet/EC2 instance/GCE instance/Azure VM) sau khi parse,
 * đã quy về MỘT hình dạng chung: mọi provider đi qua cùng danh sách xem trước + cùng đường
 * import (`importDroplets`), thêm provider mới chỉ là thêm một parser.
 */
export interface CloudInstanceDto {
  /** Id bên provider — chuỗi (DO là số → String hoá; AWS `i-…`, GCP id số dạng chuỗi, Azure vmId). */
  id: string
  name: string
  /** IPv4 public đầu tiên — null nếu máy không có (chỉ nằm trong VPC/VNet). */
  publicIp: string | null
  /** IPv4 private đầu tiên. Import dùng public trước, không có mới rơi về private. */
  privateIp: string | null
  region: string
  /** 'active'/'running' | 'off'/'stopped' | '' (không biết) — hiển thị thôi, máy off vẫn import được. */
  status: string
  tags: string[]
  image: string
  sizeSlug: string
  /** Vault đã có host trùng địa chỉ (main điền sau khi liệt kê) — UI khoá chọn để khỏi nhân đôi. */
  exists: boolean
}

/** Tên cũ thời chỉ có DigitalOcean — giữ làm alias cho code sẵn có. */
export type DoDropletDto = CloudInstanceDto

/** F05 — provider của cloud import (DigitalOcean đi bộ IPC riêng có sẵn). */
export type CloudProvider = 'aws' | 'gcp' | 'azure'

/** Tài khoản cloud đã lưu — config là phần KHÔNG bí mật (region, subscription id…). */
export interface CloudAccountDto {
  id: string
  label: string
  provider: string
  config: Record<string, string>
}

/** secretJson: undefined = giữ credentials cũ (đổi tên/label), chuỗi JSON = đặt mới. */
export interface CloudAccountInput {
  id?: string
  label: string
  provider: CloudProvider
  config: Record<string, string>
  secretJson?: string
}

export type CloudListResult =
  | { ok: true; instances: CloudInstanceDto[]; warnings: string[] }
  | { ok: false; error: 'noAccount' | 'badCreds' | 'auth' | 'http' | 'timeout' | 'network' | 'badResponse'; detail?: string }

/** Bật kênh sync WebDAV — mật khẩu mã hoá DEK theo kênh, không vào SyncChannel JSON. */
export interface WebdavConfigInput {
  url: string
  username: string
  password: string
  passphrase: string
}

/** Bật kênh sync S3 (AWS/MinIO/R2/B2… — mọi endpoint nhận SigV4). */
export interface S3ConfigInput {
  endpoint: string
  region: string
  bucket: string
  prefix: string
  accessKeyId: string
  secretAccessKey: string
  passphrase: string
}

/** Một tài khoản DigitalOcean đã lưu — chỉ có nhãn, token thật không bao giờ vào DTO. */
export interface DoAccountDto {
  id: string
  label: string
}

export interface DoConfigDto {
  accounts: DoAccountDto[]
}

/** token: undefined = giữ nguyên token cũ (đổi tên tài khoản), string = đặt mới. */
export interface DoAccountInput {
  id?: string
  label: string
  token?: string
}

export interface DoListRequest {
  /** Dùng token đã lưu của tài khoản này… */
  accountId?: string
  /** …hoặc token vừa nhập, chưa lưu (thắng accountId nếu có cả hai). */
  tokenOverride?: string
}

/** Lỗi liệt kê droplet trả về dạng MÃ — renderer dịch lúc render (đổi ngôn ngữ là đổi theo). */
export type DoListErrorKind = 'noToken' | 'unauthorized' | 'http' | 'timeout' | 'network' | 'badResponse'

export type DoListResult =
  | { ok: true; droplets: DoDropletDto[]; warnings: string[] }
  | { ok: false; error: DoListErrorKind; detail?: string }

export interface DoImportOptions {
  /** Import vào group có sẵn. Không có (null/undefined) → dùng newGroupName. */
  groupId?: string | null
  /** Tên group khi không chọn group có sẵn — group CÙNG TÊN đã có thì tái dùng, không tạo bản thứ hai. */
  newGroupName?: string
  /** null/để trống = kế thừa từ group. */
  username?: string | null
  /** Gắn key có sẵn trong vault cho các host tạo mới → authType 'key'. */
  keyId?: string | null
  /** Nhãn nguồn ghi vào notes của host (vd 'AWS EC2', 'GCP', 'Azure') — mặc định DigitalOcean. */
  source?: string
}

export interface DoImportResult {
  imported: number
  /** Bỏ qua vì vault đã có host trùng địa chỉ. */
  skipped: number
  /** Bỏ qua vì droplet không có địa chỉ IPv4 nào. */
  noIp: number
  groupName: string
  warnings: string[]
}

/** F36 — một mục con trong thư mục đang xem. */
export interface DiskEntryDto {
  path: string
  name: string
  sizeKb: number
  percent: number
}

export interface DiskUsageDto {
  path: string
  totalKb: number
  entries: DiskEntryDto[]
}

export interface FilesystemDto {
  filesystem: string
  sizeKb: number
  usedKb: number
  availKb: number
  usePercent: number
  mountedOn: string
}

export interface DiskUsageResultDto {
  ok: boolean
  usage: DiskUsageDto | null
  filesystems: FilesystemDto[]
  error?: string
}

/** F37 — bản cập nhật của một host. `manager` = 'unknown' khi không dò ra công cụ nào. */
export type PackageManagerDto = 'apt' | 'dnf' | 'yum' | 'apk' | 'unknown'

export interface PackageUpdateDto {
  name: string
  current: string | null
  candidate: string
  security: boolean
}

export interface HostUpdatesDto {
  hostId: string
  manager: PackageManagerDto
  updates: PackageUpdateDto[]
  error?: string
}

/**
 * F35 — cron nằm ở ba chỗ; đọc nhầm chỗ thì thấy trống trong khi máy vẫn đang chạy job.
 * `system` là định dạng 6 trường (có cột user) và CHỈ ĐỌC (gồm nhiều file).
 */
export type CronScopeDto = 'user' | 'root' | 'system'

/** F35 — đọc/ghi crontab của một host. */
export interface CronReadResult {
  ok: boolean
  content: string
  error?: string
}

export interface CronWriteResult {
  ok: boolean
  error?: string
}

/** F30 — sự kiện của một phiên theo dõi log. */
export type LogTailEvent =
  | { id: string; kind: 'lines'; lines: Array<{ text: string; source: 'stdout' | 'stderr' }> }
  | { id: string; kind: 'closed'; code: number | null; error?: string }

export type LogTailStartResult = { ok: true; id: string } | { ok: false; error: string }

/** F44 — một fingerprint đã TOFU. `hostPattern` dạng `host` hoặc `[host]:port`. */
export interface KnownHostDto {
  id: string
  hostPattern: string
  keyType: string
  fingerprintSha256: string
  firstSeen: number
  lastSeen: number
}

/** F43 — đẩy public key lên authorized_keys của một host. */
export interface CopyIdRequest {
  hostId: string
  keyId: string
}

export interface CopyIdResult {
  ok: boolean
  /** 'added' | 'already-present' khi ok; 'not-verified' = ghi được nhưng login bằng key vẫn hỏng. */
  outcome: 'added' | 'already-present' | 'not-verified' | 'error'
  message: string
}

/** F42 — xoay vòng SSH key trên MỘT host. Renderer lặp qua từng host để có tiến độ. */
export interface RotateRequest {
  hostId: string
  newKeyId: string
  /** null = chỉ đẩy key mới, không gỡ gì. */
  oldKeyId: string | null
}

export interface RotateResult {
  hostId: string
  host: string
  /**
   * `rotated` = đã đẩy + xác minh + gỡ key cũ · `installed` = đã đẩy + xác minh, key cũ CÒN
   * · `not-verified` = key mới ghi được nhưng không đăng nhập được, **key cũ giữ nguyên**
   * · `error` = hỏng trước đó.
   */
  stage: 'rotated' | 'installed' | 'not-verified' | 'error'
  message: string
}

/** Loại bí mật xem lại được. TOTP seed CỐ Ý không có mặt — nó không rời main process. */
export type RevealKind = 'host-password' | 'key-passphrase'

export interface RevealRequest {
  kind: RevealKind
  /** id của host hoặc của key, tuỳ `kind`. */
  id: string
  /** Xác thực lại — luôn bắt buộc, kể cả khi vault đang mở. */
  masterPassword: string
}

export interface RevealResult {
  ok: boolean
  /** CHỈ có ở đường `reveal`; đường `copy` không bao giờ trả giá trị về renderer. */
  value?: string
  error?: string
  /** > 0 = đang bị khoá tạm do gõ sai nhiều lần; số giây phải chờ. */
  cooldownSec?: number
}

/** P30 — định dạng xuất hosts. Cả 3 đều KHÔNG chứa bí mật. */
export type HostExportFormat = 'ssh_config' | 'csv' | 'json'

export interface HostExportResult {
  ok: boolean
  /** Số host đã ghi ra file. */
  exported: number
  /** Host không phải SSH bị bỏ khi xuất ssh_config (0 với csv/json). */
  skipped: number
  path?: string
  message: string
}

// ---------------------------------------------------------------------------
// Terminal sessions (local PTY + SSH)
// ---------------------------------------------------------------------------

export type SessionKind = 'local' | 'ssh' | 'telnet' | 'serial'

export type SessionStatus = 'connecting' | 'connected' | 'reconnecting'

export interface SerialPortInfo {
  path: string
  label: string
}

export interface SessionLogState {
  sessionId: string
  active: boolean
  filePath?: string
}

export interface SessionRecordState {
  sessionId: string
  active: boolean
  filePath?: string
}

export interface RecordingInfoDto {
  name: string
  path: string
  sizeBytes: number
  mtimeMs: number
}

export interface TerminalCreateRequest {
  kind: SessionKind
  cols: number
  rows: number
  /** kind=local: id shell profile (bỏ trống → mặc định). */
  profileId?: string
  /** kind=ssh: id host đã lưu trong vault. */
  hostId?: string
  /** kind=ssh: Quick Connect "user@host[:port]" — không cần host lưu sẵn. */
  quickTarget?: string
  cwd?: string
  /**
   * kind=local: biến môi trường ĐÈ LÊN env kế thừa (vd đưa php/wp vào PATH khi mở terminal
   * tại thư mục site local dev). Chỉ đè các khoá được truyền, không thay cả env.
   */
  env?: Record<string, string>
}

export interface TerminalCreateResponse {
  sessionId: string
  kind: SessionKind
  title: string
  subtitle?: string
}

export interface TerminalDataEvent {
  sessionId: string
  data: string
}

export interface TerminalExitEvent {
  sessionId: string
  exitCode: number | null
  reason?: string
}

export interface TerminalStatusEvent {
  sessionId: string
  status: SessionStatus
  detail?: string
}

// ---------------------------------------------------------------------------
// Prompts (main hỏi → renderer trả lời)
// ---------------------------------------------------------------------------

/** Câu hỏi xác minh host key (TOFU hoặc fingerprint thay đổi). */
export interface HostKeyQuestion {
  requestId: string
  host: string
  port: number
  keyType: string
  fingerprint: string
  kind: 'unknown' | 'mismatch'
  /** kind=mismatch: fingerprint đã lưu trước đó. */
  knownFingerprint?: string
}

export interface PasswordQuestion {
  requestId: string
  /** vd "root@1.2.3.4" */
  target: string
}

// ---------------------------------------------------------------------------
// API preload expose cho renderer qua `window.infra`
// ---------------------------------------------------------------------------

// ── Plugins (F16) ────────────────────────────────────────────────────────────
export type PluginStatusDto = 'active' | 'disabled' | 'failed' | 'crashed' | 'loading'

export interface PluginCommandDto {
  id: string
  title: string
}

export interface PluginInfoDto {
  id: string
  name: string
  version: string
  description: string | null
  enabled: boolean
  status: PluginStatusDto
  error: string | null
  commands: PluginCommandDto[]
  permissions: string[]
  logTail: string[]
}

/** Lệnh plugin đóng góp vào Command Palette. */
export interface ContributedCommandDto {
  pluginId: string
  commandId: string
  title: string
}

export interface PluginPanelDto {
  pluginId: string
  title: string
  markdown?: string
  text?: string
}

export interface PluginNotifyDto {
  pluginId: string
  message: string
}

/** Câu hỏi nhập liệu do plugin phát (ui.prompt) — trả lời qua prompts.answer(requestId, ...). */
export interface PluginPromptDto {
  requestId: string
  pluginId: string
  title?: string
  label?: string
  placeholder?: string
  /** Giá trị điền sẵn trong ô nhập. */
  value?: string
}

// ── Marketplace (F52) ────────────────────────────────────────────────────────
/** 1 plugin trong registry công khai — bản rút gọn cho UI (files/URL ở lại main). */
export interface MarketplacePluginDto {
  id: string
  name: string
  version: string
  description: string | null
  author: string | null
}

export interface MarketplaceListDto {
  ok: boolean
  plugins: MarketplacePluginDto[]
  /** Thông báo lỗi (mất mạng, registry hỏng…) khi ok=false. */
  error: string | null
}

export interface MarketplaceInstallResultDto {
  ok: boolean
  error: string | null
}

// ---------------------------------------------------------------------------
// F39 — Uptime/port watcher nền
// ---------------------------------------------------------------------------

/** 1 host cần watch: TCP connect tới host:port (best-effort — host sau gate có thể không tới thẳng). */
export interface WatcherTargetDto {
  hostId: string
  host: string
  port: number
  /** Tên host để main ghi sự kiện "không phản hồi / phản hồi lại" đọc được (vault có thể đang khoá). */
  label?: string
}

export interface WatcherStatusDto {
  hostId: string
  ok: boolean
  /** ms tới khi TCP mở được — null khi fail. */
  latencyMs: number | null
  ts: number
}

// ---------------------------------------------------------------------------
// Trung tâm thông báo + đánh dấu sự kiện (events.db ở userData, không mã hoá)
// ---------------------------------------------------------------------------

/** `alert` = có chuyện; `recover` = hết chuyện; `info` = ghi nhận; `marker` = user tự đánh dấu (deploy…). */
export type AppEventKind = 'alert' | 'recover' | 'info' | 'marker'
/** Nguồn phát: từng hệ theo dõi trong app, `user` = marker tay, `app` = chính ứng dụng. */
export type AppEventSource = 'monitor' | 'replication' | 'watcher' | 'tunnel' | 'http' | 'user' | 'app'
export type AppEventSeverity = 'info' | 'warning' | 'critical'

export interface AppEventDto {
  id: number
  ts: number
  kind: AppEventKind
  source: AppEventSource
  severity: AppEventSeverity
  /** Host liên quan — null với sự kiện toàn app hoặc marker "cả fleet". */
  hostId: string | null
  title: string
  detail: string | null
  /** Đã xác nhận lúc nào; null = chưa đọc. Marker không tính là "chưa đọc". */
  ackedAt: number | null
}

export interface AppEventInput {
  kind: AppEventKind
  source: AppEventSource
  severity: AppEventSeverity
  hostId?: string | null
  title: string
  detail?: string | null
  /** Mặc định = bây giờ. Marker cho phép đặt lùi ("deploy lúc 10:00"). */
  ts?: number
}

export interface AppEventQuery {
  /** Chỉ lấy sự kiện từ mốc này (ms). */
  since?: number
  unackedOnly?: boolean
  sources?: AppEventSource[]
  hostId?: string
  /** Mặc định 500 — trung tâm thông báo là chỗ xem gần đây, không phải kho lưu trữ. */
  limit?: number
}

export interface MarkerInput {
  hostId?: string | null
  title: string
  ts?: number
}

// ---------------------------------------------------------------------------
// F38 — Kiểm an ninh nhanh cả fleet (một lệnh chỉ-đọc mỗi host)
// ---------------------------------------------------------------------------

export type SecurityFindingLevel = 'high' | 'medium' | 'low' | 'info'

export interface SecurityFindingDto {
  /** Khoá ổn định (`ssh-password`, `ports-risky`…) — React key + lọc. */
  id: string
  level: SecurityFindingLevel
  title: string
  detail: string | null
  /** Sổ tay vận hành nói cách xử lý — null khi chưa có sổ tay tương ứng. */
  runbookId: string | null
}

export interface SecurityScanDto {
  hostId: string
  collectedAt: number
  ok: boolean
  /** Vì sao không quét được (không nối được, thiếu lệnh) — null khi ok. */
  error: string | null
  /** 0–100, trừ theo mức nặng. Chỉ có nghĩa khi `ok`. */
  score: number
  findings: SecurityFindingDto[]
}

export interface SecurityProgressDto {
  hostId: string
  done: number
  total: number
}

/** F40 — main → renderer: một việc theo lịch vừa bắt đầu hoặc vừa xong. */
export type JobRunEventDto =
  | { phase: 'running'; jobId: string }
  | { phase: 'done'; jobId: string; run: import('./jobs').JobRunDto }

// ---------------------------------------------------------------------------
// Theo dõi URL (synthetic HTTP monitoring) — cấu hình ở http-checks.json, kết quả ở checks.db
// ---------------------------------------------------------------------------

export type HttpCheckMethod = 'GET' | 'HEAD'

export interface HttpCheckDto {
  id: string
  label: string
  url: string
  method: HttpCheckMethod
  /** Mã trạng thái chấp nhận: `200` · `200-399` · `200,301,302` · `2xx`. */
  expectStatus: string
  /** Từ khoá phải có trong body (chỉ GET, đọc tối đa 64KB) — '' = không kiểm. */
  keyword: string
  intervalSec: number
  timeoutMs: number
  /**
   * Ép kết nối TCP tới IP này thay vì DNS — Host header và SNI vẫn theo URL, cert HTTPS vẫn khớp.
   * Dùng để kiểm TỪNG backend sau load balancer (cùng ý với HostMap). '' = DNS thường.
   */
  resolveIp: string
  enabled: boolean
  /** Số lần fail LIÊN TIẾP trước khi báo — chống một lần nháy mạng thành cảnh báo. */
  failsBeforeAlert: number
  /** Gắn với host nào (tuỳ chọn) để alert/marker của host hiện lên biểu đồ của nó. */
  hostId: string | null
  createdAt: number
}

export type HttpCheckInput = Omit<HttpCheckDto, 'id' | 'createdAt'> & { id?: string }

export interface HttpCheckResultDto {
  checkId: string
  ts: number
  ok: boolean
  status: number | null
  latencyMs: number | null
  /** Số ngày cert TLS còn hạn (null với http:// hoặc khi không đọc được cert). */
  certDaysLeft: number | null
  /** Vì sao fail (lỗi mạng, mã sai, thiếu từ khoá) — null khi ok. */
  error: string | null
}

/** Tóm tắt một check cho danh sách: main tính từ kho kết quả + bộ đếm fail đang chạy. */
export interface HttpCheckSummaryDto {
  checkId: string
  /** Trong 24h: tổng lần đo, số lần ok, % uptime (null khi chưa đo). */
  total: number
  okCount: number
  uptimePct: number | null
  avgLatencyMs: number | null
  last: HttpCheckResultDto | null
  consecutiveFails: number
  /** Đang trong trạng thái cảnh báo (đã fail ≥ failsBeforeAlert và chưa hồi). */
  alerting: boolean
}

// ---------------------------------------------------------------------------
// Nhập host từ client SSH khác (PuTTY / MobaXterm / WinSCP / Termius CSV)
// ---------------------------------------------------------------------------

export type ClientImportFormat = 'putty' | 'mobaxterm' | 'winscp' | 'termius'

/** Một host đã parse, CHƯA ghi — user tick chọn trong bảng xem trước rồi mới commit. */
export interface ClientImportDraftDto {
  label: string
  hostname: string
  port: number
  username: string | null
  /** Thư mục/nhóm trong client gốc (đã chuẩn hoá `/`); null = không có. */
  groupPath: string | null
  protocol: HostProtocol
  /** Đường dẫn key trong client gốc — chỉ để hiện cho user biết, KHÔNG tự đọc file (.ppk cần chuyển đổi). */
  keyPath: string | null
}

export interface ClientImportPreviewDto {
  format: ClientImportFormat
  /** Tên file / "Registry" — để nhãn nhóm mặc định nói được nguồn. */
  source: string
  drafts: ClientImportDraftDto[]
  warnings: string[]
}

export interface ClientImportResultDto {
  hostsImported: number
  /** Trùng host đã có (cùng hostname + port + user) → bỏ qua, không tạo bản thứ hai. */
  skipped: number
  groupNames: string[]
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Kiểm kê fleet (CMDB nhẹ) — facts thu qua SSH, lưu inventory.db
// ---------------------------------------------------------------------------

export interface HostFactsDto {
  hostname: string | null
  /** PRETTY_NAME của /etc/os-release. */
  os: string | null
  kernel: string | null
  arch: string | null
  cpuCount: number | null
  memTotalMb: number | null
  /** % đã dùng của phân vùng gốc `/`. */
  diskRootPct: number | null
  uptimeSec: number | null
  ipv4: string[]
  /** Cổng TCP đang lắng nghe (unique, tăng dần). */
  listenPorts: number[]
  /** kvm / vmware / lxc / docker… — null khi máy thật hoặc không dò được. */
  virt: string | null
  rebootRequired: boolean
  /** Phiên bản phần mềm thấy được: php, nginx, apache, mysql, node, docker, python. Thiếu = không cài. */
  versions: Record<string, string>
}

export interface InventoryRowDto {
  hostId: string
  collectedAt: number
  facts: HostFactsDto
  /** Lần thu trước (để tô ô đã đổi) — null khi mới thu lần đầu. */
  previous: HostFactsDto | null
  previousAt: number | null
}

export interface InventoryCollectResultDto {
  hostId: string
  ok: boolean
  error?: string
  row?: InventoryRowDto
}

export interface InventoryProgressDto {
  hostId: string
  done: number
  total: number
}

// ---------------------------------------------------------------------------
// F33/F34 — Process viewer + Systemd manager (qua kênh exec riêng, Linux)
// ---------------------------------------------------------------------------

export interface ProcessInfoDto {
  pid: number
  user: string
  /** %CPU / %MEM từ ps (1 chữ số thập phân). */
  cpuPct: number
  memPct: number
  rssKb: number
  /** etime của ps: [[dd-]hh:]mm:ss. */
  elapsed: string
  command: string
}

export interface ProcListResultDto {
  ok: boolean
  processes: ProcessInfoDto[]
  error?: string
}

export interface ServiceInfoDto {
  unit: string
  /** active/inactive/failed… (cột ACTIVE của systemctl). */
  active: string
  /** running/dead/exited… (cột SUB). */
  sub: string
  description: string
}

export interface ServiceListResultDto {
  ok: boolean
  services: ServiceInfoDto[]
  error?: string
}

export type ServiceActionDto = 'start' | 'stop' | 'restart'

export interface HostExecResultDto {
  ok: boolean
  stdout: string
  stderr: string
  error?: string
}

// ── Local dev stack (Laragon/LocalWP-style) ─────────────────────────────────────
// App tự tải PHP/MariaDB/Nginx portable về userData, tự sinh config, tự supervise process.
// Mọi thứ chạy trên MÁY LOCAL (không SSH). Dữ liệu site nằm ngoài vault (localdev.db) vì
// vault auto-lock 15' còn supervisor phải đọc config liên tục — xem plan §quyết-định 7.

export type LdRuntimeKindDto = 'php' | 'mariadb' | 'nginx' | 'tool'

/** 1 runtime trong catalog: có thể đã cài hoặc chưa. */
export interface LdRuntimeDto {
  id: string
  kind: LdRuntimeKindDto
  version: string
  label: string
  sizeBytes: number
  installed: boolean
  /** 'ok' = đã smoke-test chạy được; 'broken' = cài xong nhưng exe không chạy (thiếu VC++…). */
  state: 'not-installed' | 'installing' | 'ok' | 'broken'
  /** Bản đã hết security support — UI hiện cảnh báo. */
  eol?: boolean
  note?: string
  error?: string
}

export type LdDownloadPhaseDto = 'download' | 'verify' | 'extract' | 'verify-exe' | 'done' | 'error'

export interface LdRuntimeProgressDto {
  id: string
  phase: LdDownloadPhaseDto
  receivedBytes: number
  totalBytes: number | null
  percent: number
  error?: string
}

export type LdServiceStateDto =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'crashed'
  | 'restarting'
  | 'unhealthy'
  | 'missing-runtime'

export interface LdServiceDto {
  id: string
  groupId: string
  label: string
  state: LdServiceStateDto
  pid: number | null
  ports: number[]
  since: number | null
  restarts: number
  lastError: string | null
  runtimeId: string | null
}

export type LdServiceActionDto = 'start' | 'stop' | 'restart' | 'reload'

/** Trạng thái 1 site local. `createdByApp=false` ⇒ app KHÔNG BAO GIỜ xoá file của site đó. */
export interface LdSiteDto {
  id: string
  name: string
  slug: string
  /** Domain chính, vd 'myshop.localhost' (mặc định) hoặc 'myshop.test' (cần hosts entry). */
  domain: string
  /** Thư mục gốc site (chứa app/, logs/, conf/). */
  rootPath: string
  /** Thư mục web (docroot) — nơi nginx trỏ tới. */
  docRoot: string
  phpVersion: string | null
  httpPort: number
  https: boolean
  kind: 'static' | 'php' | 'wordpress'
  status: 'creating' | 'ready' | 'error'
  createdByApp: boolean
  lastError: string | null
  /**
   * Database riêng của site (null = chưa cấp). `dbPass` để thô LÀ CÓ Ý: `wp-config.php` trên
   * đĩa vốn đã chứa đúng password này, nên che ở đây chỉ là an ninh giả. UI vẫn ẩn mặc định
   * để không lộ khi user share màn hình.
   */
  dbName: string | null
  dbUser: string | null
  dbPass: string | null
  createdAt: number
  updatedAt: number
}

/** 'auto' = dò lại từ nội dung thư mục; còn lại là user ép cứng. */
export type LdSiteKindInputDto = 'auto' | 'static' | 'php' | 'wordpress'

export interface LdSiteInputDto {
  id?: string
  name: string
  /** Bỏ trống → suy ra từ name (tạo mới) / giữ nguyên (sửa). Sửa được sang domain bất kỳ. */
  domain?: string
  /** Trỏ vào folder có sẵn (M1) — bắt buộc khi TẠO MỚI, bỏ qua khi sửa. */
  rootPath?: string
  /** Bỏ trống → chính rootPath (tạo mới) / giữ nguyên (sửa). */
  docRoot?: string
  phpVersion?: string | null
  https?: boolean
  /**
   * Loại site. Bỏ trống khi tạo mới = dò tự động; khi SỬA, đây là đường để user chữa lại khi
   * app đoán sai (vd project Laravel bị nhận thành WordPress).
   */
  kind?: LdSiteKindInputDto
}

/** Kết quả dò loại site + LÝ DO — hiện trong form để user biết app căn cứ vào file nào. */
export interface LdSiteDetectDto {
  ok: boolean
  kind?: 'static' | 'php' | 'wordpress'
  /** Thư mục con nên làm docroot ('' = chính thư mục gốc). */
  docRootSub?: string
  /** vd 'artisan (Laravel)' hoặc 'wp-config.php'. */
  reason?: string
  error?: string
}

/** Trạng thái tổng thể để UI hiện 1 chấm màu + Doctor panel. */
export interface LdHealthDto {
  /** Thư mục gốc đang dùng (cấu hình được, có thể ở ổ khác). */
  root: string
  runtimesInstalled: number
  servicesRunning: number
  sites: number
  /** Orphan đã dọn lúc app khởi động (báo cho user biết, không im lặng). */
  reaped: number
  warnings: string[]
}

export interface LdSettingsDto {
  /** Toggle tổng — mặc định TẮT với user hiện có; tắt thì ẩn hoàn toàn khỏi UI. */
  enabled: boolean
  /** Gốc lưu runtime + site (mặc định userData; cho đổi sang ổ khác). */
  root: string
  /** Dải port cấp cho web server. */
  httpPortFrom: number
  httpPortTo: number
  /**
   * Dùng cổng 80 để URL không còn `:port` (`http://site.localhost/`).
   *
   * Windows KHÔNG đòi quyền admin cho cổng <1024, nhưng cổng 80 rất hay bị chiếm sẵn
   * (IIS / World Wide Web Publishing Service / http.sys, Skype cũ). Chiếm rồi thì app tự lùi
   * về dải cổng bên dưới và báo ở phần cảnh báo — KHÔNG chết stack.
   */
  usePort80: boolean
  /** Số worker php-cgi = số request PHP đồng thời tối đa (Windows không có php-fpm). */
  phpPoolSize: number
  /** Tự khởi động stack khi mở app (mặc định TẮT — tiết kiệm 300-500MB RAM). */
  autoStart: boolean
}

export type LdSitePhaseDto = 'validate' | 'scaffold' | 'vhost' | 'reload' | 'done' | 'error'

export interface LdSiteEventDto {
  siteId: string
  phase: LdSitePhaseDto
  percent: number
  message: string
  line?: string
  level?: 'info' | 'warn' | 'error'
}

/** Trạng thái MariaDB do app quản — UI dùng để biết hiện nút nào. */
export interface LdDbStatusDto {
  /** Đã cài runtime MariaDB? */
  installed: boolean
  /** Service đang chạy? */
  running: boolean
  /** Chấp nhận kết nối bằng credential ta đang giữ? */
  ready: boolean
  port: number | null
  host: string
  /** Lý do chưa dùng được, đã sẵn sàng hiện cho user. */
  error?: string
}

/** wp-config.php của site đang trỏ vào DB nào — để UI cảnh báo khi lệch với DB đã cấp. */
export interface LdWpConfigDto {
  /** Site có file wp-config.php không (site không phải WordPress thì không). */
  exists: boolean
  path?: string
  dbName?: string
  dbUser?: string
  dbHost?: string
  /** Giá trị trong file khớp với DB app đã cấp cho site? false ⇒ hiện nút "Cắm vào wp-config". */
  matches?: boolean
  /** Số bảng trong DB app đã cấp — 0 nghĩa là DB rỗng, cần nhập dump. */
  tables?: number
  error?: string
}

/** Thông tin kết nối DB của 1 site — đủ để dán vào Navicat/wp-config.php. */
export interface LdDbCredsDto {
  ok: boolean
  dbName?: string
  dbUser?: string
  dbPass?: string
  host?: string
  port?: number
  error?: string
}

export type LdLogSourceDto = 'nginx-access' | 'nginx-error' | 'php-error' | 'wp-debug'

export interface LdLogTailDto {
  ok: boolean
  text: string
  error?: string
}

/** cwd + env để mở terminal tại thư mục site với php/wp/mysql sẵn trong PATH. */
export interface LdShellEnvDto {
  ok: boolean
  cwd: string
  env: Record<string, string>
  title: string
  error?: string
}

export interface LdResultDto {
  ok: boolean
  error?: string
}

// ── HostMap: domain → IP chỉ định, không sửa file hosts, không cần admin ─────────────────

/** 1 server đích trong cụm (vd 5 con load balance). */
export interface HostMapTargetDto {
  id: string
  label: string
  ip: string
}

export interface HostMapGroupDto {
  id: string
  name: string
  /** Domain hoặc pattern `*.example.net`. */
  patterns: string[]
  targets: HostMapTargetDto[]
  /** Server đang chọn (null = chưa chọn ⇒ chưa mở được). */
  activeTargetId: string | null
  /** URL mở khi bấm Mở; null ⇒ suy ra `https://<domain đầu tiên>/`. */
  url: string | null
  /** Browser ưu tiên cho group này (id từ `HostMapStateDto.browsers`); null ⇒ lấy cái đầu. */
  browserId: string | null
}

/** Input lưu group — `id` trống = tạo mới. */
export interface HostMapGroupInput {
  id?: string
  name: string
  patterns: string[]
  targets: HostMapTargetDto[]
  activeTargetId: string | null
  url: string | null
  browserId: string | null
}

export interface HostMapBrowserDto {
  id: string
  name: string
  exe: string
}

/** Một font user tự thêm từ file. `dataUrl` để renderer đăng ký bằng `FontFace`. */
export interface CustomFontDto {
  id: string
  /** Tên họ font dùng trong CSS `font-family` — đọc từ file, user sửa được. */
  family: string
  /** Tên file trong `userData/fonts` (do main tự sinh, không phải tên user đặt). */
  fileName: string
  sizeBytes: number
  dataUrl: string
}

export interface FontListDto {
  /** Tên họ font đọc được từ thư mục font của hệ điều hành, đã sắp xếp + loại trùng. */
  system: string[]
  custom: CustomFontDto[]
  /** true = quét không ra font nào → UI phải chỉ user dùng ô nhập tay thay vì im lặng. */
  scanFailed: boolean
}

export type FontAddResultDto =
  | { ok: true; font: CustomFontDto }
  | { ok: false; reason: 'full' | 'tooLarge' | 'notFont' | 'io' }

export interface HostMapStateDto {
  groups: HostMapGroupDto[]
  /** Browser Chromium tìm thấy trên máy. Rỗng ⇒ UI phải nói rõ vì sao không mở được. */
  browsers: HostMapBrowserDto[]
  /** Tổng dung lượng profile browser app đã sinh (byte) — để user biết khi nào nên dọn. */
  profilesBytes: number
}

export interface HostMapOpenDto {
  ok: boolean
  /** Số cửa sổ đã mở (openAll). */
  opened?: number
  error?: string
}

export interface HostMapCurlDto {
  ok: boolean
  command?: string
  error?: string
}

/**
 * Kết quả một lần user tự bấm "Kiểm tra cập nhật".
 *
 * Vì sao phải có kiểu riêng thay vì `Promise<void>`: khi KHÔNG có bản mới, electron-updater
 * không bắn sự kiện nào cả — bấm nút xong màn hình đứng im, không phân biệt được "đã mới nhất"
 * với "hỏng không ai báo". Mỗi nhánh ở đây phải nói được thành một câu cho user đọc.
 */
export type UpdateCheckResultDto =
  /** Đang chạy `pnpm dev`: electron-updater không có metadata để hỏi — nói thẳng, đừng báo lỗi. */
  | { status: 'dev' }
  | { status: 'available'; version: string }
  | { status: 'latest'; version: string }
  /**
   * `code: 'assetsPending'` — release mới nhất vừa được tạo nhưng chưa có file update
   * (`latest*.yml` trả 404): tag vừa push, CI còn đang build/tải asset lên. Không phải hỏng,
   * chỉ cần thử lại sau vài phút — renderer dịch thành câu nói đúng điều đó thay vì dump lỗi thô.
   */
  | { status: 'error'; message: string; code?: 'assetsPending' }

/** Ngôn ngữ giao diện — main chỉ cần nó cho menu khay hệ thống (renderer giữ từ điển đầy đủ). */
export type UiLanguage = 'vi' | 'en' | 'ja'

/**
 * F53 — tuỳ chọn khay hệ thống, renderer gửi sang main lúc khởi động và mỗi khi đổi.
 * Main không đọc localStorage của renderer được nên phải nhận qua IPC.
 */
export interface TrayPrefsDto {
  /** Bấm ✕ cửa sổ chính = ẩn vào khay (tunnel/monitoring/watcher vẫn chạy); false = thoát như cũ. */
  closeToTray: boolean
  language: UiLanguage
}

export interface InfraApi {
  vault: {
    status(): Promise<VaultStatus>
    setup(masterPassword: string, remember: boolean): Promise<VaultStatus>
    unlock(masterPassword: string, remember: boolean): Promise<VaultStatus>
    lock(): Promise<VaultStatus>
    /** Sự kiện vault bị khoá từ main (auto-lock). Trả về hàm unsubscribe. */
    onLocked(cb: () => void): () => void
  }
  app: {
    /** F53 — báo main tuỳ chọn khay hệ thống (đóng-về-khay, ngôn ngữ menu khay). */
    setTrayPrefs(prefs: TrayPrefsDto): void
  }
  /** Trung tâm thông báo + đánh dấu sự kiện — mọi hệ theo dõi trong main ghi vào cùng một kho. */
  events: {
    list(query?: AppEventQuery): Promise<AppEventDto[]>
    unread(): Promise<number>
    ack(id: number): Promise<void>
    ackAll(): Promise<void>
    remove(id: number): Promise<void>
    addMarker(input: MarkerInput): Promise<AppEventDto | null>
    /** Marker (toàn fleet + của host) và alert/recover của host trong khoảng — để vẽ lên biểu đồ. */
    timeline(hostId: string | null, fromTs: number, toTs: number): Promise<AppEventDto[]>
    /** Sự kiện mới vừa được ghi (từ bất kỳ nguồn nào). */
    onNew(cb: (event: AppEventDto) => void): () => void
    /** Sau ack/xoá — payload là số chưa đọc hiện tại. */
    onChanged(cb: (unread: number) => void): () => void
  }
  /** Theo dõi URL — chạy ở main mọi lúc (không cần vault mở). */
  httpChecks: {
    list(): Promise<HttpCheckDto[]>
    save(input: HttpCheckInput): Promise<HttpCheckDto>
    remove(id: string): Promise<void>
    /** Đo ngay một check (không đợi chu kỳ). */
    runNow(id: string): Promise<HttpCheckResultDto | null>
    /** Kết quả của một check từ mốc `sinceTs`, cũ → mới. */
    results(id: string, sinceTs: number): Promise<HttpCheckResultDto[]>
    summaries(): Promise<HttpCheckSummaryDto[]>
    onResult(cb: (result: HttpCheckResultDto) => void): () => void
    onSummary(cb: (summary: HttpCheckSummaryDto) => void): () => void
  }
  /** Kiểm kê fleet — facts mỗi host thu qua SSH (kênh exec riêng, xuyên login-script). */
  inventory: {
    /** Bản thu gần nhất của mọi host còn trong kho (kèm bản trước để so). */
    list(): Promise<InventoryRowDto[]>
    /** Thu facts các host (song song có giới hạn); tiến độ qua onProgress. */
    collect(hostIds: string[]): Promise<InventoryCollectResultDto[]>
    /** Xuất bảng gần nhất ra CSV (hộp thoại lưu file). */
    exportCsv(): Promise<{ ok: boolean; path?: string; message: string }>
    remove(hostId: string): Promise<void>
    onProgress(cb: (p: InventoryProgressDto) => void): () => void
  }
  /** F38 — Kiểm an ninh nhanh: quét N host, kết quả giữ trong phiên (không lưu đĩa). */
  security: {
    scan(hostIds: string[]): Promise<SecurityScanDto[]>
    onProgress(cb: (p: SecurityProgressDto) => void): () => void
  }
  /** F40 — Lịch chạy tự động. Lịch đọc được khi vault khoá; lúc CHẠY thì cần vault mở. */
  jobs: {
    list(): Promise<{ jobs: import('./jobs').ScheduledJobDto[]; latest: Record<string, import('./jobs').JobRunDto> }>
    save(input: import('./jobs').ScheduledJobInput): Promise<import('./jobs').ScheduledJobDto>
    remove(id: string): Promise<void>
    /** Chạy ngay một việc, không đợi lịch. */
    runNow(id: string): Promise<import('./jobs').JobRunDto | null>
    runs(id: string): Promise<import('./jobs').JobRunDto[]>
    onRunEvent(cb: (e: JobRunEventDto) => void): () => void
  }
  /**
   * F28/F29 — Cặp thư mục local ↔ remote: so lệch theo mtime/size và tự đẩy khi file local đổi.
   * Danh sách cặp lưu ngoài vault (chỉ là đường dẫn, không bí mật) nên đọc được lúc vault khoá;
   * quét và đẩy thì cần vault mở vì phải nối SSH.
   */
  folderSync: {
    list(): Promise<import('./folderSync').FolderPairDto[]>
    save(input: import('./folderSync').FolderPairInput): Promise<import('./folderSync').FolderPairDto>
    remove(id: string): Promise<void>
    /** Hộp thoại chọn thư mục local; null nếu user huỷ. */
    pickLocal(): Promise<string | null>
    scan(pairId: string): Promise<import('./folderSync').FolderScanDto>
    /** Đẩy các file local mới hơn / chỉ có ở local. Trả số file đã đẩy. */
    push(pairId: string, paths?: string[]): Promise<{ pushed: number; failed: number; message: string }>
    watch(pairId: string, on: boolean): Promise<boolean>
    onEvent(cb: (e: import('./folderSync').FolderSyncEventDto) => void): () => void
  }
  /**
   * F24 — lịch sử LỆNH theo host (ô tìm Ctrl+Shift+R). Nội dung lệnh mã hoá bằng DEK trong vault
   * nên mọi đường ở đây cần vault MỞ; `add` khi vault khoá thì trả `false` và im lặng bỏ lượt
   * chứ không throw (lệnh vẫn chạy bình thường trong phiên đã mở — không phá việc chính).
   *
   * KHÔNG đi qua sync: `export`/`import` file JSON là đường duy nhất mang sang máy khác.
   */
  commandHistory: {
    /** Trả `false` nếu vault đang khoá hoặc ghi lỗi — nơi gọi không cần xử lý gì thêm. */
    add(input: {
      hostId: string | null
      hostLabel: string
      command: string
      exitCode: number | null
      durationMs: number
      startedAt: number
      /** Lệnh đã bị che một phần → không chạy lại nguyên văn được. */
      redacted?: boolean
    }): Promise<boolean>
    /** `hostId` bỏ trống / null = mọi host. Vault khoá → mảng rỗng. */
    list(options?: { hostId?: string | null; limit?: number }): Promise<
      import('./commandHistory').CommandHistoryEntry[]
    >
    remove(id: string): Promise<void>
    /** Xoá sạch; `hostId` để xoá của đúng một máy. Trả số dòng đã xoá. */
    clear(hostId?: string | null): Promise<number>
    /** Hộp thoại lưu file JSON (chữ THƯỜNG, không mã hoá); trả đường dẫn, null nếu huỷ. */
    export(hostId?: string | null): Promise<string | null>
    import(): Promise<{ added: number; message?: string }>
  }
  /** Sổ tay vận hành — phần RIÊNG của user (sổ tay có sẵn nằm trong renderer, không cần IPC). Cần vault mở. */
  runbooks: {
    listCustom(): Promise<import('./runbooks').Runbook[]>
    saveCustom(runbook: import('./runbooks').Runbook): Promise<import('./runbooks').Runbook[]>
    deleteCustom(id: string): Promise<import('./runbooks').Runbook[]>
  }
  data: {
    listShells(): Promise<ShellProfile[]>
    listGroups(): Promise<GroupDto[]>
    saveGroup(group: GroupInput): Promise<GroupDto>
    deleteGroup(id: string): Promise<void>
    listHosts(): Promise<HostDto[]>
    saveHost(input: HostInput): Promise<HostDto>
    deleteHost(id: string): Promise<void>
    listKeys(): Promise<SshKeyDto[]>
    generateKey(label: string): Promise<SshKeyDto>
    importKey(input: KeyImportInput): Promise<SshKeyDto>
    deleteKey(id: string): Promise<void>
    listHistory(limit?: number): Promise<HistoryEntry[]>
    listSnippets(): Promise<SnippetDto[]>
    saveSnippet(input: SnippetInput): Promise<SnippetDto>
    deleteSnippet(id: string): Promise<void>
  }
  tunnels: {
    list(): Promise<TunnelRuleDto[]>
    save(input: TunnelRuleInput): Promise<TunnelRuleDto>
    delete(id: string): Promise<void>
    start(id: string): Promise<void>
    stop(id: string): Promise<void>
    states(): Promise<TunnelStateDto[]>
    onState(cb: (e: TunnelStateDto) => void): () => void
    /** Tách bảng tunnel ra cửa sổ riêng always-on-top (theo dõi khi app chính bị che). */
    openDetached(): Promise<void>
    closeDetached(): void
    /** Cửa sổ tách rời đang mở? (để cửa sổ chính đổi nhãn nút) */
    onDetachedState(cb: (open: boolean) => void): () => void
    /**
     * F15 — bật mọi rule có `autoStart`. Gọi MỘT lần sau khi vault mở; main tự chặn lần gọi
     * thứ hai trong cùng tiến trình. Trả về số rule đã được yêu cầu bật (kết quả thật đến qua
     * `onState`, vì `TunnelService.start` nuốt lỗi vào state).
     */
    autoStart(): Promise<number>
  }
  terminal: {
    create(req: TerminalCreateRequest): Promise<TerminalCreateResponse>
    write(sessionId: string, data: string): void
    resize(sessionId: string, cols: number, rows: number): void
    kill(sessionId: string): void
    onData(cb: (e: TerminalDataEvent) => void): () => void
    onExit(cb: (e: TerminalExitEvent) => void): () => void
    onStatus(cb: (e: TerminalStatusEvent) => void): () => void
    /** Bật/tắt ghi log phiên ra file. Trả về trạng thái + đường dẫn file. */
    toggleLog(sessionId: string, title: string): Promise<SessionLogState>
    /** Mở thư mục chứa log bằng file explorer. */
    openLogFolder(): void
    /** Bật/tắt ghi hình phiên (asciicast v2 — replay được). */
    toggleRecord(sessionId: string, title: string): Promise<SessionRecordState>
    /** Báo main phiên terminal đang active (cho plugin api.terminal.getActiveSessionId). */
    setActive(sessionId: string | null): void
  }
  recordings: {
    list(): Promise<RecordingInfoDto[]>
    /** Đọc nội dung file .cast để replay. */
    read(name: string): Promise<string>
    openFolder(): void
    delete(name: string): Promise<void>
  }
  serial: {
    listPorts(): Promise<SerialPortInfo[]>
  }
  sftp: {
    open(hostId: string): Promise<SftpOpenResponse>
    close(sessionId: string): void
    list(sessionId: string, path: string): Promise<FileEntryDto[]>
    mkdir(sessionId: string, path: string): Promise<void>
    rename(sessionId: string, from: string, to: string): Promise<void>
    delete(sessionId: string, path: string, isDir: boolean): Promise<void>
    chmod(sessionId: string, path: string, mode: string): Promise<void>
    /** Tải file/thư mục remote về thư mục local. */
    download(sessionId: string, remotePath: string, localDir: string): Promise<void>
    /** Đẩy file/thư mục local lên thư mục remote. */
    upload(sessionId: string, localPath: string, remoteDir: string): Promise<void>
    /** Mở file remote bằng editor local; tự upload lại khi file thay đổi. */
    edit(sessionId: string, remotePath: string): Promise<void>
    onTransfer(cb: (e: TransferEvent) => void): () => void
  }
  vnc: {
    /** Mở phiên VNC: main dựng cầu ws↔tcp (qua jump host), trả wsPort+token cho noVNC. */
    open(hostId: string): Promise<VncOpenResultDto>
    close(sessionId: string): void
  }
  rdp: {
    /** Mở RDP qua tunnel: forward cổng 3389 rồi mở client RDP hệ điều hành. */
    open(hostId: string): Promise<RdpOpenResultDto>
    close(sessionId: string): void
    list(): Promise<RdpSessionDto[]>
    onChange(cb: () => void): () => void
  }
  fs: {
    roots(): Promise<string[]>
    home(): Promise<string>
    list(path: string): Promise<FileEntryDto[]>
    mkdir(path: string): Promise<void>
    rename(from: string, to: string): Promise<void>
    delete(path: string): Promise<void>
  }
  importer: {
    /** Mở dialog chọn file ssh_config rồi import. null = user huỷ. */
    sshConfig(): Promise<SshConfigImportResult | null>
    /** Chọn file của client khác (.reg PuTTY, .mxtsessions, WinSCP.ini, .csv Termius) → xem trước. null = huỷ/không nhận ra. */
    clientPick(): Promise<ClientImportPreviewDto | null>
    /** Windows: đọc thẳng PuTTY từ Registry (HKCU\Software\SimonTatham\PuTTY\Sessions). null ở hệ khác hoặc không có session. */
    clientPuttyRegistry(): Promise<ClientImportPreviewDto | null>
    /** Ghi các draft đã tick vào vault. */
    clientCommit(drafts: ClientImportDraftDto[], source: string): Promise<ClientImportResultDto>
    /** F05 — các tài khoản DigitalOcean đã lưu (chỉ nhãn; token thật không bao giờ qua IPC). */
    doConfig(): Promise<DoConfigDto>
    /** Thêm/đổi tên tài khoản DigitalOcean; token mã hoá DEK trong vault. */
    doSaveAccount(input: DoAccountInput): Promise<DoAccountDto>
    /** Xoá tài khoản kèm token của nó. */
    doDeleteAccount(id: string): Promise<void>
    /** Liệt kê droplet qua API — theo tài khoản đã lưu hoặc token vừa nhập. */
    doListDroplets(request: DoListRequest): Promise<DoListResult>
    /** Tạo host từ các máy đã chọn (mọi provider dùng chung) — dedupe theo địa chỉ. */
    doImport(droplets: DoDropletDto[], options: DoImportOptions): Promise<DoImportResult>
    /** F05 AWS/GCP/Azure — danh bạ tài khoản (credentials không bao giờ qua IPC). */
    cloudAccounts(): Promise<CloudAccountDto[]>
    cloudSaveAccount(input: CloudAccountInput): Promise<CloudAccountDto>
    cloudDeleteAccount(id: string): Promise<void>
    /** Liệt kê máy ảo của một tài khoản đã lưu — chỉ gọi API đọc. */
    cloudListInstances(accountId: string): Promise<CloudListResult>
  }
  exporter: {
    /**
     * Xuất hosts ra file do user chọn. Bản xuất chỉ có thông tin kết nối —
     * không mật khẩu, không key, không ghi chú, không biến môi trường.
     */
    hosts(format: HostExportFormat): Promise<HostExportResult>
  }
  keys: {
    /** Đẩy public key lên `~/.ssh/authorized_keys` của host rồi đăng nhập thử bằng key đó. */
    copyId(request: CopyIdRequest): Promise<CopyIdResult>
    /** Xoay vòng key trên một host. KHÔNG BAO GIỜ gỡ key cũ khi key mới chưa đăng nhập được. */
    rotate(request: RotateRequest): Promise<RotateResult>
  }
  logTail: {
    /** Mở phiên `tail -F` trên host. Dòng về qua `onEvent`. */
    start(hostId: string, path: string): Promise<LogTailStartResult>
    stop(id: string): Promise<void>
    onEvent(cb: (event: LogTailEvent) => void): () => void
  }
  diag: {
    /** Liệt kê MỘT cấp dưới `path` (drill-down từng bước) + dung lượng còn trống các phân vùng. */
    disk(hostId: string, path: string): Promise<DiskUsageResultDto>
    /** Liệt kê bản cập nhật đang chờ. CHỈ ĐỌC — không chạy `apt update`, không cài gì. */
    updates(hostId: string): Promise<HostUpdatesDto>
    /**
     * Đọc crontab theo phạm vi: `user` (đang đăng nhập) · `root` (qua `sudo -n`) ·
     * `system` (`/etc/crontab` + `/etc/cron.d/*`, định dạng 6 trường có cột user).
     * Rỗng = phạm vi đó chưa có crontab, không phải lỗi.
     */
    cronRead(hostId: string, scope: CronScopeDto): Promise<CronReadResult>
    /** ⚠️ GHI ĐÈ crontab. Nơi gọi phải xác nhận trước — đây là thay đổi trên production. */
    cronWrite(hostId: string, content: string, scope: CronScopeDto): Promise<CronWriteResult>
  }
  knownHosts: {
    list(): Promise<KnownHostDto[]>
    /** Quên một fingerprint — lần nối sau host đó hỏi lại như máy lạ. Trả danh sách còn lại. */
    forget(id: string): Promise<KnownHostDto[]>
  }
  secrets: {
    /** Hiện bí mật đã lưu lên màn hình. Giá trị VÀO renderer — nơi gọi phải che + tự ẩn. */
    reveal(request: RevealRequest): Promise<RevealResult>
    /**
     * Chép vào clipboard mà KHÔNG đưa giá trị qua renderer (main tự giải mã rồi ghi).
     * Clipboard tự xoá sau ~30s nếu nội dung chưa bị thay.
     */
    copy(request: RevealRequest): Promise<RevealResult>
  }
  bulk: {
    /**
     * Chạy lệnh trên nhiều host song song. Kết quả stream qua onEvent.
     * runId do renderer sinh (event lỗi prepare có thể về TRƯỚC khi invoke resolve).
     */
    run(runId: string, hostIds: string[], command: string): Promise<string>
    /** Hủy run đang chạy: dừng host xếp hàng + đóng kết nối đang chạy. */
    cancel(runId: string): Promise<void>
    onEvent(cb: (e: BulkRunEvent) => void): () => void
  }
  net: {
    ping(host: string): Promise<PingResultDto>
    dns(host: string): Promise<DnsResultDto>
    portCheck(host: string, port: number): Promise<{ open: boolean; ms: number }>
    scan(host: string): Promise<PortScanEntryDto[]>
    /** Tải ảnh từ URL ở main process (tránh CORS) → trả về data URL gốc để renderer nén/lưu. */
    fetchImage(url: string): Promise<string>
  }
  monitor: {
    /** Bắt đầu theo dõi các host (mở kết nối + poll). Kèm label để main dựng thông báo/webhook kể cả khi vault khoá. */
    start(hosts: { id: string; label: string }[]): Promise<void>
    stop(hostId: string): void
    stopAll(): void
    /** Tham gia nhận sample mà KHÔNG khởi động lại SSH (cửa sổ tách rời) — main replay sample gần nhất. */
    subscribe(): void
    /** Monitoring bị dừng (từ bất kỳ cửa sổ nào) → mọi cửa sổ reset store. */
    onStopped(cb: () => void): () => void
    /** Mở cửa sổ monitor tách rời (always-on-top, sống cả khi thu nhỏ app chính). */
    openDetached(hosts: { id: string; label: string }[]): Promise<void>
    /** Đóng cửa sổ monitor tách rời (gộp lại về dock). */
    closeDetached(): void
    /** Cửa sổ tách rời gọi lúc khởi tạo để lấy danh sách host đang theo dõi. */
    detachedInit(): Promise<{ hosts: { id: string; label: string }[] }>
    /** App chính lắng nghe: true = đang có cửa sổ tách rời, false = đã đóng. */
    onDetachedState(cb: (open: boolean) => void): () => void
    onSample(cb: (s: MetricSampleDto) => void): () => void
    /** Cảnh báo ngưỡng breach/recover (F04). */
    onAlert(cb: (a: MonitorAlertDto) => void): () => void
    getSettings(): Promise<MonitorSettingsDto>
    setSettings(s: MonitorSettingsDto): Promise<void>
    /** Gửi alert giả qua webhook để kiểm tra URL. */
    testWebhook(url: string): Promise<{ ok: boolean; message: string }>
    /** Lịch sử metrics đã downsample (res 1 = bucket phút, 10 = bucket 10 phút). */
    queryHistory(hostId: string, fromTs: number, toTs: number, res: 1 | 10): Promise<MetricHistoryPointDto[]>
    /** Các host từng được monitor (còn dữ liệu lịch sử), mới nhất trước — cho mục Dashboard. */
    historyHosts(): Promise<MetricHistoryHostDto[]>
  }
  /** F39 — watcher nền: check TCP host:port định kỳ, chấm xanh/đỏ ở sidebar. */
  watcher: {
    /** Đặt danh sách host cần watch (thay tập cũ) + chạy sweep ngay. Gọi lại khi hosts đổi. */
    start(targets: WatcherTargetDto[]): void
    stop(): void
    /** Kết quả mỗi sweep (mảng đủ các target). */
    onStatus(cb: (statuses: WatcherStatusDto[]) => void): () => void
  }
  /** F33/F34 — công cụ host (process viewer + systemd manager) qua kênh exec riêng. */
  hostTools: {
    listProcesses(hostId: string, sortBy: 'cpu' | 'mem'): Promise<ProcListResultDto>
    /** Gửi signal cho PID (TERM trước, KILL khi cứng đầu). */
    killProcess(hostId: string, pid: number, signal: 'TERM' | 'KILL'): Promise<HostExecResultDto>
    listServices(hostId: string): Promise<ServiceListResultDto>
    /** systemctl start/stop/restart — có thể cần quyền root trên server. */
    serviceAction(hostId: string, unit: string, action: ServiceActionDto): Promise<HostExecResultDto>
    /** journalctl -u <unit> (120 dòng cuối). */
    serviceLogs(hostId: string, unit: string): Promise<HostExecResultDto>
    /** F49 — đọc nội dung 1 file trên host (stdout = nội dung), cắt ở ~1MB. Cho tính năng so sánh config. */
    readFile(hostId: string, path: string): Promise<HostExecResultDto>
  }
  /**
   * F55 — theo dõi bất đồng bộ master ↔ slave (MySQL/MariaDB). Chỉ ĐỌC trạng thái và đưa ra
   * runbook; app không bao giờ tự chạy lệnh sửa.
   */
  replication: {
    listPairs(): Promise<ReplPairDto[]>
    savePair(input: ReplPairInput): Promise<ReplPairDto>
    deletePair(id: string): Promise<void>
    /** Thử kết nối 1 lần cho MỘT slave (mặc định slave đầu), cho biết đang đi đường nào. */
    testPair(id: string, replicaId?: string): Promise<ReplTestResultDto>
    /** Bắt đầu đo định kỳ. Kết nối được giữ mở nên vẫn chạy khi vault tự khoá. */
    watch(pairId: string): Promise<void>
    unwatch(pairId: string): void
    /** Đo ngay một lần, không đợi hết chu kỳ. */
    pollNow(pairId: string): Promise<void>
    /** Cửa sổ phụ chỉ nhận sample, không tự mở kết nối. */
    subscribe(): void
    onSample(cb: (s: ReplSnapshotDto) => void): () => void
    /** Cảnh báo ngưỡng breach/recover. */
    onAlert(cb: (a: ReplAlertDto) => void): () => void
    getSettings(): Promise<ReplSettingsDto>
    setSettings(s: ReplSettingsDto): Promise<void>
    /**
     * So lệch thực tế master ↔ slave: kiểm kê bảng + schema + biến cấu hình.
     * Chỉ đọc information_schema nên nhanh; số dòng là ƯỚC LƯỢNG.
     */
    compare(pairId: string, replicaId?: string): Promise<ReplCompareResultDto>
    /**
     * Đếm chính xác (COUNT(*)) và/hoặc CHECKSUM TABLE cho các bảng được chọn.
     * NẶNG — quét toàn bảng, chạy tuần tự.
     */
    checksum(
      pairId: string,
      tables: Array<{ schema: string; name: string }>,
      mode: 'count' | 'checksum',
      replicaId?: string
    ): Promise<ReplChecksumRowDto[]>
    /**
     * Lịch sử so lệch — mỗi lần quét/đếm/checksum được lưu tự động. Thiếu `pairId` = mọi cụm
     * (kể cả cụm đã bị xoá: bản ghi giữ lại nhãn tại thời điểm chạy).
     */
    historyList(pairId?: string): Promise<ReplRunDto[]>
    /** Chi tiết một bản ghi — payload chỉ được giải mã khi user thật sự mở ra xem. */
    historyGet(id: string): Promise<ReplRunDetailDto | null>
    historyDelete(id: string): Promise<void>
    /** Xoá lịch sử; thiếu `pairId` = xoá sạch. Trả về số bản ghi đã xoá. */
    historyClear(pairId?: string): Promise<number>
  }
  /**
   * Local dev stack — chạy trên MÁY LOCAL, không SSH. App tự tải runtime (PHP/MariaDB/Nginx)
   * về userData và tự supervise process. Mặc định TẮT (settings.enabled=false).
   */
  localdev: {
    /** Nhanh: tính năng có đang bật không (gate mọi entry point UI, tránh gọi cả bộ khi tắt). */
    enabled(): Promise<boolean>
    health(): Promise<LdHealthDto>
    /**
     * Mở thư mục bằng file explorer. `what='site'` cần `siteId` — main tự tra đường dẫn từ
     * store (renderer KHÔNG được truyền path tuỳ ý vào shell.openPath).
     */
    openFolder(what: 'root' | 'runtimes' | 'conf' | 'logs' | 'certs' | 'sites' | 'site', siteId?: string): void

    runtimeCatalog(): Promise<LdRuntimeDto[]>
    /** `fromFile=true`: chọn file đã tải sẵn thay vì tải qua mạng (khi AV/mạng công ty chặn). */
    runtimeInstall(id: string, fromFile?: boolean): Promise<LdResultDto>
    runtimeCancel(id: string): void
    runtimeRemove(id: string): Promise<LdResultDto>
    onRuntimeProgress(cb: (p: LdRuntimeProgressDto) => void): () => void

    services(): Promise<LdServiceDto[]>
    serviceAction(id: string, action: LdServiceActionDto): Promise<LdResultDto>
    /** Dừng MỌI service local — escape hatch khi có process kẹt (cũng có trong palette). */
    stopAll(): Promise<LdResultDto>
    onServiceEvent(cb: (s: LdServiceDto) => void): () => void

    sites(): Promise<LdSiteDto[]>
    siteSave(input: LdSiteInputDto): Promise<LdSiteDto>
    /** removeFiles=true mới xoá file trên đĩa (mặc định chỉ bỏ khỏi danh sách). */
    siteDelete(id: string, removeFiles: boolean): Promise<LdResultDto>
    siteOpen(id: string): void
    /**
     * Mở site trong browser Chromium với DNS override `MAP <domain> 127.0.0.1:<port>` — URL
     * KHÔNG có `:port` và KHÔNG cần hosts entry, dùng được cả domain custom (`.test`, `.local`).
     * Cùng cơ chế với tính năng HostMap.
     */
    siteOpenNoPort(id: string): Promise<LdResultDto>
    /** Dò lại loại site từ nội dung thư mục (kèm lý do) — cho form sửa site. */
    siteDetect(rootPath: string): Promise<LdSiteDetectDto>
    /** Hộp thoại chọn thư mục (main mở dialog) — null nếu user huỷ. */
    sitePickFolder(): Promise<string | null>
    /** cwd+env để renderer mở tab terminal tại site (renderer không tự dựng path runtime). */
    siteShellEnv(id: string): Promise<LdShellEnvDto>
    onSiteEvent(cb: (e: LdSiteEventDto) => void): () => void

    /** MariaDB do app quản: đã cài / đang chạy / nhận kết nối được chưa. */
    dbStatus(): Promise<LdDbStatusDto>
    /**
     * Cấp (hoặc lấy lại) database + user riêng cho site. Idempotent: site đã có DB thì trả
     * đúng credential cũ chứ không tạo DB mới — `wp-config.php` đang trỏ vào cái cũ.
     */
    dbProvision(siteId: string): Promise<LdDbCredsDto>
    /** Dump DB của site ra file .sql (mở hộp thoại chọn nơi lưu). */
    dbDump(siteId: string): Promise<LdResultDto>
    /**
     * Nạp 1 file .sql vào DB của site (mở hộp thoại chọn file) — đường mang dữ liệu từ
     * XAMPP/Laragon/prod sang. Dừng ở câu lỗi đầu tiên thay vì nhập nửa vời.
     */
    dbImport(siteId: string): Promise<LdResultDto>
    /** Danh sách database người dùng (bỏ schema hệ thống). */
    dbList(): Promise<string[]>
    /** Mở Adminer trong browser (công cụ DB nhẹ). `siteId` để chọn sẵn DB của site đó. */
    dbAdminer(siteId?: string): Promise<LdResultDto>
    /** Mở phpMyAdmin trong browser — cùng vai trò Adminer. `siteId` để chọn sẵn DB của site đó. */
    dbPhpMyAdmin(siteId?: string): Promise<LdResultDto>

    /** wp-config.php của site đang trỏ vào DB nào + DB app cấp có dữ liệu chưa. */
    siteWpConfigRead(siteId: string): Promise<LdWpConfigDto>
    /** Ghi credential DB của site vào wp-config.php (backup file cũ vào trash/ trước). */
    siteWpConfigWrite(siteId: string): Promise<LdResultDto>

    /** Đọc N KB CUỐI của log (khác hostTools.readFile lấy đầu file). */
    logTail(siteId: string, which: LdLogSourceDto): Promise<LdLogTailDto>
    settingsGet(): Promise<LdSettingsDto>
    settingsSet(s: Partial<LdSettingsDto>): Promise<LdSettingsDto>
  }
  /**
   * HostMap — test 1 server cụ thể trong cụm load balance mà KHÔNG sửa file hosts và KHÔNG cần
   * quyền admin: app mở browser Chromium với `--host-resolver-rules` (ghi đè DNS trong đúng
   * cửa sổ đó, certificate vẫn khớp vì hostname không đổi).
   */
  hostmap: {
    state(): Promise<HostMapStateDto>
    saveGroup(input: HostMapGroupInput): Promise<HostMapStateDto>
    deleteGroup(id: string): Promise<HostMapStateDto>
    /** Đổi server đang trỏ tới (thao tác chính, dùng nhiều nhất). */
    setActive(groupId: string, targetId: string): Promise<HostMapStateDto>
    open(groupId: string, opts?: { targetId?: string; browserId?: string }): Promise<HostMapOpenDto>
    /** Mỗi target 1 cửa sổ, mở song song — so sánh cả cụm cùng lúc. */
    openAll(groupId: string, browserId?: string): Promise<HostMapOpenDto>
    curlCommand(groupId: string, targetId?: string): Promise<HostMapCurlDto>
    /** Xoá profile browser đã sinh cho group (hoặc tất cả nếu bỏ trống). */
    clearProfiles(groupId?: string): Promise<HostMapOpenDto>
  }
  /** F57 — nguồn font cho dropdown chọn font terminal (Settings → Terminal). */
  fonts: {
    list(): Promise<FontListDto>
    /** Quét lại thư mục font của hệ điều hành — dùng sau khi user vừa cài font mới. */
    rescan(): Promise<FontListDto>
    add(name: string, bytes: Uint8Array): Promise<FontAddResultDto>
    rename(id: string, family: string): Promise<boolean>
    remove(id: string): Promise<boolean>
  }
  ai: {
    getConfig(): Promise<AiConfigDto | null>
    setConfig(input: AiConfigInput): Promise<void>
    ask(mode: AiModeDto, input: string, context?: string): Promise<AiAskResultDto>
    /** F48 — chạy 1 lệnh chẩn đoán read-only trên host qua kênh exec riêng (enforce guard ở main). */
    diagnoseExec(hostId: string, command: string): Promise<AiDiagnoseExecResultDto>
    /** F48 — lưu một phiên chẩn đoán đã kết thúc vào lịch sử. Trả về id. */
    saveDiagnosis(input: AiDiagnoseSaveInput): Promise<string>
    /** F48 — danh sách lịch sử chẩn đoán (mới nhất trước). */
    listDiagnoses(limit?: number): Promise<AiDiagnoseRecordDto[]>
    /** F48 — chi tiết đầy đủ một phiên đã lưu để xem lại. */
    getDiagnosis(id: string): Promise<AiDiagnoseDetailDto | null>
    /** F48 — xoá một phiên khỏi lịch sử. */
    deleteDiagnosis(id: string): Promise<void>
  }
  sync: {
    status(): Promise<SyncStatusDto>
    /** Mở dialog chọn thư mục đồng bộ. null = huỷ. */
    pickFolder(): Promise<string | null>
    /** Bật sync: dẫn xuất sync key từ passphrase, verify với blob hiện có, ghi nhớ key. */
    /** Bật/cấu hình lại kênh THƯ MỤC (mỗi loại backend tối đa một kênh). */
    configure(folderPath: string, passphrase: string, force?: boolean): Promise<SyncRunResult>
    /** Chạy đồng bộ: mọi kênh (mặc định) hoặc đúng một kênh. */
    now(force?: boolean, channelId?: string): Promise<SyncRunResult>
    /** Tắt một kênh (channelId) hoặc tắt hết (không truyền). */
    disable(channelId?: string): Promise<SyncStatusDto>
    /** Trạng thái kết nối Google Drive (đã đăng nhập chưa, tài khoản nào). */
    gdriveStatus(): Promise<GdriveStatusDto>
    /** Mở trình duyệt hệ thống đăng nhập Google (OAuth loopback + PKCE). */
    gdriveLogin(): Promise<GdriveLoginResult>
    /** Thu hồi token + quên tài khoản Google. */
    gdriveLogout(): Promise<GdriveStatusDto>
    /** Bật sync qua Google Drive (đã đăng nhập trước đó). Passphrase tối thiểu 12 ký tự. */
    configureGdrive(passphrase: string, force?: boolean): Promise<SyncRunResult>
    /** Bật kênh WebDAV (Nextcloud/Seafile/Nginx dav…). Passphrase tối thiểu 12 ký tự. */
    configureWebdav(input: WebdavConfigInput, force?: boolean): Promise<SyncRunResult>
    /** Bật kênh S3 (AWS/MinIO/R2/B2…). Passphrase tối thiểu 12 ký tự. */
    configureS3(input: S3ConfigInput, force?: boolean): Promise<SyncRunResult>
    /** Bật/tắt tự đồng bộ. 0 = tắt. */
    setAuto(minutes: number): Promise<SyncStatusDto>
    /** Ghi blob mã hoá ra file do user chọn (không cần đã bật sync). */
    exportFile(passphrase: string): Promise<SyncRunResult>
    /** Đọc blob từ file do user chọn rồi merge vào vault. */
    importFile(passphrase: string): Promise<SyncRunResult>
    /** Auto-sync vừa kéo về dữ liệu mới. Trả về hàm unsubscribe. */
    onPulled(cb: (pulled: number) => void): () => void
  }
  prompts: {
    onHostKey(cb: (q: HostKeyQuestion) => void): () => void
    onPassword(cb: (q: PasswordQuestion) => void): () => void
    answer(requestId: string, answer: unknown): void
  }
  versions: {
    electron: string
    node: string
    chrome: string
    /** 'win32' | 'darwin' | 'linux'… — màn hình Trợ giúp và text báo lỗi cần biết OS nào. */
    platform: string
    /** 'x64' | 'arm64'… */
    arch: string
    /** `os.release()` — vd '10.0.26200' trên Windows 11. */
    osRelease: string
  }
  help: {
    /** Mở thư mục dữ liệu app (vault, log, bản ghi…) bằng file explorer. */
    openUserData(): void
  }
  update: {
    /**
     * User tự bấm kiểm tra — trả về kết quả TƯỜNG MINH (kể cả "đã mới nhất" và lỗi), vì
     * electron-updater im lặng khi không có bản mới. Auto-check nền vẫn đi qua onAvailable.
     */
    check(): Promise<UpdateCheckResultDto>
    /** Bắt đầu tải bản cập nhật về nền. */
    download(): Promise<void>
    /** Thoát app và cài bản vừa tải (chỉ gọi sau khi onDownloaded đã bắn). */
    install(): void
    /** Bản mới có sẵn — version là string vd "1.2.3". */
    onAvailable(cb: (version: string) => void): () => void
    /** Tiến trình tải — percent từ 0 đến 100. */
    onProgress(cb: (percent: number) => void): () => void
    /** Tải xong, sẵn sàng cài. */
    onDownloaded(cb: (version: string) => void): () => void
  }
  plugins: {
    list(): Promise<PluginInfoDto[]>
    setEnabled(id: string, enabled: boolean): Promise<PluginInfoDto[]>
    reload(id: string): Promise<PluginInfoDto[]>
    /** Quét lại thư mục plugins (phát hiện plugin mới) — không cần khởi động lại. */
    rescan(): Promise<PluginInfoDto[]>
    /** Mở thư mục plugins (hoặc thư mục 1 plugin) bằng file explorer. */
    openFolder(id?: string): void
    /** Chạy 1 lệnh do plugin đóng góp; activeSessionId lấy từ tab đang mở; arg tuỳ ý (link cmd: trong panel). */
    invokeCommand(pluginId: string, commandId: string, activeSessionId: string | null, arg?: string): Promise<void>
    contributions(): Promise<ContributedCommandDto[]>
    onContributionsChanged(cb: (list: ContributedCommandDto[]) => void): () => void
    onPanel(cb: (p: PluginPanelDto) => void): () => void
    onNotify(cb: (n: PluginNotifyDto) => void): () => void
    /** Plugin hỏi user 1 chuỗi (ui.prompt) — trả lời qua prompts.answer(requestId, chuỗi | null). */
    onPrompt(cb: (q: PluginPromptDto) => void): () => void
  }
  marketplace: {
    /** Tải + validate registry công khai (cache trong main 5 phút). */
    list(): Promise<MarketplaceListDto>
    /** Tải file plugin theo registry, verify sha256 rồi cài vào thư mục plugins. */
    install(id: string): Promise<MarketplaceInstallResultDto>
  }
}
