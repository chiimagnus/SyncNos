import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Copy, ExternalLink, ImageDown } from 'lucide-react';

import type { DetailHeaderAction } from '@services/integrations/detail-header-actions';
import { t } from '@i18n';
import { buttonMenuItemClassName } from '@ui/shared/button-styles';
import { MenuPopover } from '@ui/shared/MenuPopover';
import { tooltipAttrs } from '@ui/shared/AppTooltip';

export type DetailHeaderActionBarProps = {
  actions: DetailHeaderAction[];
  buttonClassName: string;
  closeMenuOnActionTrigger?: () => void;
  inlineMenuItems?: boolean;
  triggerIcon?: ReactNode;
  menuTriggerLabel?: string;
  menuTriggerAriaLabel?: string;
  menuAriaLabel?: string;
  className?: string;
};

const PROVIDER_LOGO_SRC: Record<string, string> = {
  notion: '/icons/notion.svg',
  obsidian: '/icons/obsidian.svg',
  feishu: '/icons/feishu.svg',
};

function providerLogo(action: DetailHeaderAction) {
  const src = PROVIDER_LOGO_SRC[action.provider];
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      className="tw-h-4 tw-w-4 tw-shrink-0 tw-object-contain"
      data-provider-logo={action.provider}
    />
  );
}

export function DetailHeaderActionBar({
  actions,
  buttonClassName,
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
        labelResetTimerRef.current = globalThis.setTimeout(() => {
          setLabelOverride('');
          labelResetTimerRef.current = null;
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

  const resolveInlineActionIcon = (action: DetailHeaderAction) => {
    if (action.kind === 'copy-text') return <Copy size={16} strokeWidth={2} aria-hidden="true" />;
    if (action.provider === 'source' && action.kind === 'external-link')
      return <ExternalLink size={16} strokeWidth={2} aria-hidden="true" />;
    return <ImageDown size={16} strokeWidth={2} aria-hidden="true" />;
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
              {resolveInlineActionIcon(action)}
              <span className="tw-whitespace-normal tw-break-words">{action.label}</span>
            </span>
          </button>
        ))}
      </div>
    );
  }

  const status = labelOverride ? (
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
    const resolvedTriggerIcon = triggerIcon || providerLogo(action) || (
      <ExternalLink size={16} strokeWidth={2} aria-hidden="true" />
    );
    return (
      <div className={['tw-relative tw-flex tw-items-center tw-gap-2', className || ''].join(' ').trim()}>
        <button
          key={action.id}
          type="button"
          {...tooltipAttrs(action.label)}
          onClick={() => {
            void handleTrigger(action);
            closeMenuOnActionTrigger?.();
          }}
          className={buttonClassName}
          aria-label={action.label}
          aria-disabled={action.disabled ? 'true' : undefined}
          disabled={busy || !!action.disabled}
        >
          <span className="tw-inline-flex tw-items-center tw-justify-center">{resolvedTriggerIcon}</span>
        </button>
        {status}
      </div>
    );
  }

  const resolvedTriggerIcon = triggerIcon || <ExternalLink size={16} strokeWidth={2} aria-hidden="true" />;
  const resolvedMenuTriggerLabel = String(menuTriggerLabel || '').trim() || 'Open in...';
  const resolvedMenuTriggerAriaLabel = String(menuTriggerAriaLabel || '').trim() || 'Open destinations';
  const resolvedMenuAriaLabel = String(menuAriaLabel || '').trim() || resolvedMenuTriggerAriaLabel;
  const menuButtonClass = buttonMenuItemClassName();

  return (
    <div className={['tw-relative tw-flex tw-items-center tw-gap-2', className || ''].join(' ').trim()}>
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
            className={buttonClassName}
          >
            <span className="tw-inline-flex tw-items-center tw-justify-center tw-gap-0.5">
              {resolvedTriggerIcon}
              <span
                className="tw-w-[10px] tw-text-center tw-text-[10px] tw-font-black tw-leading-none tw-text-[var(--text-secondary)]"
                aria-hidden="true"
              >
                ▾
              </span>
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
              void handleTrigger(action);
              setMenuOpen(false);
              closeMenuOnActionTrigger?.();
            }}
            aria-disabled={action.disabled ? 'true' : undefined}
            disabled={busy || !!action.disabled}
          >
            <span className="tw-inline-flex tw-items-center tw-gap-1.5">
              {providerLogo(action)}
              <span className="tw-whitespace-normal tw-break-words">{action.label}</span>
            </span>
          </button>
        ))}
      </MenuPopover>
      {status}
    </div>
  );
}
