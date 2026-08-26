import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BookOpen, Copy, ExternalLink, FileText, ImageDown, Link2Off } from 'lucide-react';

import type { DetailHeaderAction } from '@services/integrations/detail-header-actions';
import { t } from '@i18n';
import { buttonMenuItemClassName } from '@ui/shared/button-styles';
import { MenuPopover } from '@ui/shared/MenuPopover';
import { tooltipAttrs } from '@ui/shared/AppTooltip';

export type DetailHeaderActionBarProps = {
  actions: DetailHeaderAction[];
  buttonClassName: string;
  iconOnly?: boolean;
  showLabelAlways?: boolean;
  closeMenuOnActionTrigger?: () => void;
  inlineMenuItems?: boolean;
  triggerIcon?: ReactNode;
  menuTriggerLabel?: string;
  menuTriggerAriaLabel?: string;
  menuAriaLabel?: string;
  className?: string;
};

export function DetailHeaderActionBar({
  actions,
  buttonClassName,
  iconOnly = false,
  showLabelAlways = false,
  closeMenuOnActionTrigger,
  inlineMenuItems = false,
  triggerIcon,
  menuTriggerLabel,
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
    if (labelResetTimerRef.current != null) globalThis.clearTimeout(labelResetTimerRef.current);
    labelResetTimerRef.current = null;
    setLabelOverride('');
    setBusy(true);
    try {
      await action.onTrigger();
      if (action.afterTriggerLabel) {
        setLabelOverride(String(action.afterTriggerLabel));
        if (labelResetTimerRef.current != null) globalThis.clearTimeout(labelResetTimerRef.current);
        const customDuration = Number(action.afterTriggerLabelDurationMs);
        const durationMs = Number.isFinite(customDuration) ? Math.max(0, Math.floor(customDuration)) : 2_600;
        if (durationMs > 0) {
          labelResetTimerRef.current = globalThis.setTimeout(() => {
            setLabelOverride('');
            labelResetTimerRef.current = null;
          }, durationMs);
        } else {
          labelResetTimerRef.current = null;
        }
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : String(error || t('actionFailedFallback'));
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
    if (action.kind === 'copy-text') return <Copy size={16} strokeWidth={2} aria-hidden="true" />;
    if (action.provider === 'source' && action.kind === 'external-link')
      return <ExternalLink size={16} strokeWidth={2} aria-hidden="true" />;
    if (action.slot === 'tools') return <ImageDown size={16} strokeWidth={2} aria-hidden="true" />;
    if (action.provider === 'obsidian' && action.disabled)
      return <Link2Off size={16} strokeWidth={2} aria-hidden="true" />;
    if (action.kind === 'open-target' && action.provider === 'obsidian')
      return <BookOpen size={16} strokeWidth={2} aria-hidden="true" />;
    if (action.kind === 'open-target' && action.provider === 'notion')
      return <FileText size={16} strokeWidth={2} aria-hidden="true" />;
    if (action.kind === 'external-link') return <ExternalLink size={16} strokeWidth={2} aria-hidden="true" />;
    return null;
  };

  if (inlineMenuItems) {
    return (
      <div className={['tw-flex tw-flex-col tw-gap-1', className || ''].join(' ').trim()}>
        {actions.map((action) => (
          <button
            key={action.id}
            className={buttonClassName}
            type="button"
            role="menuitem"
            aria-label={action.label}
            aria-disabled={action.disabled ? 'true' : undefined}
            disabled={busy || !!action.disabled}
            onClick={() => {
              void handleTrigger(action);
              closeMenuOnActionTrigger?.();
            }}
          >
            <span className="tw-inline-flex tw-items-center tw-gap-1.5">
              {resolveActionIcon(action)}
              <span className="tw-whitespace-normal tw-break-words">{action.label}</span>
            </span>
          </button>
        ))}
      </div>
    );
  }

  const iconOnlyStatus =
    iconOnly && labelOverride ? (
      <span
        role="status"
        aria-live="polite"
        className="tw-absolute tw-right-0 tw-top-[calc(100%+6px)] tw-z-10 tw-whitespace-nowrap tw-rounded-[var(--radius-control)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-px-2 tw-py-1 tw-text-[11px] tw-font-semibold tw-text-[var(--text-primary)] tw-shadow-[0_8px_24px_rgba(0,0,0,0.14)]"
      >
        {labelOverride}
      </span>
    ) : null;

  if (actions.length === 1) {
    const action = actions[0]!;
    const buttonLabel = busy ? String(action.busyLabel || action.label) : labelOverride || action.label;
    const icon = resolveActionIcon(action);
    const resolvedTriggerIcon = triggerIcon ||
      (iconOnly ? <ExternalLink size={16} strokeWidth={2} aria-hidden="true" /> : icon) || (
        <ExternalLink size={16} strokeWidth={2} aria-hidden="true" />
      );
    const triggerButtonClassName = iconOnly ? buttonClassName : [buttonClassName, 'tw-text-[13px]'].join(' ');
    return (
      <div
        className={[iconOnly ? 'tw-relative' : '', 'tw-flex tw-items-center tw-gap-2', className || '']
          .filter(Boolean)
          .join(' ')}
      >
        <button
          key={action.id}
          type="button"
          {...tooltipAttrs(action.label)}
          onClick={() => {
            void handleTrigger(action);
            closeMenuOnActionTrigger?.();
          }}
          className={triggerButtonClassName}
          aria-label={action.label}
          aria-disabled={action.disabled ? 'true' : undefined}
          disabled={busy || !!action.disabled}
        >
          {iconOnly ? (
            <span className="tw-inline-flex tw-items-center tw-justify-center">{resolvedTriggerIcon}</span>
          ) : (
            <span className="tw-inline-flex tw-items-center tw-gap-1.5">
              {resolvedTriggerIcon}
              <span
                className={showLabelAlways ? 'tw-whitespace-nowrap' : 'tw-hidden md:tw-inline tw-whitespace-nowrap'}
              >
                {buttonLabel}
              </span>
              {busy && action.showBusyProgress ? (
                <span
                  className={
                    showLabelAlways
                      ? 'tw-inline-flex tw-h-1.5 tw-w-14 tw-overflow-hidden tw-rounded-full tw-bg-[var(--bg-sunken)]'
                      : 'tw-hidden md:tw-inline-flex tw-h-1.5 tw-w-14 tw-overflow-hidden tw-rounded-full tw-bg-[var(--bg-sunken)]'
                  }
                  aria-hidden="true"
                >
                  <span className="tw-h-full tw-w-1/2 tw-animate-pulse tw-rounded-full tw-bg-[var(--accent)]" />
                </span>
              ) : null}
            </span>
          )}
        </button>
        {iconOnlyStatus}
      </div>
    );
  }

  const resolvedMenuTriggerLabel = String(menuTriggerLabel || '').trim() || 'Open in...';
  const resolvedMenuTriggerAriaLabel = String(menuTriggerAriaLabel || '').trim() || 'Open destinations';
  const resolvedMenuAriaLabel = String(menuAriaLabel || '').trim() || resolvedMenuTriggerAriaLabel;
  const triggerLabel = labelOverride || resolvedMenuTriggerLabel;
  const primaryIcon = resolveActionIcon(actions[0]!);
  const resolvedTriggerIcon = triggerIcon ||
    (iconOnly ? <ExternalLink size={16} strokeWidth={2} aria-hidden="true" /> : primaryIcon) || (
      <ExternalLink size={16} strokeWidth={2} aria-hidden="true" />
    );
  const triggerButtonClassName = iconOnly ? buttonClassName : [buttonClassName, 'tw-text-[13px]'].join(' ');

  const menuButtonClass = buttonMenuItemClassName();

  return (
    <div
      className={[iconOnly ? 'tw-relative' : '', 'tw-flex tw-items-center tw-gap-2', className || '']
        .filter(Boolean)
        .join(' ')}
    >
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
            {...tooltipAttrs(resolvedMenuTriggerLabel)}
            aria-label={resolvedMenuTriggerAriaLabel}
            className={triggerButtonClassName}
          >
            {iconOnly ? (
              <span className="tw-inline-flex tw-items-center tw-justify-center">{resolvedTriggerIcon}</span>
            ) : (
              <>
                <span className="tw-inline-flex tw-items-center tw-gap-1.5">
                  {resolvedTriggerIcon}
                  <span
                    className={
                      showLabelAlways
                        ? 'tw-whitespace-nowrap tw-leading-none'
                        : 'tw-hidden md:tw-inline tw-whitespace-nowrap tw-leading-none'
                    }
                  >
                    {triggerLabel}
                  </span>
                </span>
                <span
                  className="tw-ml-1 tw-w-[14px] tw-text-center tw-text-[12px] tw-font-black tw-leading-none tw-text-[var(--text-secondary)]"
                  aria-hidden="true"
                >
                  ▾
                </span>
              </>
            )}
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
              void handleTrigger(action);
              setMenuOpen(false);
              closeMenuOnActionTrigger?.();
            }}
            aria-disabled={action.disabled ? 'true' : undefined}
            disabled={busy || !!action.disabled}
          >
            {action.label}
          </button>
        ))}
      </MenuPopover>
      {iconOnlyStatus}
    </div>
  );
}
