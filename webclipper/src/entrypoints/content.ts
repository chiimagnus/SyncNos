import '../ui/styles/tokens.css';

import { createContentController } from '../bootstrap/content-controller.ts';
import { registerCurrentPageCaptureContentHandlers } from '../bootstrap/current-page-capture-content-handlers.ts';
import { createCurrentPageCaptureService } from '../bootstrap/current-page-capture.ts';
import { startContentBootstrap } from '../bootstrap/content.ts';
import { registerInpageCommentsPanelContentHandlers } from '../bootstrap/inpage-comments-panel-content-handlers.ts';
import { createCollectorEnv } from '../collectors/collector-env.ts';
import { registerAllCollectors } from '../collectors/register-all.ts';
import { createCollectorsRegistry } from '../collectors/registry.ts';
import runtimeObserverApi from '../collectors/runtime-observer.ts';
import incrementalUpdaterApi from '../conversations/content/incremental-updater.ts';
import notionAiModelPickerApi from '../integrations/notionai-auto-picker/notionai-model-picker.ts';
import normalizeApi from '../shared/normalize.ts';
import { inpageButtonApi } from '../ui/inpage/inpage-button-shadow.ts';
import { inpageTipApi } from '../ui/inpage/inpage-tip-shadow.ts';
import { createRuntimeClient } from '../platform/runtime/client.ts';

export default defineContentScript({
  // Inpage visibility is controlled at runtime by `inpage_display_mode` (and legacy `inpage_supported_only`).
  // This avoids browser-specific dynamic content-script registration support gaps.
  matches: ['http://*/*', 'https://*/*'],
  main() {
    const runtime = createRuntimeClient();
    const env = createCollectorEnv({ window, document, location, normalize: normalizeApi });
    const collectorsRegistry = createCollectorsRegistry();
    registerAllCollectors(collectorsRegistry, env);
    const currentPageCapture = createCurrentPageCaptureService({
      runtime,
      collectorsRegistry,
    });

    registerCurrentPageCaptureContentHandlers(currentPageCapture, { inpageTip: inpageTipApi });
    registerInpageCommentsPanelContentHandlers(runtime);

    const controller = createContentController({
      runtime,
      collectorsRegistry,
      currentPageCapture,
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
