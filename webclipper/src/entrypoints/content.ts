import '../ui/styles/tokens.css';

import { createContentController } from '../bootstrap/content-controller.ts';
import { registerCurrentPageCaptureContentHandlers } from '../bootstrap/current-page-capture-content-handlers.ts';
import { createCurrentPageCaptureService } from '../bootstrap/current-page-capture.ts';
import { startContentBootstrap } from '../bootstrap/content.ts';
import { registerInpageCommentsPanelContentHandlers } from '../bootstrap/inpage-comments-panel-content-handlers.ts';
import { registerInpageCommentsLocateContentHandlers } from '../bootstrap/inpage-comments-locate-content-handlers.ts';
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
import { COMMENTS_MESSAGE_TYPES } from '../platform/messaging/message-contracts';

const STORAGE_KEY_INPAGE_COMMENTS_AUTO_OPEN = 'inpage_comments_auto_open_enabled';

function safeString(value: unknown): string {
  return String(value || '').trim();
}

function normalizeHttpUrl(raw: unknown): string {
  const text = safeString(raw);
  if (!text) return '';
  try {
    const url = new URL(text);
    const protocol = safeString(url.protocol).toLowerCase();
    if (protocol !== 'http:' && protocol !== 'https:') return '';
    url.hash = '';
    return url.toString();
  } catch (_e) {
    return '';
  }
}

function isTopFrame(): boolean {
  try {
    return !globalThis.top || globalThis.top === globalThis.self;
  } catch (_e) {
    return true;
  }
}

function readCommentsAutoOpenSetting(): Promise<boolean> {
  const storageApi = (globalThis as any).chrome?.storage ?? (globalThis as any).browser?.storage;
  return new Promise((resolve) => {
    try {
      const local = storageApi?.local;
      if (!local?.get) return resolve(true);
      local.get([STORAGE_KEY_INPAGE_COMMENTS_AUTO_OPEN], (res: any) => {
        resolve(res?.[STORAGE_KEY_INPAGE_COMMENTS_AUTO_OPEN] !== false);
      });
    } catch (_e) {
      resolve(true);
    }
  });
}

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
    registerInpageCommentsLocateContentHandlers();
    const { controller: inpageCommentsController } = registerInpageCommentsPanelContentHandlers(runtime);

    void (async () => {
      if (!isTopFrame()) return;
      const enabled = await readCommentsAutoOpenSetting();
      if (!enabled) return;
      const canonicalUrl = normalizeHttpUrl(location.href);
      if (!canonicalUrl) return;
      const res: any = await runtime.send(COMMENTS_MESSAGE_TYPES.HAS_ARTICLE_COMMENTS, { canonicalUrl });
      const hasAny = res?.ok === true && res?.data?.hasAny === true;
      if (!hasAny) return;
      await inpageCommentsController.open({ focusEditor: false, ensureArticle: false });
    })().catch(() => {});

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
