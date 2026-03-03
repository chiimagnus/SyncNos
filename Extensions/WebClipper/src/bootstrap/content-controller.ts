type RuntimeClient = {
  send?: (type: string, payload?: Record<string, unknown>) => Promise<any>;
  onInvalidated?: (listener: (error: Error) => void) => () => void;
  isInvalidContextError?: (error: unknown) => boolean;
};

type CollectorRegistry = {
  pickActive?: () => { id: string; collector: any } | null;
  list?: () => Array<{ id: string; collector?: any; matches?: (loc: any) => boolean; inpageMatches?: (loc: any) => boolean }>;
};

type InpageButtonApi = {
  ensureInpageButton?: (input: {
    collectorId?: string;
    onClick?: () => void;
    onDoubleClick?: () => void;
    onCombo?: (payload: { level: number; count?: number }) => void;
  }) => void;
  cleanupButtons?: (collectorId: string) => void;
};

type InpageTipApi = {
  showSaveTip?: (text: unknown, options?: { kind?: 'default' | 'loading' | 'error' }) => void;
};

type RuntimeObserverApi = {
  createObserver?: (input: {
    debounceMs?: number;
    getRoot?: () => Node | null;
    onTick?: () => void | Promise<void>;
    leading?: boolean;
  }) => { start?: () => void; stop?: () => void } | null;
};

type Deps = {
  runtime: RuntimeClient | null;
  collectorsRegistry: CollectorRegistry | null;
  inpageButton: InpageButtonApi | null;
  inpageTip: InpageTipApi | null;
  runtimeObserver: RuntimeObserverApi | null;
  incrementalUpdater: { computeIncremental?: (snapshot: unknown) => any } | null;
  notionAiModelPicker: { maybeApply?: () => void } | null;
};

const CORE_MESSAGE_TYPES = Object.freeze({
  UPSERT_CONVERSATION: 'upsertConversation',
  SYNC_CONVERSATION_MESSAGES: 'syncConversationMessages',
});

const ARTICLE_MESSAGE_TYPES = Object.freeze({
  FETCH_ACTIVE_TAB: 'fetchActiveTabArticle',
});

const UI_MESSAGE_TYPES = Object.freeze({
  OPEN_EXTENSION_POPUP: 'openExtensionPopup',
});

const EASTER_EGG_LINES = Object.freeze({
  3: ['Combo x3! Nice rhythm.', 'Three taps. Paw approved.'],
  5: ['Combo x5! Beast mode on.', 'Five-hit streak. Zoomies unlocked.'],
  7: ['Combo x7! Legendary paws.', 'Seven-hit streak. Animal boss mood.'],
});

function pickLineByLevel(level: number): string {
  const lines = (EASTER_EGG_LINES as any)[level];
  if (!Array.isArray(lines) || !lines.length) return '';
  const index = Math.floor(Math.random() * lines.length);
  return lines[index] || lines[0] || '';
}

function errorMessage(error: unknown, fallback: string): string {
  const maybeError = error as { message?: unknown };
  const message = maybeError?.message ?? error;
  const normalized = String(message || fallback || 'Save failed').trim();
  return normalized || fallback || 'Save failed';
}

