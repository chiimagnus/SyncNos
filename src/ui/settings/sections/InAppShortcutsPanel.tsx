import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { t } from '@i18n';
import {
  IN_APP_SHORTCUT_ACTIONS,
  InAppShortcutBindingError,
  displayInAppShortcut,
  heldShortcutModifiers,
  setHeldShortcutModifier,
  shortcutFromKeyEvent,
  shortcutPlatform,
  type InAppShortcutAction,
} from '@services/shortcuts/in-app-shortcuts';
import { useInAppShortcutBindings } from '@viewmodels/shortcuts/useInAppShortcuts';
import { buttonClassName, cardClassName, textInputClassName } from '@ui/settings/ui';

const GROUPS = [
  { key: 'navigation', label: 'keyboardShortcutsNavigationGroup' },
  { key: 'library', label: 'keyboardShortcutsLibraryGroup' },
  { key: 'detail', label: 'keyboardShortcutsDetailGroup' },
  { key: 'reader', label: 'keyboardShortcutsReaderGroup' },
] as const;

export function InAppShortcutsPanel() {
  const { bindings, ready, error: storageError, update, reset } = useInAppShortcutBindings();
  const [search, setSearch] = useState('');
  const [recording, setRecording] = useState<InAppShortcutAction | null>(null);
  const [pressed, setPressed] = useState('');
  const held = useRef(new Set<string>());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const platform = shortcutPlatform();
  const platformLabel = { mac: 'macOS', windows: 'Windows', linux: 'Linux', chromeos: 'ChromeOS', other: 'Other' }[
    platform
  ];

  const endRecording = () => {
    held.current.clear();
    setPressed('');
    setRecording(null);
  };

  useEffect(() => {
    if (!recording) return;
    const onWindowBlur = () => {
      held.current.clear();
      setPressed('');
      setRecording(null);
    };
    window.addEventListener('blur', onWindowBlur);
    return () => window.removeEventListener('blur', onWindowBlur);
  }, [recording]);

  const save = async (action: InAppShortcutAction, shortcut: string) => {
    setSaving(true);
    setMessage('');
    try {
      await update(action, shortcut);
      endRecording();
    } catch (error) {
      if (error instanceof InAppShortcutBindingError && error.code === 'conflict') {
        const other = IN_APP_SHORTCUT_ACTIONS.find(({ id }) => id === error.conflictingAction);
        setMessage(`${t('keyboardShortcutsConflict')} ${other ? t(other.labelKey) : ''}`);
      } else if (error instanceof InAppShortcutBindingError && error.code === 'invalid') {
        setMessage(t('keyboardShortcutsInvalid'));
      } else {
        endRecording();
        setMessage(t('keyboardShortcutsSaveFailed'));
      }
    } finally {
      setSaving(false);
    }
  };

  const recordKey = (event: ReactKeyboardEvent<HTMLButtonElement>, action: InAppShortcutAction) => {
    if (event.repeat || event.nativeEvent.isComposing) return;
    // Preserve normal focus traversal and allow Escape to cancel recording.
    if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      endRecording();
      setMessage('');
      return;
    }
    setMessage('');
    if (setHeldShortcutModifier(held.current, event.nativeEvent, true)) {
      setPressed(heldShortcutModifiers(held.current));
      return;
    }
    const chord = shortcutFromKeyEvent(event.nativeEvent, platform, held.current);
    if (!chord) {
      setMessage(t('keyboardShortcutsInvalid'));
      return;
    }
    setPressed(chord);
    void save(action, chord);
  };

  const releaseKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (setHeldShortcutModifier(held.current, event.nativeEvent, false)) {
      event.stopPropagation();
      setPressed(heldShortcutModifiers(held.current));
    }
  };

  const query = search.trim().toLocaleLowerCase();
  const groups = GROUPS.map((group) => ({
    ...group,
    items: IN_APP_SHORTCUT_ACTIONS.filter(
      (action) =>
        action.group === group.key &&
        (!query ||
          t(action.labelKey).toLocaleLowerCase().includes(query) ||
          displayInAppShortcut(bindings[action.id], platform).toLocaleLowerCase().includes(query)),
    ),
  })).filter((group) => group.items.length > 0);

  return (
    <section className={cardClassName} aria-label={t('keyboardShortcutsInAppHeading')}>
      <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
        <h2 className="tw-m-0 tw-text-base tw-font-extrabold tw-text-[var(--text-primary)]">
          {t('keyboardShortcutsInAppHeading')}
        </h2>
        <span className="tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]">{platformLabel}</span>
      </div>
      <p className="tw-mb-3 tw-mt-2 tw-text-xs tw-leading-relaxed tw-text-[var(--text-secondary)]">
        {t('keyboardShortcutsInAppHint')}
      </p>

      <input
        className={`${textInputClassName} tw-mb-2 tw-w-full`}
        type="search"
        value={search}
        onInput={(event) => setSearch(event.currentTarget.value)}
        placeholder={t('keyboardShortcutsSearch')}
        aria-label={t('keyboardShortcutsSearch')}
      />
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

      <div className="tw-grid tw-gap-1">
        {groups.length ? (
          groups.map(({ key, label, items }) => (
            <details
              key={query ? `${key}:search` : key}
              open={!!query || key === 'navigation'}
              className="tw-border-b tw-border-[var(--border)]"
            >
              <summary className="tw-flex tw-cursor-pointer tw-items-center tw-justify-between tw-gap-2 tw-py-2 tw-text-sm tw-font-bold tw-text-[var(--text-primary)]">
                <span>{t(label)}</span>
                <span className="tw-text-xs tw-font-normal tw-text-[var(--text-secondary)]">{items.length}</span>
              </summary>
              <div className="tw-divide-y tw-divide-[var(--border)]">
                {items.map((action) => {
                  const isRecording = recording === action.id;
                  const displayed = isRecording ? pressed : bindings[action.id];
                  return (
                    <div
                      key={action.id}
                      className="tw-group tw-flex tw-min-h-12 tw-items-center tw-justify-between tw-gap-3 tw-py-2"
                    >
                      <span className="tw-min-w-0 tw-flex-1 tw-text-sm tw-text-[var(--text-secondary)]">
                        {t(action.labelKey)}
                      </span>
                      <div className="tw-flex tw-min-w-0 tw-shrink-0 tw-items-center tw-gap-1.5">
                        <button
                          type="button"
                          className={`tw-inline-flex tw-min-h-8 tw-min-w-16 tw-max-w-[240px] tw-items-center tw-justify-end tw-rounded-[var(--radius-inline)] tw-border tw-px-2 tw-py-1 tw-text-xs tw-transition-colors focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)] disabled:tw-opacity-50 ${isRecording ? 'tw-border-[var(--accent)] tw-bg-transparent tw-text-[var(--text-primary)]' : 'tw-border-transparent tw-bg-transparent tw-text-[var(--text-secondary)] hover:tw-border-[var(--border)] hover:tw-text-[var(--text-primary)]'}`}
                          disabled={!ready || saving || storageError}
                          onClick={(event) => {
                            if (isRecording) {
                              endRecording();
                              return;
                            }
                            held.current.clear();
                            setPressed('');
                            setMessage('');
                            setRecording(action.id);
                            event.currentTarget.focus({ preventScroll: true });
                          }}
                          onKeyDown={isRecording ? (event) => recordKey(event, action.id) : undefined}
                          onKeyUp={isRecording ? releaseKey : undefined}
                          onBlur={() => {
                            if (isRecording) endRecording();
                          }}
                          aria-pressed={isRecording}
                          aria-label={`${t('keyboardShortcutsRecord')}: ${t(action.labelKey)}${displayed ? `, ${displayInAppShortcut(displayed, platform)}` : ''}`}
                          data-shortcut-recording={isRecording ? 'true' : undefined}
                        >
                          {displayed ? (
                            <kbd
                              className="tw-block tw-max-w-full tw-truncate tw-font-mono tw-font-medium tw-leading-5"
                              aria-hidden="true"
                            >
                              {displayInAppShortcut(displayed, platform)}
                            </kbd>
                          ) : (
                            <span
                              className={isRecording ? 'tw-text-[var(--accent)]' : 'tw-text-[var(--text-secondary)]'}
                            >
                              {isRecording ? t('keyboardShortcutsRecording') : t('keyboardShortcutsUnassigned')}
                            </span>
                          )}
                        </button>
                        {bindings[action.id] ? (
                          <button
                            type="button"
                            className="tw-flex tw-size-7 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-[var(--radius-inline)] tw-border-0 tw-bg-transparent tw-text-lg tw-text-[var(--text-secondary)] tw-opacity-0 hover:tw-bg-[var(--bg-sunken)] hover:tw-text-[var(--text-primary)] group-hover:tw-opacity-70 group-focus-within:tw-opacity-70 focus-visible:tw-opacity-100 focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-[var(--focus-ring)] disabled:tw-opacity-50"
                            disabled={!ready || saving || storageError}
                            onClick={() => {
                              void save(action.id, '');
                            }}
                            aria-label={`${t('keyboardShortcutsClear')}: ${t(action.labelKey)}`}
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          ))
        ) : (
          <p className="tw-py-4 tw-text-center tw-text-sm tw-text-[var(--text-secondary)]">
            {t('keyboardShortcutsNoResults')}
          </p>
        )}
      </div>
      <div className="tw-mt-3 tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-2">
        <span className="tw-text-xs tw-text-[var(--text-secondary)]">{t('keyboardShortcutsPhysicalKeysHint')}</span>
        <button
          type="button"
          className={buttonClassName}
          disabled={!ready || saving || storageError}
          onClick={() => {
            setSaving(true);
            setMessage('');
            void reset()
              .then(endRecording)
              .catch(() => setMessage(t('keyboardShortcutsSaveFailed')))
              .finally(() => setSaving(false));
          }}
        >
          {t('keyboardShortcutsReset')}
        </button>
      </div>
    </section>
  );
}
