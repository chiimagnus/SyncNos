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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const runtimeContext: any = require('../src/runtime-context.js');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const collectorContext: any = require('../src/collectors/collector-context.js');
    const NS: any = (globalThis as any).WebClipper || ((globalThis as any).WebClipper = {});
    runtimeContext.runtimeClient = { createRuntimeClient };
    NS.runtimeClient = runtimeContext.runtimeClient;

    const runtime = createRuntimeClient();
    startContentBootstrap({
      runtime,
      inpageButton: runtimeContext.inpageButton || NS.inpageButton || null,
      createController: () =>
        createContentController({
          runtime,
          collectorsRegistry: collectorContext.collectorsRegistry || null,
          inpageButton: runtimeContext.inpageButton || NS.inpageButton || null,
          inpageTip: runtimeContext.inpageTip || NS.inpageTip || null,
          runtimeObserver: runtimeContext.runtimeObserver || NS.runtimeObserver || null,
          incrementalUpdater: runtimeContext.incrementalUpdater || NS.incrementalUpdater || null,
          notionAiModelPicker: runtimeContext.notionAiModelPicker || NS.notionAiModelPicker || null,
        }),
    });
  },
});
