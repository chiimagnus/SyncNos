import type { CollectorEnv } from '@collectors/collector-env.ts';
import { firstUserMessageTitle } from '@collectors/collector-utils.ts';
import { htmlToMarkdown } from '@collectors/shared/markdown-dom.ts';
import MarkdownIt from 'markdown-it';
import texmath from 'markdown-it-texmath';
import { normalizeNotionId } from '@services/shared/notion-id';
import { NOTION_AI_TRANSCRIPT_REQUEST, NOTION_AI_TRANSCRIPT_RESPONSE } from '@collectors/notionai/notionai-protocol';

let markupParser: MarkdownIt | undefined;

function getMarkupParser(): MarkdownIt {
  if (markupParser) return markupParser;
  const parser = new MarkdownIt({ html: true, breaks: true, typographer: false });
  parser.inline.ruler.before('html_inline', 'notion_edit_reference', (state) => {
    const match = state.src.slice(state.pos).match(/^<edit_reference(?:\s[^>]*)?>[\s\S]*?<\/edit_reference\s*>/);
    if (!match) return false;
    state.pos += match[0].length;
    return true;
  });
  for (const rule of texmath.rules.dollars.inline) {
    parser.inline.ruler.before('escape', rule.name, texmath.inline(rule));
    parser.renderer.rules[rule.name] = (tokens, index) =>
      parser.utils.escapeHtml(`${rule.tag}${tokens[index].content}${rule.tag}`);
  }
  for (const rule of texmath.rules.dollars.block) {
    parser.block.ruler.before('fence', rule.name, texmath.block(rule));
    parser.renderer.rules[rule.name] = (tokens, index) =>
      `<p>$$<br>${parser.utils.escapeHtml(tokens[index].content.trim())}<br>$$</p>`;
  }
  markupParser = parser;
  return parser;
}

const HISTORY_PARTIAL_REASON = 'notionai_transcript_history_partial';
const SCHEMA_DRIFT_REASON = 'notionai_transcript_schema_drift_partial';
const FILES_UNSUPPORTED_REASON = 'notionai_transcript_files_unsupported';

type TranscriptState = {
  pages: any[];
  complete: boolean;
};

type PendingRequest = {
  mode: 'full' | 'latest';
  threadId: string;
  resolve: (state: TranscriptState | null) => void;
  timer: ReturnType<typeof setTimeout>;
};

