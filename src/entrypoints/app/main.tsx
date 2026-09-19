import { initializeLocale } from '@i18n/locale-runtime';
import '@ui/styles/tokens.css';
import '@ui/styles/buttons.css';
import '@ui/styles/tailwind.css';
import '@entrypoints/app/style.css';

const renderModulePromise = import('./render');

async function main() {
  const [, { mountApp }] = await Promise.all([initializeLocale(), renderModulePromise]);
  mountApp();
}

void main();
