import { useCallback, useEffect, useState } from 'react';

type NarrowRoute = 'list' | 'detail' | 'comments';

type UseNarrowListDetailCommentsRouteInput = {
  isNarrow: boolean;
  defaultRoute?: NarrowRoute;
};

function escapeIsOwnedByLocalUi(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return true;

  const target = event.target instanceof HTMLElement ? event.target : null;
  if (
    target?.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]',
    )
  ) {
    return true;
  }

  return Boolean(
    document.querySelector(
      '[role="menu"]:not([hidden]), [role="dialog"]:not([hidden]), [aria-modal="true"]:not([hidden]), [aria-haspopup][aria-expanded="true"]',
    ),
  );
}

export function useNarrowListDetailCommentsRoute(input: UseNarrowListDetailCommentsRouteInput) {
  const { isNarrow, defaultRoute = 'list' } = input;
  const [route, setRoute] = useState<NarrowRoute>(defaultRoute);
  const [listRestoreKey, setListRestoreKey] = useState(0);

  const openDetail = useCallback(() => {
    if (!isNarrow) return;
    setRoute('detail');
  }, [isNarrow]);

  const openComments = useCallback(() => {
    if (!isNarrow) return;
    setRoute((current) => (current === 'detail' ? 'comments' : current));
  }, [isNarrow]);

  const returnToDetail = useCallback(() => {
    if (!isNarrow) return;
    setRoute((current) => (current === 'comments' ? 'detail' : current));
  }, [isNarrow]);

  const returnToList = useCallback(() => {
    setListRestoreKey((value) => value + 1);
    setRoute('list');
  }, []);

  useEffect(() => {
    if (!isNarrow) return;
    setRoute(defaultRoute);
  }, [defaultRoute, isNarrow]);

  useEffect(() => {
    if (!isNarrow || route !== 'detail') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (escapeIsOwnedByLocalUi(event)) return;
      event.preventDefault();
      event.stopPropagation();
      returnToList();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [isNarrow, returnToList, route]);

  return {
    route,
    openDetail,
    openComments,
    returnToDetail,
    returnToList,
    listRestoreKey,
  };
}
