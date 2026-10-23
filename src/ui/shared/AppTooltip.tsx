import { lazy, Suspense, useEffect, useState } from 'react';

const WEBCLIPPER_TOOLTIP_ID = 'webclipper-tooltip';
const LazyAppTooltipImpl = lazy(() => import('./AppTooltipImpl'));

type TooltipPlace = 'top' | 'right' | 'bottom' | 'left';

type TooltipAnchorAttrs = {
  'data-tooltip-id'?: string;
  'data-tooltip-content'?: string;
  'data-tooltip-place'?: TooltipPlace;
};

export function tooltipAttrs(content: string | null | undefined, place: TooltipPlace = 'top'): TooltipAnchorAttrs {
  const safeContent = String(content || '').trim();
  if (!safeContent) return {};
  return {
    'data-tooltip-id': WEBCLIPPER_TOOLTIP_ID,
    'data-tooltip-content': safeContent,
    'data-tooltip-place': place,
  };
}

export function AppTooltipHost() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  if (!ready) return null;

  return (
    <Suspense fallback={null}>
      <LazyAppTooltipImpl id={WEBCLIPPER_TOOLTIP_ID} />
    </Suspense>
  );
}
