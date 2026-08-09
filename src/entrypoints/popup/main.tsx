import React from 'react';
import ReactDOM from 'react-dom/client';
import PopupShell from '@ui/popup/PopupShell';
import { initializeLocale } from '@i18n';
import '@ui/styles/tokens.css';
import '@ui/styles/buttons.css';
import 'react-tooltip/dist/react-tooltip.css';
import '@ui/styles/tooltip.css';
import '@ui/styles/tailwind.css';
import '@entrypoints/popup/style.css';

async function main() {
  await initializeLocale();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <PopupShell />
    </React.StrictMode>,
  );
}

void main();