function stableString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cloneJson<T>(value: T): T {
  if (value == null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function decodePointer(path: unknown): string[] | null {
  const raw = stableString(path);
  if (!raw.startsWith('/')) return null;
  return raw
    .slice(1)
    .split('/')
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function applyPatchOperations(entity: any, operations: any[]): boolean {
  for (const operation of operations) {
    const parts = decodePointer(operation?.path);
    if (!parts?.length) return false;
    let parent = entity;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const key = parts[index];
      if (!parent || typeof parent !== 'object' || !(key in parent)) return false;
      parent = parent[key];
    }
    if (!parent || typeof parent !== 'object') return false;
    const key = parts[parts.length - 1];
    const op = stableString(operation?.op);
    if (op === 'add' || op === 'replace') {
      parent[key] = cloneJson(operation?.value);
      continue;
    }
    if (op === 'remove') {
      if (Array.isArray(parent)) {
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || index >= parent.length) return false;
        parent.splice(index, 1);
      } else {
        delete parent[key];
      }
      continue;
    }
    if (op === 'append') {
      const current = parent[key];
      if (typeof current === 'string' && typeof operation?.value === 'string') {
        parent[key] = current + operation.value;
        continue;
      }
      if (Array.isArray(current)) {
        const values = Array.isArray(operation?.value) ? operation.value : [operation?.value];
        current.push(...cloneJson(values));
        continue;
      }
      return false;
    }
    return false;
  }
  return true;
}

function materializeEntities(pages: any[]): { entities: any[]; schemaDrift: boolean } {
  const entities = new Map<string, any>();
  const pending = new Map<string, any[][]>();
  let schemaDrift = false;

  for (const page of pages) {
    for (const patch of Array.isArray(page?.patches) ? page.patches : []) {
      const op = stableString(patch?.op);
      if (op === 'put') {
        const incoming = patch?.entity;
        const id = stableString(incoming?.id);
        if (!id || !incoming || typeof incoming !== 'object') {
          schemaDrift = true;
          continue;
        }
        const next = cloneJson(incoming);
        for (const operations of pending.get(id) || []) {
          if (!applyPatchOperations(next, operations)) schemaDrift = true;
        }
        pending.delete(id);
        entities.set(id, next);
        continue;
      }
      if (op === 'patch') {
        const id = stableString(patch?.id);
        const operations = Array.isArray(patch?.ops) ? patch.ops : null;
        if (!id || !operations) {
          schemaDrift = true;
          continue;
        }
        const entity = entities.get(id);
        if (entity) {
          if (!applyPatchOperations(entity, operations)) schemaDrift = true;
        } else {
          const queued = pending.get(id) || [];
          queued.push(cloneJson(operations));
          pending.set(id, queued);
        }
        continue;
      }
      if (op === 'remove') {
        const id = stableString(patch?.id);
        if (id) {
          entities.delete(id);
          pending.delete(id);
        }
        continue;
      }
      if (op === 'session' || op === 'committed') continue;
      if (op) schemaDrift = true;
    }
  }

  return { entities: Array.from(entities.values()), schemaDrift };
}

function notionPageUrl(pageId: unknown): string {
  const compact = stableString(pageId).replace(/-/g, '');
  return /^[0-9a-fA-F]{32}$/.test(compact) ? `https://www.notion.so/${compact}` : '';
}

function safeHttpUrl(value: unknown): string {
  try {
    const url = new URL(stableString(value));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch (_error) {
    return '';
  }
}

function renderUserRichText(value: unknown): string {
  if (!Array.isArray(value)) return stableString(value);
  const output: string[] = [];
  for (const segment of value) {
    if (!Array.isArray(segment)) continue;
    let text = typeof segment[0] === 'string' ? segment[0] : '';
    const annotations = Array.isArray(segment[1]) ? segment[1] : [];
    for (const annotation of annotations) {
      if (!Array.isArray(annotation)) continue;
      const kind = stableString(annotation[0]);
      if (kind === 'p') {
        const url = notionPageUrl(annotation[1]);
        if (url) text = `[${text === '‣' ? 'Notion page' : text || 'Notion page'}](${url})`;
      } else if (kind === 'a') {
        const url = safeHttpUrl(annotation[1]);
        if (url) text = `[${text || url}](${url})`;
      } else if (kind === 'b' && text) {
        text = `**${text}**`;
      } else if (kind === 'i' && text) {
        text = `*${text}*`;
      } else if (kind === 's' && text) {
        text = `~~${text}~~`;
      } else if (kind === 'c' && text) {
        text = `\`${text.replace(/`/g, '\\`')}\``;
      }
    }
    output.push(text);
  }
  return output.join('').trim();
}

function renderAssistantMarkup(raw: unknown, document: Document): string {
  const source = typeof raw === 'string' ? raw : '';
  if (!source.trim()) return '';

  const container = document.createElement('div');
  container.innerHTML = getMarkupParser().render(source);
  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === 3 && !node.textContent?.trim()) node.remove();
  }
  for (const element of Array.from(container.querySelectorAll('edit_reference, script, style'))) element.remove();
  for (const mention of Array.from(container.querySelectorAll('mention'))) {
    const link = document.createElement('a');
    link.href = safeHttpUrl(mention.getAttribute('url'));
    link.textContent = mention.textContent || link.getAttribute('href') || '';
    mention.replaceWith(link);
  }
  return htmlToMarkdown(container);
}

function renderAssistantContent(value: unknown, document: Document): { markdown: string; supported: boolean } {
  if (!Array.isArray(value)) return { markdown: '', supported: false };
  const parts: string[] = [];
  let supported = true;
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      supported = false;
      continue;
    }
    if (stableString((item as any).type) !== 'text' || typeof (item as any).text !== 'string') {
      supported = false;
      continue;
    }
    const markdown = renderAssistantMarkup((item as any).text, document);
    if (markdown) parts.push(markdown);
  }
  return { markdown: parts.join('\n\n').trim(), supported };
}

