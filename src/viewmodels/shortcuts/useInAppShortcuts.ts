import { useEffect, useRef, useState } from 'react';

import {
  IN_APP_SHORTCUT_STORAGE_KEY,
  defaultInAppShortcutBindings,
  readInAppShortcutBindings,
  resolveInAppShortcutBindings,
  resetInAppShortcutBindings,
  shortcutFromKeyEvent,
  updateInAppShortcutBinding,
  type InAppShortcutAction,
  type InAppShortcutBindings,
} from '@services/shortcuts/in-app-shortcuts';
import { storageOnChanged } from '@services/shared/storage';

export function useInAppShortcutBindings(reportLoadError = true) {
  const [bindings, setBindings] = useState<InAppShortcutBindings>(defaultInAppShortcutBindings);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;
    let changedSinceRead = false;
    const unsubscribe = storageOnChanged((changes, area) => {
      if (area && area !== 'local') return;
      if (!changes?.[IN_APP_SHORTCUT_STORAGE_KEY]) return;
      changedSinceRead = true;
      setBindings(resolveInAppShortcutBindings(changes[IN_APP_SHORTCUT_STORAGE_KEY].newValue));
      setReady(true);
      setError(false);
    });
    void readInAppShortcutBindings().then(
      (value) => {
        if (!mounted || changedSinceRead) return;
        setBindings(value);
        setReady(true);
        setError(false);
      },
      () => {
        if (mounted && reportLoadError) setError(true);
      },
    );
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [reportLoadError]);

  const update = async (action: InAppShortcutAction, shortcut: string) => {
    const next = await updateInAppShortcutBinding(action, shortcut);
    setBindings(next);
    return next;
  };
  const reset = async () => {
    const next = await resetInAppShortcutBindings();
    setBindings(next);
  };
  return { bindings, ready, error, update, reset };
}

export function useInAppShortcuts(handlers: Partial<Record<InAppShortcutAction, () => void>>, enabled = true) {
  const { bindings, ready } = useInAppShortcutBindings(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled || !ready) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable], [role="textbox"], [role="combobox"]')
      )
        return;
      const isMac = /Mac/i.test(String(globalThis.navigator?.platform || ''));
      const pressed = shortcutFromKeyEvent(event, isMac);
      if (!pressed) return;
      const action = (Object.keys(handlersRef.current) as InAppShortcutAction[]).find(
        (id) => bindings[id] === pressed && typeof handlersRef.current[id] === 'function',
      );
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      handlersRef.current[action]?.();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [bindings, enabled, ready]);
}
