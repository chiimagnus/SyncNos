import { buttonFilledClassName, buttonTintClassName } from '../shared/button-styles';

export const cardClassName = 'tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-white/80 tw-p-3';

export const buttonClassName = buttonTintClassName();

export const primaryButtonClassName = buttonFilledClassName();

export const textInputClassName =
  'tw-min-h-9 tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white tw-px-2.5 tw-text-sm tw-text-[var(--text)]';

export const selectClassName =
  'tw-min-h-9 tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white tw-px-2.5 tw-text-sm tw-text-[var(--text)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-[var(--text)]';

export const checkboxClassName = 'tw-size-[18px] tw-cursor-pointer tw-accent-[var(--text)]';
