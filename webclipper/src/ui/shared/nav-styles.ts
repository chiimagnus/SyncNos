import { buttonTintClassName } from './button-styles';

export function navGroupTitleClassName(): string {
  return 'tw-px-3 tw-pb-1.5 tw-text-[11px] tw-font-bold tw-text-[var(--text-secondary)] tw-opacity-70';
}

export function navItemClassName(active: boolean): string {
  const base =
    [
      // Match `src/ui/example.html` sidebar item: 8px 12px padding, 6px radius, 13px text.
      'tw-flex tw-min-h-9 tw-w-full tw-cursor-pointer tw-appearance-none tw-items-center tw-gap-2 tw-rounded-md tw-border-0 tw-px-3 tw-py-2 tw-text-left tw-text-[13px] tw-shadow-none',
      'tw-transition-colors tw-duration-150',
      'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
    ].join(' ');
  if (active) return `${base} tw-bg-[var(--accent)] tw-text-[var(--accent-foreground)] tw-font-semibold`;
  return `${base} tw-bg-transparent tw-text-[var(--text-secondary)] hover:tw-bg-[var(--bg-card)] hover:tw-text-[var(--text-primary)]`;
}

export function navIconButtonClassName(active: boolean): string {
  if (active) return 'webclipper-btn webclipper-btn--icon';
  return 'webclipper-btn webclipper-btn--icon webclipper-btn--tone-muted';
}

export function navIconButtonSmClassName(active: boolean): string {
  if (active) return 'webclipper-btn webclipper-btn--icon webclipper-btn--icon-sm';
  return 'webclipper-btn webclipper-btn--icon webclipper-btn--icon-sm webclipper-btn--tone-muted';
}

export function navPillButtonClassName(): string {
  return [buttonTintClassName(), 'tw-max-w-[168px]'].join(' ');
}
