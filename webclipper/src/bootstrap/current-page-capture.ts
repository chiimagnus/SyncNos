import { t } from '../i18n';
import { inlineSameOriginImagesInSnapshot } from './image-inline';

type RuntimeClient = {
  send?: (type: string, payload?: Record<string, unknown>) => Promise<any>;
};

type CollectorRegistry = {
  pickActive?: () => { id: string; collector: any } | null;
  list?: () => Array<{ id: string; collector?: any; matches?: (loc: any) => boolean; inpageMatches?: (loc: any) => boolean }>;
};

type CurrentPageCaptureDeps = {
  runtime: RuntimeClient | null;
  collectorsRegistry: CollectorRegistry | null;
};

export type CurrentPageCaptureProgress = {
  kind?: 'default' | 'loading' | 'error';
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
};

const CORE_MESSAGE_TYPES = Object.freeze({
  UPSERT_CONVERSATION: 'upsertConversation',
  SYNC_CONVERSATION_MESSAGES: 'syncConversationMessages',
});

const STORAGE_KEY_AI_CHAT_CACHE_IMAGES_ENABLED = 'ai_chat_cache_images_enabled';

function readAiChatCacheImagesEnabled(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const storageApi = (globalThis as any).chrome?.storage ?? (globalThis as any).browser?.storage;
      const local = storageApi?.local;
      if (!local?.get) return resolve(false);
      local.get([STORAGE_KEY_AI_CHAT_CACHE_IMAGES_ENABLED], (res: any) => {
        resolve(res?.[STORAGE_KEY_AI_CHAT_CACHE_IMAGES_ENABLED] === true);
      });
    } catch (_e) {
      resolve(false);
    }
  });
}

const ARTICLE_MESSAGE_TYPES = Object.freeze({
  FETCH_ACTIVE_TAB: 'fetchActiveTabArticle',
});

function errorMessage(error: unknown, fallback: string): string {
  const maybeError = error as { message?: unknown };
  const message = maybeError?.message ?? error;
  const normalized = String(message || fallback || t('captureFailedFallback')).trim();
  return normalized || fallback || t('captureFailedFallback');
}

function normalizeConversationId(value: unknown): number | null {
  const conversationId = Number(value);
  if (!Number.isFinite(conversationId) || conversationId <= 0) return null;
  return conversationId;
}

function normalizeTitle(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateForTip(title: string, maxChars: number): string {
  const value = normalizeTitle(title);
  const limit = Number.isFinite(Number(maxChars)) ? Math.max(1, Math.floor(Number(maxChars))) : 60;
  if (!value) return '';
  if (value.length <= limit) return value;
  const sliceLen = Math.max(0, limit - 1);
  return `${value.slice(0, sliceLen)}…`;
}

const TIP_TITLE_MAX_CHARS = 48;

export function createCurrentPageCaptureService(deps: CurrentPageCaptureDeps) {
  const runtime = deps.runtime;
  const collectorsRegistry = deps.collectorsRegistry;

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

  function resolveCaptureTarget() {
    const collector = getCollector() || getInpageCollector();
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

  async function saveSnapshot(snapshot: any) {
    if (!snapshot || !snapshot.conversation) return null;

    const conversationRes = await send(CORE_MESSAGE_TYPES.UPSERT_CONVERSATION, {
      payload: snapshot.conversation,
    });
    if (!conversationRes?.ok) {
      throw new Error(conversationRes?.error?.message || 'upsertConversation failed');
    }

    try {
      const enabled = await readAiChatCacheImagesEnabled();
      const sourceType = String(snapshot?.conversation?.sourceType || '').trim().toLowerCase() || 'chat';
      if (enabled && sourceType !== 'article') {
        await inlineSameOriginImagesInSnapshot({ snapshot });
      }
    } catch (_e) {
      // never block capture on inline failures
    }

    const conversation = conversationRes.data;
    const messagesRes = await send(CORE_MESSAGE_TYPES.SYNC_CONVERSATION_MESSAGES, {
      conversationId: conversation.id,
      messages: snapshot.messages || [],
      mode: 'snapshot',
      diff: null,
      conversationSourceType: snapshot?.conversation?.sourceType || 'chat',
      conversationUrl: snapshot?.conversation?.url || '',
    });
    if (!messagesRes?.ok) {
      throw new Error(messagesRes?.error?.message || 'syncConversationMessages failed');
    }

    const rawIsNew = (conversation as any)?.__isNew;
    return {
      conversationId: normalizeConversationId(conversation.id),
      isNew: typeof rawIsNew === 'boolean' ? rawIsNew : undefined,
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

    const report = (message: string, kind?: 'default' | 'loading' | 'error') => {
      onProgress?.({ message, kind });
    };

    try {
      if (target.kind === 'article') {
        report(t('savingDots'), 'loading');
        const response = await send(ARTICLE_MESSAGE_TYPES.FETCH_ACTIVE_TAB);
        if (!response?.ok) {
          throw new Error(response?.error?.message || t('captureFailedFallback'));
        }
        const title = normalizeTitle(response?.data?.title || '');
        const isNew = response?.data?.isNew !== false;
        const prefix = isNew ? t('savedPrefix') : t('updatedPrefix');
        report(
          title ? `${prefix}${truncateForTip(title, TIP_TITLE_MAX_CHARS)}` : (isNew ? t('saved') : t('updated')),
          'default',
        );
        return {
          kind: 'article',
          label: target.label,
          collectorId: target.collectorId,
          conversationId: normalizeConversationId(response?.data?.conversationId),
          title: title || undefined,
          isNew,
        };
      }

      report(typeof target.collector.prepareManualCapture === 'function' ? t('loadingFullHistory') : t('savingDots'), 'loading');
      if (typeof target.collector.prepareManualCapture === 'function') {
        await target.collector.prepareManualCapture();
        report(t('savingDots'), 'loading');
      }

      const snapshot = await Promise.resolve(target.collector.capture({ manual: true }));
      if (!snapshot) {
        throw new Error(t('noVisibleConversationFound'));
      }

      const saved = await saveSnapshot(snapshot);
      if (!saved) {
        throw new Error(t('noVisibleConversationFound'));
      }

      const title = normalizeTitle(snapshot?.conversation?.title || '');
      const isNew = saved.isNew !== false;
      const prefix = isNew ? t('savedPrefix') : t('updatedPrefix');
      report(
        title ? `${prefix}${truncateForTip(title, TIP_TITLE_MAX_CHARS)}` : (isNew ? t('saved') : t('updated')),
        'default',
      );
      return {
        kind: 'chat',
        label: target.label,
        collectorId: target.collectorId,
        conversationId: normalizeConversationId(saved.conversationId),
        title: title || undefined,
        isNew,
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
