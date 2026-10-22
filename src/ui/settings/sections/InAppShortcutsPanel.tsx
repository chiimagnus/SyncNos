import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { t } from '@i18n';
import {
  IN_APP_SHORTCUT_ACTIONS,
  InAppShortcutBindingError,
  shortcutFromKeyEvent,
  type InAppShortcutAction,
} from '@services/shortcuts/in-app-shortcuts';
import { useInAppShortcutBindings } from '@viewmodels/shortcuts/useInAppShortcuts';
import { buttonClassName, cardClassName } from '@ui/settings/ui';

const GROUPS = [
  { key: 'navigation', label: 'keyboardShortcutsNavigationGroup' },
  { key: 'library', label: 'keyboardShortcutsLibraryGroup' },
  { key: 'detail', label: 'keyboardShortcutsDetailGroup' },
  { key: 'reader', label: 'keyboardShortcutsReaderGroup' },
] as const;

export function InAppShortcutsPanel() {
  const { bindings, ready, error: storageError, update, reset } = useInAppShortcutBindings();
  const [recording, setRecording] = useState<InAppShortcutAction | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const save = async (action: InAppShortcutAction, shortcut: string) => {
    setSaving(true);
    setMessage('');
    try {
      await update(action, shortcut);
      setRecording(null);
    } catch (error) {
      if (error instanceof InAppShortcutBindingError && error.code === 'conflict') {
        const other = IN_APP_SHORTCUT_ACTIONS.find(({ id }) => id === error.conflictingAction);
        setMessage(`${t('keyboardShortcutsConflict')} ${other ? t(other.labelKey) : ''}`);
      } else {
        setRecording(null);
        setMessage(t('keyboardShortcutsSaveFailed'));
      }
    } finally {
      setSaving(false);
    }
  };

  const recordKey = (event: ReactKeyboardEvent<HTMLButtonElement>, action: InAppShortcutAction) => {
    if (event.key === 'Tab') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      setRecording(null);
      setMessage('');
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      void save(action, '');
      return;
    }
    if (['Control', 'Alt', 'Meta', 'Shift'].includes(event.key)) return;
    const shortcut = shortcutFromKeyEvent(event.nativeEvent, /Mac/i.test(navigator.platform));
    if (!shortcut) {
      setMessage(t('keyboardShortcutsInvalid'));
      return;
    }
    void save(action, shortcut);
  };

  return (
    <section className={cardClassName} aria-label={t('keyboardShortcutsInAppHeading')}>
      <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
        {t('keyboardShortcutsInAppHeading')}
      </h2>
      <p className="tw-mb-2 tw-mt-2 tw-text-xs tw-leading-relaxed tw-text-[var(--text-secondary)]">
        {t('keyboardShortcutsInAppHint')}
      </p>
      {storageError ? (
        <p role="alert" className="tw-text-sm tw-text-[var(--error)]">
          {t('keyboardShortcutsStorageFailed')}
        </p>
      ) : null}
      {message ? (
        <p role="alert" className="tw-text-sm tw-text-[var(--error)]">
          {message}
        </p>
      ) : null}
      <div className="tw-grid tw-gap-2">
        {GROUPS.map(({ key, label }) => (
          <details
            key={key}
            open={key === 'navigation' ? true : undefined}
            className="tw-border-b tw-border-[var(--border)] tw-py-1"
          >
            <summary className="tw-cursor-pointer tw-py-2 tw-text-sm tw-font-bold tw-text-[var(--text-primary)]">
              {t(label)}
            </summary>
            <div className="tw-grid tw-divide-y tw-divide-[var(--border)]">
              {IN_APP_SHORTCUT_ACTIONS.filter((action) => action.group === key).map((action) => (
                <div key={action.id} className="tw-flex tw-min-w-0 tw-items-center tw-justify-between tw-gap-2 tw-py-2">
                  <span className="tw-min-w-0 tw-text-sm tw-text-[var(--text-secondary)]">{t(action.labelKey)}</span>
                  <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-2">
                    <button
                      type="button"
                      className={buttonClassName}
                      disabled={!ready || saving || storageError}
                      onClick={(event) => {
                        event.currentTarget.focus({ preventScroll: true });
                        setMessage('');
                        setRecording(action.id);
                      }}
                      onKeyDown={recording === action.id ? (event) => recordKey(event, action.id) : undefined}
                      data-shortcut-recording={recording === action.id ? 'true' : undefined}
                      onBlur={() => {
                        if (recording === action.id) setRecording(null);
                      }}
                      aria-label={`${t('keyboardShortcutsRecord')}: ${t(action.labelKey)}`}
                    >
                      {recording === action.id
                        ? t('keyboardShortcutsRecording')
                        : bindings[action.id] || t('keyboardShortcutsUnassigned')}
                    </button>
                    <button
                      type="button"
                      className={buttonClassName}
                      disabled={!ready || saving || storageError || !bindings[action.id]}
                      onClick={() => {
                        void save(action.id, '');
                      }}
                      aria-label={`${t('keyboardShortcutsClear')}: ${t(action.labelKey)}`}
                    >
                      {t('keyboardShortcutsClear')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
      <button
        type="button"
        className={buttonClassName}
        disabled={!ready || saving || storageError}
        onClick={() => {
          setSaving(true);
          setMessage('');
          void reset()
            .then(() => setRecording(null))
            .catch(() => setMessage(t('keyboardShortcutsSaveFailed')))
            .finally(() => setSaving(false));
        }}
      >
        {t('keyboardShortcutsReset')}
      </button>
    </section>
  );
}
