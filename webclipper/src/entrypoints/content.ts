import { createContentController } from '@services/bootstrap/content-controller.ts';
import { registerCurrentPageCaptureContentHandlers } from '@services/bootstrap/current-page-capture-content-handlers.ts';
import { createCurrentPageCaptureService } from '@services/bootstrap/current-page-capture.ts';
import { startContentBootstrap } from '@services/bootstrap/content.ts';
import { registerInpageCommentsPanelContentHandlers } from '@services/bootstrap/inpage-comments-panel-content-handlers.ts';
import { registerWebArticleExtractContentHandlers } from '@services/bootstrap/web-article-extract-content-handlers';
import { createCollectorEnv } from '@collectors/collector-env.ts';
import { registerAllCollectors } from '@collectors/register-all.ts';
import { createCollectorsRegistry } from '@collectors/registry.ts';
import runtimeObserverApi from '@collectors/runtime-observer.ts';
import incrementalUpdaterApi from '@services/conversations/content/incremental-updater.ts';
import notionAiModelPickerApi from '@services/integrations/notionai-auto-picker/notionai-model-picker.ts';
import { createItemMentionController } from '@services/integrations/item-mention/content/mention-controller';
import normalizeApi from '@services/shared/normalize.ts';
import { inpageButtonApi } from '@ui/inpage/inpage-button-shadow.ts';
import { inpageItemMentionApi } from '@ui/inpage/inpage-item-mention-shadow.ts';
import { inpageTipApi } from '@ui/inpage/inpage-tip-shadow.ts';
import { createRuntimeClient } from '@platform/runtime/client.ts';

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
    registerWebArticleExtractContentHandlers();

    const itemMentionController = createItemMentionController({ runtime, ui: inpageItemMentionApi });
    const controller = createContentController({
      runtime,
      collectorsRegistry,
      currentPageCapture,
      inpageButton: inpageButtonApi,
      inpageTip: inpageTipApi,
      runtimeObserver: runtimeObserverApi,
      incrementalUpdater: incrementalUpdaterApi,
      notionAiModelPicker: notionAiModelPickerApi,
      itemMention: itemMentionController,
    });
    startContentBootstrap({
      runtime,
      inpageButton: inpageButtonApi,
      createController: () => controller,
    });
  },
});
