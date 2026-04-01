import { useResponsiveTier } from './useResponsiveTier';

const DEFAULT_BREAKPOINT_PX = 768; // Tailwind `md`

type UseIsNarrowScreenOptions = {
  breakpointPx?: number;
};

export function useIsNarrowScreen(opts: UseIsNarrowScreenOptions = {}): boolean {
  const breakpointPx = Number(opts.breakpointPx ?? DEFAULT_BREAKPOINT_PX) || DEFAULT_BREAKPOINT_PX;
  return useResponsiveTier({ narrowBreakpointPx: breakpointPx, wideBreakpointPx: breakpointPx + 1 }) === 'narrow';
}
