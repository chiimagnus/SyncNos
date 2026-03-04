import '../src/ui/styles/tokens.css';
import '../src/ui/styles/flash-ok.css';

import { createContentController } from '../src/bootstrap/content-controller.ts';
import { startContentBootstrap } from '../src/bootstrap/content.ts';
import { createCollectorEnv } from '../src/collectors/collector-env.ts';
import { registerAllCollectors } from '../src/collectors/register-all.ts';
import { createCollectorsRegistry } from '../src/collectors/registry.ts';
import runtimeObserverApi from '../src/collectors/runtime-observer.ts';
import incrementalUpdaterApi from '../src/conversations/content/incremental-updater.ts';
import notionAiModelPickerApi from '../src/integrations/notionai-model-picker.ts';
import normalizeApi from '../src/shared/normalize.ts';
import inpageButtonApi from '../src/ui/inpage/inpage-button.ts';
import inpageTipApi from '../src/ui/inpage/inpage-tip.ts';
import { createRuntimeClient } from '../src/platform/runtime/client.ts';

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
    const runtime = createRuntimeClient();
    const env = createCollectorEnv({ window, document, location, normalize: normalizeApi });
    const collectorsRegistry = createCollectorsRegistry();
    registerAllCollectors(collectorsRegistry, env);
    const controller = createContentController({
      runtime,
      collectorsRegistry,
      inpageButton: inpageButtonApi,
      inpageTip: inpageTipApi,
      runtimeObserver: runtimeObserverApi,
      incrementalUpdater: incrementalUpdaterApi,
      notionAiModelPicker: notionAiModelPickerApi,
    });
    startContentBootstrap({
      runtime,
      inpageButton: inpageButtonApi,
      createController: () => controller,
    });
  },
});
