export function buttonTintClassName(): string {
  return [
    'tw-inline-flex tw-min-h-9 tw-appearance-none tw-cursor-pointer tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border)] tw-px-3',
    'tw-bg-[var(--bg-card)] tw-text-xs tw-font-extrabold tw-text-[var(--text-primary)] tw-shadow-none',
    'tw-transition-colors tw-duration-200 hover:tw-bg-[var(--bg-sunken)]',
    'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
    'disabled:tw-cursor-not-allowed disabled:tw-opacity-[0.38]',
  ].join(' ');
}

export function buttonFilledClassName(): string {
  return [
    'tw-inline-flex tw-min-h-9 tw-appearance-none tw-cursor-pointer tw-items-center tw-justify-center tw-rounded-xl tw-border-0 tw-px-3',
    'tw-bg-[var(--accent)] tw-text-xs tw-font-extrabold tw-text-[var(--accent-foreground)] tw-shadow-none',
    'tw-transition-colors tw-duration-200 hover:tw-bg-[var(--accent-hover)] active:tw-bg-[var(--accent-active)]',
    'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
    'disabled:tw-cursor-not-allowed disabled:tw-opacity-[0.38]',
  ].join(' ');
}

export function buttonDangerClassName(): string {
  return [
    'tw-inline-flex tw-min-h-9 tw-appearance-none tw-cursor-pointer tw-items-center tw-justify-center tw-rounded-xl tw-border-0 tw-px-3',
    'tw-bg-[var(--error)] tw-text-xs tw-font-extrabold tw-text-[var(--error-foreground)] tw-shadow-none',
    'tw-transition-opacity tw-duration-200 hover:tw-opacity-90 active:tw-opacity-80',
    'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
    'disabled:tw-cursor-not-allowed disabled:tw-opacity-[0.38]',
  ].join(' ');
}

export function buttonDangerTintClassName(): string {
  return [
    'tw-inline-flex tw-min-h-9 tw-appearance-none tw-cursor-pointer tw-items-center tw-justify-center tw-rounded-xl tw-border tw-px-3',
    'tw-border-[color-mix(in_srgb,var(--error)_55%,var(--border))] tw-bg-[var(--bg-card)] tw-text-xs tw-font-extrabold tw-text-[var(--error)] tw-shadow-none',
    'tw-transition-colors tw-duration-200 hover:tw-bg-[var(--bg-sunken)] active:tw-bg-[var(--bg-sunken)]',
    'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
    'disabled:tw-cursor-not-allowed disabled:tw-opacity-[0.38]',
  ].join(' ');
}

export function buttonMenuItemClassName(): string {
  return [
    'tw-w-full tw-cursor-pointer tw-appearance-none tw-rounded-[11px] tw-border tw-border-transparent tw-bg-transparent tw-px-2.5 tw-py-2',
    'tw-text-left tw-text-xs tw-font-semibold tw-text-[var(--text-primary)]',
    'tw-transition-colors tw-duration-150 hover:tw-border-[var(--border)] hover:tw-bg-[var(--bg-sunken)]',
    'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
    'disabled:tw-cursor-not-allowed disabled:tw-opacity-[0.38] disabled:hover:tw-border-transparent disabled:hover:tw-bg-transparent',
  ].join(' ');
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
    'tw-ml-1 tw-text-[12px] tw-font-black tw-leading-none tw-text-[var(--text-secondary)]',
  ].join(' ');
}

export function buttonIconCircleCardClassName(): string {
  return [
    'tw-inline-flex tw-size-7 tw-cursor-pointer tw-appearance-none tw-items-center tw-justify-center tw-rounded-full tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)]',
    'tw-text-[11px] tw-font-black tw-text-[var(--text-secondary)]',
    'tw-shadow-none tw-transition-colors tw-duration-150 hover:tw-bg-[var(--bg-sunken)]',
    'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
    'disabled:tw-cursor-not-allowed disabled:tw-opacity-[0.38]',
  ].join(' ');
}

export function buttonIconCircleGhostClassName(): string {
  return [
    'tw-inline-flex tw-size-6 tw-cursor-pointer tw-appearance-none tw-items-center tw-justify-center tw-rounded-full tw-border-0 tw-bg-transparent tw-p-0',
    'tw-text-[var(--text-secondary)] tw-shadow-none',
    'tw-transition-colors tw-duration-200 hover:tw-bg-[var(--bg-sunken)] hover:tw-text-[var(--text-primary)]',
    'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
    'disabled:tw-cursor-not-allowed disabled:tw-opacity-[0.38]',
  ].join(' ');
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
