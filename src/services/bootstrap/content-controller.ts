import type { CurrentPageCaptureService } from '@services/bootstrap/current-page-capture';
import { AI_CHAT_AUTO_SAVE_COLLECTOR_IDS } from '@collectors/ai-chat-sites';
import {
  resolveActiveCollector,
  resolveActiveOrInpageCollector,
  type CollectorRegistryLike,
} from '@collectors/registry';
import { buildCaptureSuccessTipMessage } from '@services/shared/capture-tip';
import normalizeApi from '@services/shared/normalize.ts';
import { storageGet, storageOnChanged } from '@services/shared/storage';
import { CORE_MESSAGE_TYPES, UI_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { reconcileAutoSaveBackfill } from '@services/conversations/content/autosave-backfill-reconciler';
import {
  readInpageButtonGlobalPosition,
  writeInpageButtonGlobalPosition,
} from '@platform/storage/inpage-button-position.ts';

const STORAGE_KEY_AI_CHAT_AUTO_SAVE_ENABLED = 'ai_chat_auto_save_enabled';
const STORAGE_KEY_AI_CHAT_DOLLAR_MENTION_ENABLED = 'ai_chat_dollar_mention_enabled';
const NOTION_AI_SEND_BUTTON_SELECTOR = 'div[role="button"][data-testid="agent-send-message-button"]';
const NOTION_AI_COMPOSER_SELECTOR = 'div[role="textbox"][data-content-editable-leaf="true"][contenteditable="true"]';

type RuntimeClient = {
  send?: (type: string, payload?: Record<string, unknown>) => Promise<any>;
  isInvalidContextError?: (error: unknown) => boolean;
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

type RuntimeObserverFactory = (input: {
  debounceMs?: number;
  getRoot?: () => Node | null;
  onTick?: () => void | Promise<void>;
  leading?: boolean;
}) => { start?: () => void; stop?: () => void } | null;

type Deps = {
  runtime: RuntimeClient | null;
  collectorsRegistry: CollectorRegistryLike | null;
  currentPageCapture: CurrentPageCaptureService;
  inpageButton: InpageButtonApi | null;
  inpageTip: InpageTipApi | null;
  createRuntimeObserver: RuntimeObserverFactory | null;
  incrementalEngine: { prepare?: (snapshot: unknown) => any } | null;
  itemMention: { start?: () => { stop?: () => void } | null } | null;
};

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
  const createRuntimeObserver = deps.createRuntimeObserver;
  const incrementalEngine = deps.incrementalEngine;
  const itemMention = deps.itemMention;
  const doc = typeof document !== 'undefined' ? document : null;

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

  async function saveSnapshot(
    snapshot: any,
    options?: {
      mode?: 'snapshot' | 'incremental' | 'append';
      diff?: { added?: string[]; updated?: string[]; removed?: string[] };
    },
  ) {
    if (!snapshot || !snapshot.conversation) return null;

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

  type ResidentAutoSaveHandle = {
    ownerToken: number;
    isActive: () => boolean;
    isAutoSaveEnabled: () => boolean;
    runAutoSaveTick: () => Promise<void>;
  };
  type ManualPersistenceSlot = { ownerToken: number | null; state: 'pending' | 'inflight' };

  let residentOwnerSequence = 0;
  let activeResidentOwnerToken = 0;
  let currentResidentAutoSaveHandle: ResidentAutoSaveHandle | null = null;
  let autoSaveRunInFlight: Promise<void> | null = null;
  let latestTrailingAutoSaveOwnerToken: number | null = null;
  let manualPersistence: ManualPersistenceSlot | null = null;

  function isCurrentResidentOwner(ownerToken: number): boolean {
    return (
      ownerToken > 0 &&
      activeResidentOwnerToken === ownerToken &&
      currentResidentAutoSaveHandle?.ownerToken === ownerToken &&
      currentResidentAutoSaveHandle.isActive()
    );
  }

  function hasManualPersistenceGate(): boolean {
    return manualPersistence !== null;
  }

  function cancelAutoSaveTrailingForOwner(ownerToken: number) {
    if (latestTrailingAutoSaveOwnerToken === ownerToken) latestTrailingAutoSaveOwnerToken = null;
  }

  function drainLatestAutoSaveRequest() {
    if (autoSaveRunInFlight || manualPersistence) return;
    const ownerToken = latestTrailingAutoSaveOwnerToken;
    latestTrailingAutoSaveOwnerToken = null;
    if (!ownerToken) return;
    startAutoSaveRequest(ownerToken);
  }

  function startAutoSaveRequest(ownerToken: number) {
    if (autoSaveRunInFlight || manualPersistence) {
      latestTrailingAutoSaveOwnerToken = ownerToken;
      return;
    }
    const handle = currentResidentAutoSaveHandle;
    if (
      !handle ||
      handle.ownerToken !== ownerToken ||
      !isCurrentResidentOwner(ownerToken) ||
      !handle.isAutoSaveEnabled()
    ) {
      return;
    }

    const run = Promise.resolve().then(() => handle.runAutoSaveTick());
    autoSaveRunInFlight = run;
    void run
      .catch((error) => {
        console.error('[WebClipper] autosave scheduler failed:', error);
      })
      .finally(() => {
        if (autoSaveRunInFlight !== run) return;
        autoSaveRunInFlight = null;
        if (!manualPersistence) drainLatestAutoSaveRequest();
      });
  }

  function requestAutoSave(ownerToken: number) {
    const handle = currentResidentAutoSaveHandle;
    if (
      !handle ||
      handle.ownerToken !== ownerToken ||
      !isCurrentResidentOwner(ownerToken) ||
      !handle.isAutoSaveEnabled()
    ) {
      return;
    }
    if (autoSaveRunInFlight || manualPersistence) {
      latestTrailingAutoSaveOwnerToken = ownerToken;
      return;
    }
    startAutoSaveRequest(ownerToken);
  }

  function installResidentAutoSaveHandle(handle: ResidentAutoSaveHandle) {
    activeResidentOwnerToken = handle.ownerToken;
    currentResidentAutoSaveHandle = handle;
  }

  function cancelPendingManualPersistenceForOwner(ownerToken: number) {
    if (manualPersistence?.ownerToken !== ownerToken || manualPersistence.state !== 'pending') return;
    manualPersistence = null;
    drainLatestAutoSaveRequest();
  }

  function releaseResidentOwner(ownerToken: number) {
    cancelAutoSaveTrailingForOwner(ownerToken);
    cancelPendingManualPersistenceForOwner(ownerToken);
    if (activeResidentOwnerToken !== ownerToken || currentResidentAutoSaveHandle?.ownerToken !== ownerToken) return;
    activeResidentOwnerToken = 0;
    currentResidentAutoSaveHandle = null;
  }

  async function enterManualPersistence(
    ownerToken: number | null,
    canStart: () => boolean,
  ): Promise<ManualPersistenceSlot | null> {
    if (manualPersistence) return null;
    const slot: ManualPersistenceSlot = { ownerToken, state: 'pending' };
    manualPersistence = slot;

    const activeAutoSave = autoSaveRunInFlight;
    if (activeAutoSave) {
      try {
        await activeAutoSave;
      } catch (_error) {
        // A failed autosave must still release explicit manual persistence.
      }
    }

    if (manualPersistence !== slot || slot.state !== 'pending') return null;
    if (!canStart()) {
      manualPersistence = null;
      drainLatestAutoSaveRequest();
      return null;
    }

    slot.state = 'inflight';
    return slot;
  }

  function exitManualPersistence(slot: ManualPersistenceSlot) {
    if (manualPersistence !== slot) return;
    manualPersistence = null;
    drainLatestAutoSaveRequest();
  }

  function createAutoCaptureController(ownerToken: number) {
    let stopped = false;
    let observer: { start?: () => void; stop?: () => void } | null = null;
    const BACKFILL_WINDOW_LIMIT = 200;
    const BACKFILL_RETRY_THROTTLE_MS = 10_000;
    const BACKFILL_RETRY_MAX_ATTEMPTS = 6;
    const BACKFILL_RETRY_MAX_DURATION_MS = 2 * 60_000;
    let aiChatAutoSaveEnabled: boolean | null = null;
    let liveGeneration = 0;
    let inpageButtonPosition: any = null;
    let inpageButtonPositionLoaded = false;
    let inpageButtonPositionLoadPromise: Promise<any> | null = null;
    let proactiveNotionAiBurstTimers = new Set<ReturnType<typeof setTimeout>>();
    let lastProactiveNotionAiBurstAt = 0;
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
    const NOTION_AI_PROACTIVE_CAPTURE_DELAYS_MS = [0, 120, 450, 1000] as const;
    const NOTION_AI_PROACTIVE_CAPTURE_COOLDOWN_MS = 160;

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

    function clearProactiveTimers() {
      for (const timer of proactiveNotionAiBurstTimers) clearTimeout(timer);
      proactiveNotionAiBurstTimers.clear();
    }

    function setAutoSaveEnabled(enabled: boolean) {
      const next = enabled === true;
      if (aiChatAutoSaveEnabled === true && !next) {
        liveGeneration += 1;
        clearProactiveTimers();
        cancelAutoSaveTrailingForOwner(ownerToken);
      }
      aiChatAutoSaveEnabled = next;
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      liveGeneration += 1;
      releaseResidentOwner(ownerToken);
      inpageButton?.setSaving?.(false);
      inpageButton?.cleanupButtons?.('');
      backfillStateByConversation.clear();
      observer?.stop?.();
      clearProactiveTimers();
      doc?.removeEventListener('click', onDocumentClickCapture, true);
      doc?.removeEventListener('keydown', onDocumentKeydownCapture, true);
    }

    function isNotionAiCollectorActive(): boolean {
      const collector = resolveActiveCollector(collectorsRegistry);
      return (
        String(collector?.id || '')
          .trim()
          .toLowerCase() === 'notionai'
      );
    }

    function scheduleNotionAiProactiveCaptureBurst() {
      if (stopped) return;
      if (aiChatAutoSaveEnabled !== true) return;
      if (!isNotionAiCollectorActive()) return;

      const now = Date.now();
      if (now - lastProactiveNotionAiBurstAt < NOTION_AI_PROACTIVE_CAPTURE_COOLDOWN_MS) return;
      lastProactiveNotionAiBurstAt = now;

      for (const delay of NOTION_AI_PROACTIVE_CAPTURE_DELAYS_MS) {
        const timer = setTimeout(() => {
          proactiveNotionAiBurstTimers.delete(timer);
          if (stopped) return;
          requestAutoSave(ownerToken);
        }, delay);
        proactiveNotionAiBurstTimers.add(timer);
      }
    }

    function onDocumentClickCapture(event: Event) {
      const target = event.target as Element | null;
      if (!target?.closest) return;
      if (!target.closest(NOTION_AI_SEND_BUTTON_SELECTOR)) return;
      scheduleNotionAiProactiveCaptureBurst();
    }

    function onDocumentKeydownCapture(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.isComposing) return;
      if (event.key !== 'Enter') return;
      if (event.shiftKey || event.altKey) return;
      const target = event.target as Element | null;
      if (!target?.closest) return;
      if (!target.closest(NOTION_AI_COMPOSER_SELECTOR)) return;
      scheduleNotionAiProactiveCaptureBurst();
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

    function formatUnknownError(err: unknown): string {
      if (err instanceof Error) return err.message;
      try {
        if (err && typeof err === 'object') return JSON.stringify(err);
      } catch (_e) {
        // ignore
      }
      return String(err || '');
    }

    function summarizeBackfillMessages(messages: any[], options?: { head?: boolean; limit?: number }) {
      const limit = Number.isFinite(Number(options?.limit)) ? Math.max(1, Math.floor(Number(options?.limit))) : 8;
      const list = Array.isArray(messages) ? messages : [];
      const slice = options?.head ? list.slice(0, limit) : list.slice(Math.max(0, list.length - limit));
      return slice.map((m: any) => {
        const key = String(m?.messageKey || '').trim();
        const role = String(m?.role || '').trim();
        const seq = Number(m?.sequence);
        const raw = String(m?.contentText || m?.contentMarkdown || '')
          .replace(/\s+/g, ' ')
          .trim();
        const preview = raw.length > 80 ? `${raw.slice(0, 79)}…` : raw;
        return {
          messageKey: key || null,
          role: role || null,
          sequence: Number.isFinite(seq) ? seq : null,
          preview: preview || null,
        };
      });
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
            error: formatUnknownError(error),
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
            localTailTailSample: summarizeBackfillMessages(localTailMessages, { head: false, limit: 8 }),
            pageWindowHeadSample: summarizeBackfillMessages(pageWindowMessages, { head: true, limit: 8 }),
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

    function setResidentSaving(saving: boolean) {
      if (!stopped) inpageButton?.setSaving?.(saving);
    }

    const clickSave = async () => {
      if (stopped) return;
      let manualSlot: ManualPersistenceSlot | null = null;
      try {
        manualSlot = await enterManualPersistence(ownerToken, () => !stopped && isCurrentResidentOwner(ownerToken));
        if (!manualSlot) return;
        setResidentSaving(true);
        try {
          await currentPageCapture.captureCurrentPage({
            onProgress: (progress) => {
              if (!stopped && isCurrentResidentOwner(ownerToken)) {
                showInpageTip(progress.message, progress.kind === 'default' ? 'ok' : progress.kind);
              }
            },
          });
        } finally {
          setResidentSaving(false);
        }
      } catch (_error) {
        // tip already shown in progress callback
      } finally {
        if (manualSlot) exitManualPersistence(manualSlot);
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
      const positionState = await ensureInpageButtonPositionLoadedOnce();
      if (stopped) return null;
      const collector = resolveActiveCollector(collectorsRegistry);
      const inpageCollector = collector || resolveActiveOrInpageCollector(collectorsRegistry);
      inpageButton?.cleanupButtons?.(inpageCollector?.id || '');
      inpageButton?.ensureInpageButton?.({
        collectorId: inpageCollector?.id,
        onClick: clickSave,
        onDoubleClick: openInpageCommentsSidebar,
        onCombo: showComboLine,
        positionState,
        onPositionChange: (state: any) => {
          if (stopped) return;
          inpageButtonPosition = state;
          void writeInpageButtonGlobalPosition(state);
        },
      });
      if (stopped) {
        inpageButton?.cleanupButtons?.('');
        return null;
      }
      return collector;
    }

    function isAutoSaveRequestAllowed(generation: number) {
      return (
        !stopped &&
        aiChatAutoSaveEnabled === true &&
        liveGeneration === generation &&
        isCurrentResidentOwner(ownerToken)
      );
    }

    function isAutoSavePreSaveAllowed(generation: number) {
      return isAutoSaveRequestAllowed(generation) && !hasManualPersistenceGate();
    }

    function rollbackBackfillAttempt(backfill: {
      changed: boolean;
      stateKey: string | null;
      pageSignature: string | null;
    }) {
      if (!backfill.changed || !backfill.stateKey || !backfill.pageSignature) return;
      const state = backfillStateByConversation.get(backfill.stateKey);
      if (state && state.lastAttemptedPageSignature === backfill.pageSignature) {
        state.lastAttemptedPageSignature = '';
      }
    }

    function dedupeKeys(values: unknown): string[] {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const value of Array.isArray(values) ? values : []) {
        const key = String(value || '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(key);
      }
      return out;
    }

    function mergeAutoSaveSnapshots(snapshot: any, backfill: any, incremental: any) {
      const effectiveConversation = incremental?.snapshot?.conversation || snapshot?.conversation;
      if (backfill.changed && incremental?.changed) {
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
        for (const message of Array.isArray(incremental.snapshot?.messages) ? incremental.snapshot.messages : []) {
          pushMessage(message);
        }
        return {
          snapshot: {
            ...(incremental.snapshot || backfill.snapshot || snapshot),
            conversation: effectiveConversation,
            messages: [...Array.from(mergedByKey.values()), ...mergedUnkeyed],
          },
          diff: {
            added: dedupeKeys([...(backfill.diff?.added || []), ...(incremental.diff?.added || [])]),
            updated: dedupeKeys([...(backfill.diff?.updated || []), ...(incremental.diff?.updated || [])]),
            removed: [],
          },
        };
      }

      if (backfill.changed) {
        return {
          snapshot: {
            ...(backfill.snapshot || snapshot),
            conversation: effectiveConversation,
            messages: Array.isArray(backfill.snapshot?.messages) ? backfill.snapshot.messages : [],
          },
          diff: backfill.diff,
        };
      }

      return { snapshot: incremental?.snapshot || null, diff: incremental?.diff || null };
    }

    async function runAutoSaveTick() {
      if (stopped) return;
      const generation = liveGeneration;
      let backfill: Awaited<ReturnType<typeof maybeRunBackfill>> | null = null;

      try {
        if (!isAutoSavePreSaveAllowed(generation)) return;
        const collector = resolveActiveCollector(collectorsRegistry);
        if (!collector || typeof collector.capture !== 'function') return;
        // ChatGPT and Google AI Studio remain manual-capture only.
        if (!AI_CHAT_AUTO_SAVE_COLLECTOR_IDS.has(String(collector.id || ''))) return;

        const snapshot = await Promise.resolve(collector.capture());
        if (!isAutoSavePreSaveAllowed(generation)) return;
        if (!snapshot) return;

        backfill = await maybeRunBackfill(snapshot);
        if (!isAutoSavePreSaveAllowed(generation)) {
          rollbackBackfillAttempt(backfill);
          return;
        }

        const incremental = incrementalEngine?.prepare?.(snapshot) || null;
        const incrementalChanged = incremental?.changed === true;
        if (incremental && !incrementalChanged) {
          try {
            incremental.commit();
          } catch (error) {
            rollbackBackfillAttempt(backfill);
            console.error('[WebClipper] autosave incremental pre-save commit invariant failed:', error);
            return;
          }
        }

        if (!backfill.changed && !incrementalChanged) return;
        const merged = mergeAutoSaveSnapshots(snapshot, backfill, incremental);
        if (!merged.snapshot || !merged.diff) return;

        setResidentSaving(true);
        try {
          let saved: Awaited<ReturnType<typeof saveSnapshot>>;
          try {
            saved = await saveSnapshot(merged.snapshot, { mode: 'append', diff: merged.diff });
          } catch (error) {
            rollbackBackfillAttempt(backfill);
            throw error;
          }

          if (saved && backfill.changed && backfill.logInfo) {
            if (backfill.stateKey) {
              const state = backfillStateByConversation.get(backfill.stateKey);
              if (state && backfill.pageSignature) state.completedPageSignature = backfill.pageSignature;
            }
            console.info('[WebClipper] auto-save backfill applied', backfill.logInfo);
          }

          if (saved && incrementalChanged) {
            try {
              incremental.commit();
            } catch (error) {
              console.error('[WebClipper] autosave incremental durable commit invariant failed:', error);
              return;
            }
          }

          if (saved && isCurrentResidentOwner(ownerToken) && !stopped && (incrementalChanged || backfill.changed)) {
            showInpageTip(
              buildCaptureSuccessTipMessage({ isNew: saved.isNew, title: merged.snapshot?.conversation?.title }),
              'ok',
            );
          }
        } finally {
          setResidentSaving(false);
        }
      } catch (error) {
        if (runtime?.isInvalidContextError?.(error)) {
          stop();
          return;
        }
        console.error('WebClipper auto-save failed:', error);
      }
    }

    async function handleObserverTick() {
      if (stopped) return;
      const generation = liveGeneration;
      try {
        await refreshInpageButton();
        if (!isAutoSaveRequestAllowed(generation)) return;
        requestAutoSave(ownerToken);
      } catch (error) {
        if (runtime?.isInvalidContextError?.(error)) stop();
      }
    }

    doc?.addEventListener('click', onDocumentClickCapture, true);
    doc?.addEventListener('keydown', onDocumentKeydownCapture, true);

    observer =
      createRuntimeObserver?.({
        debounceMs: 600,
        getRoot: () => {
          if (stopped) return null;
          const collector = resolveActiveCollector(collectorsRegistry);
          return collector && typeof collector.getRoot === 'function' ? collector.getRoot() : null;
        },
        onTick: handleObserverTick,
      }) || null;

    return {
      ownerToken,
      start() {
        if (!stopped) observer?.start?.();
      },
      isActive: () => !stopped,
      isAutoSaveEnabled: () => !stopped && aiChatAutoSaveEnabled === true,
      runAutoSaveTick,
      setAutoSaveEnabled,
      stop,
    };
  }

  return {
    async captureCurrentPage(
      input?: Parameters<CurrentPageCaptureService['captureCurrentPage']>[0],
    ): ReturnType<CurrentPageCaptureService['captureCurrentPage']> {
      const manualSlot = await enterManualPersistence(null, () => true);
      if (!manualSlot) throw new Error('manual_capture_in_progress');
      try {
        return await currentPageCapture.captureCurrentPage(input);
      } finally {
        exitManualPersistence(manualSlot);
      }
    },
    start() {
      const ownerToken = ++residentOwnerSequence;
      const controller = createAutoCaptureController(ownerToken);
      installResidentAutoSaveHandle(controller);
      let mentionController: { stop?: () => void } | null = null;
      let stopped = false;
      let controllerStarted = false;
      let aiChatDollarMentionEnabled: boolean | null = null;
      let autoSaveObservationRevision = 0;
      let mentionObservationRevision = 0;
      let unsubscribeStorage = () => {};

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
        if (stopped || aiChatDollarMentionEnabled !== true) return;
        if (!itemMention || typeof itemMention.start !== 'function' || mentionController) return;
        mentionController = itemMention.start() || null;
      }

      function applyMentionEnabled(enabled: boolean) {
        aiChatDollarMentionEnabled = enabled === true;
        if (aiChatDollarMentionEnabled) startMention();
        else stopMention();
      }

      function ensureControllerStarted() {
        if (stopped || controllerStarted) return;
        controllerStarted = true;
        controller.start();
      }

      function applyAutoSaveEnabled(enabled: boolean) {
        controller.setAutoSaveEnabled(enabled === true);
        ensureControllerStarted();
      }

      unsubscribeStorage = storageOnChanged((changes: Record<string, any> | null, areaName: string) => {
        if (stopped || areaName !== 'local' || !changes) return;
        if (Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY_AI_CHAT_AUTO_SAVE_ENABLED)) {
          autoSaveObservationRevision += 1;
          applyAutoSaveEnabled(changes[STORAGE_KEY_AI_CHAT_AUTO_SAVE_ENABLED]?.newValue !== false);
        }
        if (Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY_AI_CHAT_DOLLAR_MENTION_ENABLED)) {
          mentionObservationRevision += 1;
          applyMentionEnabled(changes[STORAGE_KEY_AI_CHAT_DOLLAR_MENTION_ENABLED]?.newValue !== false);
        }
      });

      const initialAutoSaveRevision = autoSaveObservationRevision;
      const initialMentionRevision = mentionObservationRevision;
      void storageGet([STORAGE_KEY_AI_CHAT_AUTO_SAVE_ENABLED, STORAGE_KEY_AI_CHAT_DOLLAR_MENTION_ENABLED]).then(
        (local) => {
          if (stopped) return;
          if (autoSaveObservationRevision === initialAutoSaveRevision) {
            applyAutoSaveEnabled(local?.[STORAGE_KEY_AI_CHAT_AUTO_SAVE_ENABLED] !== false);
          }
          if (mentionObservationRevision === initialMentionRevision) {
            applyMentionEnabled(local?.[STORAGE_KEY_AI_CHAT_DOLLAR_MENTION_ENABLED] !== false);
          }
        },
        () => {
          if (stopped) return;
          if (autoSaveObservationRevision === initialAutoSaveRevision) applyAutoSaveEnabled(true);
          if (mentionObservationRevision === initialMentionRevision) applyMentionEnabled(true);
        },
      );

      return {
        stop() {
          if (stopped) return;
          stopped = true;
          autoSaveObservationRevision += 1;
          mentionObservationRevision += 1;
          try {
            unsubscribeStorage();
          } catch (_e) {
            // ignore
          }
          unsubscribeStorage = () => {};
          stopMention();
          controller.stop();
        },
      };
    },
  };
}
