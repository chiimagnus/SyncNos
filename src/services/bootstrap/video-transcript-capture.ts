import { extractVideoTranscriptFromCurrentPage } from '@collectors/video/video-transcript-extract';
import {
  formatVideoTranscriptMarkdown,
  toCanonicalVideoTranscriptCues,
} from '@services/conversations/domain/video-content';
import { CORE_MESSAGE_TYPES } from '@platform/messaging/message-contracts';

type RuntimeClient = {
  send?: (type: string, payload?: Record<string, unknown>) => Promise<any>;
};

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
    url: string;
    subtitleStatus: 'ok' | 'empty';
  }> {
    const extracted = await extractVideoTranscriptFromCurrentPage();
    const activityAt = Date.now();
    const {
      url,
      title,
      author,
      platform,
      durationSeconds,
      thumbnailUrl,
      description: videoDescription,
    } = extracted.meta;
    const transcriptCues = toCanonicalVideoTranscriptCues(extracted.cues);
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
    if (extracted.chapters !== null) {
      message.videoChapters = extracted.chapters;
    }

    const messagesRes = await send(CORE_MESSAGE_TYPES.SYNC_CONVERSATION_MESSAGES, {
      conversationId: conversation.id,
      messages: [message],
      mode: 'snapshot',
      conversationSourceType: 'video',
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
