import type { ReactNode } from 'react'
import { AiDiagnoseModal } from './AiDiagnoseModal'
import { HelpModal } from './HelpModal'
import { ProcessesModal } from './ProcessesModal'
import { ReplicationModal } from './ReplicationModal'
import { ServicesModal } from './ServicesModal'
import { TunnelsModal } from './TunnelsModal'
import { LogTailModal } from './LogTailModal'
import { CronModal } from './CronModal'
import { KeyRotateModal } from './KeyRotateModal'
import { DiskUsageModal } from './DiskUsageModal'
import { PackageUpdatesModal } from './PackageUpdatesModal'
import { KnownHostsModal } from './KnownHostsModal'
import { NotificationsModal } from './NotificationsModal'
import { HttpChecksModal } from './HttpChecksModal'
import { InventoryModal } from './InventoryModal'
import { RunbooksModal } from './RunbooksModal'
import { JobsModal } from './JobsModal'
import { SecurityAuditModal } from './SecurityAuditModal'
import { FolderSyncModal } from './FolderSyncModal'
import { useT } from '../i18n'
import type { I18nKey } from '../i18n/dict'
import type { ToolTabKind } from '../stores/tabs'

/**
 * Bọc một công cụ vào TAB (thay vì popup) — dùng lại ĐÚNG component của popup ở chế độ
 * `embedded` nên không có bản thứ hai phải bảo trì song song, và state giữ nguyên vì cả hai
 * đọc chung store.
 *
 * Ẩn bằng `hidden` khi tab không active (khuôn của các tab view khác) — KHÔNG unmount, để phiên
 * chẩn đoán AI đang chạy hoặc bộ lọc tiến trình không mất khi user nhảy sang tab khác.
 */
const TOOLS: Partial<Record<ToolTabKind, { icon: string; titleKey: I18nKey; render: () => ReactNode }>> = {
  tunnels: { icon: '🔀', titleKey: 'tunnel.title', render: () => <TunnelsModal embedded /> },
  processes: { icon: '📋', titleKey: 'procs.title', render: () => <ProcessesModal embedded /> },
  services: { icon: '⚙', titleKey: 'svc.title', render: () => <ServicesModal embedded /> },
  'ai-diagnose': { icon: '🩺', titleKey: 'ai.diagnose.title', render: () => <AiDiagnoseModal embedded /> },
  replication: { icon: '🔁', titleKey: 'repl.title', render: () => <ReplicationModal embedded /> },
  help: { icon: '❓', titleKey: 'help.title', render: () => <HelpModal embedded /> },
  'log-tail': { icon: '🪵', titleKey: 'tail.title', render: () => <LogTailModal embedded /> },
  cron: { icon: '⏰', titleKey: 'cron.title', render: () => <CronModal embedded /> },
  'key-rotate': { icon: '🔄', titleKey: 'rotate.title', render: () => <KeyRotateModal embedded /> },
  'disk-usage': { icon: '💾', titleKey: 'disk.title', render: () => <DiskUsageModal host={null} embedded /> },
  'pkg-updates': { icon: '📦', titleKey: 'pkg.title', render: () => <PackageUpdatesModal embedded /> },
  'known-hosts': { icon: '🔏', titleKey: 'knownHosts.title', render: () => <KnownHostsModal embedded /> },
  notifications: { icon: '🔔', titleKey: 'events.title', render: () => <NotificationsModal embedded /> },
  'http-checks': { icon: '🌐', titleKey: 'http.title', render: () => <HttpChecksModal embedded /> },
  inventory: { icon: '📇', titleKey: 'inv.title', render: () => <InventoryModal embedded /> },
  runbooks: { icon: '📖', titleKey: 'runbooks.title', render: () => <RunbooksModal embedded /> },
  jobs: { icon: '⏰', titleKey: 'jobs.title', render: () => <JobsModal embedded /> },
  security: { icon: '🛡️', titleKey: 'sec.title', render: () => <SecurityAuditModal embedded /> },
  'folder-sync': { icon: '🔄', titleKey: 'folderSync.title', render: () => <FolderSyncModal embedded /> }
}

export function ToolTabView({ kind, active }: { kind: ToolTabKind; active: boolean }) {
  const t = useT()
  const tool = TOOLS[kind]
  if (!tool) return null
  return (
    <div className={`bg-app absolute inset-0 flex flex-col ${active ? '' : 'hidden'}`}>
      <div className="border-edge bg-panel flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <span className="text-content text-sm font-medium">
          {tool.icon} {t(tool.titleKey)}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{tool.render()}</div>
    </div>
  )
}
