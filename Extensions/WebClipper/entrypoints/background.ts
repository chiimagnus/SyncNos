import { startLegacyBackground } from '../src/legacy/background-entry.js';

export default defineBackground(async () => {
  // P1: minimal ping for verifying WXT -> background messaging.
  try {
    browser.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== '__WXT_PING__') return;
      return Promise.resolve({ ok: true, from: 'background' });
    });
  } catch (_e) {
    // ignore
  }

  await startLegacyBackground();
});
