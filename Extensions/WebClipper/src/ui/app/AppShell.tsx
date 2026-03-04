import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import Conversations from './routes/Conversations';
import Debug from './routes/Debug';
import Settings from './routes/Settings';

const navItems = [
  { path: '/', label: 'Conversations' },
  { path: '/settings', label: 'Settings' },
  { path: '/debug', label: 'Debug' },
];

function navLinkClass(isActive: boolean) {
  const base =
    'tw-rounded-full tw-border tw-px-3 tw-py-1.5 tw-text-xs tw-font-bold tw-transition-colors tw-duration-200';
  if (isActive) {
    return `${base} tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-text-[var(--text)]`;
  }
  return `${base} tw-border-[var(--border)] tw-bg-white/70 tw-text-[var(--muted)] hover:tw-border-[var(--border-strong)] hover:tw-text-[var(--text)]`;
}

function Nav() {
  return (
    <nav className="tw-flex tw-flex-wrap tw-items-center tw-gap-2" aria-label="App routes">
      {navItems.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          className={({ isActive }) => navLinkClass(isActive)}
          end={item.path === '/'}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function AppShell() {
  return (
    <HashRouter>
      <div className="tw-grid tw-min-h-screen tw-grid-rows-[auto_1fr]">
        <header className="tw-sticky tw-top-0 tw-z-20 tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3 tw-border-b tw-border-[var(--border)] tw-bg-[var(--panel)]/90 tw-px-3 tw-py-2 tw-backdrop-blur-sm md:tw-px-4">
          <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-3">
            <span
              className="tw-inline-flex tw-size-8 tw-items-center tw-justify-center tw-rounded-xl tw-border tw-border-[var(--border-strong)] tw-bg-[var(--btn-bg)] tw-text-[11px] tw-font-black tw-tracking-[0.12em] tw-text-[var(--text)]"
              aria-hidden="true"
            >
              SN
            </span>
            <div className="tw-min-w-0">
              <p className="tw-m-0 tw-truncate tw-text-[15px] tw-font-black tw-leading-none tw-text-[var(--text)]">SyncNos WebClipper</p>
            </div>
          </div>
          <Nav />
        </header>

        <main className="tw-mx-auto tw-min-h-0 tw-w-[calc(100%-20px)] tw-max-w-[1400px] tw-overflow-x-hidden tw-overflow-y-auto tw-py-3 md:tw-w-[calc(100%-28px)] md:tw-py-4">
          <Routes>
            <Route path="/" element={<Conversations />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/sync" element={<Navigate to="/settings" replace />} />
            <Route path="/backup" element={<Navigate to="/settings" replace />} />
            <Route path="/debug" element={<Debug />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
