import type { RefObject } from 'react';

import { t } from '../../../i18n';
import { formatTime } from '../utils';
import { buttonClassName, cardClassName } from '../ui';

function ImportStatsList(props: { stats: any }) {
  const stats = props.stats;
  if (!stats) return null;
  return (
    <ul className="tw-m-0 tw-pl-[18px]">
      <li>
        {t('statsConversations')} +{stats.conversationsAdded} / ~{stats.conversationsUpdated}
      </li>
      <li>
        {t('statsMessages')} +{stats.messagesAdded} / ~{stats.messagesUpdated} (skipped {stats.messagesSkipped})
      </li>
      <li>
        {t('statsMappings')} +{stats.mappingsAdded} / ~{stats.mappingsUpdated}
      </li>
      <li>{t('statsSettingsApplied')} {stats.settingsApplied}</li>
    </ul>
  );
}

export function BackupSection(props: {
  busy: boolean;
  exportStatus: string;
  importStatus: string;
  importStats: any;
  lastBackupExportAt: number;
  backupImportRef: RefObject<HTMLDivElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  importLabel?: string;
  onImportClick?: () => void;
  onExport: () => void;
  onImportFile: (file: File) => void;
}) {
  const {
    busy,
    exportStatus,
    importStatus,
    importStats,
    lastBackupExportAt,
    backupImportRef,
    fileInputRef,
    importLabel,
    onImportClick,
    onExport,
    onImportFile,
  } = props;

  return (
    <section className={cardClassName} aria-label="Database Backup">
      <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text)]">{t('databaseBackup')}</h2>

      <div ref={backupImportRef} id="settings-backup-import" className="tw-mt-2.5 tw-flex tw-flex-wrap tw-items-center tw-gap-2.5">
        <button className={buttonClassName} onClick={onExport} disabled={busy}>
          {t('exportZip')}
        </button>
        <button
          className={buttonClassName}
          disabled={busy}
          onClick={() => {
            if (busy) return;
            if (onImportClick) onImportClick();
            else fileInputRef.current?.click();
          }}
        >
          {importLabel || t('importDots')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,application/zip,application/json,.json"
          className="tw-hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportFile(file);
          }}
        />
      </div>
      <div className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--muted)] tw-opacity-90">{t('exportStatus')} {exportStatus}</div>
      <div className="tw-mt-1.5 tw-text-xs tw-font-semibold tw-text-[var(--muted)] tw-opacity-90">{t('lastExport')} {lastBackupExportAt ? formatTime(lastBackupExportAt) : '—'}</div>
      <div className="tw-mt-1.5 tw-text-xs tw-font-semibold tw-text-[var(--muted)] tw-opacity-90">{t('importStatus')} {importStatus}</div>
      <div className="tw-mt-2.5">
        <ImportStatsList stats={importStats} />
      </div>
    </section>
  );
}
