import { useEffect, useState } from 'react';

const DEFAULT_BREAKPOINT_PX = 768; // Tailwind `md`

type UseIsNarrowScreenOptions = {
  breakpointPx?: number;
};

export function useIsNarrowScreen(opts: UseIsNarrowScreenOptions = {}): boolean {
  const breakpointPx = Number(opts.breakpointPx ?? DEFAULT_BREAKPOINT_PX) || DEFAULT_BREAKPOINT_PX;
  const query = `(max-width: ${Math.max(0, breakpointPx - 1)}px)`;

  const [isNarrow, setIsNarrow] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (typeof window.matchMedia !== 'function') return window.innerWidth < breakpointPx;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof window.matchMedia !== 'function') {
      const onResize = () => setIsNarrow(window.innerWidth < breakpointPx);
      onResize();
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }

    const mql = window.matchMedia(query);
    const onChange = () => setIsNarrow(mql.matches);
    onChange();

    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }

    // Safari < 14 + some older Chromium extension contexts.
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [breakpointPx, query]);

  return isNarrow;
}
