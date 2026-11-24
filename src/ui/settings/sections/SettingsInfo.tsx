import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { autoUpdate, computePosition, flip, hide, offset, shift, size } from '@floating-ui/dom';
import { Info } from 'lucide-react';

import { t } from '@i18n';
import { SettingsDocsLink, type SettingsDocsPath } from '@ui/settings/SettingsDocsLink';
import { useDismissableLayer } from '@ui/shared/useDismissableLayer';

export function SettingsInfo({
  label,
  detail,
  docsPath,
}: {
  label: string;
  detail: string;
  docsPath?: SettingsDocsPath;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const keyboardFocus = useRef(false);
  const [mode, setMode] = useState<'hover' | 'pinned' | null>(null);
  const open = mode !== null;
  const clearTimer = () => window.clearTimeout(timer.current);
  const close = () => {
    clearTimer();
    keyboardFocus.current = false;
    setMode(null);
  };
  const scheduleClose = () => {
    clearTimer();
    if (mode === 'hover') timer.current = window.setTimeout(close, 180);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useDismissableLayer({
    open,
    containerRef: panelRef,
    insideRef: triggerRef,
    onDismiss: () => {
      if (panelRef.current?.contains(document.activeElement)) triggerRef.current?.focus({ preventScroll: true });
      close();
    },
  });

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !panelRef.current) return;
    const anchor = triggerRef.current;
    const panel = panelRef.current;
    let disposed = false;
    const update = () => {
      void computePosition(anchor, panel, {
        strategy: 'fixed',
        placement: 'bottom-start',
        middleware: [
          offset(7),
          flip({ padding: 12 }),
          shift({ padding: 12 }),
          size({
            padding: 12,
            apply({ availableWidth, availableHeight, elements }) {
              elements.floating.style.maxWidth = Math.min(320, Math.max(0, availableWidth)) + 'px';
              elements.floating.style.maxHeight = Math.max(0, availableHeight) + 'px';
            },
          }),
          hide(),
        ],
      }).then(({ x, y, middlewareData }) => {
        if (disposed) return;
        if (middlewareData.hide?.referenceHidden) {
          panel.style.visibility = 'hidden';
          return;
        }
        Object.assign(panel.style, { left: x + 'px', top: y + 'px', visibility: 'visible' });
        if (keyboardFocus.current) {
          keyboardFocus.current = false;
          panel.focus({ preventScroll: true });
        }
      });
    };
    const cleanup = autoUpdate(anchor, panel, update);
    return () => {
      disposed = true;
      cleanup();
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="settings-info"
        aria-label={t('settingsMoreInfo') + ': ' + label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup="dialog"
        onPointerEnter={(event) => {
          if (event.pointerType !== 'mouse') return;
          clearTimer();
          if (!open)
            timer.current = window.setTimeout(() => {
              if (!document.querySelector('[data-settings-info-mode="pinned"]')) setMode('hover');
            }, 220);
        }}
        onPointerLeave={scheduleClose}
        onClick={(event) => {
          clearTimer();
          if (mode === 'pinned') {
            close();
            return;
          }
          keyboardFocus.current = event.detail === 0;
          setMode('pinned');
          if (keyboardFocus.current && panelRef.current?.style.visibility === 'visible') {
            keyboardFocus.current = false;
            panelRef.current.focus({ preventScroll: true });
          }
        }}
      >
        <Info size={16} aria-hidden="true" />
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              id={id}
              role="dialog"
              aria-label={label}
              data-settings-info-panel="true"
              data-settings-info-mode={mode}
              tabIndex={-1}
              className="settings-info-panel"
              onPointerEnter={clearTimer}
              onPointerLeave={scheduleClose}
              style={{ position: 'fixed', visibility: 'hidden' }}
            >
              <strong>{label}</strong>
              <p>{detail}</p>
              {docsPath ? <SettingsDocsLink path={docsPath} /> : null}
            </div>,
            triggerRef.current?.closest('.settings-scene') ?? document.body,
          )
        : null}
    </>
  );
}
