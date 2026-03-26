import { Tooltip } from 'react-tooltip';

const WEBCLIPPER_TOOLTIP_ID = 'webclipper-tooltip';

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
  return (
    <Tooltip
      id={WEBCLIPPER_TOOLTIP_ID}
      delayShow={120}
      delayHide={40}
      opacity={1}
      noArrow
      positionStrategy="fixed"
      className="webclipper-tooltip"
    />
  );
}
