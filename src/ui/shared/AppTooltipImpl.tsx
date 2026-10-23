import { Tooltip } from 'react-tooltip';
import 'react-tooltip/dist/react-tooltip.css';
import '@ui/styles/tooltip.css';

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
    />
  );
}
