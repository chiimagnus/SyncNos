import React from 'react';
import ReactDOM from 'react-dom/client';
import PopupShell from '../../src/ui/popup/PopupShell';
import '../../src/ui/styles/tailwind.css';
import '../../src/ui/styles/tokens.css';
import './style.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PopupShell />
  </React.StrictMode>,
);
