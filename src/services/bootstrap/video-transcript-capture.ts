import { extractVideoTranscriptFromCurrentPage } from '@collectors/video/video-transcript-extract';
import {
  formatVideoTranscriptMarkdown,
  normalizeCanonicalVideoChapters,
  toCanonicalVideoTranscriptCues,
} from '@services/conversations/domain/video-content';
import { CORE_MESSAGE_TYPES } from '@platform/messaging/message-contracts';

type RuntimeClient = {
  send?: (type: string, payload?: Record<string, unknown>) => Promise<any>;
};

function normalizeText(text: unknown) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function toError(message: unknown) {
  return new Error(String(message || 'unknown error'));
}

export function createVideoTranscriptCaptureService(deps: { runtime: RuntimeClient | null }) {
  const runtime = deps.runtime;

  function send(type: string, payload?: Record<string, unknown>) {
    if (!runtime || typeof runtime.send !== 'function') {
      return Promise.reject(toError('runtime client unavailable'));
    }
    return runtime.send(type, payload);
  }

  async function captureVideoTranscript(): Promise<{
    conversationId: number;
    title?: string;
    isNew: boolean;
    url?: string;
    subtitleStatus: 'ok' | 'empty';
  }> {
    const extracted = await extractVideoTranscriptFromCurrentPage();
    const activityAt = Date.now();

    const rawUrl = normalizeText(extracted?.meta?.url || location.href);
    const url = normalizeText(rawUrl);

    const title = normalizeText(extracted?.meta?.title || '');
    const author = normalizeText(extracted?.meta?.author || '');
    const platform = normalizeText(extracted?.meta?.platform || '');
    const durationSeconds =
      extracted?.meta?.durationSeconds != null && Number.isFinite(Number(extracted.meta.durationSeconds))
        ? Math.max(0, Number(extracted.meta.durationSeconds))
        : null;
    const thumbnailUrl = normalizeText(extracted?.meta?.thumbnailUrl || '');
    const videoDescription = normalizeText(extracted?.meta?.description || '');

    const transcriptCues = toCanonicalVideoTranscriptCues(Array.isArray(extracted?.cues) ? extracted.cues : []);
    const transcriptMarkdown = formatVideoTranscriptMarkdown(transcriptCues);
    const subtitleStatus: 'ok' | 'empty' = transcriptCues.length ? 'ok' : 'empty';

    const conversationRes = await send(CORE_MESSAGE_TYPES.UPSERT_CONVERSATION, {
      payload: {
        sourceType: 'video',
        source: 'video',
        conversationKey: `video:${url}`,
        title,
        url,
        author,
        lastActivityAt: 0,
        platform,
        durationSeconds,
        thumbnailUrl,
        videoDescription,
      },
    });
    if (!conversationRes?.ok) {
      throw toError(conversationRes?.error?.message || 'upsertConversation failed');
    }
    const conversation = conversationRes.data;
    const conversationId = Number((conversation as any)?.id);
    if (!Number.isFinite(conversationId) || conversationId <= 0) throw toError('invalid conversation id');

    const message: Record<string, unknown> = {
      messageKey: 'video_transcript',
      role: 'transcript',
      contentMarkdown: transcriptMarkdown,
      sequence: 1,
      updatedAt: activityAt,
    };
    if (transcriptCues.length) {
      message.transcriptCues = transcriptCues;
    }
    if (extracted?.chapters !== null) {
      message.videoChapters = normalizeCanonicalVideoChapters(extracted?.chapters);
    }
    const messages = [message];

    const messagesRes = await send(CORE_MESSAGE_TYPES.SYNC_CONVERSATION_MESSAGES, {
      conversationId: conversation.id,
      messages,
      mode: 'snapshot',
      diff: null,
      conversationSourceType: 'video',
      conversationUrl: url,
      activityAt,
    });
    if (!messagesRes?.ok) {
      throw toError(messagesRes?.error?.message || 'syncConversationMessages failed');
    }

    const isNew = (conversation as any)?.__isNew;
    if (typeof isNew !== 'boolean') throw toError('invalid upsertConversation response');
    return {
      conversationId,
      title: title || undefined,
      url,
      isNew,
      subtitleStatus,
    };
  }

  return { captureVideoTranscript };
}

export type VideoTranscriptCaptureService = ReturnType<typeof createVideoTranscriptCaptureService>;
