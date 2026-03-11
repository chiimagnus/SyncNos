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
  const base =
    [
      'tw-inline-flex tw-size-9 tw-cursor-pointer tw-appearance-none tw-items-center tw-justify-center tw-rounded-xl tw-border-0 tw-p-0',
      'tw-shadow-none tw-transition-colors tw-duration-150',
      'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
      'disabled:tw-cursor-not-allowed disabled:tw-opacity-[0.38]',
    ].join(' ');
  if (active) return `${base} tw-bg-[var(--accent)] tw-text-[var(--accent-foreground)]`;
  return `${base} tw-bg-[var(--bg-card)] tw-text-[var(--text-secondary)] hover:tw-bg-[var(--bg-sunken)] hover:tw-text-[var(--text-primary)]`;
}

export function navIconButtonSmClassName(active: boolean): string {
  const base =
    [
      'tw-inline-flex tw-size-8 tw-cursor-pointer tw-appearance-none tw-items-center tw-justify-center tw-rounded-lg tw-border-0 tw-p-0',
      'tw-shadow-none tw-transition-colors tw-duration-150',
      'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
      'disabled:tw-cursor-not-allowed disabled:tw-opacity-[0.38]',
    ].join(' ');
  if (active) return `${base} tw-bg-[var(--accent)] tw-text-[var(--accent-foreground)]`;
  return `${base} tw-bg-[var(--bg-card)] tw-text-[var(--text-secondary)] hover:tw-bg-[var(--bg-sunken)] hover:tw-text-[var(--text-primary)]`;
}

export function navPillButtonClassName(): string {
  return [
    'tw-inline-flex tw-h-8 tw-max-w-[168px] tw-appearance-none tw-items-center tw-justify-center tw-rounded-lg tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-px-3',
    'tw-text-[11px] tw-font-black tw-text-[var(--text-primary)] tw-shadow-none tw-transition-colors tw-duration-150 hover:tw-bg-[var(--bg-sunken)]',
    'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)]',
    'disabled:tw-cursor-not-allowed disabled:tw-opacity-[0.38]',
  ].join(' ');
}
