import { createContentController } from '@services/bootstrap/content-controller.ts';
import { registerCurrentPageCaptureContentHandlers } from '@services/bootstrap/current-page-capture-content-handlers.ts';
import { createCurrentPageCaptureService } from '@services/bootstrap/current-page-capture.ts';
import { startContentBootstrap } from '@services/bootstrap/content.ts';
import {
  ensureContentScriptLifecycleToken,
  startContentScriptLifecycle,
} from '@services/bootstrap/content-script-lifecycle';
import { registerInpageCommentsPanelContentHandlers } from '@services/bootstrap/inpage-comments-panel-content-handlers.ts';
import { registerWebArticleExtractContentHandlers } from '@services/bootstrap/web-article-extract-content-handlers';
import { createVideoTranscriptCaptureService } from '@services/bootstrap/video-transcript-capture';
import { createCollectorEnv } from '@collectors/collector-env.ts';
import { registerAllCollectors } from '@collectors/register-all.ts';
import { createCollectorsRegistry } from '@collectors/registry.ts';
import { createObserver } from '@collectors/runtime-observer.ts';
import { createAutoSaveIncrementalEngine } from '@services/conversations/content/autosave-incremental-engine.ts';
import { createItemMentionController } from '@services/integrations/item-mention/content/mention-controller';
import normalizeApi from '@services/shared/normalize.ts';
import { inpageButtonApi } from '@ui/inpage/inpage-button-shadow.ts';
import { inpageItemMentionApi } from '@ui/inpage/inpage-item-mention-shadow.ts';
import { inpageTipApi } from '@ui/inpage/inpage-tip-shadow.ts';
import { initializeLocale } from '@i18n';
import {
  cleanupInpageCommentsPanel,
  createInpageCommentsDomSource,
  getInpageCommentsPanelApi,
  isInpageCommentsPanelOpen,
} from '@ui/inpage/inpage-comments-panel-shadow.ts';
import { createRuntimeClient } from '@platform/runtime/client.ts';

export default defineContentScript({
  // Inpage visibility is controlled at runtime by canonical `inpage_display_mode`.
  // This avoids browser-specific dynamic content-script registration support gaps.
  matches: ['http://*/*', 'https://*/*'],
  async main() {
    const restoreInpageComments = isInpageCommentsPanelOpen();
    const lifecycleToken = await ensureContentScriptLifecycleToken();
    const lifecycle = startContentScriptLifecycle(document, lifecycleToken);

    lifecycle.addCleanup(cleanupInpageCommentsPanel);
    lifecycle.addCleanup(inpageTipApi.cleanup);

    const localeReady = initializeLocale();
    const runtime = createRuntimeClient();
    runtime.onInvalidated(lifecycle.dispose);
    const env = createCollectorEnv({ window, document, location, normalize: normalizeApi });
    const collectorsRegistry = createCollectorsRegistry();
    registerAllCollectors(collectorsRegistry, env);
    const videoTranscriptCapture = createVideoTranscriptCaptureService({ runtime });
    const currentPageCapture = createCurrentPageCaptureService({
      runtime,
      collectorsRegistry,
      videoCapture: videoTranscriptCapture,
    });
    const incrementalEngine = createAutoSaveIncrementalEngine();
    let captureCurrentPage = currentPageCapture.captureCurrentPage;

    lifecycle.addCleanup(
      registerCurrentPageCaptureContentHandlers(
        {
          getCurrentPageCaptureState: currentPageCapture.getCurrentPageCaptureState,
          captureCurrentPage: (input) => captureCurrentPage(input),
        },
        {
          inpageTip: inpageTipApi,
          localeReady,
        },
      ),
    );
    const inpageComments = registerInpageCommentsPanelContentHandlers(runtime, {
      localeReady,
      createPanelApi: () => getInpageCommentsPanelApi(),
      domSource: createInpageCommentsDomSource({
        window,
        document,
        getPanelRoot: () => document.getElementById('webclipper-inpage-comments-panel'),
      }),
    });
    lifecycle.addCleanup(inpageComments.cleanup);
    lifecycle.addCleanup(registerWebArticleExtractContentHandlers());

    if (restoreInpageComments) {
      void localeReady
        .catch(() => undefined)
        .then(async () => {
          if (lifecycle.isDisposed()) return;
          await inpageComments.controller.open({
            focusComposer: false,
            ensureArticle: false,
          });
        })
        .catch(() => undefined);
    }

    await localeReady.catch(() => undefined);
    if (lifecycle.isDisposed()) return;
    const itemMentionController = createItemMentionController({ runtime, ui: inpageItemMentionApi });
    const controller = createContentController({
      runtime,
      collectorsRegistry,
      currentPageCapture,
      inpageButton: inpageButtonApi,
      inpageTip: inpageTipApi,
      createRuntimeObserver: createObserver,
      incrementalEngine,
      itemMention: itemMentionController,
    });
    captureCurrentPage = controller.captureCurrentPage;
    const bootstrap = startContentBootstrap({
      runtime,
      inpageButton: inpageButtonApi,
      createController: () => controller,
    });
    lifecycle.addCleanup(() => bootstrap.stop());
  },
});
