import type { CSSProperties } from 'react';

export const cardClassName = 'tw-rounded-2xl tw-border tw-border-[var(--border)] tw-bg-white/80 tw-p-3';

export const buttonClassName =
  'tw-inline-flex tw-min-h-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-px-3 tw-text-xs tw-font-bold tw-text-[var(--text)] tw-transition-colors tw-duration-200 hover:tw-bg-[var(--btn-bg-hover)] disabled:tw-cursor-not-allowed disabled:tw-opacity-60';

export const primaryButtonClassName =
  'tw-inline-flex tw-min-h-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--text)] tw-bg-[var(--text)] tw-px-3 tw-text-xs tw-font-bold tw-text-white tw-transition-colors tw-duration-200 hover:tw-bg-[#c94f20] disabled:tw-cursor-not-allowed disabled:tw-opacity-60';

export const textInputClassName =
  'tw-min-h-9 tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white tw-px-2.5 tw-text-sm tw-text-[var(--text)]';

export const selectClassName =
  'tw-min-h-9 tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white tw-px-2.5 tw-text-sm tw-text-[var(--text)] focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-[var(--text)]';

export const checkboxClassName = 'tw-size-[18px] tw-cursor-pointer tw-accent-[var(--text)]';

export const buttonStyle: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid var(--border-strong)',
  background: 'var(--btn-bg)',
  color: 'var(--text)',
  fontWeight: 700,
  cursor: 'pointer',
};

export const cardStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 16,
  background: 'rgba(255, 255, 255, 0.8)',
  padding: 12,
};