export function buildNotionAiTranscriptSnapshot(input: {
  pages: any[];
  complete: boolean;
  threadId: string;
  conversationTitle?: string;
  document: Document;
  capturedAt?: number;
}): any | null {
  const threadId = normalizeNotionId(input.threadId);
  if (!threadId || !Array.isArray(input.pages) || !input.pages.length) return null;
  const { entities, schemaDrift } = materializeEntities(input.pages);
  const reasons = new Set<string>();
  if (!input.complete) reasons.add(HISTORY_PARTIAL_REASON);
  if (schemaDrift) reasons.add(SCHEMA_DRIFT_REASON);
  const capturedAt = Number.isFinite(input.capturedAt) ? Number(input.capturedAt) : Date.now();
  const visible = entities
    .filter((entity) => entity?.kind === 'user_message' || entity?.kind === 'assistant_message')
    .sort((a, b) => {
      const left = Number(a?.sequence);
      const right = Number(b?.sequence);
      if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return left - right;
      return stableString(a?.id).localeCompare(stableString(b?.id));
    });

  const messages: any[] = [];
  for (const entity of visible) {
    const id = stableString(entity?.id);
    if (!id) {
      reasons.add(SCHEMA_DRIFT_REASON);
      continue;
    }
    let contentMarkdown = '';
    if (entity.kind === 'user_message') {
      contentMarkdown = renderUserRichText(entity.text);
      if (entity.has_files === true) reasons.add(FILES_UNSUPPORTED_REASON);
    } else {
      const rendered = renderAssistantContent(entity.content, input.document);
      contentMarkdown = rendered.markdown;
      if (!rendered.supported) reasons.add(SCHEMA_DRIFT_REASON);
    }
    if (!contentMarkdown) continue;
    const createdAt = Date.parse(stableString(entity.created_at));
    messages.push({
      messageKey: `${entity.kind === 'user_message' ? 'user' : 'assistant'}_${id}`,
      role: entity.kind === 'user_message' ? 'user' : 'assistant',
      contentMarkdown,
      sequence: messages.length,
      updatedAt: Number.isFinite(createdAt) ? createdAt : capturedAt,
    });
  }
  if (!messages.length) return null;

  const title = stableString(input.conversationTitle) || firstUserMessageTitle(messages) || 'Notion AI';
  return {
    conversation: {
      sourceType: 'chat',
      source: 'notionai',
      conversationKey: `notionai_t_${threadId}`,
      title,
      url: `https://app.notion.com/chat?t=${threadId}&wfv=chat`,
      warningFlags: [],
    },
    messages,
    captureMeta: {
      completeness: reasons.size ? 'partial' : 'complete',
      identityVerified: true,
      ...(reasons.size ? { reasons: Array.from(reasons) } : null),
    },
  };
}

export function createNotionAiTranscriptBridge(env: Pick<CollectorEnv, 'window'>) {
  const window = env.window;
  const stateByThread = new Map<string, TranscriptState>();
  const pendingByRequestId = new Map<string, PendingRequest>();
  let requestCounter = 0;

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window) return;
    const data: any = event.data;
    if (!data || data.__syncnos !== true) return;

    if (data.type !== NOTION_AI_TRANSCRIPT_RESPONSE) return;
    const requestId = stableString(data.requestId);
    const pending = pendingByRequestId.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingByRequestId.delete(requestId);
    const threadId = normalizeNotionId(data.threadId);
    const pages = Array.isArray(data.pages) ? data.pages : [];
    if (!threadId || threadId !== pending.threadId || !pages.length) {
      pending.resolve(pending.mode === 'full' ? stateByThread.get(pending.threadId) || null : null);
      return;
    }
    const state = { pages, complete: data.complete === true };
    if (pending.mode === 'full') stateByThread.set(threadId, state);
    pending.resolve(state);
  };

  window.addEventListener('message', onMessage);

  const request = (threadIdValue: unknown, mode: 'full' | 'latest'): Promise<TranscriptState | null> => {
    const threadId = normalizeNotionId(threadIdValue);
    if (!threadId) return Promise.resolve(null);
    const requestId = `notionai-${Date.now()}-${++requestCounter}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingByRequestId.delete(requestId);
        resolve(mode === 'full' ? stateByThread.get(threadId) || null : null);
      }, 15_000);
      pendingByRequestId.set(requestId, { mode, threadId, resolve, timer });
      window.postMessage({ __syncnos: true, type: NOTION_AI_TRANSCRIPT_REQUEST, requestId, threadId, mode }, '*');
    });
  };

  return {
    get(threadIdValue: unknown): TranscriptState | null {
      const threadId = normalizeNotionId(threadIdValue);
      return threadId ? stateByThread.get(threadId) || null : null;
    },
    requestFull(threadIdValue: unknown): Promise<TranscriptState | null> {
      return request(threadIdValue, 'full');
    },
    requestLatest(threadIdValue: unknown): Promise<TranscriptState | null> {
      return request(threadIdValue, 'latest');
    },
  };
}
