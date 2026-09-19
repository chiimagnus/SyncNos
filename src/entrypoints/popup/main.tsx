import { initializeLocale } from '@i18n/locale-runtime';
import '@ui/styles/tokens.css';
import '@entrypoints/popup/style.css';

const renderModulePromise = import('./render');

async function main() {
  const [, { mountPopup }] = await Promise.all([initializeLocale(), renderModulePromise]);
  mountPopup();
}

void main();
