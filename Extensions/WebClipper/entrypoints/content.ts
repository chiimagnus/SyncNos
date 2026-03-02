import '../src/ui/styles/tokens.css';
import '../src/ui/styles/flash-ok.css';

import { startLegacyContent } from '../src/legacy/content-entry';
import { createRuntimeClient } from '../src/platform/runtime/client';

export default defineContentScript({
  // P1-05: align with current `manifest.json` content_scripts matches.
  // Note: host_permissions still includes `http(s)://*/*` for on-demand scripting injects.
  matches: [
    'https://chat.openai.com/*',
    'https://chatgpt.com/*',
    'https://www.chatgpt.com/*',
    'https://claude.ai/*',
    'https://gemini.google.com/*',
    'https://chat.deepseek.com/*',
    'https://chat.z.ai/*',
    'https://kimi.moonshot.cn/*',
    'https://kimi.com/*',
    'https://*.kimi.com/*',
    'https://www.doubao.com/*',
    'https://yuanbao.tencent.com/*',
    'https://poe.com/*',
    'https://*.notion.so/*',
  ],
  main() {
    const NS: any = (globalThis as any).WebClipper || ((globalThis as any).WebClipper = {});
    NS.runtimeClient = { createRuntimeClient };
    startLegacyContent();
  },
});
