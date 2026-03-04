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
  // Inpage visibility is controlled at runtime by `inpage_supported_only`.
  // This avoids browser-specific dynamic content-script registration support gaps.
  matches: ['http://*/*', 'https://*/*'],
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
