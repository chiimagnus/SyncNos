import { useEffect, useRef, useState } from 'react';

import type { DetailHeaderAction } from '../../integrations/detail-header-actions';

export type DetailHeaderActionBarProps = {
  actions: DetailHeaderAction[];
  buttonClassName: string;
  menuTriggerLabel?: string;
  menuTriggerTitle?: string;
  menuTriggerAriaLabel?: string;
  menuAriaLabel?: string;
  className?: string;
};

export function DetailHeaderActionBar({
  actions,
  buttonClassName,
  menuTriggerLabel,
  menuTriggerTitle,
  menuTriggerAriaLabel,
  menuAriaLabel,
  className,
}: DetailHeaderActionBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [labelOverride, setLabelOverride] = useState<string>('');
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const labelResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTrigger = async (action: DetailHeaderAction) => {
    if (busy) return;
    setBusy(true);
    try {
      await action.onTrigger();
      if (action.afterTriggerLabel) {
        setLabelOverride(String(action.afterTriggerLabel));
        if (labelResetTimerRef.current != null) globalThis.clearTimeout(labelResetTimerRef.current);
        labelResetTimerRef.current = globalThis.setTimeout(() => {
          setLabelOverride('');
        }, 2_600);
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : String(error || 'Action failed.');
      if (typeof globalThis.window?.alert === 'function') {
        globalThis.window.alert(message);
      } else {
        console.error(message);
      }
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    return () => {
      if (labelResetTimerRef.current != null) globalThis.clearTimeout(labelResetTimerRef.current);
      labelResetTimerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (wrapRef.current && target && !wrapRef.current.contains(target)) {
        setMenuOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [menuOpen]);

  if (!actions.length) return null;

  if (actions.length === 1) {
    const action = actions[0]!;
    const buttonLabel = labelOverride || action.label;
    return (
      <div className={className || 'tw-flex tw-items-center tw-gap-2'}>
        <button
          key={action.id}
          type="button"
          title={action.label}
          onClick={() => {
            void handleTrigger(action);
          }}
          className={buttonClassName}
          aria-label={action.label}
          disabled={busy}
        >
          {buttonLabel}
        </button>
      </div>
    );
  }

  const resolvedMenuTriggerLabel = String(menuTriggerLabel || '').trim() || 'Open in...';
  const resolvedMenuTriggerTitle = String(menuTriggerTitle || '').trim() || resolvedMenuTriggerLabel;
  const resolvedMenuTriggerAriaLabel = String(menuTriggerAriaLabel || '').trim() || 'Open destinations';
  const resolvedMenuAriaLabel = String(menuAriaLabel || '').trim() || resolvedMenuTriggerAriaLabel;
  const triggerLabel = labelOverride || resolvedMenuTriggerLabel;

  const menuButtonClass =
    'tw-w-full tw-rounded-[11px] tw-border tw-border-transparent tw-bg-transparent tw-px-2.5 tw-py-2 tw-text-left tw-text-xs tw-font-semibold tw-text-[var(--text)] tw-transition-colors tw-duration-150 hover:tw-border-[var(--border)] hover:tw-bg-[var(--btn-bg)]';

  return (
    <div ref={wrapRef} className={className || 'tw-flex tw-items-center tw-gap-2'}>
      <div className="tw-relative">
        <button
          type="button"
          title={resolvedMenuTriggerTitle}
          aria-label={resolvedMenuTriggerAriaLabel}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => {
            setMenuOpen((value) => !value);
          }}
          className={buttonClassName}
          disabled={busy}
        >
          <span className="tw-leading-none">{triggerLabel}</span>
          <span
            className="tw-ml-1 tw-w-[14px] tw-text-center tw-text-[12px] tw-font-black tw-leading-none tw-text-[var(--muted)]"
            aria-hidden="true"
          >
            ▾
          </span>
        </button>

        <div
          role="menu"
          aria-label={resolvedMenuAriaLabel}
          hidden={!menuOpen}
          className="tw-absolute tw-right-0 tw-top-[calc(100%+8px)] tw-z-30 tw-min-w-[170px] tw-rounded-[14px] tw-border tw-border-[var(--border)] tw-bg-[var(--panel)] tw-p-1.5 tw-shadow-[var(--shadow)]"
        >
          {actions.map((action) => (
            <button
              key={action.id}
              className={menuButtonClass}
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                void handleTrigger(action);
              }}
              disabled={busy}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