export function createContentController(deps: Deps) {
  const runtime = deps.runtime;
  const inpageButton = deps.inpageButton;
  const inpageTip = deps.inpageTip;
  const collectorsRegistry = deps.collectorsRegistry;
  const runtimeObserver = deps.runtimeObserver;
  const incrementalUpdater = deps.incrementalUpdater;
  const notionAiModelPicker = deps.notionAiModelPicker;

  function toTipKind(kind?: unknown): 'default' | 'loading' | 'error' | undefined {
    const value = String(kind || '').trim().toLowerCase();
    if (!value) return undefined;
    if (value === 'ok') return 'default';
    if (value === 'default' || value === 'loading' || value === 'error') return value;
    return undefined;
  }

  function showInpageTip(text: string, kind?: string) {
    inpageTip?.showSaveTip?.(text, { kind: toTipKind(kind) });
  }

  function send(type: string, payload?: Record<string, unknown>) {
    if (!runtime || typeof runtime.send !== 'function') {
      return Promise.reject(new Error('runtime client unavailable'));
    }
    return runtime.send(type, payload);
  }

  async function runManualSaveFlow(input: { startText: string; run: () => Promise<any> }) {
    showInpageTip(input.startText || 'Saving...', 'loading');
    try {
      const value = await input.run();
      showInpageTip('Saved', 'ok');
      return value;
    } catch (error) {
      showInpageTip(errorMessage(error, 'Save failed'), 'error');
      throw error;
    }
  }

  function getCollector() {
    const picked = collectorsRegistry?.pickActive?.();
    if (!picked || !picked.collector) return null;
    return { id: picked.id, ...picked.collector };
  }

  function getInpageCollector() {
    const list = collectorsRegistry?.list?.() || [];
    if (!Array.isArray(list) || !list.length) return null;
    const locationPayload = {
      href: location.href,
      hostname: location.hostname,
      pathname: location.pathname,
    };
    for (const item of list) {
      if (!item) continue;
      const matcher = typeof item.inpageMatches === 'function' ? item.inpageMatches : item.matches;
      if (typeof matcher !== 'function') continue;
      try {
        if (matcher(locationPayload)) return { id: item.id, ...(item.collector || {}) };
      } catch (_e) {
        // ignore matcher errors
      }
    }
    return null;
  }

  async function saveSnapshot(snapshot: any) {
    if (!snapshot || !snapshot.conversation) return null;

    const conversationRes = await send(CORE_MESSAGE_TYPES.UPSERT_CONVERSATION, {
      payload: snapshot.conversation,
    });
    if (!conversationRes?.ok) {
      throw new Error(conversationRes?.error?.message || 'upsertConversation failed');
    }

    const conversation = conversationRes.data;
    const messagesRes = await send(CORE_MESSAGE_TYPES.SYNC_CONVERSATION_MESSAGES, {
      conversationId: conversation.id,
      messages: snapshot.messages || [],
    });
    if (!messagesRes?.ok) {
      throw new Error(messagesRes?.error?.message || 'syncConversationMessages failed');
    }

    return { conversationId: conversation.id };
  }

  function createAutoCaptureController() {
    let stopped = false;
    let manualSaveInFlight = false;
    let observer: { start?: () => void; stop?: () => void } | null = null;

    function stop() {
      if (stopped) return;
      stopped = true;
      inpageButton?.cleanupButtons?.('');
      observer?.stop?.();
    }

    runtime?.onInvalidated?.(() => stop());

    const clickSave = async () => {
      if (stopped) return;
      if (manualSaveInFlight) {
        showInpageTip('Saving...', 'loading');
        return;
      }
      manualSaveInFlight = true;
      try {
        const collector = getCollector() || getInpageCollector();
        if (!collector) return;

        if (collector.id === 'web') {
          await runManualSaveFlow({
            startText: 'Saving...',
            run: async () => {
              const response = await send(ARTICLE_MESSAGE_TYPES.FETCH_ACTIVE_TAB);
              if (!response?.ok) {
                throw new Error(response?.error?.message || 'Fetch failed');
              }
              return response;
            },
          });
          return;
        }

        if (typeof collector.capture !== 'function') return;
        await runManualSaveFlow({
          startText:
            typeof collector.prepareManualCapture === 'function'
              ? 'Loading full history...'
              : 'Saving...',
          run: async () => {
            if (typeof collector.prepareManualCapture === 'function') {
              await collector.prepareManualCapture();
              showInpageTip('Saving...', 'loading');
            }
            const snapshot = await Promise.resolve(collector.capture({ manual: true }));
            if (!snapshot) throw new Error('No visible conversation found');
            const saved = await saveSnapshot(snapshot);
            if (!saved) throw new Error('No visible conversation found');
            return saved;
          },
        });
      } catch (_e) {
        // tip already shown
      } finally {
        manualSaveInFlight = false;
      }
    };

    const openPopupPanel = async () => {
      try {
        const response = await send(UI_MESSAGE_TYPES.OPEN_EXTENSION_POPUP);
        if (!response?.ok) showInpageTip('Click toolbar icon to open panel', 'error');
      } catch (_e) {
        showInpageTip('Click toolbar icon to open panel', 'error');
      }
    };

    const showComboLine = (payload: { level: number }) => {
      const level = Number(payload?.level);
      if (!Number.isFinite(level)) return;
      const line = pickLineByLevel(level);
      if (line) showInpageTip(line);
    };

  function refreshInpageButton() {
    const collector = getCollector();
    const inpageCollector = collector || getInpageCollector();
    inpageButton?.cleanupButtons?.(inpageCollector?.id || '');
    inpageButton?.ensureInpageButton?.({
      collectorId: inpageCollector?.id,
      onClick: clickSave,
      onDoubleClick: openPopupPanel,
        onCombo: showComboLine,
      });
      return collector;
    }

    observer = runtimeObserver?.createObserver?.({
      debounceMs: 600,
      getRoot: () => {
        if (stopped) return null;
        const collector = getCollector();
        return collector && typeof collector.getRoot === 'function' ? collector.getRoot() : null;
      },
      onTick: async () => {
        if (stopped) return;
        try {
          notionAiModelPicker?.maybeApply?.();

          const collector = refreshInpageButton();
          if (!collector || typeof collector.capture !== 'function') return;

          // Google AI Studio uses virtualized rendering; auto-capture often sees only the visible turns
          // and would overwrite history. Keep manual save only for this source.
          if (collector.id === 'googleaistudio') return;

          const snapshot = await Promise.resolve(collector.capture());
          if (!snapshot) return;

          const incremental = incrementalUpdater?.computeIncremental?.(snapshot);
          if (!incremental || !incremental.changed) return;

          const saved = await saveSnapshot(incremental.snapshot);
          if (saved) showInpageTip('Saved', 'ok');
        } catch (error) {
          if (runtime?.isInvalidContextError?.(error)) {
            stop();
            return;
          }
          console.error('WebClipper auto-save failed:', error);
        }
      },
    }) || null;

    return {
      start() {
        if (!stopped) observer?.start?.();
      },
      stop,
    };
  }

  return {
    start() {
      const controller = createAutoCaptureController();
      controller.start();
      return controller;
    },
  };
}
