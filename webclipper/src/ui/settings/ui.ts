import { buttonDangerTintClassName, buttonFilledClassName, buttonTintClassName } from '@ui/shared/button-styles';

export const cardClassName =
  'tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-p-3 tw-shadow-[0_8px_20px_rgb(93_63_35_/_0.08)]';

export const buttonClassName = buttonTintClassName();

export const primaryButtonClassName = buttonFilledClassName();

export const dangerButtonClassName = buttonDangerTintClassName();

export const textInputClassName =
  'tw-min-h-9 tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-sunken)] tw-px-2.5 tw-text-sm tw-text-[var(--text-primary)] tw-transition-colors tw-duration-150 hover:tw-bg-[var(--bg-primary)] focus-visible:tw-border-[var(--focus-ring)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)] disabled:tw-cursor-not-allowed disabled:tw-opacity-[0.38]';

export const checkboxClassName =
  'tw-size-[18px] tw-cursor-pointer tw-accent-[var(--accent)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)] disabled:tw-cursor-not-allowed disabled:tw-opacity-[0.38]';
