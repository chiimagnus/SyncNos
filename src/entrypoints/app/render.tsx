import React from 'react';
import ReactDOM from 'react-dom/client';
import AppShell from '@ui/app/AppShell';

export function mountApp() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <AppShell />
    </React.StrictMode>,
  );
}
