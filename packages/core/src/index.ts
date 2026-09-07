export { detectShells, defaultCwd } from './pty/shellDetector'
export { SessionManager } from './connection/SessionManager'
export type { SshSessionOptions } from './connection/SshSession'
export type { HostKeyInfo, HostKeyVerifier, TerminalSession } from './connection/types'
export { establishChain, agentPath, friendlySshError } from './connection/establish'
export type { ChainEndpoint, EstablishedChain } from './connection/establish'
export { TunnelService } from './connection/TunnelService'
export type { TunnelConnectionConfig } from './connection/TunnelService'
export { startForward } from './connection/forward'
export type { ForwardHandle } from './connection/forward'
export { SftpService } from './sftp/SftpService'
export { deriveSftpExecFromLoginSteps, deriveExecFromLoginSteps, deriveStreamExecFromLoginSteps } from './connection/loginScript'
export type { LoginStepLike } from './connection/loginScript'
export { listSerialPorts } from './connection/SerialSession'
export { BulkService } from './bulk/BulkService'
export type { BulkTarget, BulkResult } from './bulk/BulkService'
export { execOnce } from './connection/execOnce'
export { LineBuffer, execStream } from './connection/execStream'
export type { ExecStreamOptions, StreamHandle } from './connection/execStream'
export type { ExecOnceOptions, ExecOnceResult } from './connection/execOnce'
export { ping, dnsLookup, checkPort, scanCommonPorts, fetchImageAsDataUrl, normalizeImageUrl } from './nettools/netTools'
export type { PingResult, DnsResult, PortScanEntry } from './nettools/netTools'
export {
  assertSafeHostPattern,
  assertSafeIpLiteral,
  buildChromiumArgs,
  buildCurlResolveCommand,
  buildHostResolverRules,
  defaultUrlFor,
  isSafeHostPattern,
  isSafeHttpUrl,
  isSafeIpLiteral
} from './hostmap/hostMap'
export type { ChromiumArgsInput, HostMapGroup, HostMapTarget } from './hostmap/hostMap'
export { CHROMIUM_BROWSERS, detectChromiumBrowsers } from './hostmap/browsers'
export type { BrowserCandidate, BrowserEnv, DetectedBrowser } from './hostmap/browsers'
// F57 — Chọn font terminal từ danh sách font có trên máy + font user tự thêm.
export {
  ADDABLE_FONT_EXT,
  SCANNABLE_FONT_EXT,
  SFNT_HEADER_BYTES,
  SFNT_TABLE_ENTRY_BYTES,
  detectFontContainer,
  isAddableFontBytes,
  isScannableFontFile,
  parseFamilyFromNameTable,
  parseTableDirectory,
  sfntNumTables,
  ttcFontOffsets,
  ttcNumFonts
} from './fonts/sfnt'
export type { FontContainer, SfntTable } from './fonts/sfnt'
export {
  FONT_SCAN_MAX_DEPTH,
  FONT_SCAN_MAX_FILES,
  buildFontStack,
  primaryFontFamily,
  quoteFontFamily,
  systemFontDirs
} from './fonts/fontDirs'
export type { FontDirEnv } from './fonts/fontDirs'
export { MonitorService } from './monitor/MonitorService'
export type { MetricSample, MonitorTarget } from './monitor/MonitorService'
export { AlertEngine } from './monitor/AlertEngine'
export type { AlertRules, AlertThresholds, AlertEvent, AlertMetric } from './monitor/AlertEngine'
export { buildWebhookRequest, buildWebhookRequestFor, formatAlertText } from './monitor/webhook'
export type { AlertInfo, WebhookRequest } from './monitor/webhook'
export { HysteresisStates, binaryZone, feedHysteresis, newHysteresisState, numericZone } from './monitor/hysteresis'
export type { HysteresisOptions, HysteresisOutcome, HysteresisState, HysteresisZone } from './monitor/hysteresis'
export { MetricsStore } from './monitor/MetricsStore'
export type { MetricHistoryPoint, MetricHistoryHost } from './monitor/MetricsStore'
// Trung tâm thông báo + đánh dấu sự kiện: kho SQLite chung cho mọi hệ theo dõi trong main.
export { EVENT_RETENTION_MS, EventStore, MARKER_RETENTION_MS } from './events/EventStore'
// Theo dõi URL (synthetic HTTP monitoring): quyết định thuần + prober + kho kết quả.
export {
  BODY_SNIPPET_BYTES,
  CERT_WARN_DAYS,
  DEFAULT_EXPECT_STATUS,
  HTTP_CHECK_LIMITS,
  certDaysLeft,
  consecutiveFails,
  evaluateProbe,
  isValidCheckUrl,
  isValidStatusSpec,
  labelFromUrl,
  parseStatusSpec,
  sanitizeHttpCheck,
  summarizeResults
} from './httpcheck/httpCheck'
export type { ProbeResult } from './httpcheck/httpCheck'
export { describeNetError, probeUrl } from './httpcheck/probe'
export { HTTP_RESULT_RETENTION_MS, HttpCheckStore } from './httpcheck/HttpCheckStore'
// Kiểm kê fleet (CMDB nhẹ): lệnh thu facts + parser + kho lịch sử (lọc/so lệch ở @infra/shared vì renderer dùng).
export { FACTS_COMMAND, factsToCsv, parseFacts, splitSections } from './inventory/facts'
export { InventoryStore, KEEP_PER_HOST } from './inventory/InventoryStore'
// F55 — Theo dõi bất đồng bộ master ↔ slave (MySQL/MariaDB).
export {
  READ_ONLY_SQL,
  VARS_SQL,
  computeDrift,
  mergeReadOnly,
  masterStatusSqlFor,
  normalizeMasterStatus,
  normalizeReplicaStatus,
  normalizeVars,
  parseBinlogName,
  parseServerVersion,
  parseVerticalG,
  replicaStatusSqlFor,
  variableRowsToMap
} from './replication/status'
export type {
  MasterStatus,
  ReplDrift,
  ReplFilters,
  ReplSample,
  ReplVars,
  ReplicaStatus,
  ServerVersion,
  StatusSql,
  ThreadState
} from './replication/status'
export { diagnose, extractTableFromError, formatBytes, formatDuration } from './replication/diagnose'
export type { Cmd, Danger, Diagnosis, DiagnoseOptions, Severity } from './replication/diagnose'
export {
  buildRemoteMysqlCommand,
  cleanMysqlStderr,
  isUnsupportedSyntaxError,
  makeCliProbe,
  openDriverProbe,
  queryFirstSupported,
  randomCnfPath,
  shq
} from './replication/probe'
export type { CliProbeDeps, DriverProbeOptions, RemoteMysqlOptions, ReplProbe } from './replication/probe'
export {
  DEFAULT_POLL_INTERVAL_MS,
  MAX_POLL_INTERVAL_MS,
  MIN_POLL_INTERVAL_MS,
  NO_MASTER,
  VARS_REFRESH_MS,
  ReplicationService,
  clampPollInterval,
  detectVersion,
  errorSample,
  openEndpointProbe,
  readMasterSnapshot,
  readSample
} from './replication/ReplicationService'
export type {
  MasterSnapshot,
  ProbeSession,
  ReplEndpointTarget,
  ReplPairTarget,
  ReplReplicaTarget,
  ReplicationServiceDeps
} from './replication/ReplicationService'
export { DEFAULT_REPL_THRESHOLDS, ReplAlertEngine, errorDetail, errorNo, threadsBad, threadsDetail } from './replication/ReplAlertEngine'
export type {
  ReplAlertEngineOptions,
  ReplAlertEvent,
  ReplAlertMetric,
  ReplAlertRules,
  ReplAlertThresholds
} from './replication/ReplAlertEngine'
export { buildReplWebhookRequest, formatReplAlertText } from './replication/replWebhook'
export type { ReplAlertInfo } from './replication/replWebhook'
export {
  COLUMNS_SQL,
  INDEXES_SQL,
  TABLE_INVENTORY_SQL,
  buildChecksumSql,
  buildCountSql,
  diffInventory,
  diffSchemaEntries,
  diffVariables,
  isFilteredOut,
  matchesWildPattern,
  normalizeColumns,
  normalizeIndexes,
  normalizeTableRows,
  readChecksumRow,
  readCountRow
} from './replication/compare'
export type {
  DiffInventoryOptions,
  SchemaDiff,
  SchemaDiffStatus,
  SchemaEntry,
  TableDiff,
  TableDiffStatus,
  TableInfo,
  VarDiff
} from './replication/compare'
export { RUN_ENTRY_CAP, buildChecksumRun, buildScanRun, isChecksumMismatch, runHasFindings } from './replication/history'
export type { ReplRunBuild, ReplRunCounts, ReplRunPayload } from './replication/history'
export { AiService } from './ai/AiService'
export type { AiProvider, AiRuntimeConfig, AiAskRequest, AiAskResult, AiMode } from './ai/AiService'
export { isReadOnlyCommand } from './ai/readonlyGuard'
export type { ReadOnlyVerdict } from './ai/readonlyGuard'
export { resolveSecret, detectSecretProvider } from './secrets/SecretsService'
export type { SecretProvider } from './secrets/SecretsService'
export { generateTotp, isValidTotpSecret, normalizeTotpSecret, applyTotpToken, TOTP_TOKEN } from './secrets/totp'
export { importSshConfig, parseSshConfig } from './importers/sshConfig'
// Nhập từ client SSH khác (PuTTY .reg / MobaXterm / WinSCP.ini / Termius CSV): parser thuần + ghi vault.
export {
  decodeTextFile,
  detectClientFormat,
  importClientHosts,
  parseClientFile,
  parseCsv,
  parseMobaXterm,
  parsePuttyReg,
  parseTermiusCsv,
  parseWinScpIni
} from './importers/clientImport'
// F05 — Cloud import (DigitalOcean): parse + ghi vault là hàm thuần, phần fetch nằm ở main.
export { DO_DEFAULT_GROUP_NAME, importDroplets, parseDropletsPage } from './importers/digitalOcean'
export type { DropletImportVault } from './importers/digitalOcean'
// P30 — xuất hosts ra định dạng đọc được. Bản xuất KHÔNG chứa bí mật (xem đầu file).
export { renderExport, resolveForExport, sshAlias, toCsv, toJson, toSshConfig } from './exporters/hostExport'
export type { ExportFormat, ExportHost } from './exporters/hostExport'
export { LEGACY_SYNC_CHANNEL_ID, VaultService } from './vault/VaultService'
export type {
  KnownHostEntry,
  KnownHostRecord,
  ReplCreds,
  ReplCredentialsResolved,
  ReplRunSaveInput,
  ResolvedConnection,
  ResolvedEndpoint,
  SyncChannel,
  SyncConfig,
  SyncSnapshot
} from './vault/VaultService'
export { deriveSyncKey, newSyncSalt } from './vault/crypto'
export { SyncService, createBackend, BLOB_NAME, findNearMissBlobs, isEmptySnapshot } from './sync/SyncService'
export type { SyncBackend, SyncResult, BlobError } from './sync/SyncService'
// Google Drive sync — phần thuần của OAuth desktop (loopback+PKCE) và Drive API v3
export {
  GOOGLE_TOKEN_URL,
  GOOGLE_REVOKE_URL,
  GOOGLE_DRIVE_SCOPES,
  buildGoogleAuthUrl,
  emailFromIdToken,
  newOAuthState,
  newPkce,
  parseLoopbackCallback,
  parseTokenResponse
} from './sync/googleOAuth'
export type { GoogleTokens, LoopbackCallback, TokenParse } from './sync/googleOAuth'
export {
  DRIVE_FILES_URL,
  DRIVE_UPLOAD_URL,
  buildDriveListByNameUrl,
  buildDriveListContainsUrl,
  buildMultipartUpload,
  driveEscapeQuery,
  parseDriveFileList
} from './sync/driveApi'
export type { DriveFileRef, DriveListParse } from './sync/driveApi'
// WebDAV + S3 sync backends — SigV4 thuần (dùng chung với EC2) + parse phản hồi
export { awsUriEncode, sha256Hex, signAwsRequest } from './sync/awsSig'
export type { AwsSignInput, AwsSignedRequest } from './sync/awsSig'
export {
  normalizeS3Prefix,
  parseS3ListKeys,
  s3KeyBasename,
  s3ListUrl,
  s3ObjectUrl
} from './sync/s3Api'
export type { S3Target } from './sync/s3Api'
export { PROPFIND_BODY, parsePropfindNames, webdavJoin } from './sync/webdavApi'
// F05 — cloud import AWS/GCP/Azure: parser thuần, phần mạng ở main
export { buildDescribeInstancesBody, ec2Host, parseDescribeInstances } from './importers/awsEc2'
export {
  GCP_TOKEN_URL,
  buildGcpJwt,
  buildGcpTokenBody,
  gcpAggregatedInstancesUrl,
  parseGcpAggregated,
  parseGcpServiceAccount
} from './importers/gcpCompute'
export type { GcpServiceAccount } from './importers/gcpCompute'
export {
  azureNicListUrl,
  azurePublicIpListUrl,
  azureTokenUrl,
  azureVmListUrl,
  buildAzureTokenBody,
  joinAzureInstances
} from './importers/azureVms'
export { validateManifest, parseManifest } from './plugins/manifest'
export type { PluginManifest, PluginCommandManifest, ManifestResult } from './plugins/manifest'
export { discoverPlugins } from './plugins/discover'
export type { DiscoveredPlugin, InvalidPlugin, DiscoverResult } from './plugins/discover'
export { pluginScopedPath } from './plugins/paths'
export { validateRegistry, parseRegistry, semverGt } from './plugins/registry'
// Trợ giúp / About: cắt mục CHANGELOG của version đang chạy (dùng lúc build, xem file để biết vì sao)
export { extractChangelogSection } from './help/changelog'
export type { RegistryFile, RegistryPluginEntry, RegistryResult } from './plugins/registry'
export {
  pluginSigningPayload,
  signPluginEntry,
  verifyPluginEntry,
  OFFICIAL_REGISTRY_PUBLIC_KEY_PEM
} from './plugins/signing'
export { PluginHost } from './plugins/PluginHost'
export type {
  PluginHostAdapters,
  PluginWorkerLike,
  PluginInfo,
  PluginStatus,
  ContributedCommand,
  PluginPanelPayload,
  PluginNotifyPayload
} from './plugins/PluginHost'
export type {
  HostToWorker,
  WorkerToHost,
  ApiMethod,
  CommandCtx,
  WorkerContributions,
  PluginPromptOptions
} from './plugins/protocol'
// Local dev stack (Laragon/LocalWP-style) — chạy trên máy local, không SSH.
export {
  localDevPaths,
  scopedPath,
  runtimeScopedPath,
  runtimeDir,
  siteDir,
  isSafeToDeleteRecursive
} from './localdev/paths'
export type {
  LocalDevPaths,
  RuntimeKind,
  ServiceSpec,
  ServiceState,
  ServiceStatus,
  StrayProcess
} from './localdev/types'
export {
  RUNTIME_SOURCES,
  cliShimSources,
  newestPhpRuntime,
  pickPhpForWebApp,
  resolveCatalog,
  runtimeSigningPayload,
  signRuntimeEntry,
  validateRuntimeManifest,
  verifyRuntimeEntry,
  webAppSources
} from './localdev/runtimeCatalog'
export type {
  RuntimeArchive,
  RuntimeCliShim,
  RuntimeManifest,
  RuntimeManifestEntry,
  RuntimeManifestResult,
  RuntimeSource,
  RuntimeWebApp
} from './localdev/runtimeCatalog'
export { nextDelayMs, pruneHistory, shouldGiveUp } from './localdev/backoff'
export { allocatePort, isReserved, pickPort, probePort } from './localdev/ports'
export type { PortBlockedReason, PortProbeResult, PortRange } from './localdev/ports'
export { LogRing, rotatePlan, shouldRotate, splitLines } from './localdev/logLines'
export { assertSafeDomain, assertSafePort, iniPath, isSafeDomain, isSafePort, nginxPath, toFwd } from './localdev/templates/escape'
export { renderNginxConf, renderSiteConf, upstreamName } from './localdev/templates/nginxConf'
export type { NginxConfModel, NginxSiteModel, NginxUpstream } from './localdev/templates/nginxConf'
export { DEFAULT_PHP_EXTENSIONS, renderPhpIni } from './localdev/templates/phpIni'
export type { PhpIniModel } from './localdev/templates/phpIni'
export { MARIADB_BIN_CANDIDATES, renderClientCnf, renderMyIni } from './localdev/templates/myIni'
export type { MyIniModel } from './localdev/templates/myIni'
export { renderPmaConfig } from './localdev/templates/pmaConfig'
export type { PmaConfigModel } from './localdev/templates/pmaConfig'
export { renderCmdShim } from './localdev/templates/cmdShim'
export type { CmdShimModel } from './localdev/templates/cmdShim'
export { LocalDevStore } from './localdev/LocalDevStore'
export {
  MARIADB_PORT_PURPOSE,
  WEB_PORT_PURPOSE,
  phpPortPurpose,
  sitePortPurpose
} from './localdev/portPurpose'
export type { SiteInsert, SiteRow, SiteUpdate } from './localdev/types'
export {
  ADMINER_DOMAIN,
  MARIADB_SERVICE_ID,
  PMA_DOMAIN,
  ManagedStackProvider,
  buildInstallDbArgs,
  parseCnfPassword
} from './localdev/ManagedStackProvider'
export {
  WP_DB_CONSTANTS,
  applyWpDbConfig,
  detectEol,
  looksLikeWpConfig,
  phpSingleQuoted,
  readDefine,
  readWpDbConfig,
  replaceDefine,
  wpDbHost
} from './localdev/wpConfig'
export type { ApplyWpDbResult, WpDbConfig, WpDbConstant } from './localdev/wpConfig'
export type { ManagedStackDeps, MariadbTarget, StackPortStore, StackSettings } from './localdev/ManagedStackProvider'
export type { StackCapabilities, StackProvider } from './localdev/StackProvider'
export { DbService } from './localdev/DbService'
export type { DbCredentials, DbReadyResult, DbServiceDeps } from './localdev/DbService'
export {
  IDENT_RE,
  assertIdent,
  buildCreateDbSql,
  buildDropDbSql,
  deriveDbNames,
  genDbPassword,
  pingDb,
  runSql,
  sqlQuote
} from './localdev/mysqlCli'
export type { MysqlCliDeps, SqlResult } from './localdev/mysqlCli'
export {
  deriveDomain,
  detectSiteKind,
  detectSiteKindDetailed,
  isSafeSiteDomain,
  resolvesWithoutHostsFile,
  siteUrl,
  slugify,
  uniqueDomain,
  uniqueSlug
} from './localdev/siteScaffold'
export type { SiteKind, SiteKindGuess, SiteTld } from './localdev/siteScaffold'
export { PhpCgiPool } from './localdev/php/PhpCgiPool'
export type { PhpBackend, PhpPoolInput } from './localdev/php/PhpBackend'
export { PROVENANCE_FILE, RuntimeManager } from './localdev/RuntimeManager'
export type {
  DownloadStream,
  InstalledRuntime,
  RuntimeManagerDeps,
  RuntimeProgress,
  RuntimeProvenance
} from './localdev/RuntimeManager'
export { ProcessSupervisor } from './localdev/ProcessSupervisor'
export type { SpawnFn, SpawnOptions, SpawnedProcess, SupervisorDeps } from './localdev/ProcessSupervisor'
export type { PlatformAdapter } from './localdev/platform/PlatformAdapter'
export { WindowsAdapter, parseExcludedPortRanges, parseStrayJson } from './localdev/platform/WindowsAdapter'
export { PosixAdapter, createPlatformAdapter } from './localdev/platform/PosixAdapter'
// F43 — đẩy public key lên authorized_keys (phần quyết định; phần chạy lệnh ở main).
export {
  AUTHKEYS_OK_MARKER,
  appendAuthorizedKeyCommand,
  authKeysWriteSucceeded,
  authorizedKeysHas,
  planCopyId,
  publicKeyIdentity,
  readAuthorizedKeysCommand,
  removeKeyFromAuthorized,
  writeAuthorizedKeysCommand
} from './keys/authorizedKeys'
export type { CopyIdOutcome } from './keys/authorizedKeys'
// F36 / F37 — chẩn đoán đọc-thuần trên host: đĩa đầy ở đâu, máy nào cần vá gì.
export { dfCommand, duCommand, formatKb, parentPath, parseDf, parseDu } from './diag/diskUsage'
export type { DiskEntry, DiskUsage, Filesystem } from './diag/diskUsage'
export {
  detectManagerCommand,
  parseManager,
  parseUpdates,
  securityCount,
  updatesCommand
} from './diag/packageUpdates'
export type { HostUpdates, PackageManager, PackageUpdate } from './diag/packageUpdates'
// F35 — đọc/sửa crontab. Phần GHI là ghi vào production: nơi gọi phải xác nhận trước.
export {
  CRON_OK_MARKER,
  buildCrontab,
  describeSchedule,
  isScopeWritable,
  parseCrontab,
  readCrontabCommand,
  scopeHasUserColumn,
  sudoDenied,
  writeCrontabCommand,
  writeSucceeded
} from './diag/crontab'
export type { CronLine, CronLineKind, CronScope, ScheduleDescription } from './diag/crontab'
// F37 — đọc nhãn bảo mật từ `updateinfo` (họ RHEL không dò được qua tên repo).
// Phần TÓM TẮT (`groupOf`/`summarizeUpdates`/`summarizeFleet`) nằm ở `@infra/shared` vì
// renderer là nơi vẽ nó, mà renderer không import được `@infra/core` (CLAUDE.md §5).
export { applySecurityNames, parseSecurityNames, securityListCommand } from './diag/packageUpdates'
