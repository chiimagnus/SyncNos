import React from 'react';
import ReactDOM from 'react-dom/client';
import AppShell from '@ui/app/AppShell';
import '@ui/styles/tokens.css';
import '@ui/styles/buttons.css';
import '@ui/styles/tailwind.css';
import 'katex/dist/katex.min.css';
import '@entrypoints/app/style.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>,
);
