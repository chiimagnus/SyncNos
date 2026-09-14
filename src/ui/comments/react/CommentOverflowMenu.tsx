import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type Ref } from 'react';

export type CommentOverflowAction = {
  id: string;
  label: string;
  disabled?: boolean;
  destructive?: boolean;
  confirm?: boolean;
};

type CommentOverflowMenuProps = {
  targetLabel: string;
  open: boolean;
  disabled?: boolean;
  actions: readonly CommentOverflowAction[];
  triggerClassName?: string;
  triggerRef?: Ref<HTMLButtonElement>;
  menuClassName?: string;
  onToggle: () => void;
  onAction: (action: CommentOverflowAction) => void | Promise<void>;
};

function assignButtonRef(ref: Ref<HTMLButtonElement> | undefined, node: HTMLButtonElement | null) {
  if (typeof ref === 'function') ref(node);
  else if (ref) ref.current = node;
}

export function CommentOverflowMenu({
  targetLabel,
  open,
  disabled = false,
  actions,
  triggerClassName = '',
  triggerRef,
  menuClassName = '',
  onToggle,
  onAction,
}: CommentOverflowMenuProps) {
  const reactId = useId();
  const menuId = `webclipper-comment-menu-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const menuRef = useRef<HTMLDivElement | null>(null);

  const setTriggerRef = (node: HTMLButtonElement | null) => {
    assignButtonRef(triggerRef, node);
  };

  useEffect(() => {
    if (!open) return;
    const firstItem = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    firstItem?.focus();
  }, [open]);

  const focusRelativeItem = (event: ReactKeyboardEvent<HTMLDivElement>, delta: 1 | -1) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') || [],
    );
    if (!items.length) return;
    const currentIndex = items.indexOf(event.target as HTMLButtonElement);
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + delta + items.length) % items.length;
    event.preventDefault();
    items[nextIndex]?.focus();
  };

  return (
    <div className="webclipper-inpage-comments-panel__overflow" data-open={open ? '1' : undefined}>
      <button
        ref={setTriggerRef}
        type="button"
        className={`webclipper-inpage-comments-panel__overflow-trigger webclipper-btn webclipper-btn--icon ${triggerClassName}`.trim()}
        aria-label={targetLabel}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open ? 'true' : 'false'}
        disabled={disabled}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          if (!open) onToggle();
          else menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="3.25" cy="8" r="1.15" fill="currentColor" />
          <circle cx="8" cy="8" r="1.15" fill="currentColor" />
          <circle cx="12.75" cy="8" r="1.15" fill="currentColor" />
        </svg>
      </button>
      <div
        ref={menuRef}
        id={menuId}
        className={`webclipper-inpage-comments-panel__overflow-menu ${menuClassName}`.trim()}
        role="menu"
        aria-label={targetLabel}
        hidden={!open}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') focusRelativeItem(event, 1);
          if (event.key === 'ArrowUp') focusRelativeItem(event, -1);
          if (event.key === 'Home') {
            event.preventDefault();
            menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
          }
          if (event.key === 'End') {
            event.preventDefault();
            const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
            items?.[items.length - 1]?.focus();
          }
        }}
      >
        <div className="webclipper-inpage-comments-panel__overflow-menu-body">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              className={`webclipper-inpage-comments-panel__overflow-menu-item webclipper-btn webclipper-btn--menu-item${
                action.destructive ? ' webclipper-btn--danger-tint' : ''
              }${action.confirm ? ' webclipper-btn--danger' : ''}`}
              disabled={Boolean(action.disabled)}
              data-confirm={action.confirm ? '1' : undefined}
              data-destructive={action.destructive ? '1' : undefined}
              onClick={() => void onAction(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
