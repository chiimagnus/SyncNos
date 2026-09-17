import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { menuPopoverPanelClassName } from '@ui/shared/button-styles';
import { useDismissableLayer } from '@ui/shared/useDismissableLayer';

type ReaderRailPanelProps = {
  id: string;
  label: string;
  narrow: boolean;
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
};

const CLOSE_DELAY_MS = 160;
const PANEL_BASE_CLASS = [
  'tw-absolute tw-text-[var(--text-primary)]',
  menuPopoverPanelClassName(170),
  'tw-w-[300px] tw-max-w-[78vw]',
].join(' ');
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

export function ReaderRailPanel({ id, label, narrow, trigger, children, className }: ReaderRailPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const openNow = useCallback(() => {
    clearCloseTimer();
    setOpen(true);
  }, [clearCloseTimer]);

  const closeNow = useCallback(() => {
    clearCloseTimer();
    setOpen(false);
  }, [clearCloseTimer]);

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, CLOSE_DELAY_MS);
  }, [clearCloseTimer]);

  useEffect(
    () => () => {
      clearCloseTimer();
    },
    [clearCloseTimer],
  );

  useDismissableLayer({ open, containerRef, onDismiss: closeNow });

  return (
    <div
      ref={containerRef}
      className={['tw-relative tw-flex tw-flex-col tw-items-start', className || ''].join(' ').trim()}
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
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
          className={PANEL_BASE_CLASS}
          style={getPanelStyle(narrow)}
          onClick={closeNow}
        >
          <div className={PANEL_CONTENT_CLASS}>{children}</div>
        </div>
      ) : null}
    </div>
  );
}
