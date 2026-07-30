import { t } from '@i18n';
import { hydrateChatgptDeepResearchSnapshot } from '@collectors/chatgpt/chatgpt-deep-research-hydrator';
import { resolveActiveOrInpageCollector, type CollectorRegistryLike } from '@collectors/registry';
import { DISCOURSE_OP_NOT_FOUND_ERROR, isDiscourseOpNotFoundErrorMessage } from '@collectors/web/article-fetch-errors';
import { ARTICLE_MESSAGE_TYPES, CORE_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import { buildCaptureSuccessTipMessage } from '@services/shared/capture-tip';
import { resolveCaptureIntegrity } from '@services/shared/capture-integrity';

type RuntimeClient = {
  send?: (type: string, payload?: Record<string, unknown>) => Promise<any>;
};

type CurrentPageCaptureDeps = {
  runtime: RuntimeClient | null;
  collectorsRegistry: CollectorRegistryLike | null;
};

export type CurrentPageCaptureProgress = {
  kind?: 'default' | 'error';
  message: string;
};

export type CurrentPageCaptureState = {
  available: boolean;
  kind: 'chat' | 'article' | 'unsupported';
  label: string;
  collectorId: string | null;
  reason?: string;
};

export type CurrentPageCaptureResult = {
  kind: 'chat' | 'article';
  label: string;
  collectorId: string | null;
  conversationId: number | null;
  title?: string;
  isNew?: boolean;
  captureCompleteness?: 'complete' | 'partial';
  captureReasons?: string[];
};

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
  const value = String(message.contentText || message.contentMarkdown || '').trim();
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

  function send(type: string, payload?: Record<string, unknown>) {
    if (!runtime || typeof runtime.send !== 'function') {
      return Promise.reject(new Error('runtime client unavailable'));
    }
    return runtime.send(type, payload);
  }

  function resolveCaptureTarget() {
    const collector = resolveActiveOrInpageCollector(collectorsRegistry);
    if (!collector) {
      return {
        available: false,
        kind: 'unsupported' as const,
        label: t('unavailable'),
        collectorId: null,
        reason: t('currentPageCannotBeCaptured'),
        collector: null,
      };
    }

    if (collector.id === 'web') {
      return {
        available: true,
        kind: 'article' as const,
        label: t('fetchArticle'),
        collectorId: 'web',
        collector,
      };
    }

    return {
      available: true,
      kind: 'chat' as const,
      label: t('fetchAiChat'),
      collectorId: collector.id,
      collector,
    };
  }

  async function saveSnapshot(snapshot: any, collectorId: string | null) {
    if (!snapshot || !snapshot.conversation) return null;

    const integrity = resolveCaptureIntegrity(collectorId, snapshot);
    if (!integrity.ok) return null;
    const normalizedSnapshot = integrity.snapshot;

    const conversationRes = await send(CORE_MESSAGE_TYPES.UPSERT_CONVERSATION, {
      payload: normalizedSnapshot.conversation,
    });
    if (!conversationRes?.ok) {
      throw new Error(conversationRes?.error?.message || 'upsertConversation failed');
    }

    const conversation = conversationRes.data;
    const messagesRes = await send(CORE_MESSAGE_TYPES.SYNC_CONVERSATION_MESSAGES, {
      conversationId: conversation.id,
      messages: normalizedSnapshot.messages || [],
      mode: integrity.persistence.mode,
      diff: integrity.persistence.diff,
      conversationSourceType: normalizedSnapshot?.conversation?.sourceType || 'chat',
      conversationUrl: normalizedSnapshot?.conversation?.url || '',
    });
    if (!messagesRes?.ok) {
      throw new Error(messagesRes?.error?.message || 'syncConversationMessages failed');
    }

    const rawIsNew = (conversation as any)?.__isNew;
    return {
      conversationId: normalizeConversationId(conversation.id),
      isNew: typeof rawIsNew === 'boolean' ? rawIsNew : undefined,
      captureCompleteness: integrity.meta?.completeness,
      captureReasons: integrity.meta?.reasons?.slice(),
    };
  }

  async function captureCurrentPage(input?: {
    onProgress?: (progress: CurrentPageCaptureProgress) => void;
  }): Promise<CurrentPageCaptureResult> {
    const onProgress = input?.onProgress;
    const target = resolveCaptureTarget();

    if (!target.available || !target.collector) {
      throw new Error(target.reason || t('currentPageCannotBeCaptured'));
    }

    const report = (message: string, kind?: 'default' | 'error') => {
      onProgress?.({ message, kind });
    };

    try {
      if (target.kind === 'article') {
        const response = await send(ARTICLE_MESSAGE_TYPES.FETCH_ACTIVE_TAB);
        if (!response?.ok) {
          const normalizedError = normalizeArticleCaptureErrorMessage(response?.error?.message);
          throw new Error(normalizedError || t('captureFailedFallback'));
        }
        const title = String(response?.data?.title || '');
        const isNew = response?.data?.isNew !== false;
        report(buildCaptureSuccessTipMessage({ isNew, title }), 'default');
        return {
          kind: 'article',
          label: target.label,
          collectorId: target.collectorId,
          conversationId: normalizeConversationId(response?.data?.conversationId),
          title: String(title || '').trim() || undefined,
          isNew,
        };
      }

      let preparedCapture: unknown;
      if (typeof target.collector.prepareManualCapture === 'function') {
        preparedCapture = await target.collector.prepareManualCapture({ manual: true });
      }

      const snapshot = await Promise.resolve(target.collector.capture({ manual: true, preparedCapture }));
      if (!snapshot) {
        throw new Error(t('noVisibleConversationFound'));
      }

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

      const saved = await saveSnapshot(snapshot, target.collectorId);
      if (!saved) {
        throw new Error(t('noVisibleConversationFound'));
      }

      const title = String(snapshot?.conversation?.title || '');
      const isNew = saved.isNew !== false;
      report(
        saved.captureCompleteness === 'partial'
          ? t('partialCaptureSaved')
          : buildCaptureSuccessTipMessage({ isNew, title }),
        'default',
      );
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
      report(errorMessage(error, t('captureFailedFallback')), 'error');
      throw error;
    }
  }

  function getCurrentPageCaptureState(): CurrentPageCaptureState {
    const target = resolveCaptureTarget();
    return {
      available: target.available,
      kind: target.kind,
      label: target.label,
      collectorId: target.collectorId,
      reason: target.reason,
    };
  }

  return {
    captureCurrentPage,
    getCurrentPageCaptureState,
  };
}

export type CurrentPageCaptureService = ReturnType<typeof createCurrentPageCaptureService>;
