import type { RefObject } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { t } from '@i18n';
import type { OrphanMessageGroup } from '@services/conversations/client/repo';
import type { Conversation } from '@services/conversations/domain/models';
import {
  RECOVERED_CONVERSATION_SOURCE,
  recoveredConversationKey,
} from '@services/conversations/domain/orphaned-messages';
import { buildConversationRouteFromLoc, encodeConversationLoc } from '@services/shared/conversation-loc';
import { useConversationsApp } from '@viewmodels/conversations/conversations-context';
import { formatTime } from '@viewmodels/settings/utils';
import { useIsNarrowScreen } from '@ui/shared/hooks/useIsNarrowScreen';
import { openConversation as openConversationInApp } from '@ui/conversations/open-conversation';
import { setPendingOpenConversationId } from '@ui/conversations/pending-open';
import { buttonClassName, cardClassName, checkboxClassName, conversationJumpLinkClassName } from '@ui/settings/ui';

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
  onRecoverOrphanConversation?: (conversationId: number) => Promise<Conversation | null>;
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
    onRecoverOrphanConversation,
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
  const { openConversationInListScopeByLoc } = useConversationsApp();
  const isNarrow = useIsNarrowScreen();
  const navigate = useNavigate();

  const openRecoveredConversation = (conversation: Pick<Conversation, 'id' | 'source' | 'conversationKey'>) => {
    const { id, source, conversationKey } = conversation;
    const openedId = openConversationInApp(id, {
      isNarrow,
      setActiveId: () => {
        void openConversationInListScopeByLoc({ source, conversationKey });
      },
    });
    if (isNarrow && openedId) setPendingOpenConversationId(openedId, { source, conversationKey });
  };

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
          <div className="tw-mt-3 tw-grid tw-gap-2.5">
            {orphanMessageGroups.map((group) => {
              const title = `#${group.originalConversationId}`;
              const source = RECOVERED_CONVERSATION_SOURCE;
              const conversationKey = recoveredConversationKey(group.originalConversationId);
              const route = buildConversationRouteFromLoc(encodeConversationLoc({ source, conversationKey }));
              const label = (
                <span className="tw-min-w-0 tw-truncate tw-underline-offset-2 group-hover:tw-underline">{title}</span>
              );
              return (
                <div
                  key={group.conversationId}
                  className="tw-grid tw-grid-cols-[minmax(0,1fr)_auto] tw-items-start tw-gap-3"
                >
                  <div className="tw-min-w-0">
                    {group.recovered ? (
                      <Link
                        to={route}
                        replace
                        className={conversationJumpLinkClassName}
                        title={title}
                        aria-label={`${t('backupOrphanedView')} ${title}`}
                        onClick={(event) => {
                          if (event.defaultPrevented) return;
                          if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
                          openRecoveredConversation({ id: group.conversationId, source, conversationKey });
                        }}
                      >
                        {label}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className={conversationJumpLinkClassName}
                        disabled={busy}
                        title={title}
                        aria-label={`${t('backupOrphanedReview')} ${title}`}
                        onClick={() => {
                          void (async () => {
                            const recovered = await onRecoverOrphanConversation?.(group.conversationId);
                            if (!recovered) return;
                            openRecoveredConversation(recovered);
                            navigate(
                              buildConversationRouteFromLoc(
                                encodeConversationLoc({
                                  source: recovered.source,
                                  conversationKey: recovered.conversationKey,
                                }),
                              ),
                              { replace: true },
                            );
                          })();
                        }}
                      >
                        {label}
                      </button>
                    )}
                    <div className="tw-mt-0.5 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
                      {t(group.recovered ? 'backupOrphanedRecovered' : 'backupOrphanedPending')}
                    </div>
                  </div>
                  <div className="tw-text-sm tw-font-black tw-text-[var(--text-primary)]">
                    {group.messageCount} {t('backupOrphanedCount')}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="tw-mt-2.5">
        <ImportStatsList stats={importStats} />
      </div>
    </section>
  );
}
