import {
  NOTION_AI_TRANSCRIPT_REQUEST,
  NOTION_AI_TRANSCRIPT_RESPONSE,
  normalizeNotionAiThreadId,
  notionAiApiThreadId,
} from '@collectors/notionai/notionai-transcript';

type RequestTemplate = {
  url: string;
  body: Record<string, unknown>;
  init: {
    method: string;
    headers: Array<[string, string]>;
    credentials: RequestCredentials;
  };
};

const TRANSCRIPT_PATH = '/api/v3/getThreadTranscript';
const MAX_HISTORY_PAGES = 200;

function stableString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requestUrl(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' || input instanceof URL ? String(input) : input?.url || '';
  try {
    return new URL(raw, location.href).toString();
  } catch (_error) {
    return '';
  }
}

function isTranscriptUrl(url: string): boolean {
  try {
    return new URL(url).pathname === TRANSCRIPT_PATH;
  } catch (_error) {
    return false;
  }
}

function readJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function requestBodyText(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string') return Promise.resolve(init.body);
  if (typeof Request === 'function' && input instanceof Request) {
    return input
      .clone()
      .text()
      .catch(() => '');
  }
  return Promise.resolve('');
}

function buildTemplate(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  url: string,
  body: Record<string, unknown>,
) {
  try {
    const request = new Request(typeof input === 'string' || input instanceof URL ? url : input, init);
    return {
      url,
      body,
      init: {
        method: request.method || 'POST',
        headers: Array.from(request.headers.entries()),
        credentials: request.credentials,
      },
    } satisfies RequestTemplate;
  } catch (_error) {
    return null;
  }
}

function sanitizePages(pages: any[], visibleKinds: Map<string, 'user_message' | 'assistant_message'>): any[] {
  for (const page of pages) {
    for (const patch of Array.isArray(page?.patches) ? page.patches : []) {
      if (patch?.op !== 'put') continue;
      const kind = stableString(patch?.entity?.kind);
      const id = stableString(patch?.entity?.id);
      if (id && (kind === 'user_message' || kind === 'assistant_message')) visibleKinds.set(id, kind);
    }
  }

  return pages.map((page) => ({
    patches: (Array.isArray(page?.patches) ? page.patches : []).flatMap((patch: any) => {
      if (patch?.op === 'put') {
        const entity = patch?.entity;
        const id = stableString(entity?.id);
        const kind = visibleKinds.get(id);
        if (!kind) return [];
        return [
          {
            op: 'put',
            entity:
              kind === 'user_message'
                ? {
                    id,
                    kind,
                    sequence: entity?.sequence,
                    created_at: entity?.created_at,
                    text: entity?.text,
                    has_files: Array.isArray(entity?.files) && entity.files.length > 0,
                  }
                : {
                    id,
                    kind,
                    sequence: entity?.sequence,
                    created_at: entity?.created_at,
                    content: entity?.content,
                  },
          },
        ];
      }

      const id = stableString(patch?.id);
      const kind = visibleKinds.get(id);
      if (!kind) return [];
      if (patch?.op === 'remove') return [{ op: 'remove', id }];
      if (patch?.op !== 'patch') return [];

      const operations = (Array.isArray(patch?.ops) ? patch.ops : []).filter((operation: any) => {
        const path = stableString(operation?.path);
        return kind === 'assistant_message' ? path.startsWith('/content') : path.startsWith('/text');
      });
      return operations.length === (Array.isArray(patch?.ops) ? patch.ops.length : -1)
        ? [{ op: 'patch', id, ops: operations }]
        : [{ op: 'unsupported_visible_patch', id }];
    }),
  }));
}

function currentThreadId(): string {
  try {
    return normalizeNotionAiThreadId(new URL(location.href).searchParams.get('t'));
  } catch (_error) {
    return '';
  }
}

export default defineContentScript({
  matches: ['https://app.notion.com/*', 'https://notion.so/*', 'https://*.notion.so/*'],
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    const originalFetch = globalThis.fetch;
    if (typeof originalFetch !== 'function') return;

    const templates = new Map<string, RequestTemplate>();
    const visibleKinds = new Map<string, 'user_message' | 'assistant_message'>();

    const fetchPage = async (template: RequestTemplate, body: Record<string, unknown>) => {
      const response = await originalFetch(template.url, {
        ...template.init,
        headers: new Headers(template.init.headers),
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`notionai_transcript_http_${response.status}`);
      const page = await response.json();
      if (!page || typeof page !== 'object') throw new Error('notionai_transcript_invalid_response');
      return page;
    };

    globalThis.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input?.url || '';
      if (!rawUrl.includes(TRANSCRIPT_PATH)) return originalFetch(input, init);
      const url = requestUrl(input);
      if (!url || !isTranscriptUrl(url)) return originalFetch(input, init);

      return (async () => {
        const bodyTextPromise = requestBodyText(input, init);
        const responsePromise = originalFetch(input, init);
        const body = readJsonObject(await bodyTextPromise);
        const response = await responsePromise;
        if (!body) return response;

        const threadId = normalizeNotionAiThreadId(body.threadId);
        const template = threadId ? buildTemplate(input, init, url, body) : null;
        if (threadId && template && currentThreadId() === threadId) {
          if (!templates.has(threadId)) {
            templates.clear();
            visibleKinds.clear();
          }
          templates.set(threadId, template);
        }
        return response;
      })();
    } as typeof fetch;

    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      const data: any = event.data;
      if (!data || data.__syncnos !== true || data.type !== NOTION_AI_TRANSCRIPT_REQUEST) return;
      const requestId = stableString(data.requestId);
      const threadId = normalizeNotionAiThreadId(data.threadId);
      const mode = data.mode === 'latest' ? 'latest' : 'full';
      if (!requestId || !threadId || currentThreadId() !== threadId) return;

      const finish = (payload: { pages?: any[]; complete?: boolean; error?: string }) => {
        window.postMessage(
          {
            __syncnos: true,
            type: NOTION_AI_TRANSCRIPT_RESPONSE,
            requestId,
            threadId,
            pages: sanitizePages(payload.pages || [], visibleKinds),
            complete: payload.complete === true,
            ...(payload.error ? { error: payload.error } : null),
          },
          '*',
        );
      };

      void (async () => {
        const template = templates.get(threadId);
        if (!template) {
          finish({ error: 'notionai_transcript_request_template_unavailable' });
          return;
        }

        try {
          const baseBody: Record<string, unknown> = {
            ...template.body,
            threadId: notionAiApiThreadId(threadId),
            direction: 'backward',
            limit: Number.isFinite(Number(template.body.limit)) ? Number(template.body.limit) : 10,
          };
          delete baseBody.cursor;

          const newest = await fetchPage(template, baseBody);
          if (mode === 'latest') {
            finish({ pages: [newest], complete: newest?.has_more_backward === false });
            return;
          }

          const pages = [newest];
          const seenCursors = new Set<string>();
          let page = newest;

          while (page?.has_more_backward === true && pages.length < MAX_HISTORY_PAGES) {
            const cursor = stableString(page?.backward_cursor);
            if (!cursor || seenCursors.has(cursor)) break;
            seenCursors.add(cursor);
            page = await fetchPage(template, { ...baseBody, cursor });
            pages.push(page);
          }

          finish({
            pages: pages.reverse(),
            complete: page?.has_more_backward !== true,
          });
        } catch (error) {
          finish({ error: error instanceof Error ? error.message : 'notionai_transcript_request_failed' });
        }
      })();
    });
  },
});
