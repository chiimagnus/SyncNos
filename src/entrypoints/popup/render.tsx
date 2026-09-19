import React from 'react';
import ReactDOM from 'react-dom/client';
import PopupShell from '@ui/popup/PopupShell';
import '@ui/styles/buttons.css';
import 'react-tooltip/dist/react-tooltip.css';
import '@ui/styles/tooltip.css';
import '@ui/styles/tailwind.css';

export function mountPopup() {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <PopupShell />
    </React.StrictMode>,
  );
}
