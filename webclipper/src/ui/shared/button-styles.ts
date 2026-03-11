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
