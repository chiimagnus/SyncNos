import { t } from '@i18n';
import type { LocalDataMigrationStatus } from '@services/local-data/migration-status';
import { buttonClassName, cardClassName, primaryButtonClassName } from '@ui/settings/ui';
import { LocalDatabaseInstallHelp } from './LocalDatabaseInstallHelp';
import { LocalDatabaseMigrationDialog } from './LocalDatabaseMigrationDialog';

export type LocalDatabaseCardProps = Readonly<{
  actionBusy: boolean;
  copiedHelpText: string;
  dialogMode: 'start' | 'join' | null;
  error: string;
  loading: boolean;
  status: LocalDataMigrationStatus | null;
  onCancelMigration: () => void;
  onConfirmMigration: () => void;
  onCopyHelpText: (text: string) => void;
  onRequestMigration: () => void;
  onResumeMigration: () => void;
  onRetryStatus: () => void;
}>;

function statusTitle(status: LocalDataMigrationStatus): string {
  switch (status.profileState) {
    case 'setup_required':
      return t('localDatabaseSetupRequiredTitle');
    case 'join_existing_required':
      return t('localDatabaseJoinRequiredTitle');
    case 'migration_in_progress':
      return t('localDatabaseMigrationInProgressTitle');
    case 'active':
      return t('localDatabaseActiveTitle');
    case 'blocked':
      return t('localDatabaseBlockedTitle');
    case 'unavailable':
      return status.capability.browser === 'safari'
        ? t('localDatabaseSafariUnsupportedTitle')
        : t('localDatabaseUnavailableTitle');
  }
}

function statusBody(status: LocalDataMigrationStatus): string {
  switch (status.profileState) {
    case 'setup_required':
      return t('localDatabaseSetupRequiredBody');
    case 'join_existing_required':
      return t('localDatabaseJoinRequiredBody');
    case 'migration_in_progress':
      return status.actions.canResume ? t('localDatabaseResumeBody') : t('localDatabaseMigrationInProgressBody');
    case 'active':
      return t('localDatabaseActiveBody');
    case 'blocked':
      return t('localDatabaseBlockedBody');
    case 'unavailable':
      return status.capability.browser === 'safari'
        ? t('localDatabaseSafariUnsupportedBody')
        : t('localDatabaseUnavailableBody');
  }
}

export function LocalDatabaseCard(props: LocalDatabaseCardProps) {
  const {
    actionBusy,
    copiedHelpText,
    dialogMode,
    error,
    loading,
    status,
    onCancelMigration,
    onConfirmMigration,
    onCopyHelpText,
    onRequestMigration,
    onResumeMigration,
    onRetryStatus,
  } = props;
  const disabled = actionBusy || loading;
  const primaryAction = status?.actions.canStart
    ? status.profileState === 'join_existing_required'
      ? t('localDatabaseJoinAction')
      : t('localDatabaseEnableAction')
    : status?.actions.canResume
      ? t('localDatabaseResumeAction')
      : null;
  const shouldShowRecheck =
    !status ||
    status.profileState !== 'active' ||
    !!error ||
    status.host.registration !== 'available' ||
    status.host.compatibility !== 'compatible' ||
    status.database.presence !== 'present' ||
    status.database.factsHealth !== 'healthy' ||
    status.diagnostics.length > 0;

  return (
    <>
      <section
        className={cardClassName}
        aria-label={t('localDatabaseCardTitle')}
        data-local-database-state={status?.profileState ?? 'loading'}
      >
        <div className="tw-flex tw-items-start tw-justify-between tw-gap-3">
          <div className="tw-min-w-0">
            <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
              {t('localDatabaseCardTitle')}
            </h2>
            <div className="tw-mt-1 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
              {t('localDatabaseCardSubtitle')}
            </div>
          </div>
          {loading ? (
            <span role="status" aria-live="polite" className="tw-text-xs tw-font-bold tw-text-[var(--text-secondary)]">
              {t('localDatabaseChecking')}
            </span>
          ) : null}
        </div>

        {status ? (
          <div className="tw-mt-3 tw-rounded-[var(--radius-control)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-p-3">
            <div className="tw-text-sm tw-font-black tw-text-[var(--text-primary)]">{statusTitle(status)}</div>
            <div className="tw-mt-1.5 tw-text-sm tw-leading-6 tw-text-[var(--text-secondary)]">
              {statusBody(status)}
            </div>
            {status.profileState === 'active' ? (
              <div className="tw-mt-2 tw-text-xs tw-font-semibold tw-leading-5 tw-text-[var(--text-secondary)]">
                {t('localDatabaseFixedLocationBody')}
              </div>
            ) : null}
            {status.profileState === 'migration_in_progress' ? (
              <div className="tw-mt-2 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">
                {t('localDatabaseMigrationStage')} {status.journal.stage ?? t('statusUnknown')}
              </div>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div role="alert" className="tw-mt-3 tw-text-xs tw-font-bold tw-text-[var(--error)]">
            {error}
          </div>
        ) : null}
        {status ? (
          <LocalDatabaseInstallHelp status={status} copiedText={copiedHelpText} onCopyText={onCopyHelpText} />
        ) : null}

        {status?.diagnostics?.length ? (
          <div className="tw-mt-2 tw-space-y-1" aria-label={t('localDatabaseDiagnostics')}>
            {status.diagnostics.map((diagnostic, index) => (
              <div key={`${diagnostic.code}-${index}`} className="tw-text-xs tw-text-[var(--text-secondary)]">
                {diagnostic.message}
              </div>
            ))}
          </div>
        ) : null}

        <div className="tw-mt-3 tw-flex tw-flex-wrap tw-items-center tw-gap-2">
          {primaryAction ? (
            <button
              type="button"
              className={primaryButtonClassName}
              disabled={disabled}
              onClick={status?.actions.canResume ? onResumeMigration : onRequestMigration}
            >
              {actionBusy ? t('localDatabaseMigrationWorking') : primaryAction}
            </button>
          ) : null}
          {shouldShowRecheck ? (
            <button type="button" className={buttonClassName} disabled={disabled} onClick={onRetryStatus}>
              {t('localDatabaseRecheckAction')}
            </button>
          ) : null}
        </div>
      </section>

      {dialogMode ? (
        <LocalDatabaseMigrationDialog
          busy={actionBusy}
          mode={dialogMode}
          onCancel={onCancelMigration}
          onConfirm={onConfirmMigration}
        />
      ) : null}
    </>
  );
}
