import { t } from '@i18n';
import type { TranslationKey } from '@i18n/locales/en';
import { buttonClassName, cardClassName } from '@ui/settings/ui';
import type {
  KeyboardShortcutAction,
  KeyboardShortcutsControllerItem,
  KeyboardShortcutsControllerManagerAccess,
  KeyboardShortcutsControllerStatus,
} from '@viewmodels/settings/useKeyboardShortcutsController';

export type KeyboardShortcutsSectionProps = {
  status: KeyboardShortcutsControllerStatus;
  items: KeyboardShortcutsControllerItem[];
  managerAccess: KeyboardShortcutsControllerManagerAccess;
  onOpenManager: () => void;
};

const ACTION_ROWS: ReadonlyArray<{ action: KeyboardShortcutAction; labelKey: TranslationKey }> = [
  { action: 'open-popup', labelKey: 'keyboardShortcutsOpenPopup' },
  { action: 'capture-current-page', labelKey: 'keyboardShortcutsCaptureCurrentPage' },
  { action: 'open-app', labelKey: 'keyboardShortcutsOpenApp' },
];

export function KeyboardShortcutsSection(props: KeyboardShortcutsSectionProps) {
  const { status, items, managerAccess, onOpenManager } = props;
  const loading = status === 'idle' || status === 'loading';
  const unsupported = status === 'unsupported';
  const shortcutByAction = new Map(items.map((item) => [item.action, item.shortcut]));

  return (
    <section className={cardClassName} aria-label={t('keyboardShortcutsHeading')}>
      <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
        {t('keyboardShortcutsHeading')}
      </h2>
      <p className="tw-mb-0 tw-mt-1.5 tw-text-xs tw-font-semibold tw-leading-relaxed tw-text-[var(--text-secondary)] tw-opacity-90">
        {t('keyboardShortcutsDescription')}
      </p>

      <div className="tw-mt-3 tw-grid tw-divide-y tw-divide-[var(--border)]">
        {ACTION_ROWS.map(({ action, labelKey }) => {
          const shortcut = shortcutByAction.get(action) || '';
          return (
            <div
              key={action}
              className="tw-flex tw-min-w-0 tw-items-center tw-justify-between tw-gap-3 tw-py-2 first:tw-pt-0 last:tw-pb-0"
            >
              <span className="tw-min-w-0 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]">
                {t(labelKey)}
              </span>
              {loading ? (
                <span className="tw-shrink-0 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-70">
                  {t('loadingDots')}
                </span>
              ) : unsupported ? (
                <span
                  className="tw-shrink-0 tw-text-sm tw-font-semibold tw-text-[var(--text-secondary)]"
                  aria-hidden="true"
                >
                  —
                </span>
              ) : shortcut ? (
                <kbd className="tw-max-w-[55%] tw-shrink-0 tw-overflow-hidden tw-text-ellipsis tw-whitespace-nowrap tw-rounded-[var(--radius-inline)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-px-2 tw-py-1 tw-font-mono tw-text-xs tw-font-bold tw-text-[var(--text-primary)]">
                  {shortcut}
                </kbd>
              ) : (
                <span className="tw-shrink-0 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-80">
                  {t('keyboardShortcutsUnassigned')}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {!loading && unsupported ? (
        <p className="tw-mb-0 tw-mt-3 tw-text-xs tw-font-semibold tw-leading-relaxed tw-text-[var(--text-secondary)]">
          {t('keyboardShortcutsUnsupported')}
        </p>
      ) : !loading && managerAccess === 'manual' ? (
        <p className="tw-mb-0 tw-mt-3 tw-text-xs tw-font-semibold tw-leading-relaxed tw-text-[var(--text-secondary)]">
          {t('keyboardShortcutsManualHint')}
        </p>
      ) : !loading && managerAccess === 'openable' ? (
        <div className="tw-mt-3">
          <button
            type="button"
            className={buttonClassName}
            onClick={onOpenManager}
            aria-label={t('keyboardShortcutsManage')}
          >
            {t('keyboardShortcutsManage')}
          </button>
        </div>
      ) : null}
    </section>
  );
}
