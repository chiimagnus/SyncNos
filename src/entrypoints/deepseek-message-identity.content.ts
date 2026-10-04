import { stampDeepseekMessageIdentities } from '@collectors/deepseek/deepseek-message-identity';
import { createObserver } from '@collectors/runtime-observer';

export default defineContentScript({
  matches: ['https://chat.deepseek.com/*'],
  world: 'MAIN',
  runAt: 'document_idle',
  main() {
    createObserver({
      debounceMs: 0,
      getRoot: () => document.querySelector('.ds-virtual-list'),
      onTick: () => {
        const sessionId = location.pathname.match(/^\/a\/chat\/s\/([^/?#]+)/)?.[1] || '';
        stampDeepseekMessageIdentities(document.querySelector('.ds-virtual-list'), sessionId);
      },
    }).start();
  },
});
