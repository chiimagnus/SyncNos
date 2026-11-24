import { t } from '@i18n';
import type { TranslationKey } from '@i18n/locales/en';
import { buttonClassName } from '@ui/settings/ui';
import { SettingsGroup } from './SettingsGroup';
import { SettingsFormRow } from './SettingsFormRow';
import { InAppShortcutsPanel } from '@ui/settings/sections/InAppShortcutsPanel';
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
  { action: 'open-tab', labelKey: 'keyboardShortcutsOpenTab' },
];

export function KeyboardShortcutsSection(props: KeyboardShortcutsSectionProps) {
  const { status, items, managerAccess, onOpenManager } = props;
  const loading = status === 'idle' || status === 'loading';
  const unsupported = status === 'unsupported';
  const shortcutByAction = new Map(items.map((item) => [item.action, item.shortcut]));

  return (
    <>
      <SettingsGroup title={t('keyboardShortcutsBrowserHeading')} ariaLabel={t('keyboardShortcutsHeading')}>
        {ACTION_ROWS.map(({ action, labelKey }) => {
          const shortcut = shortcutByAction.get(action) || '';
          return (
            <SettingsFormRow key={action} label={t(labelKey)}>
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
                <kbd className="tw-min-w-0 tw-overflow-hidden tw-text-ellipsis tw-whitespace-nowrap tw-font-mono tw-text-xs tw-font-medium tw-text-[var(--text-secondary)]">
                  {shortcut}
                </kbd>
              ) : (
                <span className="tw-shrink-0 tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-80">
                  {t('keyboardShortcutsUnassigned')}
                </span>
              )}
            </SettingsFormRow>
          );
        })}

        {!loading && unsupported ? (
          <p className="tw-mb-0 tw-pb-3 tw-text-xs tw-font-semibold tw-leading-relaxed tw-text-[var(--text-secondary)]">
            {t('keyboardShortcutsUnsupported')}
          </p>
        ) : !loading && managerAccess === 'manual' ? (
          <p className="tw-mb-0 tw-pb-3 tw-text-xs tw-font-semibold tw-leading-relaxed tw-text-[var(--text-secondary)]">
            {t('keyboardShortcutsManualHint')}
          </p>
        ) : !loading && managerAccess === 'openable' ? (
          <div className="settings-group-actions">
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
      </SettingsGroup>
      <InAppShortcutsPanel />
    </>
  );
}
