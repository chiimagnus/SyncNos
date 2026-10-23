import { Tooltip } from 'react-tooltip';
import 'react-tooltip/dist/react-tooltip.css';
import '@ui/styles/tooltip.css';

export function renderAppTooltip({
  content,
  activeAnchor,
}: {
  content: string | null;
  activeAnchor: HTMLElement | null;
}) {
  const shortcut = activeAnchor?.getAttribute('data-tooltip-shortcut');
  if (!shortcut) return content;
  const label = content?.slice(0, -shortcut.length).trim() || '';
  return (
    <>
      {label ? <span className="webclipper-tooltip__label">{label}</span> : null}
      <span className="webclipper-tooltip__shortcut">{shortcut}</span>
    </>
  );
}

export default function AppTooltipImpl({ id }: { id: string }) {
  return (
    <Tooltip
      id={id}
      delayShow={120}
      delayHide={40}
      opacity={1}
      noArrow
      positionStrategy="fixed"
      className="webclipper-tooltip"
      render={renderAppTooltip}
    />
  );
}
