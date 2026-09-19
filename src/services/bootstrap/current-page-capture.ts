import { t } from '@i18n';
import { hydrateChatgptDeepResearchSnapshot } from '@collectors/chatgpt/chatgpt-deep-research-hydrator';
import { resolveActiveOrInpageCollector, type CollectorRegistryLike } from '@collectors/registry';
import { DISCOURSE_OP_NOT_FOUND_ERROR, isDiscourseOpNotFoundErrorMessage } from '@collectors/web/article-fetch-errors';
import { ARTICLE_MESSAGE_TYPES, CORE_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { buildCaptureSuccessTipMessage } from '@services/shared/capture-tip';
import { resolveCaptureIntegrity } from '@services/shared/capture-integrity';
import { detectSupportedVideoPagePlatform } from '@services/url-cleaning/video-url';
import type { VideoTranscriptCaptureService } from '@services/bootstrap/video-transcript-capture';
import { readChatgptApiCaptureEnabled } from '@services/integrations/chatgpt/api-capture-settings';
import { captureCurrentChatgptConversationViaApi } from '@services/integrations/chatgpt/api-capture';
import { augmentChatgptApiSnapshotWithLiveTurn } from '@services/integrations/chatgpt/api-live-tail';
import { parseChatgptDurableConversationRoute } from '@services/shared/chatgpt-route';
import {
  buildCaptureWaitingMessage,
  buildPartialCaptureMessage,
} from '@services/bootstrap/current-page-capture-status';

type RuntimeClient = {
  send?: (type: string, payload?: Record<string, unknown>) => Promise<any>;
};

type CurrentPageCaptureDeps = {
  runtime: RuntimeClient | null;
  collectorsRegistry: CollectorRegistryLike | null;
  videoCapture: Pick<VideoTranscriptCaptureService, 'captureVideoTranscript'>;
};

type CurrentPageCaptureProgress = {
  kind?: 'default' | 'error';
  message: string;
};

type CurrentPageCaptureActivity = {
  phase: 'capturing' | 'settled';
  kind: 'info' | 'success' | 'warning' | 'error';
  message: string;
  expiresAt: number | null;
};

export type CurrentPageCaptureState = {
  readiness: 'ready' | 'waiting' | 'unsupported';
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
  | (CurrentPageSavedResult & { kind: 'video'; subtitleStatus: 'ok' | 'empty' });

const CAPTURE_ACTIVITY_VISIBLE_MS = 5_000;

function errorMessage(error: unknown, fallback: string): string {
  const maybeError = error as { message?: unknown };
  const message = maybeError?.message ?? error;
  const normalized = String(message || fallback || t('captureFailedFallback')).trim();
  return normalized || fallback || t('captureFailedFallback');
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

  for (const message of unresolved) {
    message.captureMergePolicy = 'preserve-existing-content';
  }
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

  function setCaptureActivity(
    phase: CurrentPageCaptureActivity['phase'],
    kind: CurrentPageCaptureActivity['kind'],
    message: string,
  ) {
    captureActivity = {
      phase,
      kind,
      message,
      expiresAt: phase === 'capturing' ? null : Date.now() + CAPTURE_ACTIVITY_VISIBLE_MS,
    };
  }

  function readCaptureActivity(): CurrentPageCaptureActivity | null {
    if (!captureActivity) return null;
    if (captureActivity.expiresAt != null && captureActivity.expiresAt <= Date.now()) {
      captureActivity = null;
      return null;
    }
    return { ...captureActivity };
  }

  function send(type: string, payload?: Record<string, unknown>) {
    if (!runtime || typeof runtime.send !== 'function') {
      return Promise.reject(new Error('runtime client unavailable'));
    }
    return runtime.send(type, payload);
  }

  function resolveCaptureTarget() {
    if (detectSupportedVideoPagePlatform(globalThis.location?.href || '')) {
      return {
        readiness: 'ready' as const,
        kind: 'video' as const,
        label: t('fetchVideoTranscript'),
        collectorId: 'video' as const,
        collector: null,
      };
    }

    const collector = resolveActiveOrInpageCollector(collectorsRegistry);
    if (!collector) {
      return {
        readiness: 'unsupported' as const,
        kind: 'unsupported' as const,
        label: t('unavailable'),
        collectorId: null,
        reason: t('currentPageCannotBeCaptured'),
        collector: null,
      };
    }

    const readiness = collector.getCaptureReadiness();
    if (readiness !== 'ready' && readiness !== 'waiting' && readiness !== 'unsupported') {
      throw new Error(`invalid capture readiness: ${String(readiness)}`);
    }
    if (readiness === 'unsupported') {
      return {
        readiness,
        kind: 'unsupported' as const,
        label: t('unavailable'),
        collectorId: collector.id,
        reason: t('currentPageCannotBeCaptured'),
        collector: null,
      };
    }
    if (collector.id === 'web') {
      return {
        readiness,
        kind: 'article' as const,
        label: t('fetchArticle'),
        collectorId: 'web',
        ...(readiness === 'waiting' ? { reason: buildCaptureWaitingMessage('web') } : null),
        collector,
      };
    }
    return {
      readiness,
      kind: 'chat' as const,
      label: t('fetchAiChat'),
      collectorId: collector.id,
      ...(readiness === 'waiting' ? { reason: buildCaptureWaitingMessage(collector.id) } : null),
      collector,
    };
  }

  async function saveSnapshot(
    snapshot: any,
    collectorId: string | null,
    options?: { expectedChatgptConversationId?: string },
  ) {
    if (!snapshot || !snapshot.conversation) return null;

    const integrity = resolveCaptureIntegrity(collectorId, snapshot);
    if (!integrity.ok) return null;
    const normalizedSnapshot = integrity.snapshot;
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
      mode: integrity.persistence.mode,
      diff: integrity.persistence.diff,
      conversationSourceType: normalizedSnapshot?.conversation?.sourceType || 'chat',
      activityAt,
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

  async function captureCurrentPage(input?: {
    onProgress?: (progress: CurrentPageCaptureProgress) => void;
  }): Promise<CurrentPageCaptureResult> {
    const onProgress = input?.onProgress;
    const report = (message: string, kind?: 'default' | 'error') => {
      onProgress?.({ message, kind });
    };

    setCaptureActivity('capturing', 'info', t('fetchingDots'));

    try {
      const target = resolveCaptureTarget();
      if (target.readiness !== 'ready') {
        const fallback =
          target.readiness === 'waiting'
            ? buildCaptureWaitingMessage(target.collectorId)
            : t('currentPageCannotBeCaptured');
        const error = Object.assign(new Error(target.reason || fallback), {
          code: target.readiness === 'waiting' ? 'capture_waiting' : 'capture_unsupported',
        });
        throw error;
      }

      if (target.kind === 'video') {
        const result = await videoCapture.captureVideoTranscript();
        const message =
          result.subtitleStatus === 'empty'
            ? t('videoTranscriptTipNoSubtitles')
            : buildCaptureSuccessTipMessage({ isNew: result.isNew, title: result.title || '' });
        setCaptureActivity('settled', 'success', message);
        report(message, 'default');
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
        setCaptureActivity('settled', 'success', message);
        report(message, 'default');
        return {
          kind: 'article',
          label: target.label,
          collectorId: target.collectorId,
          conversationId: normalizeConversationId(response?.data?.conversationId),
          title: String(title || '').trim() || undefined,
          isNew,
        };
      }

      if (!target.collector) throw new Error(t('currentPageCannotBeCaptured'));

      let snapshot: any = null;
      let expectedChatgptConversationId = '';
      const useChatgptApi = target.collectorId === 'chatgpt' && (await readChatgptApiCaptureEnabled());
      if (useChatgptApi) {
        const apiCapture = await captureCurrentChatgptConversationViaApi({
          fallbackTitle: String(globalThis.document?.title || ''),
        });
        if (apiCapture.applicable) {
          snapshot = apiCapture.snapshot;
          expectedChatgptConversationId = String(snapshot?.conversation?.conversationKey || '').trim();
          const liveTurn = target.collector.captureApiLiveTurn({
            expectedConversationId: expectedChatgptConversationId,
          });
          snapshot = augmentChatgptApiSnapshotWithLiveTurn(snapshot, liveTurn, {
            currentTurnState: apiCapture.currentTurnState,
            currentTurnId: apiCapture.currentTurnId,
          });
        }
      }

      if (!snapshot) {
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

      const saved = await saveSnapshot(snapshot, target.collectorId, {
        ...(expectedChatgptConversationId ? { expectedChatgptConversationId } : null),
      });
      if (!saved) {
        throw new Error(t('noVisibleConversationFound'));
      }

      const title = String(snapshot?.conversation?.title || '');
      const isNew = saved.isNew;
      const partial = saved.captureCompleteness === 'partial';
      const message = partial
        ? buildPartialCaptureMessage(saved.captureReasons)
        : buildCaptureSuccessTipMessage({ isNew, title });
      setCaptureActivity('settled', partial ? 'warning' : 'success', message);
      report(message, 'default');
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
      const waiting = (error as any)?.code === 'capture_waiting';
      const message = errorMessage(error, t('captureFailedFallback'));
      setCaptureActivity('settled', waiting ? 'info' : 'error', message);
      report(message, waiting ? 'default' : 'error');
      throw error;
    }
  }

  function getCurrentPageCaptureState(): CurrentPageCaptureState {
    const target = resolveCaptureTarget();
    const activity = readCaptureActivity();
    return {
      readiness: target.readiness,
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
  };
}

export type CurrentPageCaptureService = ReturnType<typeof createCurrentPageCaptureService>;
