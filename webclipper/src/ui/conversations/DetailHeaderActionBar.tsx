import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BookOpen, ExternalLink, FileText, ImageDown, Link2Off } from 'lucide-react';

import type { DetailHeaderAction } from '@services/integrations/detail-header-actions';
import { t } from '@i18n';
import { buttonMenuItemClassName } from '@ui/shared/button-styles';
import { MenuPopover } from '@ui/shared/MenuPopover';
import { tooltipAttrs } from '@ui/shared/AppTooltip';

export type DetailHeaderActionBarProps = {
  actions: DetailHeaderAction[];
  buttonClassName: string;
  iconOnly?: boolean;
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

  if (actions.length === 1) {
    const action = actions[0]!;
    const buttonLabel = labelOverride || action.label;
    const icon = resolveActionIcon(action);
    const resolvedTriggerIcon =
      triggerIcon ||
      (iconOnly ? <ExternalLink size={16} strokeWidth={2} aria-hidden="true" /> : icon) ||
      <ExternalLink size={16} strokeWidth={2} aria-hidden="true" />;
    const triggerButtonClassName = iconOnly
      ? [buttonClassName, 'webclipper-btn--icon'].join(' ')
      : buttonClassName;
    return (
      <div className={className || 'tw-flex tw-items-center tw-gap-2'}>
        <button
          key={action.id}
          type="button"
          {...tooltipAttrs(action.label)}
          onClick={() => {
            void handleTrigger(action);
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
              <span className="tw-hidden md:tw-inline tw-whitespace-nowrap">{buttonLabel}</span>
            </span>
          )}
        </button>
      </div>
    );
  }

  const resolvedMenuTriggerLabel = String(menuTriggerLabel || '').trim() || 'Open in...';
  const resolvedMenuTriggerAriaLabel = String(menuTriggerAriaLabel || '').trim() || 'Open destinations';
  const resolvedMenuAriaLabel = String(menuAriaLabel || '').trim() || resolvedMenuTriggerAriaLabel;
  const triggerLabel = labelOverride || resolvedMenuTriggerLabel;
  const primaryIcon = resolveActionIcon(actions[0]!);
  const resolvedTriggerIcon =
    triggerIcon ||
    (iconOnly ? <ExternalLink size={16} strokeWidth={2} aria-hidden="true" /> : primaryIcon) ||
    <ExternalLink size={16} strokeWidth={2} aria-hidden="true" />;
  const triggerButtonClassName = iconOnly
    ? [buttonClassName, 'webclipper-btn--icon'].join(' ')
    : buttonClassName;

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
                  <span className="tw-hidden md:tw-inline tw-whitespace-nowrap tw-leading-none">{triggerLabel}</span>
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
