import { useEffect, type CSSProperties, type ReactNode } from 'react';

import { menuPopoverPanelClassName } from '@ui/shared/button-styles';

type ReaderRailPanelProps = {
  id: string;
  label: string;
  open: boolean;
  narrow: boolean;
  trigger: ReactNode;
  children: ReactNode;
  panelTitle?: ReactNode;
  className?: string;
  panelClassName?: string;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onEscape: () => void;
};

const PANEL_BASE_CLASS = [
  'tw-absolute tw-z-30 tw-text-[var(--text-primary)]',
  menuPopoverPanelClassName(170),
  'tw-w-[300px] tw-max-w-[78vw]',
].join(' ');

const PANEL_TITLE_CLASS =
  'tw-mb-3 tw-flex tw-items-center tw-justify-between tw-text-xs tw-font-semibold tw-text-[var(--text-secondary)]';

const PANEL_CONTENT_CLASS = 'tw-flex tw-flex-col tw-gap-1';

function getPanelStyle(narrow: boolean): CSSProperties {
  const anchored: CSSProperties = {
    right: 0,
    top: 0,
  };

  if (!narrow) return anchored;

  return {
    ...anchored,
    width: '300px',
    maxWidth: 'calc(100vw - 28px)',
    maxHeight: '70vh',
    overflow: 'auto',
  };
}

export function ReaderRailPanel({
  id,
  label,
  open,
  narrow,
  trigger,
  children,
  panelTitle,
  className,
  panelClassName,
  onMouseEnter,
  onMouseLeave,
  onEscape,
}: ReaderRailPanelProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onEscape();
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onEscape, open]);

  return (
    <div
      className={['tw-relative tw-flex tw-flex-col tw-items-start', className || ''].join(' ').trim()}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-reader-rail-wrap={id}
    >
      <div
        className="tw-contents"
        aria-hidden={open ? 'true' : undefined}
        style={open ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}
        data-reader-rail-trigger-shell={id}
      >
        {trigger}
      </div>

      {open ? (
        <div
          role="menu"
          aria-label={label}
          data-reader-rail-panel={id}
          className={[PANEL_BASE_CLASS, panelClassName || ''].join(' ').trim()}
          style={getPanelStyle(narrow)}
        >
          {panelTitle ? <h3 className={PANEL_TITLE_CLASS}>{panelTitle}</h3> : null}
          <div className={PANEL_CONTENT_CLASS}>{children}</div>
        </div>
      ) : null}
    </div>
  );
}
