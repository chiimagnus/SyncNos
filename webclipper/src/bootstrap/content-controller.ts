import type { CurrentPageCaptureService } from './current-page-capture';
import { t } from '../i18n';
import { AI_CHAT_AUTO_SAVE_COLLECTOR_IDS } from '../collectors/ai-chat-sites';
import { hydrateChatgptDeepResearchSnapshot } from '../collectors/chatgpt/chatgpt-deep-research-hydrator';

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
  setSaving?: (saving: boolean) => void;
};

type InpageTipApi = {
  showSaveTip?: (text: unknown, options?: { kind?: 'default' | 'error' }) => void;
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

  function toTipKind(kind?: unknown): 'default' | 'error' | undefined {
    const value = String(kind || '').trim().toLowerCase();
    if (!value) return undefined;
    if (value === 'ok') return 'default';
    if (value === 'default' || value === 'error') return value;
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

  async function saveSnapshot(
    snapshot: any,
    options?: { mode?: 'snapshot' | 'incremental' | 'append'; diff?: { added?: string[]; updated?: string[]; removed?: string[] } },
  ) {
    if (!snapshot || !snapshot.conversation) return null;

    if (options?.mode !== 'incremental') {
      try {
        const isChatgpt = String(snapshot?.conversation?.source || '').trim().toLowerCase() === 'chatgpt';
        const hasDeepResearchPlaceholders =
          isChatgpt &&
          Array.isArray(snapshot?.messages) &&
          snapshot.messages.some((m: any) => String(m?.contentText || m?.contentMarkdown || '').trim().startsWith('Deep Research (iframe):'));
        if (hasDeepResearchPlaceholders) {
          await hydrateChatgptDeepResearchSnapshot(snapshot, send);
        }
      } catch (_e) {
        // ignore hydration failures
      }
    }

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
      mode: options?.mode || 'snapshot',
      diff: options?.diff || null,
      conversationSourceType: snapshot?.conversation?.sourceType || 'chat',
      conversationUrl: snapshot?.conversation?.url || '',
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
    let deepResearchHydrateInFlight = false;
    let deepResearchLastHydrateAttemptAt = 0;
    let deepResearchPollTimer: ReturnType<typeof setTimeout> | null = null;
    let deepResearchPollStartedAt = 0;
    const DEEP_RESEARCH_POLL_INTERVAL_MS = 5_000;
    const DEEP_RESEARCH_POLL_MAX_DURATION_MS = 3 * 60_000;
    const DEEP_RESEARCH_HYDRATE_MIN_INTERVAL_MS = 12_000;
    const storageApi = (globalThis as any).chrome?.storage ?? (globalThis as any).browser?.storage;
    const hasStorageGet = !!storageApi?.local?.get;
    // Default to enabled when storage API is unavailable (e.g. tests).
    // When storage is available, wait for the async read to avoid a "first tick" auto-save surprise for users who disabled it.
    let aiChatAutoSaveEnabled: boolean | null = hasStorageGet ? null : true;
    let savingDepth = 0;

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
      savingDepth = 0;
      inpageButton?.setSaving?.(false);
      inpageButton?.cleanupButtons?.('');
      if (deepResearchPollTimer) {
        clearTimeout(deepResearchPollTimer);
        deepResearchPollTimer = null;
      }
      observer?.stop?.();
    }

    runtime?.onInvalidated?.(() => stop());

    function hasChatgptDeepResearchPlaceholderMessages(snapshot: any): boolean {
      return (
        Array.isArray(snapshot?.messages) &&
        snapshot.messages.some((m: any) =>
          String(m?.contentText || m?.contentMarkdown || '')
            .trim()
            .startsWith('Deep Research (iframe):'),
        )
      );
    }

    function clearDeepResearchPoll() {
      if (deepResearchPollTimer) {
        clearTimeout(deepResearchPollTimer);
        deepResearchPollTimer = null;
      }
      deepResearchPollStartedAt = 0;
    }

    function ensureDeepResearchPoll(handleTick: () => Promise<void>) {
      if (deepResearchPollTimer) return;
      const now = Date.now();
      if (!deepResearchPollStartedAt) deepResearchPollStartedAt = now;
      if (now - deepResearchPollStartedAt > DEEP_RESEARCH_POLL_MAX_DURATION_MS) return;

      deepResearchPollTimer = setTimeout(() => {
        deepResearchPollTimer = null;
        void handleTick();
      }, DEEP_RESEARCH_POLL_INTERVAL_MS);
    }

    function beginSaving() {
      savingDepth += 1;
      if (savingDepth === 1) inpageButton?.setSaving?.(true);
    }

    function endSaving() {
      savingDepth = Math.max(0, savingDepth - 1);
      if (savingDepth === 0) inpageButton?.setSaving?.(false);
    }

    const clickSave = async () => {
      if (stopped) return;
      if (manualSaveInFlight) {
        inpageButton?.setSaving?.(true);
        return;
      }

      manualSaveInFlight = true;
      beginSaving();
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
        endSaving();
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

    const handleTick = async () => {
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

        const isChatgpt = String(collector.id || '').trim().toLowerCase() === 'chatgpt';
        if (isChatgpt && hasChatgptDeepResearchPlaceholderMessages(snapshot)) {
          // Deep Research reports load inside a cross-origin iframe and may initially be captured as a placeholder URL.
          // Poll and hydrate until the report becomes available, then proceed with incremental auto-save.
          ensureDeepResearchPoll(handleTick);

          const now = Date.now();
          const canHydrate =
            !deepResearchHydrateInFlight &&
            now - deepResearchLastHydrateAttemptAt >= DEEP_RESEARCH_HYDRATE_MIN_INTERVAL_MS;
          if (!canHydrate) return;

          deepResearchHydrateInFlight = true;
          deepResearchLastHydrateAttemptAt = now;
          beginSaving();
          try {
            await hydrateChatgptDeepResearchSnapshot(snapshot, send);
          } catch (_e) {
            // ignore hydration failures
          } finally {
            deepResearchHydrateInFlight = false;
            endSaving();
          }

          if (hasChatgptDeepResearchPlaceholderMessages(snapshot)) return;
          clearDeepResearchPoll();
        } else {
          clearDeepResearchPoll();
        }

        const incremental = incrementalUpdater?.computeIncremental?.(snapshot);
        if (!incremental || !incremental.changed) return;

        beginSaving();
        try {
          const saved = await saveSnapshot(incremental.snapshot, { mode: 'append', diff: incremental.diff });
          if (saved) showInpageTip(t('saved'), 'ok');
        } finally {
          endSaving();
        }
      } catch (error) {
        if (runtime?.isInvalidContextError?.(error)) {
          stop();
          return;
        }
        console.error('WebClipper auto-save failed:', error);
      }
    };

    observer = runtimeObserver?.createObserver?.({
      debounceMs: 600,
      getRoot: () => {
        if (stopped) return null;
        const collector = getCollector();
        return collector && typeof collector.getRoot === 'function' ? collector.getRoot() : null;
      },
      onTick: handleTick,
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
