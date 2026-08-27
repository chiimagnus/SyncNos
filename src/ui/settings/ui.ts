import { buttonDangerTintClassName, buttonFilledClassName, buttonTintClassName } from '@ui/shared/button-styles';

export const cardClassName =
  'tw-rounded-[var(--radius-card)] tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-p-3 tw-shadow-[var(--card-shadow)]';

export const buttonClassName = buttonTintClassName();

export const primaryButtonClassName = buttonFilledClassName();

export const dangerButtonClassName = buttonDangerTintClassName();

export const textInputClassName = 'webclipper-field tw-min-h-9 tw-px-2.5 tw-text-sm tw-text-[var(--text-primary)]';

export const checkboxClassName =
  'tw-size-[18px] tw-cursor-pointer tw-accent-[var(--accent)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-offset-2 focus-visible:tw-outline-[var(--focus-ring)] disabled:tw-cursor-not-allowed disabled:tw-opacity-[0.38]';
