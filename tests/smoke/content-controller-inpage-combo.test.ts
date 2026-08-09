import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createContentController } from '@services/bootstrap/content-controller.ts';
import { createCurrentPageCaptureService } from '@services/bootstrap/current-page-capture.ts';

type TickFn = (() => void | Promise<void>) | null;

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://app.notion.com/chat?t=0123456789abcdef0123456789abcdef&wfv=chat',
  });
  const g = globalThis as any;
  g.window = dom.window;
  g.document = dom.window.document;
  g.Node = dom.window.Node;
  g.location = dom.window.location;
  g.KeyboardEvent = dom.window.KeyboardEvent;
  g.MouseEvent = dom.window.MouseEvent;
  g.Event = dom.window.Event;
  g.getComputedStyle = dom.window.getComputedStyle;
  return dom;
}

function createHarness(options?: {
  sendImpl?: (type: string, payload?: any) => Promise<any>;
  captureImpl?: (args?: any) => any;
  prepareImpl?: (args?: any) => any;
  incrementalImpl?: (snapshot: any) => any;
  collectorId?: string;
}) {
  let tickRef: TickFn = null;
  let buttonConfig: any = null;

  const tipCalls: any[] = [];
  const sendCalls: Array<{ type: string; payload?: any }> = [];

  const collector: any = {
    capture: (args?: any) => {
      if (typeof options?.captureImpl === 'function') return options.captureImpl(args);
      return null;
    },
  };
  if (typeof options?.prepareImpl === 'function') collector.prepareManualCapture = options.prepareImpl;

  const runtime = {
    send: async (type: string, payload?: any) => {
      sendCalls.push({ type, payload });
      if (typeof options?.sendImpl === 'function') return options.sendImpl(type, payload);
      return { ok: true, data: {} };
    },
    onInvalidated: () => () => {},
    isInvalidContextError: () => false,
  };

  const collectorsRegistry = {
    pickActive: () => ({ id: options?.collectorId || 'gemini', collector }),
    list: () => [],
  };

  const currentPageCapture = createCurrentPageCaptureService({
    runtime,
    collectorsRegistry,
  });

  const controller = createContentController({
    runtime,
    collectorsRegistry,
    currentPageCapture,
    inpageTip: {
      showSaveTip: (text: unknown, opts: any) => {
        tipCalls.push({ text, opts });
      },
    },
    inpageButton: {
      ensureInpageButton: (cfg: any) => {
        buttonConfig = cfg;
      },
      cleanupButtons: () => {},
    },
    runtimeObserver: {
      createObserver: ({ onTick }: { onTick?: () => void | Promise<void> }) => {
        tickRef = onTick || null;
        return { start: () => {}, stop: () => {} };
      },
    },
    incrementalUpdater: {
      computeIncremental: (snapshot: any) => {
        if (typeof options?.incrementalImpl === 'function') return options.incrementalImpl(snapshot);
        return { changed: false };
      },
    },
    itemMention: null,
  });
  controller.start();

  return {
    tipCalls,
    sendCalls,
    runTick: async () => {
      if (tickRef) await tickRef();
    },
    getButtonConfig: () => buttonConfig,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  const g = globalThis as any;
  delete g.window;
  delete g.document;
  delete g.Node;
  delete g.location;
  delete g.KeyboardEvent;
  delete g.MouseEvent;
  delete g.Event;
  delete g.getComputedStyle;
});

