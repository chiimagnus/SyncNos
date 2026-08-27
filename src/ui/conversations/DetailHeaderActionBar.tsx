import { useEffect, useRef, useState } from 'react';
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
      className={[
        'tw-h-4 tw-w-4 tw-shrink-0 tw-object-contain',
        action.provider === 'notion' ? 'webclipper-provider-logo--notion' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-provider-logo={action.provider}
    />
  );
}

export function DetailHeaderActionBar({
  actions,
  buttonClassName,
  closeMenuOnActionTrigger,
  inlineMenuItems = false,
  menuTriggerLabel,
  menuTriggerAriaLabel,
  menuAriaLabel,
  className,
}: DetailHeaderActionBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [primaryActionId, setPrimaryActionId] = useState('');
  const [copiedActionId, setCopiedActionId] = useState('');
  const [labelOverride, setLabelOverride] = useState<string>('');
  const copiedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const labelResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTrigger = async (action: DetailHeaderAction) => {
    if (busy || action.disabled) return;
    if (copiedResetTimerRef.current != null) globalThis.clearTimeout(copiedResetTimerRef.current);
    copiedResetTimerRef.current = null;
    if (labelResetTimerRef.current != null) globalThis.clearTimeout(labelResetTimerRef.current);
    labelResetTimerRef.current = null;
    setCopiedActionId('');
    setLabelOverride('');
    setPrimaryActionId(action.id);
    setBusy(true);
    try {
      await action.onTrigger();
      if (action.kind === 'copy-text' && !inlineMenuItems) {
        setCopiedActionId(action.id);
        copiedResetTimerRef.current = globalThis.setTimeout(() => {
          setCopiedActionId('');
          copiedResetTimerRef.current = null;
        }, 1_100);
      } else if (action.afterTriggerLabel) {
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
      if (copiedResetTimerRef.current != null) globalThis.clearTimeout(copiedResetTimerRef.current);
      copiedResetTimerRef.current = null;
      if (labelResetTimerRef.current != null) globalThis.clearTimeout(labelResetTimerRef.current);
      labelResetTimerRef.current = null;
    };
  }, []);

  if (!actions.length) return null;

  const copyOnly = actions.every((action) => action.kind === 'copy-text');
  const resolveActionTooltipAttrs = (action: DetailHeaderAction) =>
    action.kind === 'copy-text' ? {} : tooltipAttrs(action.label);

  const resolveActionIcon = (action: DetailHeaderAction) => {
    if (action.kind === 'copy-text' && copiedActionId === action.id) {
      return (
        <span
          className="tw-inline-flex tw-h-4 tw-w-4 tw-items-center tw-justify-center"
          data-detail-header-copy-check={action.id}
          aria-hidden="true"
        >
          ✓
        </span>
      );
    }
    const logo = providerLogo(action);
    if (logo) return logo;
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
              {resolveActionIcon(action)}
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
      className="tw-absolute tw-right-0 tw-top-[calc(100%+6px)] tw-z-10 tw-whitespace-nowrap tw-rounded-[var(--radius-inline)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-px-2 tw-py-1 tw-text-[11px] tw-font-semibold tw-text-[var(--text-primary)] tw-shadow-[0_8px_24px_rgba(0,0,0,0.14)]"
    >
      {labelOverride}
    </span>
  ) : null;
  if (actions.length === 1) {
    const action = actions[0]!;
    const resolvedTriggerIcon = resolveActionIcon(action);
    return (
      <div className={['tw-relative tw-flex tw-items-center tw-gap-2', className || ''].join(' ').trim()}>
        <button
          key={action.id}
          type="button"
          {...resolveActionTooltipAttrs(action)}
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

  const primaryAction = actions.find((action) => action.id === primaryActionId) || actions[0]!;
  const resolvedTriggerIcon = resolveActionIcon(primaryAction);
  const resolvedMenuTriggerLabel = String(menuTriggerLabel || '').trim() || 'Open in...';
  const resolvedMenuTriggerAriaLabel = String(menuTriggerAriaLabel || '').trim() || 'Open destinations';
  const resolvedMenuAriaLabel = String(menuAriaLabel || '').trim() || resolvedMenuTriggerAriaLabel;
  const menuButtonClass = buttonMenuItemClassName();

  return (
    <div className={['tw-relative tw-flex tw-items-center tw-gap-2', className || ''].join(' ').trim()}>
      <div className="detail-header-split-button">
        <button
          key={primaryAction.id}
          type="button"
          {...resolveActionTooltipAttrs(primaryAction)}
          onClick={() => {
            void handleTrigger(primaryAction);
            closeMenuOnActionTrigger?.();
          }}
          className={buttonClassName}
          aria-label={primaryAction.label}
          aria-disabled={primaryAction.disabled ? 'true' : undefined}
          disabled={busy || !!primaryAction.disabled}
        >
          <span className="tw-inline-flex tw-items-center tw-justify-center">{resolvedTriggerIcon}</span>
        </button>
        <MenuPopover
          open={menuOpen}
          onOpenChange={setMenuOpen}
          disabled={busy}
          ariaLabel={resolvedMenuAriaLabel}
          side="bottom"
          align="end"
          panelMinWidth={170}
          className="detail-header-split-button__menu"
          trigger={(triggerProps) => (
            <button
              {...triggerProps}
              {...(copyOnly ? {} : tooltipAttrs(resolvedMenuTriggerLabel))}
              aria-label={resolvedMenuTriggerAriaLabel}
              className={buttonClassName}
            >
              <span
                className="tw-w-[10px] tw-text-center tw-text-[10px] tw-font-black tw-leading-none tw-text-[var(--text-secondary)]"
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
      </div>
      {status}
    </div>
  );
}
