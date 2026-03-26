import React from 'react';
import ReactDOM from 'react-dom/client';
import PopupShell from '@ui/popup/PopupShell';
import '@ui/styles/tokens.css';
import '@ui/styles/buttons.css';
import '@ui/styles/tooltip.css';
import '@ui/styles/tailwind.css';
import '@entrypoints/popup/style.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PopupShell />
  </React.StrictMode>,
);
