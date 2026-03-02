import React from 'react';
import ReactDOM from 'react-dom/client';
import AppShell from '../../src/ui/app/AppShell';
import './style.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>,
);

