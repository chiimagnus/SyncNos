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
        lastAttemptedPageSignature: string;
        completedPageSignature: string;
        warnedNoOverlap: boolean;
        warnedTailUnavailable: boolean;
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
        lastAttemptedPageSignature: '',
        completedPageSignature: '',
        warnedNoOverlap: false,
        warnedTailUnavailable: false,
      };
      backfillStateByConversation.set(stateKey, state);
      return state;
    }

    async function maybeRunBackfill(snapshot: any): Promise<{
      changed: boolean;
      snapshot: any | null;
      diff: { added: string[]; updated: string[]; removed: string[] } | null;
      logInfo: { source: string; conversationKey: string; addedCount: number } | null;
      pageSignature: string | null;
      stateKey: string | null;
    }> {
      const stateKey = makeConversationStateKey(snapshot);
      if (!stateKey)
        return { changed: false, snapshot: null, diff: null, logInfo: null, pageSignature: null, stateKey: null };
      const stateKeyHash = computeStateKeyHash(stateKey);
      if (!stateKeyHash)
        return { changed: false, snapshot: null, diff: null, logInfo: null, pageSignature: null, stateKey: null };

      const pageMessages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
      const pageWindowMessages = pageMessages.slice(Math.max(0, pageMessages.length - BACKFILL_WINDOW_LIMIT));
      if (!pageWindowMessages.length)
        return { changed: false, snapshot: null, diff: null, logInfo: null, pageSignature: null, stateKey: null };

      const pageSignature = reconcileAutoSaveBackfill({
        localTailMessages: [],
        pageWindowMessages,
        stateKeyHash,
      }).pageSignature;
      const now = Date.now();
      const state = getBackfillState(stateKey, now);

      if (state.completedPageSignature && state.completedPageSignature === pageSignature) {
        return { changed: false, snapshot: null, diff: null, logInfo: null, pageSignature: null, stateKey: null };
      }
      if (state.attempts >= BACKFILL_RETRY_MAX_ATTEMPTS) {
        return { changed: false, snapshot: null, diff: null, logInfo: null, pageSignature: null, stateKey: null };
      }
      if (now - state.startedAt > BACKFILL_RETRY_MAX_DURATION_MS) {
        return { changed: false, snapshot: null, diff: null, logInfo: null, pageSignature: null, stateKey: null };
      }
      if (state.lastAttemptAt > 0 && now - state.lastAttemptAt < BACKFILL_RETRY_THROTTLE_MS) {
        return { changed: false, snapshot: null, diff: null, logInfo: null, pageSignature: null, stateKey: null };
      }
      if (state.lastAttemptedPageSignature && state.lastAttemptedPageSignature === pageSignature) {
        return { changed: false, snapshot: null, diff: null, logInfo: null, pageSignature: null, stateKey: null };
      }

      state.attempts += 1;
      state.lastAttemptAt = now;
      state.lastAttemptedPageSignature = pageSignature;

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
        if (!state.warnedTailUnavailable) {
          state.warnedTailUnavailable = true;
          console.warn('[WebClipper] auto-save backfill skipped: tail window unavailable', {
            source,
            conversationKey,
            error: error instanceof Error ? error.message : String(error || ''),
          });
        }
        // Tail window availability is independent of the page signature; allow retries after throttle even if window doesn't change.
        state.lastAttemptedPageSignature = '';
        return { changed: false, snapshot: null, diff: null, logInfo: null, pageSignature: null, stateKey: null };
      }

      const reconciled = reconcileAutoSaveBackfill({
        localTailMessages,
        pageWindowMessages,
        stateKeyHash,
      });
      state.lastAttemptedPageSignature = reconciled.pageSignature;

      if (!reconciled.ok) {
        if (!state.warnedNoOverlap) {
          state.warnedNoOverlap = true;
          console.warn('[WebClipper] auto-save backfill skipped: no overlap, incremental continues', {
            source,
            conversationKey,
            localTailCount: Array.isArray(localTailMessages) ? localTailMessages.length : 0,
            pageWindowCount: Array.isArray(pageWindowMessages) ? pageWindowMessages.length : 0,
          });
        }
        return { changed: false, snapshot: null, diff: null, logInfo: null, pageSignature: null, stateKey: null };
      }

      if (!reconciled.addedMessages.length) {
        state.completedPageSignature = reconciled.pageSignature;
        return { changed: false, snapshot: null, diff: null, logInfo: null, pageSignature: null, stateKey: null };
      }

      return {
        changed: true,
        snapshot: { ...snapshot, messages: reconciled.addedMessages },
        diff: reconciled.diff,
        logInfo: {
          source,
          conversationKey,
          addedCount: reconciled.addedMessages.length,
        },
        pageSignature: reconciled.pageSignature,
        stateKey,
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
        const incrementalChanged = !!(incremental && incremental.changed);
        if (!backfill.changed && !incrementalChanged) return;

        let appendSnapshot = backfill.changed ? backfill.snapshot : incremental?.snapshot;
        let appendDiff = backfill.changed ? backfill.diff : incremental?.diff;

        if (backfill.changed && incrementalChanged) {
          const mergedByKey = new Map<string, any>();
          const mergedUnkeyed: any[] = [];
          const pushMessage = (message: any) => {
            if (!message) return;
            const key = String(message?.messageKey || '').trim();
            if (!key) {
              mergedUnkeyed.push(message);
              return;
            }
            if (mergedByKey.has(key)) {
              mergedByKey.set(key, { ...(mergedByKey.get(key) || {}), ...message });
              return;
            }
            mergedByKey.set(key, message);
          };
          for (const message of Array.isArray(backfill.snapshot?.messages) ? backfill.snapshot.messages : []) {
            pushMessage(message);
          }
          for (const message of Array.isArray(incremental?.snapshot?.messages) ? incremental.snapshot.messages : []) {
            pushMessage(message);
          }

          const dedupeKeys = (values: unknown): string[] => {
            const seen = new Set<string>();
            const out: string[] = [];
            for (const value of Array.isArray(values) ? values : []) {
              const key = String(value || '').trim();
              if (!key || seen.has(key)) continue;
              seen.add(key);
              out.push(key);
            }
            return out;
          };

          appendSnapshot = {
            ...(incremental?.snapshot || backfill.snapshot || snapshot),
            messages: [...Array.from(mergedByKey.values()), ...mergedUnkeyed],
          };
          appendDiff = {
            added: dedupeKeys([...(backfill.diff?.added || []), ...(incremental?.diff?.added || [])]),
            updated: dedupeKeys([...(backfill.diff?.updated || []), ...(incremental?.diff?.updated || [])]),
            removed: [],
          };
        }

        if (!appendSnapshot || !appendDiff) return;
        const appendMessages = Array.isArray(appendSnapshot?.messages) ? appendSnapshot.messages : [];
        if (!appendMessages.length && !(appendDiff.added || []).length && !(appendDiff.updated || []).length) return;

        beginSaving();
        try {
          const saved = await saveSnapshot(appendSnapshot, { mode: 'append', diff: appendDiff });
          if (saved && (incrementalChanged || backfill.changed)) {
            showInpageTip(
              buildCaptureSuccessTipMessage({ isNew: saved.isNew, title: appendSnapshot?.conversation?.title }),
              'ok',
            );
          }
          if (saved && backfill.changed && backfill.logInfo) {
            if (backfill.stateKey) {
              const state = backfillStateByConversation.get(backfill.stateKey);
              if (state && backfill.pageSignature) state.completedPageSignature = backfill.pageSignature;
            }
            console.info('[WebClipper] auto-save backfill applied', backfill.logInfo);
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
