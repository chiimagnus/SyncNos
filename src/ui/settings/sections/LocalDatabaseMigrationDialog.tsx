import { useEffect, useRef } from 'react';

import { t } from '@i18n';
import { buttonClassName, primaryButtonClassName } from '@ui/settings/ui';

export type LocalDatabaseMigrationDialogProps = Readonly<{
  busy: boolean;
  mode: 'start' | 'join' | 'retry';
  onCancel: () => void;
  onConfirm: () => void;
}>;

export function LocalDatabaseMigrationDialog(props: LocalDatabaseMigrationDialogProps) {
  const { busy, mode, onCancel, onConfirm } = props;
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelButtonRef.current?.focus();
    return () => {
      previousFocusRef.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape' || busy) return;
      event.preventDefault();
      onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onCancel]);

  const title =
    mode === 'join'
      ? t('localDatabaseJoinDialogTitle')
      : mode === 'retry'
        ? t('localDatabaseRetryDialogTitle')
        : t('localDatabaseEnableDialogTitle');

  return (
    <div
      className="tw-fixed tw-inset-0 tw-z-[120] tw-flex tw-items-center tw-justify-center tw-bg-black/35 tw-p-4"
      onPointerDown={(event) => {
        if (busy || event.target !== event.currentTarget) return;
        onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-database-migration-title"
        aria-describedby="local-database-migration-description"
        className="tw-w-full tw-max-w-[520px] tw-rounded-[var(--radius-card)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-p-4 tw-text-[var(--text-primary)] tw-shadow-[var(--card-shadow)]"
      >
        <div className="tw-flex tw-items-start tw-justify-between tw-gap-3">
          <div className="tw-min-w-0">
            <h2 id="local-database-migration-title" className="tw-m-0 tw-text-base tw-font-black">
              {title}
            </h2>
            <p
              id="local-database-migration-description"
              className="tw-mb-0 tw-mt-2 tw-text-sm tw-leading-6 tw-text-[var(--text-secondary)]"
            >
              {mode === 'join'
                ? t('localDatabaseJoinDialogIntro')
                : mode === 'retry'
                  ? t('localDatabaseRetryDialogIntro')
                  : t('localDatabaseEnableDialogIntro')}
            </p>
          </div>
          <button
            type="button"
            className="tw-grid tw-size-8 tw-shrink-0 tw-place-items-center tw-rounded-full tw-border tw-border-[var(--border)] tw-bg-transparent tw-text-lg tw-font-bold tw-text-[var(--text-secondary)] hover:tw-bg-[var(--bg-sunken)] disabled:tw-opacity-40"
            aria-label={t('localDatabaseCloseDialog')}
            disabled={busy}
            onClick={onCancel}
          >
            ×
          </button>
        </div>

        <ul className="tw-mb-0 tw-mt-4 tw-space-y-2 tw-pl-5 tw-text-sm tw-leading-6 tw-text-[var(--text-primary)]">
          <li>{t('localDatabaseMigrationFactsNotice')}</li>
          <li>{t('localDatabaseMigrationCleanupNotice')}</li>
          <li>{t('localDatabaseMigrationNoRollbackNotice')}</li>
          <li>{t('localDatabaseMigrationSettingsNotice')}</li>
          {mode === 'join' ? <li>{t('localDatabaseJoinMergeNotice')}</li> : null}
        </ul>

        <div className="tw-mt-5 tw-flex tw-flex-wrap tw-justify-end tw-gap-2">
          <button ref={cancelButtonRef} type="button" className={buttonClassName} disabled={busy} onClick={onCancel}>
            {t('cancelButton')}
          </button>
          <button type="button" className={primaryButtonClassName} disabled={busy} onClick={onConfirm}>
            {busy
              ? t('localDatabaseMigrationWorking')
              : mode === 'join'
                ? t('localDatabaseConfirmJoin')
                : mode === 'retry'
                  ? t('localDatabaseRetryAction')
                  : t('localDatabaseConfirmEnable')}
          </button>
        </div>
      </div>
    </div>
  );
}