describe('content-controller inpage combo', () => {
  it('wires double-click callback to open comments sidebar', async () => {
    setupDom();
    const harness = createHarness();

    await harness.runTick();
    const cfg = harness.getButtonConfig();

    expect(typeof cfg?.onDoubleClick).toBe('function');
    await cfg.onDoubleClick();

    expect(
      harness.sendCalls.some(
        (c) => c.type === 'openCurrentTabInpageCommentsPanel' && String(c?.payload?.source || '') === 'inpage',
      ),
    ).toBe(true);
    expect(harness.sendCalls.some((c) => c.type === 'upsertConversation')).toBe(false);
    expect(harness.sendCalls.some((c) => c.type === 'syncConversationMessages')).toBe(false);
  });

  it('emits easter-egg line for combo callback', async () => {
    setupDom();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const harness = createHarness();

    await harness.runTick();
    const cfg = harness.getButtonConfig();
    expect(typeof cfg?.onCombo).toBe('function');

    cfg.onCombo({ level: 7, count: 7 });
    expect(harness.tipCalls.some((c) => String(c.text).includes('Combo x7'))).toBe(true);
  });

  it('keeps single click save flow for manual capture', async () => {
    setupDom();
    const harness = createHarness({
      captureImpl: (args) => {
        if (!args || !args.manual) return null;
        return {
          conversation: { source: 'gemini', conversationKey: 'k1' },
          messages: [{ messageKey: 'm1', sequence: 1, role: 'user', contentText: 'hi' }],
        };
      },
      sendImpl: async (type: string) => {
        if (type === 'upsertConversation') return { ok: true, data: { id: 11 } };
        if (type === 'syncConversationMessages') return { ok: true, data: { inserted: 1 } };
        return { ok: true, data: {} };
      },
    });

    await harness.runTick();
    const cfg = harness.getButtonConfig();
    expect(typeof cfg?.onClick).toBe('function');

    await cfg.onClick();

    expect(harness.sendCalls.some((c) => c.type === 'upsertConversation')).toBe(true);
    expect(harness.sendCalls.some((c) => c.type === 'syncConversationMessages')).toBe(true);
    expect(harness.tipCalls.some((c) => c.opts?.kind === 'default')).toBe(true);
  });

  it.each(['chatgpt', 'googleaistudio'])(
    'manual button passes the exact prepared object once for %s',
    async (collectorId) => {
      setupDom();
      const prepared = { source: collectorId, token: Symbol(collectorId) };
      const prepareImpl = vi.fn(() => prepared);
      const captureImpl = vi.fn((_args?: any) => ({
        conversation: {
          source: collectorId,
          conversationKey: `${collectorId}-1`,
          url: collectorId === 'chatgpt' ? 'https://chatgpt.com/c/1' : 'https://aistudio.google.com/app/1',
        },
        messages: [{ messageKey: 'm1', sequence: 0, role: 'user', contentText: 'hi' }],
        captureMeta: { completeness: 'complete', identityVerified: true, reasons: [] },
      }));
      const harness = createHarness({
        collectorId,
        prepareImpl,
        captureImpl,
        sendImpl: async (type: string) => {
          if (type === 'upsertConversation') return { ok: true, data: { id: 11 } };
          if (type === 'syncConversationMessages') return { ok: true, data: { inserted: 1 } };
          return { ok: true, data: {} };
        },
      });

      await harness.runTick();
      await harness.getButtonConfig().onClick();

      expect(prepareImpl).toHaveBeenCalledTimes(1);
      expect(captureImpl).toHaveBeenCalledTimes(1);
      expect(captureImpl.mock.calls[0][0].preparedCapture).toBe(prepared);
    },
  );

  it('shows error tip when manual capture finds no visible conversation', async () => {
    setupDom();
    const harness = createHarness({
      captureImpl: (args) => {
        if (!args || !args.manual) return null;
        return null;
      },
    });

    await harness.runTick();
    const cfg = harness.getButtonConfig();
    expect(typeof cfg?.onClick).toBe('function');

    await cfg.onClick();

    expect(harness.tipCalls.some((c) => String(c.text).includes('No visible conversation'))).toBe(true);
    expect(harness.tipCalls.some((c) => c.opts?.kind === 'ok')).toBe(false);
  });

  it('shows tip when auto incremental save succeeds', async () => {
    setupDom();
    const snapshot = {
      conversation: { source: 'gemini', conversationKey: 'auto-1' },
      messages: [{ messageKey: 'm1', sequence: 1, role: 'user', contentText: 'hello' }],
    };

    const harness = createHarness({
      captureImpl: () => snapshot,
      incrementalImpl: (snap) => ({ changed: true, snapshot: snap }),
      sendImpl: async (type: string) => {
        if (type === 'upsertConversation') return { ok: true, data: { id: 22 } };
        if (type === 'syncConversationMessages') return { ok: true, data: { inserted: 1 } };
        return { ok: true, data: {} };
      },
    });

    await harness.runTick();

    expect(harness.sendCalls.some((c) => c.type === 'upsertConversation')).toBe(true);
    expect(harness.sendCalls.some((c) => c.type === 'syncConversationMessages')).toBe(true);
    expect(harness.tipCalls.some((c) => String(c.text) === 'Saved')).toBe(true);
  });

  it('skips auto-save when chatgpt deep research message is still a placeholder', async () => {
    setupDom();
    const snapshot = {
      conversation: { source: 'chatgpt', conversationKey: 'auto-dr-placeholder-1' },
      messages: [
        {
          role: 'assistant',
          contentText:
            'Deep Research (iframe): https://connector_openai_deep_research.web-sandbox.oaiusercontent.com?app=chatgpt&locale=en-US&deviceType=desktop',
          contentMarkdown:
            'Deep Research (iframe): https://connector_openai_deep_research.web-sandbox.oaiusercontent.com?app=chatgpt&locale=en-US&deviceType=desktop',
        },
      ],
    };

    const harness = createHarness({
      collectorId: 'chatgpt',
      captureImpl: () => snapshot,
      incrementalImpl: () => {
        throw new Error('incremental should not run when placeholder is present');
      },
    });

    await harness.runTick();

    expect(harness.sendCalls.some((c) => c.type === 'upsertConversation')).toBe(false);
    expect(harness.sendCalls.some((c) => c.type === 'syncConversationMessages')).toBe(false);
    expect(harness.tipCalls.length).toBe(0);
  });

  it('does not auto-save chatgpt deep research after ChatGPT became manual-capture only', async () => {
    setupDom();
    vi.useFakeTimers();

    const snapshot = {
      conversation: { source: 'chatgpt', conversationKey: 'auto-dr-hydrate-1' },
      messages: [
        {
          role: 'assistant',
          contentText:
            'Deep Research (iframe): https://connector_openai_deep_research.web-sandbox.oaiusercontent.com?app=chatgpt&locale=en-US&deviceType=desktop',
          contentMarkdown:
            'Deep Research (iframe): https://connector_openai_deep_research.web-sandbox.oaiusercontent.com?app=chatgpt&locale=en-US&deviceType=desktop',
        },
      ],
    };

    let extractCalls = 0;
    const harness = createHarness({
      collectorId: 'chatgpt',
      captureImpl: () => snapshot,
      incrementalImpl: () => {
        throw new Error('incremental should not run for chatgpt autosave');
      },
      sendImpl: async (type: string, payload?: any) => {
        if (type === 'chatgptExtractDeepResearch') {
          extractCalls += 1;
          if (extractCalls === 1) return { ok: true, data: { items: [] } };
          return {
            ok: true,
            data: {
              items: [
                {
                  href: payload?.urls?.[0],
                  title: 'Deep Research',
                  text: 'x'.repeat(400),
                  markdown: '# Deep Research\n\n' + 'x'.repeat(400),
                },
              ],
            },
          };
        }
        if (type === 'upsertConversation') return { ok: true, data: { id: 33 } };
        if (type === 'syncConversationMessages') return { ok: true, data: { inserted: 1 } };
        return { ok: true, data: {} };
      },
    });

    await harness.runTick();
    expect(harness.sendCalls.some((c) => c.type === 'upsertConversation')).toBe(false);

    await vi.advanceTimersByTimeAsync(15_000);

    expect(harness.sendCalls.some((c) => c.type === 'chatgptExtractDeepResearch')).toBe(false);
    expect(harness.sendCalls.some((c) => c.type === 'upsertConversation')).toBe(false);
    expect(harness.sendCalls.some((c) => c.type === 'syncConversationMessages')).toBe(false);
    expect(harness.tipCalls.some((c) => String(c.text) === 'Saved')).toBe(false);

    vi.useRealTimers();
  });

  it('proactively captures notionai after clicking send before observer mutations settle', async () => {
    setupDom();
    vi.useFakeTimers();

    const snapshot = {
      conversation: { source: 'notionai', conversationKey: 'notionai_t_1' },
      messages: [{ messageKey: 'user_u1', sequence: 1, role: 'user', contentText: 'just sent' }],
    };

    const harness = createHarness({
      collectorId: 'notionai',
      captureImpl: () => snapshot,
      incrementalImpl: (snap) => ({
        changed: true,
        snapshot: snap,
        diff: { added: ['user_u1'], updated: [], removed: [] },
      }),
      sendImpl: async (type: string) => {
        if (type === 'upsertConversation') return { ok: true, data: { id: 31 } };
        if (type === 'syncConversationMessages') return { ok: true, data: { inserted: 1 } };
        return { ok: true, data: {} };
      },
    });

    const button = document.createElement('div');
    button.setAttribute('role', 'button');
    button.setAttribute('data-testid', 'agent-send-message-button');
    document.body.appendChild(button);

    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await vi.runAllTimersAsync();

    expect(harness.sendCalls.some((c) => c.type === 'upsertConversation')).toBe(true);
    expect(harness.sendCalls.some((c) => c.type === 'syncConversationMessages')).toBe(true);

    button.remove();
    vi.useRealTimers();
  });

  it('does not proactively capture notionai on Shift+Enter draft newlines', async () => {
    setupDom();
    vi.useFakeTimers();

    const harness = createHarness({
      collectorId: 'notionai',
      captureImpl: () => ({
        conversation: { source: 'notionai', conversationKey: 'notionai_t_2' },
        messages: [{ messageKey: 'user_u2', sequence: 1, role: 'user', contentText: 'draft' }],
      }),
      incrementalImpl: (snap) => ({
        changed: true,
        snapshot: snap,
        diff: { added: ['user_u2'], updated: [], removed: [] },
      }),
      sendImpl: async (type: string) => {
        if (type === 'upsertConversation') return { ok: true, data: { id: 32 } };
        if (type === 'syncConversationMessages') return { ok: true, data: { inserted: 1 } };
        return { ok: true, data: {} };
      },
    });

    const composer = document.createElement('div');
    composer.setAttribute('role', 'textbox');
    composer.setAttribute('data-content-editable-leaf', 'true');
    composer.setAttribute('contenteditable', 'true');
    document.body.appendChild(composer);

    composer.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }),
    );
    await vi.runAllTimersAsync();

    expect(harness.sendCalls.some((c) => c.type === 'upsertConversation')).toBe(false);
    expect(harness.sendCalls.some((c) => c.type === 'syncConversationMessages')).toBe(false);

    composer.remove();
    vi.useRealTimers();
  });

  it('disables auto-save for googleaistudio to avoid virtualized truncation', async () => {
    const snapshot = {
      conversation: { source: 'googleaistudio', conversationKey: 'auto-ai-studio-1' },
      messages: [{ messageKey: 'm1', sequence: 1, role: 'user', contentText: 'hello' }],
    };

    const harness = createHarness({
      collectorId: 'googleaistudio',
      captureImpl: () => snapshot,
      incrementalImpl: (snap) => ({ changed: true, snapshot: snap }),
      sendImpl: async (type: string) => {
        if (type === 'upsertConversation') return { ok: true, data: { id: 22 } };
        if (type === 'syncConversationMessages') return { ok: true, data: { inserted: 1 } };
        return { ok: true, data: {} };
      },
    });

    await harness.runTick();

    expect(harness.sendCalls.some((c) => c.type === 'upsertConversation')).toBe(false);
    expect(harness.sendCalls.some((c) => c.type === 'syncConversationMessages')).toBe(false);
    expect(harness.tipCalls.some((c) => String(c.text) === 'Saved')).toBe(false);
  });

  it('ignores repeated manual clicks while a save is still in progress', async () => {
    let resolveUpsert!: (value: void | PromiseLike<void>) => void;
    const upsertPending = new Promise<void>((resolve) => {
      resolveUpsert = resolve;
    });

    const harness = createHarness({
      captureImpl: (args) => {
        if (!args || !args.manual) return null;
        return {
          conversation: { source: 'gemini', conversationKey: 'lock-1' },
          messages: [{ messageKey: 'm1', sequence: 1, role: 'user', contentText: 'hi' }],
        };
      },
      sendImpl: async (type: string) => {
        if (type === 'upsertConversation') {
          await upsertPending;
          return { ok: true, data: { id: 31 } };
        }
        if (type === 'syncConversationMessages') return { ok: true, data: { inserted: 1 } };
        return { ok: true, data: {} };
      },
    });

    await harness.runTick();
    const cfg = harness.getButtonConfig();
    expect(typeof cfg?.onClick).toBe('function');

    const firstClick = cfg.onClick();
    const secondClick = cfg.onClick();
    await Promise.resolve();

    expect(harness.sendCalls.filter((c) => c.type === 'upsertConversation')).toHaveLength(1);

    resolveUpsert(undefined);
    await firstClick;
    await secondClick;

    expect(harness.sendCalls.filter((c) => c.type === 'syncConversationMessages')).toHaveLength(1);
  });
});
