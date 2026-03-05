import React from 'react';
import ReactDOM from 'react-dom/client';
import AppShell from '../../src/ui/app/AppShell';
import '../../src/ui/styles/tailwind.css';
import '../../src/ui/styles/tokens.css';
import './style.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>,
);
