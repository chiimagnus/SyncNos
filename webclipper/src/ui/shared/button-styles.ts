export function buttonTintClassName(): string {
  return [
    'tw-inline-flex tw-min-h-9 tw-appearance-none tw-cursor-pointer tw-items-center tw-justify-center tw-rounded-xl tw-border-0 tw-px-3',
    'tw-bg-[var(--btn-bg)] tw-text-xs tw-font-extrabold tw-text-[var(--text)] tw-shadow-none',
    'tw-transition-colors tw-duration-200 hover:tw-bg-[var(--btn-bg-hover)]',
    'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-[var(--text)]',
    'disabled:tw-cursor-not-allowed disabled:tw-bg-white/30 disabled:tw-text-[var(--muted)] disabled:tw-opacity-80',
  ].join(' ');
}

export function buttonFilledClassName(): string {
  return [
    'tw-inline-flex tw-min-h-9 tw-appearance-none tw-cursor-pointer tw-items-center tw-justify-center tw-rounded-xl tw-border-0 tw-px-3',
    'tw-bg-[var(--text)] tw-text-xs tw-font-extrabold tw-text-white tw-shadow-none',
    'tw-transition-colors tw-duration-200 hover:tw-bg-[#c94f20]',
    'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-[var(--text)]',
    'disabled:tw-cursor-not-allowed disabled:tw-opacity-60',
  ].join(' ');
}

export function buttonDangerClassName(): string {
  return [
    'tw-inline-flex tw-min-h-9 tw-appearance-none tw-cursor-pointer tw-items-center tw-justify-center tw-rounded-xl tw-border-0 tw-px-3',
    'tw-bg-[var(--danger-bg)] tw-text-xs tw-font-extrabold tw-text-[var(--danger)] tw-shadow-none',
    'tw-transition-colors tw-duration-200 hover:tw-bg-[#ffd7d3]',
    'focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-[var(--danger)]',
    'disabled:tw-cursor-not-allowed disabled:tw-opacity-60',
  ].join(' ');
}

