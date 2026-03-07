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
};

const CORE_MESSAGE_TYPES = Object.freeze({
  UPSERT_CONVERSATION: 'upsertConversation',
  SYNC_CONVERSATION_MESSAGES: 'syncConversationMessages',
});

const ARTICLE_MESSAGE_TYPES = Object.freeze({
  FETCH_ACTIVE_TAB: 'fetchActiveTabArticle',
});

function errorMessage(error: unknown, fallback: string): string {
  const maybeError = error as { message?: unknown };
  const message = maybeError?.message ?? error;
  const normalized = String(message || fallback || 'Capture failed').trim();
  return normalized || fallback || 'Capture failed';
}

function normalizeConversationId(value: unknown): number | null {
  const conversationId = Number(value);
  if (!Number.isFinite(conversationId) || conversationId <= 0) return null;
  return conversationId;
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
        label: 'Unavailable',
        collectorId: null,
        reason: 'Current page cannot be captured',
        collector: null,
      };
    }

    if (collector.id === 'web') {
      return {
        available: true,
        kind: 'article' as const,
        label: 'Fetch Article',
        collectorId: 'web',
        collector,
      };
    }

    return {
      available: true,
      kind: 'chat' as const,
      label: 'Fetch AI Chat',
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

    const conversation = conversationRes.data;
    const messagesRes = await send(CORE_MESSAGE_TYPES.SYNC_CONVERSATION_MESSAGES, {
      conversationId: conversation.id,
      messages: snapshot.messages || [],
    });
    if (!messagesRes?.ok) {
      throw new Error(messagesRes?.error?.message || 'syncConversationMessages failed');
    }

    return { conversationId: normalizeConversationId(conversation.id) };
  }

  async function captureCurrentPage(input?: {
    onProgress?: (progress: CurrentPageCaptureProgress) => void;
  }): Promise<CurrentPageCaptureResult> {
    const onProgress = input?.onProgress;
    const target = resolveCaptureTarget();

    if (!target.available || !target.collector) {
      throw new Error(target.reason || 'Current page cannot be captured');
    }

    const report = (message: string, kind?: 'default' | 'loading' | 'error') => {
      onProgress?.({ message, kind });
    };

    try {
      if (target.kind === 'article') {
        report('Saving...', 'loading');
        const response = await send(ARTICLE_MESSAGE_TYPES.FETCH_ACTIVE_TAB);
        if (!response?.ok) {
          throw new Error(response?.error?.message || 'Fetch failed');
        }
        report('Saved', 'default');
        return {
          kind: 'article',
          label: target.label,
          collectorId: target.collectorId,
          conversationId: normalizeConversationId(response?.data?.conversationId),
          title: String(response?.data?.title || '').trim() || undefined,
        };
      }

      report(typeof target.collector.prepareManualCapture === 'function' ? 'Loading full history...' : 'Saving...', 'loading');
      if (typeof target.collector.prepareManualCapture === 'function') {
        await target.collector.prepareManualCapture();
        report('Saving...', 'loading');
      }

      const snapshot = await Promise.resolve(target.collector.capture({ manual: true }));
      if (!snapshot) {
        throw new Error('No visible conversation found');
      }

      const saved = await saveSnapshot(snapshot);
      if (!saved) {
        throw new Error('No visible conversation found');
      }

      report('Saved', 'default');
      return {
        kind: 'chat',
        label: target.label,
        collectorId: target.collectorId,
        conversationId: normalizeConversationId(saved.conversationId),
        title: String(snapshot?.conversation?.title || '').trim() || undefined,
      };
    } catch (error) {
      report(errorMessage(error, 'Capture failed'), 'error');
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
