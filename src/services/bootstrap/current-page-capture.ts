import { t } from '@i18n';
import { hydrateChatgptDeepResearchSnapshot } from '@collectors/chatgpt/chatgpt-deep-research-hydrator';
import { AI_CHAT_INCLUDE_THINKING_STORAGE_KEY, applyThinkingCapturePreference } from '@services/shared/thinking-block';
import { storageGet } from '@services/shared/storage';
import type { ChatgptApiCheckpoint } from '@services/conversations/domain/models';
import { resolveActiveOrInpageCollector, type CollectorRegistryLike } from '@collectors/registry';
import { DISCOURSE_OP_NOT_FOUND_ERROR, isDiscourseOpNotFoundErrorMessage } from '@collectors/web/article-fetch-errors';
import { ARTICLE_MESSAGE_TYPES, CORE_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { buildCaptureSuccessTipMessage, CAPTURE_ACTIVITY_VISIBLE_MS } from '@services/shared/capture-tip';
import { resolveCaptureIntegrity } from '@services/shared/capture-integrity';
import { detectSupportedVideoPagePlatform } from '@services/url-cleaning/video-url';
import type { VideoTranscriptCaptureService } from '@services/bootstrap/video-transcript-capture';
import type { VideoSubtitleStatus } from '@services/shared/video-capture';
import { readChatgptApiCaptureEnabled } from '@services/integrations/chatgpt/api-capture-settings';
import { captureCurrentChatgptConversationViaApi } from '@services/integrations/chatgpt/api-capture';
import { parseChatgptDurableConversationRoute } from '@services/shared/chatgpt-route';

type ChatgptTrustedTailWindow = {
  checkpoint: ChatgptApiCheckpoint;
  messagesRevision: number;
  messages: Array<{ messageKey: string; role: string; sequence: number }>;
};

type RuntimeClient = {
  send?: (type: string, payload?: Record<string, unknown>) => Promise<any>;
};

type CurrentPageCaptureDeps = {
  runtime: RuntimeClient | null;
  collectorsRegistry: CollectorRegistryLike | null;
  videoCapture: Pick<VideoTranscriptCaptureService, 'captureVideoTranscript'>;
  onActivity?: (activity: CurrentPageCaptureActivity) => void;
};

export type CurrentPageCaptureActivity = {
  phase: 'capturing' | 'settled';
  kind: 'info' | 'success' | 'error';
  message: string;
  expiresAt: number | null;
};

export type CurrentPageCaptureState = {
  kind: 'chat' | 'video' | 'article' | 'unsupported';
  label: string;
  collectorId: string | null;
  reason?: string;
  activity?: CurrentPageCaptureActivity;
};

type CurrentPageSavedResult = {
  label: string;
  collectorId: string | null;
  conversationId: number | null;
  title?: string;
  isNew: boolean;
};

type CurrentPageCaptureResult =
  | (CurrentPageSavedResult & {
      kind: 'chat';
      captureCompleteness?: 'complete' | 'partial';
      captureReasons?: string[];
    })
  | (CurrentPageSavedResult & { kind: 'article' })
  | (CurrentPageSavedResult & { kind: 'video'; subtitleStatus: VideoSubtitleStatus });

function errorMessage(error: unknown, fallback: string): string {
  const maybeError = error as { message?: unknown };
  const message = maybeError?.message ?? error;
  const normalized = String(message || fallback || t('captureFailedFallback')).trim();
  return normalized || fallback || t('captureFailedFallback');
}

function userFacingCaptureError(error: unknown): Error {
  const raw = error as { code?: unknown; status?: unknown; message?: unknown };
  const code = String(raw?.code || raw?.message || '').trim();
  if (!code.startsWith('chatgpt_api_')) {
    return error instanceof Error ? error : new Error(errorMessage(error, t('captureFailedFallback')));
  }

  const status = Number(raw?.status || 0);
  const sessionUnavailable =
    code === 'chatgpt_api_session_schema' ||
    (code.startsWith('chatgpt_api_session_') && (status === 401 || status === 403)) ||
    (code === 'chatgpt_api_page_http' && status === 401);
  const message =
    code === 'chatgpt_api_navigation_changed'
      ? t('chatgptApiCaptureNavigationChanged')
      : status === 429
        ? t('chatgptApiCaptureRateLimited')
        : sessionUnavailable
          ? t('chatgptApiCaptureSessionExpired')
          : t('chatgptApiCaptureTemporarilyUnavailable');
  return Object.assign(new Error(message), {
    code,
    ...(Number.isFinite(status) && status > 0 ? { status } : null),
  });
}

function normalizeArticleCaptureErrorMessage(raw: unknown): string {
  const message = String(raw || '').trim();
  if (!message) return '';
  if (isDiscourseOpNotFoundErrorMessage(message)) return DISCOURSE_OP_NOT_FOUND_ERROR;
  return message;
}

function normalizeConversationId(value: unknown): number | null {
  const conversationId = Number(value);
  if (!Number.isFinite(conversationId) || conversationId <= 0) return null;
  return conversationId;
}

function isUnresolvedDeepResearchMessage(message: any): boolean {
  if (!message || message.role !== 'assistant') return false;
  const value = String(message.contentMarkdown || '').trim();
  return value.startsWith('Deep Research (iframe):') || value === 'Deep Research (iframe)';
}

function dedupeCodes(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const code = String(value || '').trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    result.push(code);
  }
  return result;
}

