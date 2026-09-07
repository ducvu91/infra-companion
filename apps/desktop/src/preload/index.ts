import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { release } from 'node:os'
import {
  IPC,
  type AppEventDto,
  type HttpCheckResultDto,
  type HttpCheckSummaryDto,
  type InventoryProgressDto,
  type BulkRunEvent,
  type GroupInput,
  type HostInput,
  type HostKeyQuestion,
  type InfraApi,
  type KeyImportInput,
  type LogTailEvent,
  type ContributedCommandDto,
  type LdRuntimeProgressDto,
  type LdServiceDto,
  type LdSiteEventDto,
  type LdSiteInputDto,
  type MetricSampleDto,
  type MonitorAlertDto,
  type ReplAlertDto,
  type ReplSnapshotDto,
  type PasswordQuestion,
  type PluginNotifyDto,
  type PluginPanelDto,
  type PluginPromptDto,
  type SnippetInput,
  type TerminalCreateRequest,
  type TerminalDataEvent,
  type TerminalExitEvent,
  type TerminalStatusEvent,
  type TransferEvent,
  type TunnelRuleInput,
  type TunnelStateDto,
  type WatcherStatusDto
} from '@infra/shared'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.off(channel, listener)
  }
}

const api: InfraApi = {
  vault: {
    status: () => ipcRenderer.invoke(IPC.VAULT_STATUS),
    setup: (masterPassword, remember) => ipcRenderer.invoke(IPC.VAULT_SETUP, masterPassword, remember),
    unlock: (masterPassword, remember) => ipcRenderer.invoke(IPC.VAULT_UNLOCK, masterPassword, remember),
    lock: () => ipcRenderer.invoke(IPC.VAULT_LOCK),
    onLocked: (cb) => subscribe<void>(IPC.VAULT_LOCKED_EVENT, cb)
  },
  data: {
    listShells: () => ipcRenderer.invoke(IPC.SHELLS_LIST),
    listGroups: () => ipcRenderer.invoke(IPC.GROUPS_LIST),
    saveGroup: (group: GroupInput) => ipcRenderer.invoke(IPC.GROUPS_SAVE, group),
    deleteGroup: (id) => ipcRenderer.invoke(IPC.GROUPS_DELETE, id),
    listHosts: () => ipcRenderer.invoke(IPC.HOSTS_LIST),
    saveHost: (input: HostInput) => ipcRenderer.invoke(IPC.HOSTS_SAVE, input),
    deleteHost: (id) => ipcRenderer.invoke(IPC.HOSTS_DELETE, id),
    listKeys: () => ipcRenderer.invoke(IPC.KEYS_LIST),
    generateKey: (label) => ipcRenderer.invoke(IPC.KEYS_GENERATE, label),
    importKey: (input: KeyImportInput) => ipcRenderer.invoke(IPC.KEYS_IMPORT, input),
    deleteKey: (id) => ipcRenderer.invoke(IPC.KEYS_DELETE, id),
    listHistory: (limit) => ipcRenderer.invoke(IPC.HISTORY_LIST, limit),
    listSnippets: () => ipcRenderer.invoke(IPC.SNIPPETS_LIST),
    saveSnippet: (input: SnippetInput) => ipcRenderer.invoke(IPC.SNIPPETS_SAVE, input),
    deleteSnippet: (id) => ipcRenderer.invoke(IPC.SNIPPETS_DELETE, id)
  },
  tunnels: {
    list: () => ipcRenderer.invoke(IPC.TUNNELS_LIST),
    save: (input: TunnelRuleInput) => ipcRenderer.invoke(IPC.TUNNELS_SAVE, input),
    delete: (id) => ipcRenderer.invoke(IPC.TUNNELS_DELETE, id),
    start: (id) => ipcRenderer.invoke(IPC.TUNNELS_START, id),
    stop: (id) => ipcRenderer.invoke(IPC.TUNNELS_STOP, id),
    states: () => ipcRenderer.invoke(IPC.TUNNELS_STATES),
    onState: (cb) => subscribe<TunnelStateDto>(IPC.TUNNELS_EVENT, cb),
    openDetached: () => ipcRenderer.invoke(IPC.TUNNELS_OPEN_DETACHED),
    closeDetached: () => ipcRenderer.send(IPC.TUNNELS_CLOSE_DETACHED),
    onDetachedState: (cb) => subscribe<boolean>(IPC.TUNNELS_DETACHED_STATE, cb),
    autoStart: () => ipcRenderer.invoke(IPC.TUNNELS_AUTOSTART)
  },
  app: {
    setTrayPrefs: (prefs) => ipcRenderer.send(IPC.APP_TRAY_PREFS, prefs)
  },
  events: {
    list: (query) => ipcRenderer.invoke(IPC.EVENTS_LIST, query),
    unread: () => ipcRenderer.invoke(IPC.EVENTS_UNREAD),
    ack: (id) => ipcRenderer.invoke(IPC.EVENTS_ACK, id),
    ackAll: () => ipcRenderer.invoke(IPC.EVENTS_ACK_ALL),
    remove: (id) => ipcRenderer.invoke(IPC.EVENTS_DELETE, id),
    addMarker: (input) => ipcRenderer.invoke(IPC.EVENTS_ADD_MARKER, input),
    timeline: (hostId, fromTs, toTs) => ipcRenderer.invoke(IPC.EVENTS_TIMELINE, hostId, fromTs, toTs),
    onNew: (cb) => subscribe<AppEventDto>(IPC.EVENTS_NEW, cb),
    onChanged: (cb) => subscribe<number>(IPC.EVENTS_CHANGED, cb)
  },
  httpChecks: {
    list: () => ipcRenderer.invoke(IPC.HTTP_CHECKS_LIST),
    save: (input) => ipcRenderer.invoke(IPC.HTTP_CHECKS_SAVE, input),
    remove: (id) => ipcRenderer.invoke(IPC.HTTP_CHECKS_DELETE, id),
    runNow: (id) => ipcRenderer.invoke(IPC.HTTP_CHECKS_RUN_NOW, id),
    results: (id, sinceTs) => ipcRenderer.invoke(IPC.HTTP_CHECKS_RESULTS, id, sinceTs),
    summaries: () => ipcRenderer.invoke(IPC.HTTP_CHECKS_SUMMARIES),
    onResult: (cb) => subscribe<HttpCheckResultDto>(IPC.HTTP_CHECKS_RESULT_EVENT, cb),
    onSummary: (cb) => subscribe<HttpCheckSummaryDto>(IPC.HTTP_CHECKS_SUMMARY_EVENT, cb)
  },
  inventory: {
    list: () => ipcRenderer.invoke(IPC.INVENTORY_LIST),
    collect: (hostIds) => ipcRenderer.invoke(IPC.INVENTORY_COLLECT, hostIds),
    exportCsv: () => ipcRenderer.invoke(IPC.INVENTORY_EXPORT_CSV),
    remove: (hostId) => ipcRenderer.invoke(IPC.INVENTORY_DELETE, hostId),
    onProgress: (cb) => subscribe<InventoryProgressDto>(IPC.INVENTORY_PROGRESS, cb)
  },
  runbooks: {
    listCustom: () => ipcRenderer.invoke(IPC.RUNBOOKS_LIST_CUSTOM),
    saveCustom: (runbook) => ipcRenderer.invoke(IPC.RUNBOOKS_SAVE_CUSTOM, runbook),
    deleteCustom: (id) => ipcRenderer.invoke(IPC.RUNBOOKS_DELETE_CUSTOM, id)
  },
  terminal: {
    create: (req: TerminalCreateRequest) => ipcRenderer.invoke(IPC.TERM_CREATE, req),
    write: (sessionId, data) => ipcRenderer.send(IPC.TERM_WRITE, sessionId, data),
    resize: (sessionId, cols, rows) => ipcRenderer.send(IPC.TERM_RESIZE, sessionId, cols, rows),
    kill: (sessionId) => ipcRenderer.send(IPC.TERM_KILL, sessionId),
    onData: (cb) => subscribe<TerminalDataEvent>(IPC.TERM_DATA, cb),
    onExit: (cb) => subscribe<TerminalExitEvent>(IPC.TERM_EXIT, cb),
    onStatus: (cb) => subscribe<TerminalStatusEvent>(IPC.TERM_STATUS, cb),
    toggleLog: (sessionId, title) => ipcRenderer.invoke(IPC.TERM_LOG_TOGGLE, sessionId, title),
    openLogFolder: () => ipcRenderer.send(IPC.TERM_LOG_OPEN_FOLDER),
    toggleRecord: (sessionId, title) => ipcRenderer.invoke(IPC.TERM_RECORD_TOGGLE, sessionId, title),
    setActive: (sessionId) => ipcRenderer.send(IPC.TERM_SET_ACTIVE, sessionId)
  },
  recordings: {
    list: () => ipcRenderer.invoke(IPC.REC_LIST),
    read: (name) => ipcRenderer.invoke(IPC.REC_READ, name),
    openFolder: () => ipcRenderer.send(IPC.REC_OPEN_FOLDER),
    delete: (name) => ipcRenderer.invoke(IPC.REC_DELETE, name)
  },
  serial: {
    listPorts: () => ipcRenderer.invoke(IPC.SERIAL_LIST)
  },
  sftp: {
    open: (hostId) => ipcRenderer.invoke(IPC.SFTP_OPEN, hostId),
    close: (sessionId) => ipcRenderer.send(IPC.SFTP_CLOSE, sessionId),
    list: (sessionId, path) => ipcRenderer.invoke(IPC.SFTP_LIST, sessionId, path),
    mkdir: (sessionId, path) => ipcRenderer.invoke(IPC.SFTP_MKDIR, sessionId, path),
    rename: (sessionId, from, to) => ipcRenderer.invoke(IPC.SFTP_RENAME, sessionId, from, to),
    delete: (sessionId, path, isDir) => ipcRenderer.invoke(IPC.SFTP_DELETE, sessionId, path, isDir),
    chmod: (sessionId, path, mode) => ipcRenderer.invoke(IPC.SFTP_CHMOD, sessionId, path, mode),
    download: (sessionId, remotePath, localDir) =>
      ipcRenderer.invoke(IPC.SFTP_DOWNLOAD, sessionId, remotePath, localDir),
    upload: (sessionId, localPath, remoteDir) =>
      ipcRenderer.invoke(IPC.SFTP_UPLOAD, sessionId, localPath, remoteDir),
    edit: (sessionId, remotePath) => ipcRenderer.invoke(IPC.SFTP_EDIT, sessionId, remotePath),
    onTransfer: (cb) => subscribe<TransferEvent>(IPC.TRANSFER_EVENT, cb)
  },
  vnc: {
    open: (hostId) => ipcRenderer.invoke(IPC.VNC_OPEN, hostId),
    close: (sessionId) => ipcRenderer.send(IPC.VNC_CLOSE, sessionId)
  },
  rdp: {
    open: (hostId) => ipcRenderer.invoke(IPC.RDP_OPEN, hostId),
    close: (sessionId) => ipcRenderer.send(IPC.RDP_CLOSE, sessionId),
    list: () => ipcRenderer.invoke(IPC.RDP_LIST),
    onChange: (cb) => subscribe<void>(IPC.RDP_EVENT, cb)
  },
  fs: {
    roots: () => ipcRenderer.invoke(IPC.FS_ROOTS),
    home: () => ipcRenderer.invoke(IPC.FS_HOME),
    list: (path) => ipcRenderer.invoke(IPC.FS_LIST, path),
    mkdir: (path) => ipcRenderer.invoke(IPC.FS_MKDIR, path),
    rename: (from, to) => ipcRenderer.invoke(IPC.FS_RENAME, from, to),
    delete: (path) => ipcRenderer.invoke(IPC.FS_DELETE, path)
  },
  importer: {
    sshConfig: () => ipcRenderer.invoke(IPC.IMPORT_SSH_CONFIG),
    clientPick: () => ipcRenderer.invoke(IPC.IMPORT_CLIENT_PICK),
    clientPuttyRegistry: () => ipcRenderer.invoke(IPC.IMPORT_CLIENT_PUTTY_REGISTRY),
    clientCommit: (drafts, source) => ipcRenderer.invoke(IPC.IMPORT_CLIENT_COMMIT, drafts, source),
    doConfig: () => ipcRenderer.invoke(IPC.IMPORT_DO_CONFIG),
    doSaveAccount: (input) => ipcRenderer.invoke(IPC.IMPORT_DO_SAVE_ACCOUNT, input),
    doDeleteAccount: (id) => ipcRenderer.invoke(IPC.IMPORT_DO_DELETE_ACCOUNT, id),
    doListDroplets: (request) => ipcRenderer.invoke(IPC.IMPORT_DO_LIST, request),
    doImport: (droplets, options) => ipcRenderer.invoke(IPC.IMPORT_DO_RUN, droplets, options),
    cloudAccounts: () => ipcRenderer.invoke(IPC.CLOUD_ACCOUNTS),
    cloudSaveAccount: (input) => ipcRenderer.invoke(IPC.CLOUD_SAVE_ACCOUNT, input),
    cloudDeleteAccount: (id) => ipcRenderer.invoke(IPC.CLOUD_DELETE_ACCOUNT, id),
    cloudListInstances: (accountId) => ipcRenderer.invoke(IPC.CLOUD_LIST_INSTANCES, accountId)
  },
  exporter: {
    hosts: (format) => ipcRenderer.invoke(IPC.EXPORT_HOSTS, format)
  },
  keys: {
    copyId: (request) => ipcRenderer.invoke(IPC.KEY_COPY_ID, request),
    rotate: (request) => ipcRenderer.invoke(IPC.KEY_ROTATE, request)
  },
  logTail: {
    start: (hostId, path) => ipcRenderer.invoke(IPC.LOG_TAIL_START, hostId, path),
    stop: (id) => ipcRenderer.invoke(IPC.LOG_TAIL_STOP, id),
    onEvent: (cb) => subscribe<LogTailEvent>(IPC.LOG_TAIL_EVENT, cb)
  },
  diag: {
    disk: (hostId, path) => ipcRenderer.invoke(IPC.DIAG_DISK, hostId, path),
    updates: (hostId) => ipcRenderer.invoke(IPC.DIAG_UPDATES, hostId),
    cronRead: (hostId, scope) => ipcRenderer.invoke(IPC.CRON_READ, hostId, scope),
    cronWrite: (hostId, content, scope) => ipcRenderer.invoke(IPC.CRON_WRITE, hostId, content, scope)
  },
  knownHosts: {
    list: () => ipcRenderer.invoke(IPC.KNOWN_HOSTS_LIST),
    forget: (id) => ipcRenderer.invoke(IPC.KNOWN_HOSTS_DELETE, id)
  },
  secrets: {
    reveal: (request) => ipcRenderer.invoke(IPC.SECRET_REVEAL, request),
    copy: (request) => ipcRenderer.invoke(IPC.SECRET_COPY, request)
  },
  bulk: {
    run: (runId, hostIds, command) => ipcRenderer.invoke(IPC.BULK_RUN, runId, hostIds, command),
    cancel: (runId) => ipcRenderer.invoke(IPC.BULK_CANCEL, runId),
    onEvent: (cb) => subscribe<BulkRunEvent>(IPC.BULK_EVENT, cb)
  },
  net: {
    ping: (host) => ipcRenderer.invoke(IPC.NET_PING, host),
    dns: (host) => ipcRenderer.invoke(IPC.NET_DNS, host),
    portCheck: (host, port) => ipcRenderer.invoke(IPC.NET_PORT, host, port),
    scan: (host) => ipcRenderer.invoke(IPC.NET_SCAN, host),
    fetchImage: (url) => ipcRenderer.invoke(IPC.NET_FETCH_IMAGE, url)
  },
  monitor: {
    start: (hosts) => ipcRenderer.invoke(IPC.MONITOR_START, hosts),
    stop: (hostId) => ipcRenderer.send(IPC.MONITOR_STOP, hostId),
    stopAll: () => ipcRenderer.send(IPC.MONITOR_STOP_ALL),
    subscribe: () => ipcRenderer.send(IPC.MONITOR_SUBSCRIBE),
    onStopped: (cb) => subscribe<void>(IPC.MONITOR_STOPPED, cb),
    openDetached: (hosts) => ipcRenderer.invoke(IPC.MONITOR_OPEN_DETACHED, hosts),
    closeDetached: () => ipcRenderer.send(IPC.MONITOR_CLOSE_DETACHED),
    detachedInit: () => ipcRenderer.invoke(IPC.MONITOR_DETACHED_INIT),
    onDetachedState: (cb) => subscribe<boolean>(IPC.MONITOR_DETACHED_STATE, cb),
    onSample: (cb) => subscribe<MetricSampleDto>(IPC.MONITOR_SAMPLE, cb),
    onAlert: (cb) => subscribe<MonitorAlertDto>(IPC.MONITOR_ALERT, cb),
    getSettings: () => ipcRenderer.invoke(IPC.MONITOR_GET_SETTINGS),
    setSettings: (s) => ipcRenderer.invoke(IPC.MONITOR_SET_SETTINGS, s),
    testWebhook: (url) => ipcRenderer.invoke(IPC.MONITOR_TEST_WEBHOOK, url),
    queryHistory: (hostId, fromTs, toTs, res) => ipcRenderer.invoke(IPC.METRICS_QUERY, hostId, fromTs, toTs, res),
    historyHosts: () => ipcRenderer.invoke(IPC.METRICS_HOSTS)
  },
  watcher: {
    start: (targets) => ipcRenderer.send(IPC.WATCHER_START, targets),
    stop: () => ipcRenderer.send(IPC.WATCHER_STOP),
    onStatus: (cb) => subscribe<WatcherStatusDto[]>(IPC.WATCHER_STATUS, cb)
  },
  hostTools: {
    listProcesses: (hostId, sortBy) => ipcRenderer.invoke(IPC.HTOOLS_PROCS, hostId, sortBy),
    killProcess: (hostId, pid, signal) => ipcRenderer.invoke(IPC.HTOOLS_KILL, hostId, pid, signal),
    listServices: (hostId) => ipcRenderer.invoke(IPC.HTOOLS_SERVICES, hostId),
    serviceAction: (hostId, unit, action) => ipcRenderer.invoke(IPC.HTOOLS_SERVICE_ACTION, hostId, unit, action),
    serviceLogs: (hostId, unit) => ipcRenderer.invoke(IPC.HTOOLS_SERVICE_LOGS, hostId, unit),
    readFile: (hostId, path) => ipcRenderer.invoke(IPC.HTOOLS_READ_FILE, hostId, path)
  },
  replication: {
    listPairs: () => ipcRenderer.invoke(IPC.REPL_LIST_PAIRS),
    savePair: (input) => ipcRenderer.invoke(IPC.REPL_SAVE_PAIR, input),
    deletePair: (id) => ipcRenderer.invoke(IPC.REPL_DELETE_PAIR, id),
    testPair: (id, replicaId) => ipcRenderer.invoke(IPC.REPL_TEST_PAIR, id, replicaId),
    watch: (pairId) => ipcRenderer.invoke(IPC.REPL_WATCH, pairId),
    unwatch: (pairId) => ipcRenderer.send(IPC.REPL_UNWATCH, pairId),
    pollNow: (pairId) => ipcRenderer.invoke(IPC.REPL_POLL_NOW, pairId),
    subscribe: () => ipcRenderer.send(IPC.REPL_SUBSCRIBE),
    onSample: (cb) => subscribe<ReplSnapshotDto>(IPC.REPL_SAMPLE, cb),
    onAlert: (cb) => subscribe<ReplAlertDto>(IPC.REPL_ALERT, cb),
    getSettings: () => ipcRenderer.invoke(IPC.REPL_GET_SETTINGS),
    setSettings: (s) => ipcRenderer.invoke(IPC.REPL_SET_SETTINGS, s),
    compare: (pairId, replicaId) => ipcRenderer.invoke(IPC.REPL_COMPARE, pairId, replicaId),
    checksum: (pairId, tables, mode, replicaId) =>
      ipcRenderer.invoke(IPC.REPL_CHECKSUM, pairId, tables, mode, replicaId),
    historyList: (pairId) => ipcRenderer.invoke(IPC.REPL_HISTORY_LIST, pairId),
    historyGet: (id) => ipcRenderer.invoke(IPC.REPL_HISTORY_GET, id),
    historyDelete: (id) => ipcRenderer.invoke(IPC.REPL_HISTORY_DELETE, id),
    historyClear: (pairId) => ipcRenderer.invoke(IPC.REPL_HISTORY_CLEAR, pairId)
  },
  localdev: {
    enabled: () => ipcRenderer.invoke(IPC.LOCALDEV_ENABLED),
    health: () => ipcRenderer.invoke(IPC.LOCALDEV_HEALTH),
    openFolder: (what, siteId) => ipcRenderer.invoke(IPC.LOCALDEV_OPEN_FOLDER, what, siteId),

    runtimeCatalog: () => ipcRenderer.invoke(IPC.LOCALDEV_RUNTIME_CATALOG),
    runtimeInstall: (id, fromFile) => ipcRenderer.invoke(IPC.LOCALDEV_RUNTIME_INSTALL, id, fromFile),
    runtimeCancel: (id) => ipcRenderer.send(IPC.LOCALDEV_RUNTIME_CANCEL, id),
    runtimeRemove: (id) => ipcRenderer.invoke(IPC.LOCALDEV_RUNTIME_REMOVE, id),
    onRuntimeProgress: (cb) => subscribe<LdRuntimeProgressDto>(IPC.LOCALDEV_RUNTIME_PROGRESS, cb),

    services: () => ipcRenderer.invoke(IPC.LOCALDEV_SERVICES),
    serviceAction: (id, action) => ipcRenderer.invoke(IPC.LOCALDEV_SERVICE_ACTION, id, action),
    stopAll: () => ipcRenderer.invoke(IPC.LOCALDEV_STOP_ALL),
    onServiceEvent: (cb) => subscribe<LdServiceDto>(IPC.LOCALDEV_SERVICE_EVENT, cb),

    sites: () => ipcRenderer.invoke(IPC.LOCALDEV_SITES),
    siteSave: (input: LdSiteInputDto) => ipcRenderer.invoke(IPC.LOCALDEV_SITE_SAVE, input),
    siteDelete: (id, removeFiles) => ipcRenderer.invoke(IPC.LOCALDEV_SITE_DELETE, id, removeFiles),
    siteOpen: (id) => ipcRenderer.send(IPC.LOCALDEV_SITE_OPEN, id),
    sitePickFolder: () => ipcRenderer.invoke(IPC.LOCALDEV_SITE_PICK_FOLDER),
    siteShellEnv: (id) => ipcRenderer.invoke(IPC.LOCALDEV_SITE_SHELL_ENV, id),
    onSiteEvent: (cb) => subscribe<LdSiteEventDto>(IPC.LOCALDEV_SITE_EVENT, cb),

    dbStatus: () => ipcRenderer.invoke(IPC.LOCALDEV_DB_STATUS),
    dbProvision: (siteId) => ipcRenderer.invoke(IPC.LOCALDEV_DB_PROVISION, siteId),
    dbDump: (siteId) => ipcRenderer.invoke(IPC.LOCALDEV_DB_DUMP, siteId),
    dbImport: (siteId) => ipcRenderer.invoke(IPC.LOCALDEV_DB_IMPORT, siteId),
    dbList: () => ipcRenderer.invoke(IPC.LOCALDEV_DB_LIST),
    dbAdminer: (siteId) => ipcRenderer.invoke(IPC.LOCALDEV_DB_ADMINER, siteId),
    dbPhpMyAdmin: (siteId) => ipcRenderer.invoke(IPC.LOCALDEV_DB_PMA, siteId),
    siteOpenNoPort: (siteId) => ipcRenderer.invoke(IPC.LOCALDEV_SITE_OPEN_NOPORT, siteId),
    siteDetect: (rootPath) => ipcRenderer.invoke(IPC.LOCALDEV_SITE_DETECT, rootPath),
    siteWpConfigRead: (siteId) => ipcRenderer.invoke(IPC.LOCALDEV_SITE_WP_CONFIG_READ, siteId),
    siteWpConfigWrite: (siteId) => ipcRenderer.invoke(IPC.LOCALDEV_SITE_WP_CONFIG, siteId),

    logTail: (siteId, which) => ipcRenderer.invoke(IPC.LOCALDEV_LOG_TAIL, siteId, which),
    settingsGet: () => ipcRenderer.invoke(IPC.LOCALDEV_SETTINGS_GET),
    settingsSet: (s) => ipcRenderer.invoke(IPC.LOCALDEV_SETTINGS_SET, s)
  },
  hostmap: {
    state: () => ipcRenderer.invoke(IPC.HOSTMAP_STATE),
    saveGroup: (input) => ipcRenderer.invoke(IPC.HOSTMAP_SAVE_GROUP, input),
    deleteGroup: (id) => ipcRenderer.invoke(IPC.HOSTMAP_DELETE_GROUP, id),
    setActive: (groupId, targetId) => ipcRenderer.invoke(IPC.HOSTMAP_SET_ACTIVE, groupId, targetId),
    open: (groupId, opts) => ipcRenderer.invoke(IPC.HOSTMAP_OPEN, groupId, opts),
    openAll: (groupId, browserId) => ipcRenderer.invoke(IPC.HOSTMAP_OPEN_ALL, groupId, browserId),
    curlCommand: (groupId, targetId) => ipcRenderer.invoke(IPC.HOSTMAP_CURL, groupId, targetId),
    clearProfiles: (groupId) => ipcRenderer.invoke(IPC.HOSTMAP_CLEAR_PROFILES, groupId)
  },
  fonts: {
    list: () => ipcRenderer.invoke(IPC.FONTS_LIST),
    rescan: () => ipcRenderer.invoke(IPC.FONTS_RESCAN),
    add: (name, bytes) => ipcRenderer.invoke(IPC.FONTS_ADD, { name, bytes }),
    rename: (id, family) => ipcRenderer.invoke(IPC.FONTS_RENAME, id, family),
    remove: (id) => ipcRenderer.invoke(IPC.FONTS_REMOVE, id)
  },
  ai: {
    getConfig: () => ipcRenderer.invoke(IPC.AI_GET_CONFIG),
    setConfig: (input) => ipcRenderer.invoke(IPC.AI_SET_CONFIG, input),
    ask: (mode, input, context) => ipcRenderer.invoke(IPC.AI_ASK, mode, input, context),
    diagnoseExec: (hostId, command) => ipcRenderer.invoke(IPC.AI_DIAGNOSE_EXEC, hostId, command),
    saveDiagnosis: (input) => ipcRenderer.invoke(IPC.AI_DIAGNOSE_SAVE, input),
    listDiagnoses: (limit) => ipcRenderer.invoke(IPC.AI_DIAGNOSE_LIST, limit),
    getDiagnosis: (id) => ipcRenderer.invoke(IPC.AI_DIAGNOSE_GET, id),
    deleteDiagnosis: (id) => ipcRenderer.invoke(IPC.AI_DIAGNOSE_DELETE, id)
  },
  sync: {
    status: () => ipcRenderer.invoke(IPC.SYNC_STATUS),
    pickFolder: () => ipcRenderer.invoke(IPC.SYNC_PICK_FOLDER),
    configure: (folderPath, passphrase, force) => ipcRenderer.invoke(IPC.SYNC_CONFIGURE, folderPath, passphrase, force === true),
    now: (force, channelId) => ipcRenderer.invoke(IPC.SYNC_NOW, force === true, channelId),
    disable: (channelId) => ipcRenderer.invoke(IPC.SYNC_DISABLE, channelId),
    gdriveStatus: () => ipcRenderer.invoke(IPC.SYNC_GDRIVE_STATUS),
    gdriveLogin: () => ipcRenderer.invoke(IPC.SYNC_GDRIVE_LOGIN),
    gdriveLogout: () => ipcRenderer.invoke(IPC.SYNC_GDRIVE_LOGOUT),
    configureGdrive: (passphrase, force) => ipcRenderer.invoke(IPC.SYNC_CONFIGURE_GDRIVE, passphrase, force === true),
    configureWebdav: (input, force) => ipcRenderer.invoke(IPC.SYNC_CONFIGURE_WEBDAV, input, force === true),
    configureS3: (input, force) => ipcRenderer.invoke(IPC.SYNC_CONFIGURE_S3, input, force === true),
    setAuto: (minutes) => ipcRenderer.invoke(IPC.SYNC_SET_AUTO, minutes),
    exportFile: (passphrase) => ipcRenderer.invoke(IPC.SYNC_EXPORT_FILE, passphrase),
    importFile: (passphrase) => ipcRenderer.invoke(IPC.SYNC_IMPORT_FILE, passphrase),
    onPulled: (cb) => subscribe<number>(IPC.SYNC_PULLED_EVENT, cb)
  },
  prompts: {
    onHostKey: (cb) => subscribe<HostKeyQuestion>(IPC.PROMPT_HOSTKEY, cb),
    onPassword: (cb) => subscribe<PasswordQuestion>(IPC.PROMPT_PASSWORD, cb),
    answer: (requestId, answer) => ipcRenderer.send(IPC.PROMPT_ANSWER, requestId, answer)
  },
  versions: {
    electron: process.versions.electron ?? '',
    node: process.versions.node ?? '',
    chrome: process.versions.chrome ?? '',
    platform: process.platform,
    arch: process.arch,
    osRelease: release()
  },
  help: {
    openUserData: () => ipcRenderer.send(IPC.HELP_OPEN_USER_DATA)
  },
  update: {
    check: () => ipcRenderer.invoke(IPC.UPDATE_CHECK),
    download: () => ipcRenderer.invoke(IPC.UPDATE_DOWNLOAD),
    install: () => ipcRenderer.send(IPC.UPDATE_INSTALL),
    onAvailable: (cb: (version: string) => void) => subscribe<string>(IPC.UPDATE_AVAILABLE, cb),
    onProgress: (cb: (percent: number) => void) => subscribe<number>(IPC.UPDATE_PROGRESS, cb),
    onDownloaded: (cb: (version: string) => void) => subscribe<string>(IPC.UPDATE_DOWNLOADED, cb)
  },
  plugins: {
    list: () => ipcRenderer.invoke(IPC.PLUGINS_LIST),
    setEnabled: (id, enabled) => ipcRenderer.invoke(IPC.PLUGINS_SET_ENABLED, id, enabled),
    reload: (id) => ipcRenderer.invoke(IPC.PLUGINS_RELOAD, id),
    rescan: () => ipcRenderer.invoke(IPC.PLUGINS_RESCAN),
    openFolder: (id) => ipcRenderer.send(IPC.PLUGINS_OPEN_FOLDER, id),
    invokeCommand: (pluginId, commandId, activeSessionId, arg) =>
      ipcRenderer.invoke(IPC.PLUGINS_INVOKE_COMMAND, pluginId, commandId, activeSessionId, arg),
    contributions: () => ipcRenderer.invoke(IPC.PLUGINS_CONTRIBUTIONS),
    onContributionsChanged: (cb) => subscribe<ContributedCommandDto[]>(IPC.PLUGINS_CONTRIBUTIONS_CHANGED, cb),
    onPanel: (cb) => subscribe<PluginPanelDto>(IPC.PLUGINS_PANEL_SHOW, cb),
    onNotify: (cb) => subscribe<PluginNotifyDto>(IPC.PLUGINS_NOTIFY, cb),
    onPrompt: (cb) => subscribe<PluginPromptDto>(IPC.PLUGINS_PROMPT, cb)
  },
  marketplace: {
    list: () => ipcRenderer.invoke(IPC.MARKETPLACE_LIST),
    install: (id) => ipcRenderer.invoke(IPC.MARKETPLACE_INSTALL, id)
  }
}

contextBridge.exposeInMainWorld('infra', api)
