import { useLocation, useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon } from 'lucide-react';

import { getURL as runtimeGetURL } from '../../../platform/runtime/runtime';

import { t } from '../../../i18n';
import { ConversationListPane } from '../../conversations/ConversationListPane';
import { useConversationsApp } from '../../conversations/conversations-context';
import { navIconButtonClassName } from '../../shared/nav-styles';

function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13 8a5 5 0 10-1.3 3.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M13 3.5v3h-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CapturedListSidebar({ onCollapse }: { onCollapse: () => void }) {
  const routerLocation = useLocation();
  const navigate = useNavigate();
  const logoUrl = runtimeGetURL('icons/icon-48.png');

  const { refreshList, loadingList } = useConversationsApp();

  const state: any = (routerLocation as any)?.state ?? {};
  const settingsOpen = routerLocation.pathname === '/settings';

  const closeSettings = () => {
    const from = String(state?.from || '').trim();
    if (from) navigate(from, { replace: true });
    else navigate('/', { replace: true });
  };

  const openSettings = () => {
    if (settingsOpen) {
      closeSettings();
      return;
    }

    navigate('/settings', {
      state: {
        backgroundLocation: { pathname: routerLocation.pathname, search: routerLocation.search, hash: routerLocation.hash },
        from: `${routerLocation.pathname || '/'}${routerLocation.search || ''}`,
      },
    });
  };

  return (
    <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col">
      <div className="tw-border-b tw-border-[var(--border)] tw-bg-[var(--bg-sunken)]">
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-px-3 tw-py-3">
          <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
            {logoUrl ? (
              <img src={logoUrl} alt="SyncNos" className="tw-size-8 tw-rounded-xl tw-object-contain" draggable={false} />
            ) : (
              <span
                className="tw-inline-flex tw-size-8 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-[var(--bg-card)] tw-text-[11px] tw-font-black tw-tracking-[0.12em] tw-text-[var(--text-primary)]"
                aria-hidden="true"
              >
                SN
              </span>
            )}
          </div>

          <div className="tw-flex tw-items-center tw-gap-2">
            <button
              type="button"
              onClick={openSettings}
              className={navIconButtonClassName(false)}
              aria-label={t('openSettingsAria')}
              title={t('openSettings')}
            >
              <span className="tw-sr-only">{t('settingsLabel')}</span>
              <SettingsIcon size={16} strokeWidth={1.6} aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => refreshList().catch(() => {})}
              className={navIconButtonClassName(false)}
              aria-label={t('refreshList')}
              disabled={loadingList}
            >
              <RefreshIcon />
            </button>

            <button type="button" onClick={onCollapse} className={navIconButtonClassName(false)} aria-label={t('collapseSidebar')}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M6.25 3.25L3 6.5L6.25 9.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3.2 6.5H12.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <ConversationListPane onOpenConversation={() => navigate('/')} />
    </div>
  );
}
