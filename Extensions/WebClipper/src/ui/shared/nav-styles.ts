export function navGroupTitleClassName(): string {
  return 'tw-px-3 tw-pb-1.5 tw-text-[10px] tw-font-black tw-uppercase tw-tracking-[0.16em] tw-text-[var(--muted)] tw-opacity-65';
}

export function navItemClassName(active: boolean): string {
  const base =
    'tw-flex tw-min-h-9 tw-w-full tw-appearance-none tw-items-center tw-rounded-xl tw-border-0 tw-px-3 tw-text-left tw-shadow-none tw-transition-colors tw-duration-150';
  if (active) return `${base} tw-bg-[var(--btn-bg)] tw-text-[var(--text)]`;
  return `${base} tw-bg-transparent tw-text-[var(--muted)] hover:tw-bg-white/38 hover:tw-text-[var(--text)]`;
}

export function navIconButtonClassName(active: boolean): string {
  const base =
    'tw-inline-flex tw-size-9 tw-appearance-none tw-items-center tw-justify-center tw-rounded-xl tw-border-0 tw-p-0 tw-shadow-none tw-transition-colors tw-duration-150';
  if (active) return `${base} tw-bg-[var(--btn-bg)] tw-text-[var(--text)]`;
  return `${base} tw-bg-white/25 tw-text-[var(--muted)] hover:tw-bg-white/38 hover:tw-text-[var(--text)]`;
}

export function navIconButtonSmClassName(active: boolean): string {
  const base =
    'tw-inline-flex tw-size-8 tw-appearance-none tw-items-center tw-justify-center tw-rounded-lg tw-border-0 tw-p-0 tw-shadow-none tw-transition-colors tw-duration-150';
  if (active) return `${base} tw-bg-[var(--btn-bg)] tw-text-[var(--text)]`;
  return `${base} tw-bg-white/25 tw-text-[var(--muted)] hover:tw-bg-white/38 hover:tw-text-[var(--text)]`;
}

export function navPillButtonClassName(): string {
  return [
    'tw-inline-flex tw-h-8 tw-max-w-[168px] tw-appearance-none tw-items-center tw-justify-center tw-rounded-lg tw-border-0 tw-bg-[var(--btn-bg)] tw-px-3',
    'tw-text-[11px] tw-font-black tw-text-[var(--text)] tw-shadow-none tw-transition-colors tw-duration-150 hover:tw-bg-[var(--btn-bg-hover)]',
    'disabled:tw-cursor-not-allowed disabled:tw-bg-white/30 disabled:tw-text-[var(--muted)] disabled:tw-opacity-80',
  ].join(' ');
}

export function navMiniIconButtonClassName(disabled = false): string {
  const base =
    'tw-inline-flex tw-size-[18px] tw-appearance-none tw-items-center tw-justify-center tw-rounded-full tw-border-0 tw-bg-white/22 tw-text-[12px] tw-font-black tw-shadow-none tw-transition-colors tw-duration-150';
  if (disabled) return `${base} tw-cursor-not-allowed tw-opacity-40`;
  return `${base} tw-text-[var(--muted)] hover:tw-bg-white/36 hover:tw-text-[var(--text)]`;
}
