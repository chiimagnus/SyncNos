import { ChevronLeft } from 'lucide-react';

import { t } from '../../i18n';
import type { DetailHeaderAction } from '../../integrations/detail-header-actions';
import { DetailHeaderActionBar } from './DetailHeaderActionBar';
import { navIconButtonClassName } from '../shared/nav-styles';
import { buttonTintClassName } from '../shared/button-styles';

export type DetailNavigationHeaderProps = {
  title: string;
  subtitle?: string;
  actions: DetailHeaderAction[];
  onBack: () => void;
};

const backButtonClass = navIconButtonClassName(false);
const headerActionButtonClass = buttonTintClassName();

export function DetailNavigationHeader({ title, subtitle, actions, onBack }: DetailNavigationHeaderProps) {
  const safeActions = Array.isArray(actions) ? actions : [];
  const openActions = safeActions.filter((action) => action.slot === 'open');
  const chatWithActions = safeActions.filter((action) => action.slot === 'chat-with');

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

      <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-2">
        <DetailHeaderActionBar
          actions={chatWithActions}
          buttonClassName={headerActionButtonClass}
          menuTriggerLabel="Chat with..."
          menuTriggerTitle="Chat with..."
          menuTriggerAriaLabel="Chat with"
          menuAriaLabel="Chat with"
        />
        <DetailHeaderActionBar
          actions={openActions}
          buttonClassName={headerActionButtonClass}
          className="tw-flex tw-items-center tw-gap-2"
        />
      </div>
    </div>
  );
}
