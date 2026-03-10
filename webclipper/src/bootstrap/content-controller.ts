import type { CurrentPageCaptureService } from './current-page-capture';
import { t } from '../i18n';
import { AI_CHAT_AUTO_SAVE_COLLECTOR_IDS } from '../collectors/ai-chat-sites';

const STORAGE_KEY_AI_CHAT_AUTO_SAVE_ENABLED = 'ai_chat_auto_save_enabled';

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
  currentPageCapture: CurrentPageCaptureService;
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

function readAiChatAutoSaveEnabled(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const storageApi = (globalThis as any).chrome?.storage ?? (globalThis as any).browser?.storage;
      const local = storageApi?.local;
      if (!local?.get) return resolve(true);
      local.get([STORAGE_KEY_AI_CHAT_AUTO_SAVE_ENABLED], (res: any) => {
        resolve(res?.[STORAGE_KEY_AI_CHAT_AUTO_SAVE_ENABLED] !== false);
      });
    } catch (_e) {
      resolve(true);
    }
  });
}

export function createContentController(deps: Deps) {
  const runtime = deps.runtime;
  const collectorsRegistry = deps.collectorsRegistry;
  const currentPageCapture = deps.currentPageCapture;
  const inpageButton = deps.inpageButton;
  const inpageTip = deps.inpageTip;
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
      } catch (_error) {
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
    const storageApi = (globalThis as any).chrome?.storage ?? (globalThis as any).browser?.storage;
    const hasStorageGet = !!storageApi?.local?.get;
    // Default to enabled when storage API is unavailable (e.g. tests).
    // When storage is available, wait for the async read to avoid a "first tick" auto-save surprise for users who disabled it.
    let aiChatAutoSaveEnabled: boolean | null = hasStorageGet ? null : true;

    void readAiChatAutoSaveEnabled()
      .then((enabled) => {
        aiChatAutoSaveEnabled = enabled === true;
      })
      .catch(() => {
        aiChatAutoSaveEnabled = true;
      });

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
        showInpageTip(t('savingDots'), 'loading');
        return;
      }

      manualSaveInFlight = true;
      try {
        await currentPageCapture.captureCurrentPage({
          onProgress: (progress) => {
            showInpageTip(progress.message, progress.kind === 'default' ? 'ok' : progress.kind);
          },
        });
      } catch (_error) {
        // tip already shown in progress callback
      } finally {
        manualSaveInFlight = false;
      }
    };

    const openPopupPanel = async () => {
      try {
        const response = await send(UI_MESSAGE_TYPES.OPEN_EXTENSION_POPUP);
        if (!response?.ok) showInpageTip(t('clickToolbarIconToOpenPanel'), 'error');
      } catch (_error) {
        showInpageTip(t('clickToolbarIconToOpenPanel'), 'error');
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
          if (collector.id === 'googleaistudio') return;
          if (!AI_CHAT_AUTO_SAVE_COLLECTOR_IDS.has(String(collector.id || ''))) return;
          if (aiChatAutoSaveEnabled !== true) return;

          const snapshot = await Promise.resolve(collector.capture());
          if (!snapshot) return;

          const incremental = incrementalUpdater?.computeIncremental?.(snapshot);
          if (!incremental || !incremental.changed) return;

          const saved = await saveSnapshot(incremental.snapshot);
          if (saved) showInpageTip(t('saved'), 'ok');
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
