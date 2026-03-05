import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Settings as SettingsIcon } from 'lucide-react';

import { getURL as runtimeGetURL } from '../../../platform/runtime/runtime';

import { ConversationListPane } from '../../conversations/ConversationListPane';
import { useConversationsApp } from './conversations-context';

function settingsClass(isActive: boolean) {
  const base =
    'tw-inline-flex tw-size-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-transition-colors tw-duration-200';
  if (isActive) return `${base} tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-text-[var(--text)]`;
  return `${base} tw-border-[var(--border)] tw-bg-white/70 tw-text-[var(--muted)] hover:tw-border-[var(--border-strong)] hover:tw-text-[var(--text)]`;
}

function iconButtonClass() {
  return 'tw-inline-flex tw-size-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white/70 tw-text-[var(--muted)] tw-transition-colors tw-duration-200 hover:tw-border-[var(--border-strong)] hover:tw-text-[var(--text)]';
}

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

  return (
    <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col">
      <div className="tw-border-b tw-border-[var(--border)]/70 tw-bg-[var(--panel)]/70 tw-backdrop-blur-md">
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-px-3 tw-py-3">
          <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
            {logoUrl ? (
              <img src={logoUrl} alt="SyncNos" className="tw-size-8 tw-rounded-xl tw-object-contain" draggable={false} />
            ) : (
              <span
                className="tw-inline-flex tw-size-8 tw-items-center tw-justify-center tw-rounded-xl tw-bg-[var(--btn-bg)] tw-text-[11px] tw-font-black tw-tracking-[0.12em] tw-text-[var(--text)]"
                aria-hidden="true"
              >
                SN
              </span>
            )}
          </div>

          <div className="tw-flex tw-items-center tw-gap-2">
            <NavLink
              to="/settings"
              state={{
                backgroundLocation: { pathname: routerLocation.pathname, search: routerLocation.search, hash: routerLocation.hash },
                from: `${routerLocation.pathname || '/'}${routerLocation.search || ''}`,
              }}
              className={({ isActive }) => settingsClass(isActive)}
            >
              <span className="tw-sr-only">Settings</span>
              <SettingsIcon size={16} strokeWidth={2} aria-hidden="true" />
            </NavLink>

            <button
              type="button"
              onClick={() => refreshList().catch(() => {})}
              className={iconButtonClass()}
              aria-label="Refresh list"
              disabled={loadingList}
            >
              <RefreshIcon />
            </button>

            <button type="button" onClick={onCollapse} className={iconButtonClass()} aria-label="Collapse sidebar">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M6.25 3.25L3 6.5L6.25 9.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3.2 6.5H12.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <ConversationListPane suppressActiveRow={routerLocation.pathname === '/settings'} onOpenConversation={() => navigate('/')} />
    </div>
  );
}