function markUnresolvedDeepResearch(snapshot: any): void {
  const unresolved = Array.isArray(snapshot?.messages)
    ? snapshot.messages.filter((message: any) => isUnresolvedDeepResearchMessage(message))
    : [];
  if (!unresolved.length) return;

  const existingMeta = snapshot?.captureMeta && typeof snapshot.captureMeta === 'object' ? snapshot.captureMeta : {};
  snapshot.captureMeta = {
    ...existingMeta,
    completeness: 'partial',
    reasons: dedupeCodes([
      ...(Array.isArray(existingMeta.reasons) ? existingMeta.reasons : []),
      'deep_research_hydration_incomplete',
    ]),
  };
  const conversation = snapshot?.conversation;
  if (conversation && typeof conversation === 'object') {
    conversation.warningFlags = dedupeCodes([
      ...(Array.isArray(conversation.warningFlags) ? conversation.warningFlags : []),
      'deep_research_hydration_incomplete',
    ]);
  }
}

export function createCurrentPageCaptureService(deps: CurrentPageCaptureDeps) {
  const runtime = deps.runtime;
  const collectorsRegistry = deps.collectorsRegistry;
  const videoCapture = deps.videoCapture;
  let captureActivity: CurrentPageCaptureActivity | null = null;
  let captureActivityUrl = '';
  const currentUrl = () => String(globalThis.location?.href || '');

  function setCaptureActivity(
    phase: CurrentPageCaptureActivity['phase'],
    kind: CurrentPageCaptureActivity['kind'],
    message: string,
    pageUrl = currentUrl(),
  ) {
    if (pageUrl !== currentUrl()) {
      if (captureActivityUrl === pageUrl) captureActivity = null;
      return;
    }
    captureActivityUrl = pageUrl;
    captureActivity = {
      phase,
      kind,
      message,
      expiresAt: phase === 'capturing' ? null : Date.now() + CAPTURE_ACTIVITY_VISIBLE_MS,
    };
    try {
      deps.onActivity?.(captureActivity);
    } catch (_error) {
      // UI feedback must not interrupt persistence or change capture results.
    }
  }

  function readCaptureActivity(): CurrentPageCaptureActivity | null {
    if (captureActivityUrl !== currentUrl()) captureActivity = null;
    if (!captureActivity) return null;
    if (captureActivity.expiresAt != null && captureActivity.expiresAt <= Date.now()) {
      captureActivity = null;
      return null;
    }
    return captureActivity;
  }

  function send(type: string, payload?: Record<string, unknown>) {
    if (!runtime || typeof runtime.send !== 'function') {
      return Promise.reject(new Error('runtime client unavailable'));
    }
    return runtime.send(type, payload);
  }

  async function resolveCaptureTarget() {
    if (detectSupportedVideoPagePlatform(globalThis.location?.href || '')) {
      return {
        kind: 'video' as const,
        label: t('fetchVideoTranscript'),
        collectorId: 'video' as const,
        collector: null,
      };
    }

    const collector = resolveActiveOrInpageCollector(collectorsRegistry);
    if (!collector) {
      return {
        kind: 'unsupported' as const,
        label: t('unavailable'),
        collectorId: null,
        reason: t('currentPageCannotBeCaptured'),
        collector: null,
      };
    }

    const chatgptApiApplicable =
      collector.id === 'chatgpt' &&
      (await readChatgptApiCaptureEnabled()) &&
      !!parseChatgptDurableConversationRoute(globalThis.location?.href || '');
    const available = chatgptApiApplicable || collector.isCaptureAvailable();
    if (!available) {
      return {
        kind: 'unsupported' as const,
        label: t('unavailable'),
        collectorId: collector.id,
        reason: t('currentPageCannotBeCaptured'),
        collector: null,
      };
    }
    if (collector.id === 'web') {
      return {
        kind: 'article' as const,
        label: t('fetchArticle'),
        collectorId: 'web',
        collector,
      };
    }
    return {
      kind: 'chat' as const,
      label: t('fetchAiChat'),
      collectorId: collector.id,
      collector,
      useChatgptApi: chatgptApiApplicable,
    };
  }

  async function saveSnapshot(
    snapshot: any,
    collectorId: string | null,
    options?: {
      expectedChatgptConversationId?: string;
      deferRemoteSync?: boolean;
      includeThinking?: boolean;
      checkpoint?: ChatgptApiCheckpoint | null;
      trustedTail?: ChatgptTrustedTailWindow;
      trustedChatgptApiPartial?: boolean;
    },
  ) {
    if (!snapshot || !snapshot.conversation) return null;
    const safeSnapshot =
      collectorId === 'chatgpt' && snapshot.captureMeta?.completeness === 'partial' && Array.isArray(snapshot.messages)
        ? {
            ...snapshot,
            messages: snapshot.messages.map((message: any) => ({
              ...message,
              captureMergePolicy: message.captureMergePolicy ?? 'preserve-existing-content',
            })),
          }
        : snapshot;

    const integrity = resolveCaptureIntegrity(
      collectorId,
      await applyThinkingCapturePreference(safeSnapshot, options?.includeThinking),
    );
    if (!integrity.ok) return null;
    const normalizedSnapshot = integrity.snapshot;
    let persistence: {
      mode: 'snapshot' | 'append' | 'incremental';
      diff: { added: string[]; updated: string[]; removed: string[] } | null;
    } = integrity.persistence;
    if (options?.trustedTail) {
      const window = options.trustedTail;
      const messages = normalizedSnapshot.messages as Array<{
        messageKey: string;
        role: string;
        sequence: number;
        contentMarkdown: string;
      }>;
      const oldAnchor = window.messages.find((item) => item.messageKey === window.checkpoint.lastUserKey);
      const newAnchor = messages.find((item) => item.messageKey === window.checkpoint.lastUserKey);
      if (
        oldAnchor?.role !== 'user' ||
        newAnchor?.role !== 'user' ||
        !Number.isFinite(oldAnchor.sequence) ||
        !Number.isFinite(newAnchor.sequence)
      )
        throw new Error('chatgpt_api_storage_conflict');

      const previousTail = window.messages.filter((item) => item.sequence > oldAnchor.sequence);
      const previousKeys = new Set(previousTail.map((item) => item.messageKey));
      const previousByKey = new Map(previousTail.map((item) => [item.messageKey, item]));
      const isPartialTail = integrity.meta?.completeness !== 'complete';
      let nextProvisionalSequence = Math.max(oldAnchor.sequence, ...previousTail.map((item) => item.sequence)) + 1;
      const currentTail = messages
        .filter((item) => item.sequence > newAnchor.sequence)
        .map((item) => ({
          ...item,
          sequence: isPartialTail
            ? (previousByKey.get(item.messageKey)?.sequence ?? nextProvisionalSequence++)
            : oldAnchor.sequence + item.sequence - newAnchor.sequence,
        }));
      const currentKeys = new Set(currentTail.map((item) => item.messageKey));
      persistence = {
        mode: 'incremental',
        diff: {
          added: currentTail.filter((item) => !previousKeys.has(item.messageKey)).map((item) => item.messageKey),
          updated: currentTail.filter((item) => previousKeys.has(item.messageKey)).map((item) => item.messageKey),
          removed:
            integrity.meta?.completeness === 'complete'
              ? previousTail.filter((item) => !currentKeys.has(item.messageKey)).map((item) => item.messageKey)
              : [],
        },
      };
      normalizedSnapshot.messages = currentTail;
    }
    const activityAt = Date.now();
    const assertExpectedChatgptRoute = () => {
      const expected = String(options?.expectedChatgptConversationId || '').trim();
      if (!expected) return;
      const current = parseChatgptDurableConversationRoute(globalThis.location?.href || '');
      if (!current || current.conversationId !== expected) throw new Error('chatgpt_api_navigation_changed');
    };
    assertExpectedChatgptRoute();

    const conversationRes = await send(CORE_MESSAGE_TYPES.UPSERT_CONVERSATION, {
      payload: { ...normalizedSnapshot.conversation, lastActivityAt: 0 },
    });
    if (!conversationRes?.ok) {
      throw new Error(conversationRes?.error?.message || 'upsertConversation failed');
    }

    const conversation = conversationRes.data;
    const conversationId = normalizeConversationId(conversation?.id);
    const isNew = (conversation as any)?.__isNew;
    if (conversationId == null || typeof isNew !== 'boolean') throw new Error('invalid upsertConversation response');

    const messagesRes = await send(CORE_MESSAGE_TYPES.SYNC_CONVERSATION_MESSAGES, {
      conversationId,
      messages: normalizedSnapshot.messages || [],
      mode: persistence.mode,
      diff: persistence.diff,
      conversationSourceType: normalizedSnapshot?.conversation?.sourceType || 'chat',
      conversationContentChanged: (conversation as any)?.__semanticContentChanged === true,
      conversationMetadataChanged: (conversation as any)?.__conversationChanged === true,
      activityAt,
      ...(options?.deferRemoteSync ? { deferRemoteSync: true } : null),
      ...(integrity.meta?.completeness === 'complete' && options?.checkpoint
        ? { chatgptApiCheckpoint: options.checkpoint }
        : null),
      ...(options?.trustedChatgptApiPartial ? { trustedChatgptApiPartial: true } : null),
      ...(options?.trustedTail
        ? {
            expectedCheckpoint: options.trustedTail.checkpoint,
            expectedMessagesRevision: options.trustedTail.messagesRevision,
            verifiedChatgptApiTail: true,
          }
        : null),
    });
    if (!messagesRes?.ok) {
      throw new Error(messagesRes?.error?.message || 'syncConversationMessages failed');
    }

    const captureReasons = dedupeCodes(integrity.meta?.reasons || []);
    return {
      conversationId,
      isNew,
      captureCompleteness: integrity.meta?.completeness,
      captureReasons: captureReasons.length ? captureReasons : undefined,
    };
  }

  async function captureCurrentPage(): Promise<CurrentPageCaptureResult> {
    const pageUrl = currentUrl();
    let savedPagedConversationId: number | null = null;
    setCaptureActivity('capturing', 'info', t('fetchingDots'), pageUrl);

    try {
      const target = await resolveCaptureTarget();
      if (target.kind === 'unsupported') throw new Error(target.reason || t('currentPageCannotBeCaptured'));

      if (target.kind === 'video') {
        const result = await videoCapture.captureVideoTranscript();
        const message =
          result.subtitleStatus === 'empty'
            ? t('videoTranscriptTipNoSubtitles')
            : result.subtitleStatus === 'off'
              ? t('videoTranscriptTipSubtitlesOff')
              : result.subtitleStatus === 'unavailable'
                ? t('videoTranscriptTipSubtitlesUnavailable')
                : buildCaptureSuccessTipMessage({ isNew: result.isNew, title: result.title || '' });
        setCaptureActivity('settled', 'success', message, pageUrl);
        return {
          kind: 'video',
          label: target.label,
          collectorId: 'video',
          conversationId: result.conversationId,
          title: result.title,
          isNew: result.isNew,
          subtitleStatus: result.subtitleStatus,
        };
      }

      if (target.kind === 'article') {
        const response = await send(ARTICLE_MESSAGE_TYPES.FETCH_ACTIVE_TAB);
        if (!response?.ok) {
          const normalizedError = normalizeArticleCaptureErrorMessage(response?.error?.message);
          throw new Error(normalizedError || t('captureFailedFallback'));
        }
        const title = String(response?.data?.title || '');
        const isNew = response?.data?.isNew;
        if (typeof isNew !== 'boolean') throw new Error('invalid article capture response');
        const message = buildCaptureSuccessTipMessage({ isNew, title });
        setCaptureActivity('settled', 'success', message, pageUrl);
        return {
          kind: 'article',
          label: target.label,
          collectorId: target.collectorId,
          conversationId: normalizeConversationId(response?.data?.conversationId),
          title: String(title || '').trim() || undefined,
          isNew,
        };
      }

      let snapshot: any;
      let expectedChatgptConversationId = '';
      let firstPageIsNew: boolean | null = null;
      let includeThinking: boolean | undefined;
      let checkpoint: ChatgptApiCheckpoint | null = null;
      let trustedTail: ChatgptTrustedTailWindow | null = null;
      let capturedVerifiedTail = false;
      let stageChatgptPage: ((page: { snapshot: any }) => Promise<void>) | undefined;
      if (target.kind === 'chat' && target.useChatgptApi) {
        includeThinking =
          (await storageGet([AI_CHAT_INCLUDE_THINKING_STORAGE_KEY]))?.[AI_CHAT_INCLUDE_THINKING_STORAGE_KEY] !== false;
        const chatgptRoute = parseChatgptDurableConversationRoute(pageUrl);
        if (!chatgptRoute) throw new Error('chatgpt_api_navigation_changed');
        const tailResponse = await send(CORE_MESSAGE_TYPES.GET_CONVERSATION_TAIL_WINDOW_BY_SOURCE_AND_KEY, {
          source: 'chatgpt',
          conversationKey: chatgptRoute.conversationId,
          limit: 200,
          compact: true,
        });
        if (!tailResponse?.ok) throw new Error(tailResponse?.error?.message || 'chatgpt_api_tail_unavailable');
        const tailData = tailResponse.data;
        const tailMessages = Array.isArray(tailData?.messages) ? tailData.messages : [];
        const tailCheckpoint = tailData?.checkpoint as ChatgptApiCheckpoint | null;
        const orderedTail =
          tailMessages.length <= 200 &&
          tailMessages.every(
            (message: any, index: number) =>
              typeof message?.messageKey === 'string' &&
              !!message.messageKey &&
              Number.isSafeInteger(message.sequence) &&
              message.sequence >= 0 &&
              (index === 0 || message.sequence > tailMessages[index - 1].sequence),
          );
        if (
          tailCheckpoint &&
          typeof tailCheckpoint.lastUserKey === 'string' &&
          /^[0-9a-f]{64}$/.test(tailCheckpoint.userSignature) &&
          tailCheckpoint.includeThinking === includeThinking &&
          Number.isSafeInteger(tailData?.messagesRevision) &&
          tailData.messagesRevision >= 0 &&
          orderedTail &&
          tailMessages.some(
            (message: any) => message?.messageKey === tailCheckpoint.lastUserKey && message.role === 'user',
          )
        ) {
          trustedTail = {
            checkpoint: tailCheckpoint,
            messagesRevision: tailData.messagesRevision,
            messages: tailMessages,
          };
        }
        stageChatgptPage = async (page) => {
          const staged = {
            ...page.snapshot,
            captureMeta: { ...page.snapshot.captureMeta, completeness: 'partial' },
          };
          const savedPage = await saveSnapshot(staged, 'chatgpt', {
            expectedChatgptConversationId: String(page.snapshot?.conversation?.conversationKey || ''),
            deferRemoteSync: true,
            includeThinking,
            trustedChatgptApiPartial: true,
          });
          if (!savedPage) throw new Error('chatgpt_api_no_safe_messages');
          savedPagedConversationId = savedPage.conversationId;
          firstPageIsNew ??= savedPage.isNew;
        };
        const savedAnchorKey = trustedTail?.checkpoint.lastUserKey;
        const savedAnchorSequence = trustedTail?.messages.find(
          (message) => message.messageKey === savedAnchorKey,
        )?.sequence;
        const followingUserSequence =
          trustedTail?.messages.find(
            (message) => message.role === 'user' && message.sequence > (savedAnchorSequence ?? Infinity),
          )?.sequence ?? Infinity;
        const savedAssistantKey = trustedTail?.messages.findLast(
          (message) =>
            message.role === 'assistant' &&
            message.sequence > (savedAnchorSequence ?? Infinity) &&
            message.sequence < followingUserSequence,
        )?.messageKey;
        const apiCapture = await captureCurrentChatgptConversationViaApi({
          includeThinking,
          ...(trustedTail
            ? { trustedCheckpoint: trustedTail.checkpoint, trustedTailLastAssistantKey: savedAssistantKey }
            : null),
          onPage: stageChatgptPage,
        });
        snapshot = apiCapture.snapshot;
        capturedVerifiedTail = apiCapture.verifiedTail === true;
        expectedChatgptConversationId = String(snapshot?.conversation?.conversationKey || '').trim();
        if (typeof target.collector.enrichApiSnapshotWithRenderedGraphics === 'function') {
          snapshot = await target.collector.enrichApiSnapshotWithRenderedGraphics(snapshot);
        }
        if (snapshot?.captureMeta?.completeness === 'complete') {
          await apiCapture.verifyCurrent();
          const currentThinking =
            (await storageGet([AI_CHAT_INCLUDE_THINKING_STORAGE_KEY]))?.[AI_CHAT_INCLUDE_THINKING_STORAGE_KEY] !==
            false;
          if (currentThinking !== includeThinking) throw new Error('chatgpt_api_settings_changed');
          checkpoint = apiCapture.checkpoint;
        }
      } else {
        let preparedCapture: unknown;
        if (typeof target.collector.prepareManualCapture === 'function') {
          preparedCapture = await target.collector.prepareManualCapture({ manual: true });
        }
        snapshot = await Promise.resolve(target.collector.capture({ manual: true, preparedCapture }));
        if (!snapshot) throw new Error(t('noVisibleConversationFound'));

        const isChatgpt =
          String(snapshot?.conversation?.source || '')
            .trim()
            .toLowerCase() === 'chatgpt';
        const hasDeepResearchPlaceholders =
          isChatgpt &&
          Array.isArray(snapshot?.messages) &&
          snapshot.messages.some((message: any) => isUnresolvedDeepResearchMessage(message));
        if (hasDeepResearchPlaceholders) {
          try {
            await hydrateChatgptDeepResearchSnapshot(snapshot, send);
          } catch (_error) {
            // The unresolved placeholder is marked partial below.
          }
          markUnresolvedDeepResearch(snapshot);
        }
      }

      const persist = () =>
        saveSnapshot(snapshot, target.collectorId, {
          ...(expectedChatgptConversationId ? { expectedChatgptConversationId } : null),
          ...(includeThinking !== undefined ? { includeThinking } : null),
          ...(checkpoint ? { checkpoint } : null),
          ...(capturedVerifiedTail && trustedTail ? { trustedTail } : null),
          ...(expectedChatgptConversationId ? { trustedChatgptApiPartial: true } : null),
        });
      let saved;
      try {
        saved = await persist();
      } catch (error) {
        if (
          !capturedVerifiedTail ||
          !stageChatgptPage ||
          String((error as Error)?.message || '') !== 'chatgpt_api_storage_conflict'
        )
          throw error;

        // Another tab changed the local tail after our bounded read. Refetch the current branch once.
        const fullCapture = await captureCurrentChatgptConversationViaApi({
          includeThinking,
          onPage: stageChatgptPage,
        });
        snapshot = fullCapture.snapshot;
        capturedVerifiedTail = false;
        checkpoint = null;
        expectedChatgptConversationId = String(snapshot?.conversation?.conversationKey || '').trim();
        if (typeof target.collector.enrichApiSnapshotWithRenderedGraphics === 'function') {
          snapshot = await target.collector.enrichApiSnapshotWithRenderedGraphics(snapshot);
        }
        if (snapshot?.captureMeta?.completeness === 'complete') {
          await fullCapture.verifyCurrent();
          const currentThinking =
            (await storageGet([AI_CHAT_INCLUDE_THINKING_STORAGE_KEY]))?.[AI_CHAT_INCLUDE_THINKING_STORAGE_KEY] !==
            false;
          if (currentThinking !== includeThinking) throw new Error('chatgpt_api_settings_changed');
          checkpoint = fullCapture.checkpoint;
        }
        saved = await persist();
      }
      if (!saved) throw new Error(t('noVisibleConversationFound'));

      const title = String(snapshot?.conversation?.title || '');
      const isNew = firstPageIsNew ?? saved.isNew;
      const message = buildCaptureSuccessTipMessage({ isNew, title });
      setCaptureActivity('settled', 'success', message, pageUrl);
      return {
        kind: 'chat',
        label: target.label,
        collectorId: target.collectorId,
        conversationId: normalizeConversationId(saved.conversationId),
        title: String(title || '').trim() || undefined,
        isNew,
        captureCompleteness: saved.captureCompleteness,
        captureReasons: saved.captureReasons,
      };
    } catch (error) {
      if (savedPagedConversationId !== null) {
        try {
          await send(CORE_MESSAGE_TYPES.ENQUEUE_CONVERSATION_IMAGE_BACKFILL, {
            conversationId: savedPagedConversationId,
          });
        } catch (_error) {
          // Image recovery must not hide the original capture failure.
        }
      }
      const outwardError = userFacingCaptureError(error);
      const message = errorMessage(outwardError, t('captureFailedFallback'));
      setCaptureActivity('settled', 'error', message, pageUrl);
      throw outwardError;
    }
  }

  function reportAutoSave(result: { isNew: boolean; title?: unknown }, pageUrl: string) {
    setCaptureActivity('settled', 'success', buildCaptureSuccessTipMessage(result), pageUrl);
  }

  async function getCurrentPageCaptureState(): Promise<CurrentPageCaptureState> {
    const target = await resolveCaptureTarget();
    const activity = readCaptureActivity();
    return {
      kind: target.kind,
      label: target.label,
      collectorId: target.collectorId,
      reason: target.reason,
      ...(activity ? { activity } : null),
    };
  }

  return {
    captureCurrentPage,
    getCurrentPageCaptureState,
    reportAutoSave,
  };
}

export type CurrentPageCaptureService = ReturnType<typeof createCurrentPageCaptureService>;
