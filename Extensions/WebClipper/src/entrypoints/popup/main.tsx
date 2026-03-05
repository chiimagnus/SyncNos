import React from 'react';
import ReactDOM from 'react-dom/client';
import PopupShell from '../../ui/popup/PopupShell';
import '../../ui/styles/tailwind.css';
import '../../ui/styles/tokens.css';
import './style.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PopupShell />
  </React.StrictMode>,
);
