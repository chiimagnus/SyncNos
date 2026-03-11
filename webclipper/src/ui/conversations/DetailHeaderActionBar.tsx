import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Link2Off, Sparkles } from 'lucide-react';

import type { DetailHeaderAction } from '../../integrations/detail-header-actions';
import { buttonMenuItemClassName } from '../shared/button-styles';
import { MenuPopover } from '../shared/MenuPopover';

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
  const labelResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTrigger = async (action: DetailHeaderAction) => {
    if (busy || action.disabled) return;
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

  if (!actions.length) return null;

  const resolveActionIcon = (action: DetailHeaderAction) => {
    if (action.slot === 'chat-with') return <Sparkles size={14} strokeWidth={2} aria-hidden="true" />;
    if (action.provider === 'obsidian' && action.disabled) return <Link2Off size={14} strokeWidth={2} aria-hidden="true" />;
    if (action.kind === 'external-link') return <ExternalLink size={14} strokeWidth={2} aria-hidden="true" />;
    return null;
  };

  if (actions.length === 1) {
    const action = actions[0]!;
    const buttonLabel = labelOverride || action.label;
    const icon = resolveActionIcon(action);
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
          aria-disabled={action.disabled ? 'true' : undefined}
          disabled={busy || !!action.disabled}
        >
          <span className="tw-inline-flex tw-items-center tw-gap-1.5">
            {icon}
            <span className="tw-hidden md:tw-inline">{buttonLabel}</span>
          </span>
        </button>
      </div>
    );
  }

  const resolvedMenuTriggerLabel = String(menuTriggerLabel || '').trim() || 'Open in...';
  const resolvedMenuTriggerTitle = String(menuTriggerTitle || '').trim() || resolvedMenuTriggerLabel;
  const resolvedMenuTriggerAriaLabel = String(menuTriggerAriaLabel || '').trim() || 'Open destinations';
  const resolvedMenuAriaLabel = String(menuAriaLabel || '').trim() || resolvedMenuTriggerAriaLabel;
  const triggerLabel = labelOverride || resolvedMenuTriggerLabel;
  const primaryIcon = resolveActionIcon(actions[0]!);

  const menuButtonClass = buttonMenuItemClassName();

  return (
    <div className={className || 'tw-flex tw-items-center tw-gap-2'}>
      <MenuPopover
        open={menuOpen}
        onOpenChange={setMenuOpen}
        disabled={busy}
        ariaLabel={resolvedMenuAriaLabel}
        side="bottom"
        align="end"
        panelMinWidth={170}
        trigger={(triggerProps) => (
          <button
            {...triggerProps}
            title={resolvedMenuTriggerTitle}
            aria-label={resolvedMenuTriggerAriaLabel}
            className={buttonClassName}
          >
            <span className="tw-inline-flex tw-items-center tw-gap-1.5">
              {primaryIcon}
              <span className="tw-hidden md:tw-inline tw-leading-none">{triggerLabel}</span>
            </span>
            <span
              className="tw-ml-1 tw-w-[14px] tw-text-center tw-text-[12px] tw-font-black tw-leading-none tw-text-[var(--text-secondary)]"
              aria-hidden="true"
            >
              ▾
            </span>
          </button>
        )}
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
            aria-disabled={action.disabled ? 'true' : undefined}
            disabled={busy || !!action.disabled}
          >
            {action.label}
          </button>
        ))}
      </MenuPopover>
    </div>
  );
}
