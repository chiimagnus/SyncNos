import { useCallback, useEffect, useState } from 'react';

type NarrowRoute = 'list' | 'detail' | 'comments';

type UseNarrowListDetailCommentsRouteInput = {
  isNarrow: boolean;
  defaultRoute?: NarrowRoute;
};

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
    if (!isNarrow || route === 'list') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (route === 'comments') {
        returnToDetail();
        return;
      }
      returnToList();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [isNarrow, returnToDetail, returnToList, route]);

  return {
    route,
    openDetail,
    openComments,
    returnToDetail,
    returnToList,
    listRestoreKey,
  };
}
