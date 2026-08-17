import { t } from '@i18n';
import { buttonFilledClassName } from '@ui/shared/button-styles';

export function ConversationSearchDisabledPrompt({ onOpenSettings }: Readonly<{ onOpenSettings: () => void }>) {
  return (
    <div className="tw-flex tw-h-full tw-items-center tw-justify-center tw-p-6">
      <div className="tw-w-full tw-max-w-xl tw-rounded-[var(--radius-card)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-primary)] tw-p-6 tw-text-center">
        <h2 className="tw-text-lg tw-font-extrabold tw-text-[var(--text-primary)]">{t('localSearchDisabledTitle')}</h2>
        <p className="tw-mx-auto tw-mt-2 tw-max-w-lg tw-text-sm tw-leading-6 tw-text-[var(--text-secondary)]">
          {t('localSearchDisabledBody')}
        </p>
        <button type="button" className={[buttonFilledClassName(), 'tw-mt-5'].join(' ')} onClick={onOpenSettings}>
          {t('localSearchOpenLocalDatabaseSettings')}
        </button>
      </div>
    </div>
  );
}
