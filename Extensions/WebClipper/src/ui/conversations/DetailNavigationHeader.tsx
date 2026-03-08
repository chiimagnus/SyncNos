import { ChevronLeft } from 'lucide-react';

import { t } from '../../i18n';
import type { DetailHeaderAction } from './detail-header-actions';
import { DetailHeaderActionBar } from './DetailHeaderActionBar';

export type DetailNavigationHeaderProps = {
  title: string;
  subtitle?: string;
  actions: DetailHeaderAction[];
  onBack: () => void;
};

const backButtonClass =
  'tw-inline-flex tw-size-9 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white/70 tw-text-[var(--muted)] tw-transition-colors tw-duration-200 hover:tw-border-[var(--border-strong)] hover:tw-text-[var(--text)]';
const headerActionButtonClass =
  'tw-inline-flex tw-h-8 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-lg tw-border tw-border-[var(--border)] tw-bg-white/72 tw-px-3 tw-text-[11px] tw-font-black tw-text-[var(--text)] tw-transition-colors tw-duration-200 hover:tw-border-[var(--border-strong)]';

export function DetailNavigationHeader({ title, subtitle, actions, onBack }: DetailNavigationHeaderProps) {
  return (
    <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
      <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-2">
        <button
          type="button"
          onClick={onBack}
          className={backButtonClass}
          aria-label={t('backToChatsAria')}
        >
          <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
        </button>

        <div className="tw-min-w-0 tw-flex-1">
          <div className="tw-truncate tw-text-[13px] tw-font-black tw-tracking-[-0.01em] tw-text-[var(--text)]">
            {title}
          </div>
          {subtitle ? (
            <div className="tw-truncate tw-text-[11px] tw-font-semibold tw-text-[var(--muted)] tw-opacity-90">
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>

      <DetailHeaderActionBar
        actions={actions}
        buttonClassName={headerActionButtonClass}
        className="tw-flex tw-shrink-0 tw-items-center tw-gap-2"
      />
    </div>
  );
}
