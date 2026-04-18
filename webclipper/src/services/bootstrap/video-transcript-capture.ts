import { extractVideoTranscriptFromCurrentPage } from '@collectors/video/video-transcript-extract';
import { cleanTrackingParamsUrl } from '@services/url-cleaning/tracking-param-cleaner';

type RuntimeClient = {
  send?: (type: string, payload?: Record<string, unknown>) => Promise<any>;
};

const CORE_MESSAGE_TYPES = Object.freeze({
  UPSERT_CONVERSATION: 'upsertConversation',
  SYNC_CONVERSATION_MESSAGES: 'syncConversationMessages',
});

function normalizeText(text: unknown) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function toError(message: unknown) {
  return new Error(String(message || 'unknown error'));
}

function formatTranscriptMarkdown(cues: Array<{ start: number; text: string }>, hasTimestamps: boolean): string {
  const lines: string[] = [];
  const pad2 = (n: number) => String(Math.max(0, Math.floor(n))).padStart(2, '0');
  const fmt = (sec: number) => {
    const s = Math.max(0, Number(sec) || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = Math.floor(s % 60);
    return h > 0 ? `${pad2(h)}:${pad2(m)}:${pad2(r)}` : `${pad2(m)}:${pad2(r)}`;
  };

  for (const cue of cues || []) {
    const text = normalizeText((cue as any)?.text || '');
    if (!text) continue;
    if (hasTimestamps && Number.isFinite(Number((cue as any)?.start))) {
      lines.push(`${fmt(Number((cue as any).start))} ${text}`);
    } else {
      lines.push(text);
    }
  }

  return normalizeText(lines.join('\n'));
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
    conversationId: number | null;
    title?: string;
    isNew?: boolean;
    url?: string;
  }> {
    const extracted = await extractVideoTranscriptFromCurrentPage();
    const capturedAt = Date.now();

    const rawUrl = normalizeText(extracted?.meta?.url || location.href);
    const cleanedUrl = (await cleanTrackingParamsUrl(rawUrl)) || rawUrl;
    const url = normalizeText(cleanedUrl) || rawUrl;

    const title = normalizeText(extracted?.meta?.title || '');
    const author = normalizeText(extracted?.meta?.author || '');
    const platform = normalizeText(extracted?.meta?.platform || '');
    const durationSeconds =
      extracted?.meta?.durationSeconds != null && Number.isFinite(Number(extracted.meta.durationSeconds))
        ? Math.max(0, Math.floor(Number(extracted.meta.durationSeconds)))
        : null;
    const thumbnailUrl = normalizeText(extracted?.meta?.thumbnailUrl || '');

    const transcriptMarkdown = formatTranscriptMarkdown(
      Array.isArray(extracted?.cues) ? extracted.cues : [],
      extracted?.hasTimestamps === true,
    );
    const resolvedTranscriptMarkdown = transcriptMarkdown || '_(未检测到字幕。)_';
    const transcriptText = normalizeText(
      (Array.isArray(extracted?.cues) ? extracted.cues : [])
        .map((c: any) => normalizeText(c?.text || ''))
        .filter(Boolean)
        .join('\n'),
    );

    const conversationRes = await send(CORE_MESSAGE_TYPES.UPSERT_CONVERSATION, {
      payload: {
        sourceType: 'video',
        source: 'video',
        conversationKey: `video:${url}`,
        title,
        url,
        author,
        publishedAt: '',
        warningFlags: [],
        lastCapturedAt: capturedAt,
        platform,
        durationSeconds,
        thumbnailUrl,
        transcriptSource: extracted?.source || 'C',
        hasTimestamps: extracted?.hasTimestamps === true,
      },
    });
    if (!conversationRes?.ok) {
      throw toError(conversationRes?.error?.message || 'upsertConversation failed');
    }
    const conversation = conversationRes.data;
    const conversationId = Number((conversation as any)?.id);
    if (!Number.isFinite(conversationId) || conversationId <= 0) throw toError('invalid conversation id');

    const messages = [
      {
        messageKey: 'video_transcript',
        role: 'transcript',
        contentText: transcriptText,
        contentMarkdown: resolvedTranscriptMarkdown,
        sequence: 1,
        updatedAt: capturedAt,
      },
    ];

    const messagesRes = await send(CORE_MESSAGE_TYPES.SYNC_CONVERSATION_MESSAGES, {
      conversationId: conversation.id,
      messages,
      mode: 'snapshot',
      diff: null,
      conversationSourceType: 'video',
      conversationUrl: url,
    });
    if (!messagesRes?.ok) {
      throw toError(messagesRes?.error?.message || 'syncConversationMessages failed');
    }

    const rawIsNew = (conversation as any)?.__isNew;
    return {
      conversationId,
      title: title || undefined,
      url,
      isNew: typeof rawIsNew === 'boolean' ? rawIsNew : undefined,
    };
  }

  return { captureVideoTranscript };
}

export type VideoTranscriptCaptureService = ReturnType<typeof createVideoTranscriptCaptureService>;
