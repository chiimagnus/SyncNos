export function buttonTintClassName(): string {
  return 'webclipper-btn webclipper-btn--tint';
}

export function buttonFilledClassName(): string {
  return 'webclipper-btn webclipper-btn--filled';
}

export function buttonSunkenClassName(): string {
  return 'webclipper-btn webclipper-btn--sunken';
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
      'tw-z-30 tw-rounded-[14px] tw-border tw-border-[var(--border)] tw-p-1.5',
      'tw-bg-[color-mix(in_srgb,var(--bg-card)_88%,transparent)]',
      'tw-backdrop-blur-[10px] tw-backdrop-saturate-150',
      'tw-shadow-[0_18px_48px_rgba(0,0,0,0.18)]',
    ].join(' '),
  ].join(' ');
}

export function menuChevronClassName(): string {
  return [
    'tw-text-[12px] tw-font-black tw-leading-none tw-text-[var(--text-secondary)]',
  ].join(' ');
}

export function buttonIconCircleCardClassName(): string {
  return 'webclipper-btn webclipper-btn--tint webclipper-btn--icon webclipper-btn--icon-xs webclipper-btn--round webclipper-btn--tone-muted';
}

export function buttonIconCircleGhostClassName(): string {
  return 'webclipper-btn webclipper-btn--tint webclipper-btn--icon webclipper-btn--icon-xxs webclipper-btn--round webclipper-btn--tone-muted';
}

export function buttonMiniIconClassName(active: boolean): string {
  const base = [
    'tw-inline-flex tw-size-[18px] tw-cursor-pointer tw-appearance-none tw-items-center tw-justify-center tw-rounded-full tw-border-0 tw-bg-transparent',
    'tw-text-[12px] tw-font-black tw-shadow-none',
    'tw-transition-colors tw-duration-150',
    'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
  ].join(' ');

  const hoverBg = active ? 'hover:tw-bg-[var(--accent-hover)]' : 'hover:tw-bg-[var(--bg-card)]';
  return [
    base,
    'tw-text-[currentColor] tw-opacity-80 hover:tw-opacity-100',
    hoverBg,
    'disabled:tw-cursor-not-allowed disabled:tw-opacity-[0.38] disabled:hover:tw-bg-transparent disabled:hover:tw-opacity-[0.38]',
  ].join(' ');
}
