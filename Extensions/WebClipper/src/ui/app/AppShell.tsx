import { useEffect, useState } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import Conversations from './routes/Conversations';
import Settings from './routes/Settings';

const SIDEBAR_COLLAPSED_KEY = 'webclipper_app_sidebar_collapsed';

function navLinkClass(isActive: boolean) {
  const base =
    'tw-flex tw-w-full tw-items-center tw-justify-between tw-gap-2 tw-rounded-xl tw-border tw-px-3 tw-py-2 tw-text-xs tw-font-extrabold tw-transition-colors tw-duration-200';
  if (isActive) {
    return `${base} tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-text-[var(--text)]`;
  }
  return `${base} tw-border-[var(--border)] tw-bg-white/70 tw-text-[var(--muted)] hover:tw-border-[var(--border-strong)] hover:tw-text-[var(--text)]`;
}

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

function Nav({ onCollapse }: { onCollapse: () => void }) {
  return (
    <nav className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-gap-2" aria-label="App sidebar">
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
          <span
            className="tw-inline-flex tw-size-8 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-text-[11px] tw-font-black tw-tracking-[0.12em] tw-text-[var(--text)]"
            aria-hidden="true"
          >
            SN
          </span>
          <div className="tw-min-w-0">
            <p className="tw-m-0 tw-truncate tw-text-[13px] tw-font-black tw-leading-none tw-text-[var(--text)]">SyncNos</p>
            <p className="tw-mt-1 tw-truncate tw-text-[11px] tw-font-semibold tw-text-[var(--muted)]">WebClipper</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          className="tw-inline-flex tw-size-9 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border)] tw-bg-white/70 tw-text-[var(--muted)] tw-transition-colors tw-duration-200 hover:tw-border-[var(--border-strong)] hover:tw-text-[var(--text)]"
          aria-label="Collapse sidebar"
        >
          <CollapseIcon />
        </button>
      </div>

      <div className="tw-mt-2 tw-grid tw-gap-2">
        <NavLink to="/" className={({ isActive }) => navLinkClass(isActive)} end>
          Conversations
        </NavLink>
      </div>

      <div className="tw-mt-auto tw-grid tw-gap-2">
        <NavLink to="/settings" className={({ isActive }) => navLinkClass(isActive)}>
          Settings
        </NavLink>
      </div>
    </nav>
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
      <div className="tw-flex tw-h-[100dvh] tw-w-full tw-min-w-0 tw-bg-[var(--bg)]">
        {sidebarCollapsed ? null : (
          <aside className="tw-flex tw-w-[280px] tw-min-w-[280px] tw-flex-col tw-gap-2 tw-border-r tw-border-[var(--border)] tw-bg-[var(--panel)]/85 tw-p-3 tw-backdrop-blur-sm">
            <Nav onCollapse={() => setCollapsed(true)} />
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

          <div className="tw-h-full tw-min-h-0 tw-overflow-y-auto tw-overflow-x-hidden tw-p-3 md:tw-p-4">
          <Routes>
            <Route path="/" element={<Conversations />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/sync" element={<Navigate to="/settings" replace />} />
            <Route path="/backup" element={<Navigate to="/settings" replace />} />
          </Routes>
          </div>
        </main>
      </div>
    </HashRouter>
  );
}
