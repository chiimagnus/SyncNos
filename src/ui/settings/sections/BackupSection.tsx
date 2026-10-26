import type { RefObject } from 'react';

import { t } from '@i18n';
import type { OrphanMessageGroup } from '@services/conversations/client/repo';
import { formatTime } from '@viewmodels/settings/utils';
import { buttonClassName, cardClassName, checkboxClassName } from '@ui/settings/ui';

function ImportStatsList(props: { stats: any }) {
  const stats = props.stats;
  if (!stats) return null;
  return (
    <ul className="tw-m-0 tw-pl-[18px]">
      <li>
        {t('statsConversations')} {t('statsAdded')} {stats.conversationsAdded} · {t('statsUpdated')}{' '}
        {stats.conversationsUpdated}
      </li>
      <li>
        {t('statsMessages')} {t('statsAdded')} {stats.messagesAdded} · {t('statsUpdated')} {stats.messagesUpdated} (
        {t('skipped')} {stats.messagesSkipped})
      </li>
      {'commentsAdded' in stats ? (
        <li>
          {t('statsComments')} {t('statsAdded')} {stats.commentsAdded} · {t('statsUpdated')} {stats.commentsUpdated} (
          {t('skipped')} {stats.commentsSkipped})
        </li>
      ) : null}
      <li>
        {t('statsMappings')} {t('statsAdded')} {stats.mappingsAdded} · {t('statsUpdated')} {stats.mappingsUpdated}
      </li>
      <li>
        {t('statsSettingsApplied')} {stats.settingsApplied}
      </li>
    </ul>
  );
}

export function BackupSection(props: {
  busy: boolean;
  exportStatus: string;
  importStatus: string;
  exportErrorDetail?: string;
  importErrorDetail?: string;
  orphanMessageGroups?: OrphanMessageGroup[];
  orphanLoadError?: string;
  onReviewOrphanConversation?: (conversationId: number) => void;
  importStats: any;
  lastBackupExportAt: number;
  includeSensitiveData: boolean;
  onChangeIncludeSensitiveData: (enabled: boolean) => void;
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
    exportErrorDetail,
    importErrorDetail,
    orphanMessageGroups = [],
    orphanLoadError,
    onReviewOrphanConversation,
    importStats,
    lastBackupExportAt,
    includeSensitiveData,
    onChangeIncludeSensitiveData,
    backupImportRef,
    fileInputRef,
    importLabel,
    onImportClick,
    onExport,
    onImportFile,
  } = props;

  return (
    <section className={cardClassName} aria-label={t('databaseBackup')}>
      <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">{t('databaseBackup')}</h2>

      <label className="tw-mt-2.5 tw-flex tw-items-center tw-gap-2 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">
        <input
          type="checkbox"
          checked={includeSensitiveData}
          disabled={busy}
          onChange={(event) => onChangeIncludeSensitiveData(event.target.checked)}
          aria-label={t('backupIncludeSensitiveData')}
          className={checkboxClassName}
        />
        {t('backupIncludeSensitiveData')}
      </label>
      <div className="tw-mt-1.5 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
        {t('backupIncludeSensitiveDataHint')}
      </div>

      <div
        ref={backupImportRef}
        id="settings-backup-import"
        className="tw-mt-3 tw-flex tw-flex-wrap tw-items-center tw-gap-2.5"
      >
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
          accept=".zip,application/zip"
          className="tw-hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportFile(file);
          }}
        />
      </div>
      {exportStatus ? (
        <div
          role={exportErrorDetail ? 'alert' : undefined}
          className={`tw-mt-2 tw-text-xs tw-font-semibold ${exportErrorDetail ? 'tw-text-[var(--error)]' : 'tw-text-[var(--text-secondary)]'}`}
        >
          {exportStatus}
          {exportErrorDetail ? (
            <div className="tw-mt-1 tw-break-words tw-font-normal">
              {t('backupTechnicalDetail')} {exportErrorDetail}
            </div>
          ) : null}
        </div>
      ) : null}
      {lastBackupExportAt ? (
        <div className="tw-mt-1.5 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
          {t('lastExport')} {formatTime(lastBackupExportAt)}
        </div>
      ) : null}
      {importStatus ? (
        <div
          role={importErrorDetail ? 'alert' : undefined}
          className={`tw-mt-1.5 tw-text-xs tw-font-semibold ${importErrorDetail ? 'tw-text-[var(--error)]' : 'tw-text-[var(--text-secondary)]'}`}
        >
          {importStatus}
          {importErrorDetail ? (
            <div className="tw-mt-1 tw-break-words tw-font-normal">
              {t('backupTechnicalDetail')} {importErrorDetail}
            </div>
          ) : null}
        </div>
      ) : null}
      {orphanMessageGroups.length || orphanLoadError ? (
        <div className="tw-mt-4 tw-border-t tw-border-[var(--border)] tw-pt-3">
          <h3 className="tw-m-0 tw-text-sm tw-font-bold tw-text-[var(--text-primary)]">{t('backupOrphanedHeading')}</h3>
          <p className="tw-mt-1 tw-text-xs tw-text-[var(--text-secondary)]">{t('backupOrphanedHint')}</p>
          {orphanLoadError ? (
            <p role="alert" className="tw-mt-1 tw-break-words tw-text-xs tw-text-[var(--error)]">
              {t('backupOrphanedLoadFailed')} {orphanLoadError}
            </p>
          ) : null}
          {orphanMessageGroups.map((group) => (
            <div key={group.conversationId} className="tw-mt-2 tw-flex tw-items-center tw-justify-between tw-gap-2">
              <span className="tw-text-xs tw-text-[var(--text-primary)]">
                #{group.originalConversationId} · {group.messageCount} {t('backupOrphanedCount')}
                {group.recovered ? ` · ${t('backupOrphanedRecovered')}` : ''}
              </span>
              <button
                type="button"
                className={buttonClassName}
                disabled={busy}
                onClick={() => onReviewOrphanConversation?.(group.conversationId)}
              >
                {t(group.recovered ? 'backupOrphanedView' : 'backupOrphanedReview')}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="tw-mt-2.5">
        <ImportStatsList stats={importStats} />
      </div>
    </section>
  );
}
