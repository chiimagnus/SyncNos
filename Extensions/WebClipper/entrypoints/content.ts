import '../src/ui/styles/tokens.css';
import '../src/ui/styles/flash-ok.css';

import '../src/shared/normalize.ts';
import '../src/storage/incremental-updater.ts';
import '../src/collectors/bootstrap.ts';
import '../src/collectors/runtime-observer.ts';
import '../src/collectors/sites-bootstrap';
import '../src/collectors/web/web-collector.ts';
import '../src/integrations/notionai-model-picker.ts';
import '../src/ui/inpage/inpage-tip.ts';
import '../src/ui/inpage/inpage-button.ts';

import { createContentController } from '../src/bootstrap/content-controller.ts';
import { startContentBootstrap } from '../src/bootstrap/content.ts';
import { createRuntimeClient } from '../src/platform/runtime/client';
import runtimeContext from '../src/runtime-context.ts';
import collectorContext from '../src/collectors/collector-context.ts';

export default defineContentScript({
  // P1-05: align with current `manifest.json` content_scripts matches.
  // Note: host_permissions still includes `http(s)://*/*` for on-demand scripting injects.
  matches: [
    'https://chat.openai.com/*',
    'https://chatgpt.com/*',
    'https://www.chatgpt.com/*',
    'https://claude.ai/*',
    'https://gemini.google.com/*',
    'https://aistudio.google.com/*',
    'https://makersuite.google.com/*',
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
    const runtimeNS: any = runtimeContext;
    const collectorsNS: any = collectorContext;
    runtimeContext.runtimeClient = { createRuntimeClient };

    const runtime = createRuntimeClient();
    startContentBootstrap({
      runtime,
      inpageButton: runtimeNS.inpageButton || null,
      createController: () =>
        createContentController({
          runtime,
          collectorsRegistry: collectorsNS.collectorsRegistry || null,
          inpageButton: runtimeNS.inpageButton || null,
          inpageTip: runtimeNS.inpageTip || null,
          runtimeObserver: runtimeNS.runtimeObserver || null,
          incrementalUpdater: runtimeNS.incrementalUpdater || null,
          notionAiModelPicker: runtimeNS.notionAiModelPicker || null,
        }),
    });
  },
});
