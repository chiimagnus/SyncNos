import '@ui/styles/tokens.css';
import '@ui/styles/buttons.css';
import 'react-tooltip/dist/react-tooltip.css';
import '@ui/styles/tooltip.css';
import '@ui/styles/tailwind.css';
import '@entrypoints/popup/style.css';

function loadPopupApp() {
  void import('./render').then(({ mountPopup }) => mountPopup());
}

if (typeof globalThis.requestAnimationFrame === 'function') {
  globalThis.requestAnimationFrame(loadPopupApp);
} else {
  globalThis.setTimeout(loadPopupApp, 0);
}
