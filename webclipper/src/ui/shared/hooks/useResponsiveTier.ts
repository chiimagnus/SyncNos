import { useEffect, useState } from 'react';

const DEFAULT_NARROW_BREAKPOINT_PX = 768; // Tailwind `md`
const DEFAULT_WIDE_BREAKPOINT_PX = 1280; // Tailwind `xl`

export type ResponsiveTier = 'narrow' | 'medium' | 'wide';

type UseResponsiveTierOptions = {
  narrowBreakpointPx?: number;
  wideBreakpointPx?: number;
};

function resolveTierFromWidth(width: number, narrowBreakpointPx: number, wideBreakpointPx: number): ResponsiveTier {
  if (width < narrowBreakpointPx) return 'narrow';
  if (width >= wideBreakpointPx) return 'wide';
  return 'medium';
}

function resolveTierFromMedia(
  narrowMatches: boolean,
  wideMatches: boolean,
  fallbackWidth: number,
  narrowBreakpointPx: number,
  wideBreakpointPx: number,
): ResponsiveTier {
  if (narrowMatches) return 'narrow';
  if (wideMatches) return 'wide';
  return resolveTierFromWidth(fallbackWidth, narrowBreakpointPx, wideBreakpointPx);
}

export function useResponsiveTier(opts: UseResponsiveTierOptions = {}): ResponsiveTier {
  const narrowBreakpointPx =
    Math.max(0, Number(opts.narrowBreakpointPx ?? DEFAULT_NARROW_BREAKPOINT_PX)) || DEFAULT_NARROW_BREAKPOINT_PX;
  const wideBreakpointPxRaw =
    Math.max(0, Number(opts.wideBreakpointPx ?? DEFAULT_WIDE_BREAKPOINT_PX)) || DEFAULT_WIDE_BREAKPOINT_PX;
  const wideBreakpointPx = Math.max(narrowBreakpointPx + 1, wideBreakpointPxRaw);

  const narrowQuery = `(max-width: ${Math.max(0, narrowBreakpointPx - 1)}px)`;
  const wideQuery = `(min-width: ${wideBreakpointPx}px)`;

  const [tier, setTier] = useState<ResponsiveTier>(() => {
    if (typeof window === 'undefined') return 'wide';
    if (typeof window.matchMedia !== 'function') {
      return resolveTierFromWidth(window.innerWidth, narrowBreakpointPx, wideBreakpointPx);
    }
    const narrowMql = window.matchMedia(narrowQuery);
    const wideMql = window.matchMedia(wideQuery);
    return resolveTierFromMedia(
      narrowMql.matches,
      wideMql.matches,
      window.innerWidth,
      narrowBreakpointPx,
      wideBreakpointPx,
    );
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof window.matchMedia !== 'function') {
      const onResize = () => {
        setTier(resolveTierFromWidth(window.innerWidth, narrowBreakpointPx, wideBreakpointPx));
      };
      onResize();
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }

    const narrowMql = window.matchMedia(narrowQuery);
    const wideMql = window.matchMedia(wideQuery);
    const onChange = () => {
      setTier(
        resolveTierFromMedia(
          narrowMql.matches,
          wideMql.matches,
          window.innerWidth,
          narrowBreakpointPx,
          wideBreakpointPx,
        ),
      );
    };
    onChange();

    if (typeof narrowMql.addEventListener === 'function' && typeof wideMql.addEventListener === 'function') {
      narrowMql.addEventListener('change', onChange);
      wideMql.addEventListener('change', onChange);
      return () => {
        narrowMql.removeEventListener('change', onChange);
        wideMql.removeEventListener('change', onChange);
      };
    }

    // Safari < 14 + some older Chromium extension contexts.
    narrowMql.addListener(onChange);
    wideMql.addListener(onChange);
    return () => {
      narrowMql.removeListener(onChange);
      wideMql.removeListener(onChange);
    };
  }, [narrowBreakpointPx, narrowQuery, wideBreakpointPx, wideQuery]);

  return tier;
}
