import type { CurrentPageCaptureService } from '@services/bootstrap/current-page-capture';
import { AI_CHAT_AUTO_SAVE_COLLECTOR_IDS } from '@collectors/ai-chat-sites';
import { hydrateChatgptDeepResearchSnapshot } from '@collectors/chatgpt/chatgpt-deep-research-hydrator';
import { buildCaptureSuccessTipMessage } from '@services/shared/capture-tip';
import normalizeApi from '@services/shared/normalize.ts';
import { UI_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { reconcileAutoSaveBackfill } from '@services/conversations/content/autosave-backfill-reconciler';
import {
  readInpageButtonGlobalPosition,
  writeInpageButtonGlobalPosition,
} from '@platform/storage/inpage-button-position.ts';

const STORAGE_KEY_AI_CHAT_AUTO_SAVE_ENABLED = 'ai_chat_auto_save_enabled';
const STORAGE_KEY_AI_CHAT_DOLLAR_MENTION_ENABLED = 'ai_chat_dollar_mention_enabled';

type RuntimeClient = {
  send?: (type: string, payload?: Record<string, unknown>) => Promise<any>;
  onInvalidated?: (listener: (error: Error) => void) => () => void;
  isInvalidContextError?: (error: unknown) => boolean;
};

type CollectorRegistry = {
  pickActive?: () => { id: string; collector: any } | null;
  list?: () => Array<{
    id: string;
    collector?: any;
    matches?: (loc: any) => boolean;
    inpageMatches?: (loc: any) => boolean;
  }>;
};

type InpageButtonApi = {
  ensureInpageButton?: (input: {
    collectorId?: string;
    onClick?: () => void;
    onDoubleClick?: () => void;
    onCombo?: (payload: { level: number; count?: number }) => void;
    positionState?: any;
    onPositionChange?: (state: any) => void;
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
  itemMention: { start?: () => { stop?: () => void } | null } | null;
};

const CORE_MESSAGE_TYPES = Object.freeze({
  UPSERT_CONVERSATION: 'upsertConversation',
  SYNC_CONVERSATION_MESSAGES: 'syncConversationMessages',
  GET_CONVERSATION_TAIL_WINDOW_BY_SOURCE_AND_KEY: 'getConversationTailWindowBySourceAndKey',
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

function readAiChatDollarMentionEnabled(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const storageApi = (globalThis as any).chrome?.storage ?? (globalThis as any).browser?.storage;
      const local = storageApi?.local;
      if (!local?.get) return resolve(true);
      local.get([STORAGE_KEY_AI_CHAT_DOLLAR_MENTION_ENABLED], (res: any) => {
        resolve(res?.[STORAGE_KEY_AI_CHAT_DOLLAR_MENTION_ENABLED] !== false);
      });
    } catch (_e) {
      resolve(true);
    }
  });
}

function normalizeConversationMeta(value: unknown): string {
  return String(value || '').trim();
}

function computeStateKeyHash(stateKey: string): string {
  const normalize = normalizeApi as any;
  if (normalize && typeof normalize.fnv1a32 === 'function') return String(normalize.fnv1a32(stateKey));
  return stateKey.replace(/[^a-zA-Z0-9]+/g, '_');
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
  const itemMention = deps.itemMention;

  function toTipKind(kind?: unknown): 'default' | 'error' | undefined {
    const value = String(kind || '')
      .trim()
      .toLowerCase();
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
    options?: {
      mode?: 'snapshot' | 'incremental' | 'append';
      diff?: { added?: string[]; updated?: string[]; removed?: string[] };
    },
  ) {
    if (!snapshot || !snapshot.conversation) return null;

    if (options?.mode !== 'incremental') {
      try {
        const isChatgpt =
          String(snapshot?.conversation?.source || '')
            .trim()
            .toLowerCase() === 'chatgpt';
        const hasDeepResearchPlaceholders =
          isChatgpt &&
          Array.isArray(snapshot?.messages) &&
          snapshot.messages.some((m: any) =>
            String(m?.contentText || m?.contentMarkdown || '')
              .trim()
              .startsWith('Deep Research (iframe):'),
          );
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
    const rawIsNew = (conversation as any)?.__isNew;
    const isNew = typeof rawIsNew === 'boolean' ? rawIsNew : undefined;
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

    return { conversationId: conversation.id, isNew };
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
    const BACKFILL_WINDOW_LIMIT = 200;
    const BACKFILL_RETRY_THROTTLE_MS = 10_000;
    const BACKFILL_RETRY_MAX_ATTEMPTS = 6;
    const BACKFILL_RETRY_MAX_DURATION_MS = 2 * 60_000;
    const storageApi = (globalThis as any).chrome?.storage ?? (globalThis as any).browser?.storage;
    const hasStorageGet = !!storageApi?.local?.get;
    // Default to enabled when storage API is unavailable (e.g. tests).
    // When storage is available, wait for the async read to avoid a "first tick" auto-save surprise for users who disabled it.
    let aiChatAutoSaveEnabled: boolean | null = hasStorageGet ? null : true;
    let savingDepth = 0;
    let inpageButtonPosition: any = null;
    let inpageButtonPositionLoaded = false;
    let inpageButtonPositionLoadPromise: Promise<any> | null = null;
    const backfillStateByConversation = new Map<
      string,
      {
        startedAt: number;
        attempts: number;
        lastAttemptAt: number;
        lastPageSignature: string;
        completed: boolean;
        warnedSignatures: Set<string>;
      }
    >();

    void readAiChatAutoSaveEnabled()
      .then((enabled) => {
        aiChatAutoSaveEnabled = enabled === true;
      })
      .catch(() => {
        aiChatAutoSaveEnabled = true;
      });

    async function ensureInpageButtonPositionLoadedOnce(): Promise<any | null> {
      if (inpageButtonPositionLoaded) return inpageButtonPosition;
      if (inpageButtonPositionLoadPromise) return inpageButtonPositionLoadPromise;

      inpageButtonPositionLoadPromise = (async () => {
        try {
          const globalPos = await readInpageButtonGlobalPosition();
          if (globalPos) {
            inpageButtonPosition = globalPos;
            return inpageButtonPosition;
          }
        } catch (_e) {
          // ignore
        }

        inpageButtonPosition = null;
        return null;
      })();

      try {
        await inpageButtonPositionLoadPromise;
      } finally {
        inpageButtonPositionLoaded = true;
        inpageButtonPositionLoadPromise = null;
      }

      return inpageButtonPosition;
    }

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
      backfillStateByConversation.clear();
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

    function makeConversationStateKey(snapshot: any): string {
      const source = normalizeConversationMeta(snapshot?.conversation?.source);
      const conversationKey = normalizeConversationMeta(snapshot?.conversation?.conversationKey);
      if (!source || !conversationKey) return '';
      return `${source}::${conversationKey}`;
    }

    function getBackfillState(stateKey: string, now: number) {
      let state = backfillStateByConversation.get(stateKey);
      if (state) return state;
      state = {
        startedAt: now,
        attempts: 0,
        lastAttemptAt: 0,
        lastPageSignature: '',
        completed: false,
        warnedSignatures: new Set<string>(),
      };
      backfillStateByConversation.set(stateKey, state);
      return state;
    }

    async function maybeRunBackfill(snapshot: any): Promise<{ skipIncrementalSave: boolean; writtenKeys: string[] }> {
      const stateKey = makeConversationStateKey(snapshot);
      if (!stateKey) return { skipIncrementalSave: false, writtenKeys: [] };
      const stateKeyHash = computeStateKeyHash(stateKey);
      if (!stateKeyHash) return { skipIncrementalSave: false, writtenKeys: [] };

      const pageMessages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
      const pageWindowMessages = pageMessages.slice(Math.max(0, pageMessages.length - BACKFILL_WINDOW_LIMIT));
      if (!pageWindowMessages.length) return { skipIncrementalSave: false, writtenKeys: [] };

      const pageSignature = reconcileAutoSaveBackfill({
        localTailMessages: [],
        pageWindowMessages,
        stateKeyHash,
      }).pageSignature;
      const now = Date.now();
      const state = getBackfillState(stateKey, now);

      if (state.completed) return { skipIncrementalSave: false, writtenKeys: [] };
      if (state.attempts >= BACKFILL_RETRY_MAX_ATTEMPTS) return { skipIncrementalSave: false, writtenKeys: [] };
      if (now - state.startedAt > BACKFILL_RETRY_MAX_DURATION_MS) return { skipIncrementalSave: false, writtenKeys: [] };
      if (state.lastAttemptAt > 0 && now - state.lastAttemptAt < BACKFILL_RETRY_THROTTLE_MS) {
        return { skipIncrementalSave: false, writtenKeys: [] };
      }
      if (state.lastPageSignature && state.lastPageSignature === pageSignature) {
        return { skipIncrementalSave: false, writtenKeys: [] };
      }

      state.attempts += 1;
      state.lastAttemptAt = now;
      state.lastPageSignature = pageSignature;

      const source = normalizeConversationMeta(snapshot?.conversation?.source);
      const conversationKey = normalizeConversationMeta(snapshot?.conversation?.conversationKey);

      let localTailMessages: any[] = [];
      try {
        const localWindowRes = await send(CORE_MESSAGE_TYPES.GET_CONVERSATION_TAIL_WINDOW_BY_SOURCE_AND_KEY, {
          source,
          conversationKey,
          limit: BACKFILL_WINDOW_LIMIT,
        });
        if (!localWindowRes?.ok) {
          throw new Error(localWindowRes?.error?.message || 'getConversationTailWindowBySourceAndKey failed');
        }
        localTailMessages = Array.isArray(localWindowRes?.data?.messages) ? localWindowRes.data.messages : [];
      } catch (error) {
        console.warn('[WebClipper] auto-save backfill skipped: tail window unavailable', {
          source,
          conversationKey,
          error: error instanceof Error ? error.message : String(error || ''),
        });
        return { skipIncrementalSave: false, writtenKeys: [] };
      }

      const reconciled = reconcileAutoSaveBackfill({
        localTailMessages,
        pageWindowMessages,
        stateKeyHash,
      });
      state.lastPageSignature = reconciled.pageSignature;

      if (!reconciled.ok) {
        if (!state.warnedSignatures.has(reconciled.pageSignature)) {
          state.warnedSignatures.add(reconciled.pageSignature);
          console.warn('[WebClipper] auto-save backfill skipped: no overlap, incremental continues', {
            source,
            conversationKey,
          });
        }
        return { skipIncrementalSave: false, writtenKeys: [] };
      }

      state.completed = true;
      if (!reconciled.addedMessages.length) return { skipIncrementalSave: false, writtenKeys: [] };

      beginSaving();
      try {
        await saveSnapshot({ ...snapshot, messages: reconciled.addedMessages }, { mode: 'append', diff: reconciled.diff });
      } catch (error) {
        state.completed = false;
        console.warn('[WebClipper] auto-save backfill write failed, incremental continues', {
          source,
          conversationKey,
          error: error instanceof Error ? error.message : String(error || ''),
        });
        return { skipIncrementalSave: false, writtenKeys: [] };
      } finally {
        endSaving();
      }

      console.info('[WebClipper] auto-save backfill applied', {
        source,
        conversationKey,
        addedCount: reconciled.addedMessages.length,
      });
      return {
        skipIncrementalSave: true,
        writtenKeys: Array.isArray(reconciled.diff?.added) ? reconciled.diff.added.map((x) => String(x || '')) : [],
      };
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

    const showComboLine = (payload: { level: number }) => {
      const level = Number(payload?.level);
      if (!Number.isFinite(level)) return;
      const line = pickLineByLevel(level);
      if (line) showInpageTip(line);
    };

    const openInpageCommentsSidebar = async () => {
      if (stopped) return;
      try {
        await send(UI_MESSAGE_TYPES.OPEN_CURRENT_TAB_INPAGE_COMMENTS_PANEL, {
          source: 'inpage',
        });
      } catch (_error) {
        // ignore: comments sidebar can be unavailable on unsupported pages
      }
    };

    async function refreshInpageButton() {
      const collector = getCollector();
      const inpageCollector = collector || getInpageCollector();
      const positionState = await ensureInpageButtonPositionLoadedOnce();
      inpageButton?.cleanupButtons?.(inpageCollector?.id || '');
      inpageButton?.ensureInpageButton?.({
        collectorId: inpageCollector?.id,
        onClick: clickSave,
        onDoubleClick: openInpageCommentsSidebar,
        onCombo: showComboLine,
        positionState,
        onPositionChange: (state: any) => {
          inpageButtonPosition = state;
          void writeInpageButtonGlobalPosition(state);
        },
      });
      return collector;
    }

    const handleTick = async () => {
      if (stopped) return;

      try {
        notionAiModelPicker?.maybeApply?.();

        const collector = await refreshInpageButton();
        if (!collector || typeof collector.capture !== 'function') return;
        if (collector.id === 'googleaistudio') return;
        if (!AI_CHAT_AUTO_SAVE_COLLECTOR_IDS.has(String(collector.id || ''))) return;
        if (aiChatAutoSaveEnabled !== true) return;

        const snapshot = await Promise.resolve(collector.capture());
        if (!snapshot) return;

        const isChatgpt =
          String(collector.id || '')
            .trim()
            .toLowerCase() === 'chatgpt';
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

        const backfill = await maybeRunBackfill(snapshot);

        const incremental = incrementalUpdater?.computeIncremental?.(snapshot);
        if (!incremental || !incremental.changed) return;

        let incrementalSnapshot = incremental.snapshot;
        let incrementalDiff = incremental.diff || { added: [], updated: [], removed: [] };
        if (backfill.skipIncrementalSave && backfill.writtenKeys.length > 0) {
          const writtenKeys = new Set(backfill.writtenKeys);
          const filteredMessages = (Array.isArray(incrementalSnapshot?.messages) ? incrementalSnapshot.messages : []).filter(
            (message: any) => !writtenKeys.has(String(message?.messageKey || '').trim()),
          );
          const filterKeys = (keys: unknown) =>
            (Array.isArray(keys) ? keys : [])
              .map((value) => String(value || '').trim())
              .filter((key) => !!key && !writtenKeys.has(key));
          incrementalDiff = {
            added: filterKeys(incrementalDiff?.added),
            updated: filterKeys(incrementalDiff?.updated),
            removed: [],
          };
          if (!filteredMessages.length && !incrementalDiff.added.length && !incrementalDiff.updated.length) return;
          incrementalSnapshot = { ...incrementalSnapshot, messages: filteredMessages };
        }

        beginSaving();
        try {
          const saved = await saveSnapshot(incrementalSnapshot, { mode: 'append', diff: incrementalDiff });
          if (saved) {
            showInpageTip(
              buildCaptureSuccessTipMessage({ isNew: saved.isNew, title: incrementalSnapshot?.conversation?.title }),
              'ok',
            );
          }
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

    observer =
      runtimeObserver?.createObserver?.({
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

      const storageApi = (globalThis as any).chrome?.storage ?? (globalThis as any).browser?.storage;
      const hasStorageGet = !!storageApi?.local?.get;
      // Default to enabled when storage API is unavailable (e.g. tests).
      // When storage is available, wait for the async read to avoid "first keypress" enabling for users who disabled it.
      let aiChatDollarMentionEnabled: boolean | null = hasStorageGet ? null : true;
      let mentionController: { stop?: () => void } | null = null;
      let stopped = false;
      let unsubscribeStorage: (() => void) | null = null;

      function stopMention() {
        const previous = mentionController;
        mentionController = null;
        try {
          previous?.stop?.();
        } catch (_e) {
          // ignore
        }
      }

      function startMention() {
        if (stopped) return;
        if (aiChatDollarMentionEnabled !== true) return;
        if (!itemMention || typeof itemMention.start !== 'function') return;
        if (mentionController) return;
        mentionController = itemMention.start() || null;
      }

      function applyMentionEnabled(enabled: boolean) {
        aiChatDollarMentionEnabled = enabled === true;
        if (aiChatDollarMentionEnabled === true) startMention();
        else stopMention();
      }

      if (!itemMention || typeof itemMention.start !== 'function') {
        // No-op.
      } else if (!hasStorageGet) {
        applyMentionEnabled(true);
      } else {
        void readAiChatDollarMentionEnabled()
          .then((enabled) => {
            applyMentionEnabled(enabled === true);
          })
          .catch(() => {
            applyMentionEnabled(true);
          });

        const onChanged = storageApi?.onChanged;
        if (onChanged?.addListener && onChanged?.removeListener) {
          const listener = (changes: Record<string, any> | null, areaName?: string) => {
            if (stopped) return;
            if (areaName && String(areaName) !== 'local') return;
            const change = changes ? (changes as any)[STORAGE_KEY_AI_CHAT_DOLLAR_MENTION_ENABLED] : null;
            if (!change) return;
            applyMentionEnabled(change?.newValue !== false);
          };
          try {
            onChanged.addListener(listener);
            unsubscribeStorage = () => {
              try {
                onChanged.removeListener(listener);
              } catch (_e) {
                // ignore
              }
            };
          } catch (_e) {
            // ignore
          }
        }
      }

      return {
        stop() {
          stopped = true;
          try {
            unsubscribeStorage?.();
          } catch (_e) {
            // ignore
          }
          unsubscribeStorage = null;
          try {
            stopMention();
          } catch (_e) {
            // ignore
          }
          controller.stop();
        },
      };
    },
  };
}
