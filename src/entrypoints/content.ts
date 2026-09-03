import { createContentController } from '@services/bootstrap/content-controller.ts';
import { registerCurrentPageCaptureContentHandlers } from '@services/bootstrap/current-page-capture-content-handlers.ts';
import { createCurrentPageCaptureService } from '@services/bootstrap/current-page-capture.ts';
import { startContentBootstrap } from '@services/bootstrap/content.ts';
import { registerInpageCommentsPanelContentHandlers } from '@services/bootstrap/inpage-comments-panel-content-handlers.ts';
import { registerWebArticleExtractContentHandlers } from '@services/bootstrap/web-article-extract-content-handlers';
import { createVideoTranscriptCaptureService } from '@services/bootstrap/video-transcript-capture';
import { registerVideoTranscriptCaptureContentHandlers } from '@services/bootstrap/video-transcript-capture-content-handlers';
import { createCollectorEnv } from '@collectors/collector-env.ts';
import { registerAllCollectors } from '@collectors/register-all.ts';
import { createCollectorsRegistry } from '@collectors/registry.ts';
import runtimeObserverApi from '@collectors/runtime-observer.ts';
import { createAutoSaveIncrementalEngine } from '@services/conversations/content/autosave-incremental-engine.ts';
import { createItemMentionController } from '@services/integrations/item-mention/content/mention-controller';
import normalizeApi from '@services/shared/normalize.ts';
import { inpageButtonApi } from '@ui/inpage/inpage-button-shadow.ts';
import { inpageItemMentionApi } from '@ui/inpage/inpage-item-mention-shadow.ts';
import { inpageTipApi } from '@ui/inpage/inpage-tip-shadow.ts';
import { initializeLocale } from '@i18n';
import { createInpageCommentsDomSource, getInpageCommentsPanelApi } from '@ui/inpage/inpage-comments-panel-shadow.ts';
import { createRuntimeClient } from '@platform/runtime/client.ts';

export default defineContentScript({
  // Inpage visibility is controlled at runtime by canonical `inpage_display_mode`.
  // This avoids browser-specific dynamic content-script registration support gaps.
  matches: ['http://*/*', 'https://*/*'],
  async main() {
    const localeReady = initializeLocale();
    const runtime = createRuntimeClient();
    const env = createCollectorEnv({ window, document, location, normalize: normalizeApi });
    const collectorsRegistry = createCollectorsRegistry();
    registerAllCollectors(collectorsRegistry, env);
    const currentPageCapture = createCurrentPageCaptureService({
      runtime,
      collectorsRegistry,
    });
    const incrementalEngine = createAutoSaveIncrementalEngine();
    let captureCurrentPage = currentPageCapture.captureCurrentPage;

    registerCurrentPageCaptureContentHandlers(
      {
        getCurrentPageCaptureState: currentPageCapture.getCurrentPageCaptureState,
        captureCurrentPage: (input) => captureCurrentPage(input),
      },
      {
        inpageTip: inpageTipApi,
        localeReady,
      },
    );
    registerInpageCommentsPanelContentHandlers(runtime, {
      localeReady,
      createPanelApi: () => getInpageCommentsPanelApi(),
      domSource: createInpageCommentsDomSource({
        window,
        document,
        getPanelRoot: () => document.getElementById('webclipper-inpage-comments-panel'),
      }),
    });
    registerWebArticleExtractContentHandlers();
    registerVideoTranscriptCaptureContentHandlers(createVideoTranscriptCaptureService({ runtime }), {
      inpageTip: inpageTipApi,
      localeReady,
    });

    await localeReady.catch(() => undefined);
    const itemMentionController = createItemMentionController({ runtime, ui: inpageItemMentionApi });
    const controller = createContentController({
      runtime,
      collectorsRegistry,
      currentPageCapture,
      inpageButton: inpageButtonApi,
      inpageTip: inpageTipApi,
      runtimeObserver: runtimeObserverApi,
      incrementalEngine,
      itemMention: itemMentionController,
    });
    captureCurrentPage = controller.captureCurrentPage;
    startContentBootstrap({
      runtime,
      inpageButton: inpageButtonApi,
      createController: () => controller,
    });
  },
});
