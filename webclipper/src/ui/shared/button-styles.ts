export function buttonTintClassName(): string {
  return 'webclipper-btn';
}

export function buttonFilledClassName(): string {
  return 'webclipper-btn webclipper-btn--filled';
}

export function buttonDangerClassName(): string {
  return 'webclipper-btn webclipper-btn--danger';
}

export function buttonDangerTintClassName(): string {
  return 'webclipper-btn webclipper-btn--danger-tint';
}

export function buttonMenuItemClassName(): string {
  return 'webclipper-btn webclipper-btn--menu-item';
}

export function menuPopoverPanelClassName(minWidth: 150 | 170): string {
  const width = minWidth === 150 ? 'tw-min-w-[150px]' : 'tw-min-w-[170px]';
  return [
    width,
    [
      'webclipper-menu-popover-panel tw-z-30 tw-border tw-border-[var(--border)] tw-p-1.5',
      'tw-bg-[color-mix(in_srgb,var(--bg-card)_88%,transparent)]',
      'tw-backdrop-blur-[10px] tw-backdrop-saturate-150',
      'tw-shadow-[0_18px_48px_rgba(0,0,0,0.18)]',
    ].join(' '),
  ].join(' ');
}

export function menuChevronClassName(): string {
  return ['tw-text-[12px] tw-font-black tw-leading-none tw-text-[var(--text-secondary)]'].join(' ');
}

export function buttonIconCircleCardClassName(): string {
  return 'webclipper-btn webclipper-btn--icon webclipper-btn--icon-xs webclipper-btn--tone-muted';
}

export function buttonIconCircleGhostClassName(): string {
  return 'webclipper-btn webclipper-btn--icon webclipper-btn--icon-xxs webclipper-btn--tone-muted';
}

export function buttonMiniIconClassName(active: boolean): string {
  if (active) return 'webclipper-btn webclipper-btn--icon webclipper-btn--icon-xxs';
  return 'webclipper-btn webclipper-btn--icon webclipper-btn--icon-xxs webclipper-btn--tone-muted';
}
