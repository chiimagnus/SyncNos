import { buttonTintClassName } from '@ui/shared/button-styles';

export function navItemClassName(active: boolean): string {
  const base = [
    // Sidebar items use the same inline control radius as the shared button system.
    'tw-flex tw-min-h-9 tw-w-full tw-cursor-pointer tw-appearance-none tw-items-center tw-gap-2 tw-rounded-[var(--radius-inline)] tw-border-0 tw-px-3 tw-py-2 tw-text-left tw-text-[13px] tw-shadow-none',
    'tw-transition-colors tw-duration-150',
    'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
  ].join(' ');
  if (active) return `${base} tw-bg-[var(--accent)] tw-text-[var(--accent-foreground)] tw-font-semibold`;
  return `${base} tw-bg-transparent tw-text-[var(--text-secondary)] hover:tw-bg-[var(--bg-card)] hover:tw-text-[var(--text-primary)]`;
}

export function navPillButtonClassName(): string {
  return [buttonTintClassName(), 'tw-max-w-[168px]'].join(' ');
}
