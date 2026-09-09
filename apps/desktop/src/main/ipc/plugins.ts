import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import { Worker } from 'node:worker_threads'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PluginHost,
  pluginScopedPath,
  type PluginHostAdapters,
  type PluginWorkerLike
} from '@infra/core'
import { IPC, type PluginInfoDto } from '@infra/shared'
import { touchActivity } from './vault'
import { askRenderer } from './prompts'
import type { TerminalBridge } from './terminal'

/**
 * Đăng ký IPC + dựng PluginHost (worker_thread chung) cho Plugin system (F16).
 * Trả về hàm dispose gọi khi quit. Worker chạy file out/main/plugin-worker.js (emit nhờ
 * input thứ 2 trong electron.vite.config.ts).
 */
export function registerPluginsIpc(
  getWin: () => BrowserWindow | null,
  terminal: TerminalBridge
): () => void {
  const pluginsDir = join(app.getPath('userData'), 'plugins')
  const statePath = join(pluginsDir, 'state.json')
  const workerPath = join(__dirname, 'plugin-worker.js')

  try {
    mkdirSync(pluginsDir, { recursive: true })
  } catch {
    /* không tạo được thư mục — discover sẽ trả rỗng, không chặn app */
  }

  const send = (channel: string, payload: unknown): void => {
    const win = getWin()
    if (win && !win.webContents.isDestroyed()) win.webContents.send(channel, payload)
  }

  // Thiếu file worker (build lỗi) → vẫn đăng ký handler trả rỗng để renderer không vỡ.
  if (!existsSync(workerPath)) {
    console.error('[plugins] missing', workerPath, '- plugin system disabled')
    ipcMain.handle(IPC.PLUGINS_LIST, (): PluginInfoDto[] => [])
    ipcMain.handle(IPC.PLUGINS_SET_ENABLED, (): PluginInfoDto[] => [])
    ipcMain.handle(IPC.PLUGINS_RELOAD, (): PluginInfoDto[] => [])
    ipcMain.handle(IPC.PLUGINS_RESCAN, (): PluginInfoDto[] => [])
    ipcMain.handle(IPC.PLUGINS_CONTRIBUTIONS, () => [])
    ipcMain.handle(IPC.PLUGINS_INVOKE_COMMAND, () => undefined)
    ipcMain.on(IPC.PLUGINS_OPEN_FOLDER, () => void shell.openPath(pluginsDir))
    return () => undefined
  }

  const readState = (): Record<string, { enabled: boolean }> => {
    try {
      return JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, { enabled: boolean }>
    } catch {
      return {}
    }
  }

  const adapters: PluginHostAdapters = {
    pluginsDir,
    createWorker: (): PluginWorkerLike => {
      const w = new Worker(workerPath, { stdout: true, stderr: true })
      w.stdout.on('data', (b: Buffer) => console.log('[plugin-worker]', b.toString().trimEnd()))
      w.stderr.on('data', (b: Buffer) => console.error('[plugin-worker]', b.toString().trimEnd()))
      return {
        postMessage: (msg) => w.postMessage(msg),
        onMessage: (cb) => w.on('message', cb),
        onExit: (cb) => w.on('exit', cb),
        onError: (cb) => w.on('error', cb),
        terminate: () => void w.terminate()
      }
    },
    readState,
    writeState: (state) => {
      try {
        writeFileSync(statePath, JSON.stringify(state, null, 2))
      } catch {
        /* ghi state lỗi — bỏ qua */
      }
    },
    terminalWrite: (sessionId, data) => terminal.write(sessionId, data),
    getActiveSessionId: () => terminal.getActiveSessionId(),
    storageGet: (pluginId, key) => {
      const file = pluginScopedPath(pluginsDir, pluginId, 'data.json')
      if (!file) throw new Error('pluginId không hợp lệ')
      try {
        const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
        return data[key]
      } catch {
        return undefined
      }
    },
    storageSet: (pluginId, key, value) => {
      const file = pluginScopedPath(pluginsDir, pluginId, 'data.json')
      if (!file) throw new Error('pluginId không hợp lệ')
      let data: Record<string, unknown> = {}
      try {
        data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      } catch {
        data = {}
      }
      data[key] = value
      writeFileSync(file, JSON.stringify(data, null, 2))
    },
    promptUser: (pluginId, opts) => {
      const win = getWin()
      if (!win || win.webContents.isDestroyed()) return Promise.resolve(null)
      return askRenderer<string | null>(win.webContents, IPC.PLUGINS_PROMPT, { pluginId, ...opts })
    }
  }

  const host = new PluginHost(adapters)
  host.on('contributions-changed', (list) => send(IPC.PLUGINS_CONTRIBUTIONS_CHANGED, list))
  host.on('panel', (p) => send(IPC.PLUGINS_PANEL_SHOW, p))
  host.on('notify', (n) => send(IPC.PLUGINS_NOTIFY, n))

  terminal.setOutputSink((sessionId, data) => host.onTerminalData(sessionId, data))
  host.init()

  ipcMain.handle(IPC.PLUGINS_LIST, (): PluginInfoDto[] => host.list())
  ipcMain.handle(IPC.PLUGINS_SET_ENABLED, (_e, id: string, enabled: boolean): PluginInfoDto[] => {
    touchActivity()
    return host.setEnabled(id, enabled)
  })
  ipcMain.handle(IPC.PLUGINS_RELOAD, (_e, id: string): PluginInfoDto[] => {
    touchActivity()
    return host.reload(id)
  })
  ipcMain.handle(IPC.PLUGINS_RESCAN, (): PluginInfoDto[] => {
    touchActivity()
    return host.rescan()
  })
  ipcMain.handle(IPC.PLUGINS_CONTRIBUTIONS, () => host.contributions())
  ipcMain.handle(
    IPC.PLUGINS_INVOKE_COMMAND,
    (_e, pluginId: string, commandId: string, activeSessionId: string | null, arg?: string) => {
      touchActivity()
      host.invokeCommand(pluginId, commandId, activeSessionId, arg)
    }
  )
  ipcMain.on(IPC.PLUGINS_OPEN_FOLDER, (_e, id?: string) => {
    if (id) {
      const dir = pluginScopedPath(pluginsDir, id, 'manifest.json')
      void shell.openPath(dir ? join(pluginsDir, id) : pluginsDir)
    } else {
      void shell.openPath(pluginsDir)
    }
  })

  return () => {
    terminal.setOutputSink(null)
    host.disposeAll()
  }
}
