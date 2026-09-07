import { useEffect } from 'react'
import { useEventsStore } from '../stores/events'
import { useGdriveStore } from '../stores/gdrive'
import { useTabsStore } from '../stores/tabs'
import { useUiStore } from '../stores/ui'
import { useVaultStore } from '../stores/vault'
import { useT } from '../i18n'
import type { I18nKey } from '../i18n/dict'

const STATUS_KEY: Record<string, I18nKey> = {
  connecting: 'status.connecting',
  reconnecting: 'status.reconnecting',
  connected: 'status.connected',
  exited: 'status.exited'
}

export function StatusBar() {
  const t = useT()
  const { tabs, activeId } = useTabsStore()
  const lock = useVaultStore((s) => s.lock)
  const setModal = useUiStore((s) => s.setModal)
  const gdrive = useGdriveStore((s) => s.status)
  const unread = useEventsStore((s) => s.unread)
  const tab = tabs.find((t) => t.id === activeId)
  const { electron, node } = window.infra.versions
  const appVersion = __APP_VERSION__

  useEffect(() => {
    // Nạp một lần lúc mount; về sau login/logout trong SyncModal tự cập nhật store này
    void useGdriveStore.getState().refresh()
  }, [])

  let info = t('status.noSession')
  if (tab?.kind === 'sftp') {
    info = tab.sftpTitle ?? 'SFTP'
  } else if (tab) {
    const pane = tab.panes.find((p) => p.id === tab.activePaneId) ?? tab.panes[0]
    if (pane) {
      const statusText = STATUS_KEY[pane.status] ? t(STATUS_KEY[pane.status]!) : pane.status
      info = `${pane.subtitle ?? pane.title} — ${statusText}${pane.statusDetail ? ` (${pane.statusDetail})` : ''}`
      if (tab.broadcast && tab.panes.length > 1) info += ` · ${t('status.broadcast', { n: tab.panes.length })}`
    }
  }

  return (
    <div className="border-edge bg-panel text-subtle flex h-6 shrink-0 items-center justify-between border-t px-3 text-[11px] select-none">
      <span className="truncate">{info}</span>
      <span className="flex items-center gap-3">
        {/* Chuông trung tâm thông báo đứng ĐẦU cụm phải (trước tài khoản Google) — số chưa đọc tô
            warning để liếc là thấy có gì đêm qua; email dài không được đẩy nó đi chỗ khác */}
        <button
          className={`hover:text-content ${unread > 0 ? 'text-warning' : ''}`}
          title={t('events.title')}
          aria-label={t('events.title')}
          onClick={() => setModal('notifications')}
        >
          🔔{unread > 0 ? ` ${unread > 99 ? '99+' : unread}` : ''}
        </button>
        {/* Tài khoản Google đang kết nối (sync qua Drive) — bấm là vào thẳng hộp Sync.
            Email cắt bớt để hàng trạng thái không bị một địa chỉ dài chiếm hết chỗ. */}
        {gdrive?.connected && (
          <button
            className="hover:text-content max-w-64 truncate"
            title={t('status.gdrive', { email: gdrive.email ?? 'Google' })}
            onClick={() => setModal('sync')}
          >
            ☁️ {gdrive.email ?? 'Google'}
          </button>
        )}
        <button className="hover:text-content" title={t('status.lockVault')} onClick={() => void lock()}>
          🔒 {t('status.lockVault')}
        </button>
        {/* Dòng version là nơi người ta bấm theo phản xạ khi muốn biết "bản nào / có bản mới chưa" */}
        <button className="hover:text-content" title={t('help.title')} onClick={() => setModal('help')}>
          Infra Companion {appVersion} · Electron {electron} · Node {node}
        </button>
      </span>
    </div>
  )
}
