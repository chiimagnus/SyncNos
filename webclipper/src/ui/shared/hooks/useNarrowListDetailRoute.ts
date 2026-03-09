import { useCallback, useEffect, useState } from 'react';

type NarrowRoute = 'list' | 'detail';

type UseNarrowListDetailRouteInput = {
  isNarrow: boolean;
  defaultRoute?: NarrowRoute;
};

export function useNarrowListDetailRoute(input: UseNarrowListDetailRouteInput) {
  const { isNarrow, defaultRoute = 'list' } = input;
  const [route, setRoute] = useState<NarrowRoute>(defaultRoute);
  const [listRestoreKey, setListRestoreKey] = useState(0);

  const openDetail = useCallback(() => {
    if (!isNarrow) return;
    setRoute('detail');
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
    returnToList,
    listRestoreKey,
  };
}
