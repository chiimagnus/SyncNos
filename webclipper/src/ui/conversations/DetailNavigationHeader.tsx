import { ChevronLeft } from 'lucide-react';

import { t } from '@i18n';
import type { DetailHeaderAction } from '@services/integrations/detail-header-actions';
import { DetailHeaderActionBar } from '@ui/conversations/DetailHeaderActionBar';
import { navIconButtonClassName } from '@ui/shared/nav-styles';
import { buttonTintClassName } from '@ui/shared/button-styles';

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
  const toolActions = safeActions.filter((action) => action.slot === 'tools');

  return (
    <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 md:tw-grid md:tw-gap-2">
      <div className="tw-flex tw-min-w-0 tw-flex-1 tw-items-center tw-gap-2">
        <button type="button" onClick={onBack} className={backButtonClass} aria-label={t('backToChatsAria')}>
          <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
        </button>

        <div className="tw-min-w-0 tw-flex-1">
          <div className="tw-truncate tw-text-[13px] tw-font-black tw-tracking-[-0.01em] tw-text-[var(--text-primary)]">
            {title}
          </div>
          {subtitle ? (
            <div className="tw-truncate tw-text-[11px] tw-font-semibold tw-text-[var(--text-secondary)] tw-opacity-90">
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>

      <div className="tw-flex tw-shrink-0 tw-flex-wrap tw-items-center tw-justify-end tw-gap-2">
        <DetailHeaderActionBar
          actions={toolActions}
          buttonClassName={headerActionButtonClass}
          menuTriggerLabel={t('detailHeaderToolsMenuLabel')}
          menuTriggerTitle={t('detailHeaderToolsMenuLabel')}
          menuTriggerAriaLabel={t('detailHeaderToolsMenuAria')}
          menuAriaLabel={t('detailHeaderToolsMenuAria')}
          className="tw-flex tw-items-center tw-gap-2 tw-flex-wrap tw-justify-end"
        />
        <DetailHeaderActionBar
          actions={chatWithActions}
          buttonClassName={headerActionButtonClass}
          menuTriggerLabel={t('detailHeaderChatWithMenuLabel')}
          menuTriggerTitle={t('detailHeaderChatWithMenuLabel')}
          menuTriggerAriaLabel={t('detailHeaderChatWithMenuAria')}
          menuAriaLabel={t('detailHeaderChatWithMenuAria')}
          className="tw-flex tw-items-center tw-gap-2 tw-flex-wrap tw-justify-end"
        />
        <DetailHeaderActionBar
          actions={openActions}
          buttonClassName={headerActionButtonClass}
          menuTriggerLabel={t('detailHeaderOpenInMenuLabel')}
          menuTriggerTitle={t('detailHeaderOpenInMenuLabel')}
          menuTriggerAriaLabel={t('detailHeaderOpenInMenuAria')}
          menuAriaLabel={t('detailHeaderOpenInMenuAria')}
          className="tw-flex tw-items-center tw-gap-2 tw-flex-wrap tw-justify-end"
        />
      </div>
    </div>
  );
}
