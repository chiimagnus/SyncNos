import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import Conversations from './routes/Conversations';
import Settings from './routes/Settings';
import { CapturedListSidebar } from './conversations/CapturedListSidebar';
import { ConversationsProvider } from './conversations/conversations-context';

const SIDEBAR_COLLAPSED_KEY = 'webclipper_app_sidebar_collapsed';

function CollapseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6.25 3.25L3 6.5L6.25 9.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.2 6.5H12.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9.75 3.25L13 6.5L9.75 9.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.8 6.5H3.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export default function AppShell() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (v === '1') setSidebarCollapsed(true);
    } catch (_e) {
      // ignore
    }
  }, []);

  const setCollapsed = (collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch (_e) {
      // ignore
    }
  };

  return (
    <HashRouter>
      <ConversationsProvider>
        <div className="tw-flex tw-h-[100dvh] tw-w-full tw-min-w-0 tw-bg-[var(--bg)]">
          {sidebarCollapsed ? null : (
            <aside className="tw-flex tw-w-[320px] tw-min-w-[320px] tw-flex-col tw-gap-2 tw-border-r tw-border-[var(--border)] tw-bg-[var(--panel)]/85 tw-p-3 tw-backdrop-blur-sm">
              <CapturedListSidebar onCollapse={() => setCollapsed(true)} />
            </aside>
          )}

          <main className="tw-relative tw-min-w-0 tw-flex-1 tw-overflow-hidden">
            {sidebarCollapsed ? (
              <button
                type="button"
                onClick={() => setCollapsed(false)}
                className="tw-absolute tw-left-3 tw-top-3 tw-z-10 tw-inline-flex tw-size-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white/75 tw-text-[var(--muted)] tw-shadow-[var(--shadow)] tw-transition-colors tw-duration-200 hover:tw-border-[var(--border-strong)] hover:tw-text-[var(--text)]"
                aria-label="Expand sidebar"
              >
                <ExpandIcon />
              </button>
            ) : null}

            <div className="route-scroll tw-h-full tw-min-h-0 tw-overflow-y-auto tw-overflow-x-hidden tw-p-3 md:tw-p-4">
              <Routes>
                <Route path="/" element={<Conversations />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/sync" element={<Navigate to="/settings" replace />} />
                <Route path="/backup" element={<Navigate to="/settings" replace />} />
              </Routes>
            </div>
          </main>
        </div>
      </ConversationsProvider>
    </HashRouter>
  );
}
