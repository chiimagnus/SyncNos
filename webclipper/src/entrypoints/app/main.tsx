import React from 'react';
import ReactDOM from 'react-dom/client';
import AppShell from '../../ui/app/AppShell';
import '../../ui/styles/tailwind.css';
import '../../ui/styles/tokens.css';
import './style.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>,
);
