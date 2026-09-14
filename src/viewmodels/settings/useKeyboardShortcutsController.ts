import { useCallback, useEffect, useRef, useState } from 'react';

import {
  openKeyboardShortcutSettings,
  readKeyboardShortcutSnapshot,
  type KeyboardShortcutAction,
  type KeyboardShortcutItem,
  type KeyboardShortcutManagerAccess,
} from '@services/shortcuts/keyboard-shortcuts';

export type KeyboardShortcutsControllerStatus = 'idle' | 'loading' | 'ready' | 'unsupported';
export type KeyboardShortcutsControllerItem = KeyboardShortcutItem;
export type KeyboardShortcutsControllerManagerAccess = KeyboardShortcutManagerAccess;
export type { KeyboardShortcutAction };

type UseKeyboardShortcutsControllerArgs = {
  active: boolean;
};

export function useKeyboardShortcutsController({ active }: UseKeyboardShortcutsControllerArgs) {
  const [status, setStatus] = useState<KeyboardShortcutsControllerStatus>('idle');
  const [items, setItems] = useState<KeyboardShortcutItem[]>([]);
  const [managerAccess, setManagerAccess] = useState<KeyboardShortcutManagerAccess>('unsupported');
  const activeRef = useRef(active);
  const generationRef = useRef(0);
  activeRef.current = active;

  const refresh = useCallback(async () => {
    if (!activeRef.current) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setStatus('loading');

    const snapshot = await readKeyboardShortcutSnapshot();
    if (!activeRef.current || generationRef.current !== generation) return;

    setItems(snapshot.items);
    setManagerAccess(snapshot.managerAccess);
    setStatus(snapshot.supported ? 'ready' : 'unsupported');
  }, []);

  const openManager = useCallback(async () => {
    const result = await openKeyboardShortcutSettings();
    if (result === 'manual') setManagerAccess('manual');
    if (result === 'unsupported') setManagerAccess('unsupported');
    return result;
  }, []);

  useEffect(() => {
    if (!active) {
      generationRef.current += 1;
      setStatus('idle');
      return undefined;
    }

    void refresh();
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      generationRef.current += 1;
      window.removeEventListener('focus', onFocus);
    };
  }, [active, refresh]);

  return {
    status,
    items,
    managerAccess,
    refresh,
    openManager,
  };
}
