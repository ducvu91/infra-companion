import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { EventStore } from '@infra/core'
import { IPC, type AppEventDto, type AppEventInput, type AppEventQuery, type MarkerInput } from '@infra/shared'

/**
 * Trung tâm thông báo + đánh dấu sự kiện — phần main.
 *
 * `recordEvent()` là lối ghi DUY NHẤT: monitoring (ipc/monitor.ts), replication, uptime watcher,
 * tunnel và theo dõi URL đều gọi nó, rồi nó bắn `EVENTS_NEW` tới mọi cửa sổ. Nhờ đó renderer chỉ
 * đăng ký một listener là biết mọi chuyện, và biểu đồ vẽ được cả alert lẫn marker của user từ
 * cùng một kho. Store mở lười (lần ghi/đọc đầu) và đóng lúc thoát.
 */

let store: EventStore | null = null

export function getEventStore(): EventStore {
  store ??= new EventStore(join(app.getPath('userData'), 'events.db'))
  return store
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/** Ghi một sự kiện + báo mọi cửa sổ. Không bao giờ ném: lỗi ghi sổ không được phép làm hỏng alert thật. */
export function recordEvent(input: AppEventInput): AppEventDto | null {
  try {
    const dto = getEventStore().add(input)
    broadcast(IPC.EVENTS_NEW, dto)
    return dto
  } catch (error) {
    console.error('[events] không ghi được sự kiện:', error instanceof Error ? error.message : error)
    return null
  }
}

function notifyChanged(): void {
  try {
    broadcast(IPC.EVENTS_CHANGED, getEventStore().unreadCount())
  } catch {
    /* store lỗi — renderer giữ số cũ */
  }
}

export function registerEventsIpc(): () => void {
  ipcMain.handle(IPC.EVENTS_LIST, (_e, query?: AppEventQuery) => getEventStore().list(query ?? {}))
  ipcMain.handle(IPC.EVENTS_UNREAD, () => getEventStore().unreadCount())
  ipcMain.handle(IPC.EVENTS_ACK, (_e, id: number) => {
    getEventStore().ack(Number(id))
    notifyChanged()
  })
  ipcMain.handle(IPC.EVENTS_ACK_ALL, () => {
    getEventStore().ackAll()
    notifyChanged()
  })
  ipcMain.handle(IPC.EVENTS_DELETE, (_e, id: number) => {
    getEventStore().remove(Number(id))
    notifyChanged()
  })
  ipcMain.handle(IPC.EVENTS_ADD_MARKER, (_e, input: MarkerInput) => {
    const title = String(input?.title ?? '').trim()
    if (!title) return null
    return recordEvent({
      kind: 'marker',
      source: 'user',
      severity: 'info',
      hostId: input.hostId ?? null,
      title: title.slice(0, 200),
      ts: typeof input.ts === 'number' && Number.isFinite(input.ts) ? input.ts : undefined
    })
  })
  ipcMain.handle(IPC.EVENTS_TIMELINE, (_e, hostId: string | null, fromTs: number, toTs: number) =>
    getEventStore().timeline(hostId ?? null, Number(fromTs), Number(toTs))
  )
  return () => {
    store?.close()
    store = null
  }
}
