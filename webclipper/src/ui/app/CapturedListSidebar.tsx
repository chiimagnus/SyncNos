import { useLocation, useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon } from 'lucide-react';

import { t } from '@i18n';
import { ConversationListPane } from '@ui/conversations/ConversationListPane';
import { headerButtonClassName } from '@ui/shared/button-styles';
import { tooltipAttrs } from '@ui/shared/AppTooltip';
import { CapturedListPaneShell } from '@ui/shared/CapturedListPaneShell';

export function CapturedListSidebar({ onCollapse }: { onCollapse: () => void }) {
  const routerLocation = useLocation();
  const navigate = useNavigate();

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
        backgroundLocation: {
          pathname: routerLocation.pathname,
          search: routerLocation.search,
          hash: routerLocation.hash,
        },
        from: `${routerLocation.pathname || '/'}${routerLocation.search || ''}`,
      },
    });
  };

  const openInsightSettings = () => {
    if (settingsOpen) {
      navigate('/settings?section=aboutyou', { replace: true, state: routerLocation.state });
      return;
    }

    navigate('/settings?section=aboutyou', {
      state: {
        backgroundLocation: {
          pathname: routerLocation.pathname,
          search: routerLocation.search,
          hash: routerLocation.hash,
        },
        from: `${routerLocation.pathname || '/'}${routerLocation.search || ''}`,
      },
    });
  };

  const openProviderSettings = (section: string) => {
    const safeSection =
      String(section || '')
        .trim()
        .toLowerCase() || 'notion';
    const route = `/settings?section=${encodeURIComponent(safeSection)}`;
    if (settingsOpen) {
      navigate(route, { replace: true, state: routerLocation.state });
      return;
    }
    navigate(route, {
      state: {
        backgroundLocation: {
          pathname: routerLocation.pathname,
          search: routerLocation.search,
          hash: routerLocation.hash,
        },
        from: `${routerLocation.pathname || '/'}${routerLocation.search || ''}`,
      },
    });
  };

  return (
    <CapturedListPaneShell
      rightSlot={
        <>
          <button
            type="button"
            onClick={openSettings}
            className={headerButtonClassName()}
            aria-label={t('openSettingsAria')}
            {...tooltipAttrs(t('openSettings'))}
          >
            <span className="tw-sr-only">{t('settingsLabel')}</span>
            <SettingsIcon size={16} strokeWidth={1.6} aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onCollapse}
            className={headerButtonClassName()}
            aria-label={t('collapseSidebar')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M6.25 3.25L3 6.5L6.25 9.75"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path d="M3.2 6.5H12.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </>
      }
    >
      <ConversationListPane
        onOpenConversation={() => navigate('/')}
        onOpenInsightsSection={openInsightSettings}
        onOpenSettingsSection={openProviderSettings}
      />
    </CapturedListPaneShell>
  );
}
