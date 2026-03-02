import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import Backup from './routes/Backup';
import Conversations from './routes/Conversations';
import Debug from './routes/Debug';
import Settings from './routes/Settings';
import SyncJobs from './routes/SyncJobs';

function Nav() {
  const linkStyle = ({ isActive }: { isActive: boolean }) => ({
    textDecoration: 'none',
    fontWeight: isActive ? 700 : 500,
    opacity: isActive ? 1 : 0.75,
  });

  return (
    <nav style={{ display: 'flex', gap: 12 }}>
      <NavLink to="/" style={linkStyle}>
        Conversations
      </NavLink>
      <NavLink to="/sync" style={linkStyle}>
        Sync
      </NavLink>
      <NavLink to="/settings" style={linkStyle}>
        Settings
      </NavLink>
      <NavLink to="/backup" style={linkStyle}>
        Backup
      </NavLink>
      <NavLink to="/debug" style={linkStyle}>
        Debug
      </NavLink>
    </nav>
  );
}

export default function AppShell() {
  return (
    <HashRouter>
      <div
        style={{
          display: 'grid',
          gridTemplateRows: 'auto 1fr',
          minHeight: '100vh',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            padding: '12px 16px',
            borderBottom: '1px solid color-mix(in oklab, CanvasText 15%, transparent)',
          }}
        >
          <div style={{ fontWeight: 800 }}>SyncNos WebClipper</div>
          <Nav />
        </header>

        <main style={{ padding: '16px' }}>
          <Routes>
            <Route path="/" element={<Conversations />} />
            <Route path="/sync" element={<SyncJobs />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/backup" element={<Backup />} />
            <Route path="/debug" element={<Debug />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
