import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initializeLocale: vi.fn(),
  startContentBootstrap: vi.fn(),
  createContentController: vi.fn(),
  createItemMentionController: vi.fn(),
  createRuntimeClient: vi.fn(() => ({})),
  createCollectorEnv: vi.fn(() => ({})),
  createCollectorsRegistry: vi.fn(() => ({})),
  registerAllCollectors: vi.fn(),
  createCurrentPageCaptureService: vi.fn(() => ({})),
  createVideoTranscriptCaptureService: vi.fn(() => ({})),
  createInpageCommentsDomSource: vi.fn(() => ({
    resolveComposerSelection: () => ({ selectionText: '', locator: null }),
    isTopFrame: () => true,
    readPageUrl: () => 'https://example.com/',
  })),
  getInpageCommentsPanelApi: vi.fn(() => ({
    attachHost: () => ({ dispose: () => {} }),
  })),
}));

vi.mock('@i18n', () => ({ initializeLocale: mocks.initializeLocale }));
vi.mock('@services/bootstrap/content.ts', () => ({ startContentBootstrap: mocks.startContentBootstrap }));
vi.mock('@services/bootstrap/content-controller.ts', () => ({
  createContentController: mocks.createContentController,
}));
vi.mock('@services/integrations/item-mention/content/mention-controller', () => ({
  createItemMentionController: mocks.createItemMentionController,
}));
vi.mock('@platform/runtime/client.ts', () => ({ createRuntimeClient: mocks.createRuntimeClient }));
vi.mock('@collectors/collector-env.ts', () => ({ createCollectorEnv: mocks.createCollectorEnv }));
vi.mock('@collectors/registry.ts', () => ({ createCollectorsRegistry: mocks.createCollectorsRegistry }));
vi.mock('@collectors/register-all.ts', () => ({ registerAllCollectors: mocks.registerAllCollectors }));
vi.mock('@services/bootstrap/current-page-capture.ts', () => ({
  createCurrentPageCaptureService: mocks.createCurrentPageCaptureService,
}));
vi.mock('@services/bootstrap/video-transcript-capture', () => ({
  createVideoTranscriptCaptureService: mocks.createVideoTranscriptCaptureService,
}));
vi.mock('@ui/inpage/inpage-comments-panel-shadow.ts', () => ({
  createInpageCommentsDomSource: mocks.createInpageCommentsDomSource,
  getInpageCommentsPanelApi: mocks.getInpageCommentsPanelApi,
}));
vi.mock('@ui/inpage/inpage-button-shadow.ts', () => ({ inpageButtonApi: {} }));
vi.mock('@ui/inpage/inpage-item-mention-shadow.ts', () => ({ inpageItemMentionApi: {} }));
vi.mock('@ui/inpage/inpage-tip-shadow.ts', () => ({ inpageTipApi: {} }));
vi.mock('@collectors/runtime-observer.ts', () => ({ default: {} }));
vi.mock('@services/conversations/content/incremental-updater.ts', () => ({ default: {} }));
vi.mock('@services/shared/normalize.ts', () => ({ default: {} }));

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

async function loadContentMain() {
  let main: (() => Promise<void> | void) | null = null;
  vi.stubGlobal('defineContentScript', (config: { main: () => Promise<void> | void }) => {
    main = config.main;
    return config;
  });
  await import('../../src/entrypoints/content.ts');
  if (!main) throw new Error('content main was not registered');
  return main;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.createContentController.mockReturnValue({});
  mocks.createItemMentionController.mockReturnValue({});
  vi.stubGlobal('window', {} as Window);
  vi.stubGlobal('document', {} as Document);
  vi.stubGlobal('location', { hostname: 'example.com' } as Location);
  // @ts-expect-error test global cleanup
  delete globalThis.browser;
  // @ts-expect-error test global cleanup
  delete globalThis.chrome;
});

describe('content entrypoint listener readiness', () => {
  it('routes an early current-page manual request through the controller persistence gate after readiness', async () => {
    const locale = deferred<void>();
    mocks.initializeLocale.mockReturnValue(locale.promise);
    const rawCapture = vi.fn(async () => ({ title: 'raw' }));
    const gatedCapture = vi.fn(async () => ({ title: 'gated' }));
    mocks.createCurrentPageCaptureService.mockReturnValue({
      getCurrentPageCaptureState: vi.fn(() => ({ available: true })),
      captureCurrentPage: rawCapture,
    });
    mocks.createContentController.mockReturnValue({ captureCurrentPage: gatedCapture });

    const listeners: any[] = [];
    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener: any) => listeners.push(listener)),
          removeListener: vi.fn(),
        },
      },
    };

    const main = await loadContentMain();
    const started = Promise.resolve(main());
    await flushMicrotasks();
    expect(listeners).toHaveLength(4);

    let response: any = null;
    expect(
      listeners[0]?.({ type: 'captureCurrentPage', payload: { source: 'popup' } }, {}, (value: any) => {
        response = value;
      }),
    ).toBe(true);
    await flushMicrotasks();
    expect(rawCapture).not.toHaveBeenCalled();
    expect(gatedCapture).not.toHaveBeenCalled();

    locale.resolve();
    await started;
    await flushMicrotasks();

    expect(gatedCapture).toHaveBeenCalledTimes(1);
    expect(rawCapture).not.toHaveBeenCalled();
    expect(response?.ok).toBe(true);
    expect(response?.data).toEqual({ title: 'gated' });
  });

  it('registers content message listeners before locale readiness settles', async () => {
    const locale = deferred<void>();
    mocks.initializeLocale.mockReturnValue(locale.promise);

    const addListener = vi.fn();
    // @ts-expect-error test global
    globalThis.chrome = {
      runtime: {
        onMessage: {
          addListener,
          removeListener: vi.fn(),
        },
      },
    };

    const main = await loadContentMain();
    const started = Promise.resolve(main());
    await flushMicrotasks();

    expect(addListener).toHaveBeenCalledTimes(4);
    expect(mocks.startContentBootstrap).not.toHaveBeenCalled();
    expect(mocks.createContentController).not.toHaveBeenCalled();

    locale.resolve();
    await started;
    expect(mocks.startContentBootstrap).toHaveBeenCalledTimes(1);
    expect(mocks.createContentController).toHaveBeenCalledTimes(1);
  });
});
