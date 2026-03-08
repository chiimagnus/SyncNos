import { useEffect, useRef, useState } from 'react';

import type { DetailHeaderAction } from './detail-header-actions';

export type DetailHeaderActionBarProps = {
  actions: DetailHeaderAction[];
  buttonClassName: string;
  className?: string;
};

export function DetailHeaderActionBar({ actions, buttonClassName, className }: DetailHeaderActionBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const handleTrigger = (action: DetailHeaderAction) => {
    action.onTrigger().catch((error) => {
      const message =
        error instanceof Error && error.message ? error.message : String(error || 'Action failed.');
      if (typeof globalThis.window?.alert === 'function') {
        globalThis.window.alert(message);
        return;
      }
      console.error(message);
    });
  };

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
    return (
      <div className={className || 'tw-flex tw-items-center tw-gap-2'}>
        <button
          key={action.id}
          type="button"
          title={action.label}
          onClick={() => {
            handleTrigger(action);
          }}
          className={buttonClassName}
          aria-label={action.label}
        >
          {action.label}
        </button>
      </div>
    );
  }

  const menuButtonClass =
    'tw-w-full tw-rounded-[11px] tw-border tw-border-transparent tw-bg-transparent tw-px-2.5 tw-py-2 tw-text-left tw-text-xs tw-font-semibold tw-text-[var(--text)] tw-transition-colors tw-duration-150 hover:tw-border-[var(--border)] hover:tw-bg-[var(--btn-bg)]';

  return (
    <div ref={wrapRef} className={className || 'tw-flex tw-items-center tw-gap-2'}>
      <div className="tw-relative">
        <button
          type="button"
          title="Open in..."
          aria-label="Open destinations"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => {
            setMenuOpen((value) => !value);
          }}
          className={buttonClassName}
        >
          <span className="tw-leading-none">Open in...</span>
          <span
            className="tw-ml-1 tw-w-[14px] tw-text-center tw-text-[12px] tw-font-black tw-leading-none tw-text-[var(--muted)]"
            aria-hidden="true"
          >
            ▾
          </span>
        </button>

        <div
          role="menu"
          aria-label="Open destinations"
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
                handleTrigger(action);
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
