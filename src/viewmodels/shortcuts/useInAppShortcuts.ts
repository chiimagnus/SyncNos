import { useCallback, useEffect, useRef, useState } from 'react';

import {
  IN_APP_SHORTCUT_STORAGE_KEY,
  defaultInAppShortcutBindings,
  readInAppShortcutBindings,
  resolveInAppShortcutBindings,
  resetInAppShortcutBindings,
  shortcutFromKeyEvent,
  shortcutPlatform,
  inAppShortcutMatches,
  setHeldShortcutModifier,
  displayInAppShortcut,
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
    const held = new Set<string>();
    const onKeyDown = (event: KeyboardEvent) => {
      if (setHeldShortcutModifier(held, event, true)) return;
      if (event.defaultPrevented || event.repeat || event.isComposing || event.getModifierState('AltGraph')) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('input, textarea, select, [contenteditable], [role="textbox"], [role="combobox"]')
      )
        return;
      const platform = shortcutPlatform();
      const pressed = shortcutFromKeyEvent(event, platform, held);
      if (!pressed) return;
      const action = (Object.keys(handlersRef.current) as InAppShortcutAction[]).find(
        (id) => inAppShortcutMatches(bindings[id], pressed, platform) && typeof handlersRef.current[id] === 'function',
      );
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      handlersRef.current[action]?.();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      setHeldShortcutModifier(held, event, false);
    };
    const clearHeld = () => held.clear();
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', clearHeld);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', clearHeld);
    };
  }, [bindings, enabled, ready]);

  return useCallback(
    (action: InAppShortcutAction) => displayInAppShortcut(ready ? bindings[action] : '', shortcutPlatform()),
    [bindings, ready],
  );
}
