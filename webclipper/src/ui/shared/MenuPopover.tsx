import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef } from 'react';

import { menuPopoverPanelClassName } from './button-styles';
import { useDismissableLayer } from './useDismissableLayer';

export type MenuPopoverSide = 'top' | 'bottom';
export type MenuPopoverAlign = 'start' | 'end';

export type MenuPopoverTriggerProps = {
  type: 'button';
  onClick: () => void;
  disabled?: boolean;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
};

export type MenuPopoverProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  disabled?: boolean;
  ariaLabel: string;
  side?: MenuPopoverSide;
  align?: MenuPopoverAlign;
  panelMinWidth?: number;
  panelMaxHeight?: number;
  panelClassName?: string;
  className?: string;
  trigger: (props: MenuPopoverTriggerProps) => ReactNode;
  children: ReactNode;
};

export function MenuPopover(props: MenuPopoverProps) {
  const {
    open,
    onOpenChange,
    disabled,
    ariaLabel,
    side = 'bottom',
    align = 'end',
    panelMinWidth,
    panelMaxHeight,
    panelClassName,
    className,
    trigger,
    children,
  } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!disabled) return;
    onOpenChange(false);
  }, [disabled, onOpenChange, open]);

  useDismissableLayer({
    open,
    containerRef,
    onDismiss: () => onOpenChange(false),
  });

  const panelPosClassName = useMemo(() => {
    const alignClass = align === 'start' ? 'tw-left-0' : 'tw-right-0';
    const sideClass =
      side === 'top'
        ? 'tw-bottom-[calc(100%+8px)] tw-top-auto'
        : 'tw-top-[calc(100%+8px)]';
    return ['tw-absolute', alignClass, sideClass].join(' ');
  }, [align, side]);

  const basePanelClassName = useMemo(() => {
    const inferredMinWidth = typeof panelMinWidth === 'number' && Number.isFinite(panelMinWidth) ? panelMinWidth : 170;
    const minWidthPreset: 150 | 170 = inferredMinWidth <= 150 ? 150 : 170;
    return [panelPosClassName, menuPopoverPanelClassName(minWidthPreset), panelClassName || ''].join(' ').trim();
  }, [panelClassName, panelMinWidth, panelPosClassName]);

  const panelStyle = useMemo(() => {
    const style: Record<string, string> = {};
    if (typeof panelMinWidth === 'number' && Number.isFinite(panelMinWidth) && panelMinWidth > 0) {
      style.minWidth = `${Math.round(panelMinWidth)}px`;
    }
    if (typeof panelMaxHeight === 'number' && Number.isFinite(panelMaxHeight) && panelMaxHeight > 0) {
      style.maxHeight = `${Math.round(panelMaxHeight)}px`;
      style.overflowY = 'auto';
      style.overscrollBehavior = 'contain';
    }
    return style;
  }, [panelMaxHeight, panelMinWidth]);

  return (
    <div ref={containerRef} className={['tw-relative', className || ''].join(' ').trim()}>
      {trigger({
        type: 'button',
        disabled,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        onClick: () => onOpenChange(!open),
      })}

      <div role="menu" aria-label={ariaLabel} hidden={!open} className={basePanelClassName} style={panelStyle}>
        {children}
      </div>
    </div>
  );
}

