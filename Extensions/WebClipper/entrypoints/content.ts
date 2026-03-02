import '../src/ui/styles/tokens.css';
import '../src/ui/styles/flash-ok.css';

import '../src/shared/normalize.js';
import '../src/storage/incremental-updater.js';
import '../src/collectors/bootstrap.ts';
import '../src/collectors/runtime-observer.js';
import '../src/collectors/sites-bootstrap';
import '../src/collectors/web/web-collector.js';
import '../src/integrations/notionai-model-picker.js';
import '../src/ui/inpage/inpage-tip.js';
import '../src/ui/inpage/inpage-button.js';
import '../src/ui/inpage/inpage-tip-shadow';
import '../src/ui/inpage/inpage-button-shadow';

import { createContentController } from '../src/bootstrap/content-controller.ts';
import { startContentBootstrap } from '../src/bootstrap/content.ts';
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

    const runtime = createRuntimeClient();
    startContentBootstrap({
      runtime,
      inpageButton: NS.inpageButton || null,
      createController: () =>
        createContentController({
          runtime,
          collectorsRegistry: NS.collectorsRegistry || null,
          inpageButton: NS.inpageButton || null,
          inpageTip: NS.inpageTip || null,
          runtimeObserver: NS.runtimeObserver || null,
          incrementalUpdater: NS.incrementalUpdater || null,
          notionAiModelPicker: NS.notionAiModelPicker || null,
        }),
    });
  },
});
