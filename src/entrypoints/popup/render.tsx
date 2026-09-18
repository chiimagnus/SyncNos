import React from 'react';
import ReactDOM from 'react-dom/client';

import PopupShell from '@ui/popup/PopupShell';
import { initializeLocale } from '@i18n';

export function mountPopup() {
  const container = document.getElementById('root');
  if (!container) throw new Error('popup root is unavailable');

  const root = ReactDOM.createRoot(container);
  const render = () => {
    root.render(
      <React.StrictMode>
        <PopupShell />
      </React.StrictMode>,
    );
  };

  render();
  void initializeLocale()
    .then(render)
    .catch(() => {});
}
