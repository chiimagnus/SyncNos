import { structuredRichUiMarkdown } from '@services/integrations/chatgpt/rich-ui-data';
import { composeThinkingMarkdown } from '@services/shared/thinking-block';
import { normalizeDilMarkdown } from '@services/shared/dil-markdown';
import {
  buildChatgptFileCacheKey,
  buildChatgptGeneratedImageMessageKey,
  chatgptFileIdFromAssetPointer,
} from '@services/shared/chatgpt-image-identity';

type ChatgptApiCurrentTurnState = 'finalized' | 'open' | 'unknown';

export type ChatgptApiSnapshotResult = { snapshot: any };

type PendingImage = {
  fileId: string;
  alt: string;
  turnId: string;
};

type PendingAuxiliary = {
  turnId: string;
  markdown: string;
};

const SCHEMA_DRIFT_REASON = 'chatgpt_api_schema_drift_partial';
const UNOWNED_AUXILIARY_REASON = 'chatgpt_api_unowned_auxiliary_omitted';
const UNFINISHED_TURN_REASON = 'chatgpt_api_unfinished_turn_partial';
export const CHATGPT_API_PROVISIONAL_TURN_KEY_PREFIX = 'chatgpt-turn:';
type SchemaDriftReporter = () => void;

function apiSnapshotError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function stableString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function messageRole(message: any): string {
  return stableString(message?.author?.role).toLowerCase();
}

function contentType(message: any): string {
  return stableString(message?.content?.content_type).toLowerCase();
}

function messageTurnId(message: any): string {
  return stableString(message?.metadata?.turn_id);
}

function isHidden(message: any): boolean {
  return message?.metadata?.is_visually_hidden_from_conversation === true;
}

function primitivePartText(part: unknown): string {
  if (typeof part === 'string' || typeof part === 'number' || typeof part === 'boolean') return String(part);
  if (!part || typeof part !== 'object' || Array.isArray(part)) return '';
  const record = part as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  if (typeof record.content === 'string') return record.content;
  return '';
}

function isFilePart(part: unknown): part is Record<string, unknown> {
  return (
    !!part &&
    typeof part === 'object' &&
    !Array.isArray(part) &&
    stableString((part as Record<string, unknown>).content_type) === 'file_asset_pointer'
  );
}

function isImagePart(part: unknown): part is Record<string, unknown> {
  if (!part || typeof part !== 'object' || Array.isArray(part)) return false;
  const record = part as Record<string, unknown>;
  const type = stableString(record.content_type).toLowerCase();
  return type === 'image_asset_pointer';
}

function isGeneratedImageToolResult(message: any): boolean {
  return !!stableString(message?.metadata?.image_gen_title);
}

function currentParts(message: any, onSchemaDrift: SchemaDriftReporter): unknown[] {
  const raw = message?.content?.parts;
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  onSchemaDrift();
  return [];
}

function currentAttachments(message: any, onSchemaDrift: SchemaDriftReporter): any[] {
  const raw = message?.metadata?.attachments;
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  onSchemaDrift();
  return [];
}

function stableHttpUrl(value: unknown): string {
  const raw = stableString(value);
  if (!/^https?:\/\//i.test(raw)) return '';
  return raw;
}

function markdownReferenceAlt(value: unknown): string {
  const raw = stableString(value);
  const wrapped = raw.match(/^\((\[[\s\S]+\]\(https?:\/\/[\s\S]+\))\)$/i);
  return wrapped?.[1] || raw;
}

function groupedWebpageReference(reference: any, onSchemaDrift: SchemaDriftReporter): string {
  const items = Array.isArray(reference?.items) ? reference.items : [];
  const first = items.find((item: any) => item && typeof item === 'object' && !Array.isArray(item)) || null;
  const safeUrls = Array.isArray(reference?.safe_urls) ? reference.safe_urls : [];
  const url = stableHttpUrl(first?.url) || safeUrls.map(stableHttpUrl).find(Boolean) || '';
  const label = stableString(first?.attribution) || stableString(first?.title);
  const supporting = Array.isArray(first?.supporting_websites) ? first.supporting_websites.length : 0;
  const extraCount = supporting + Math.max(0, items.length - 1);
  if (url && label) return `[${label}${extraCount ? `+${extraCount}` : ''}](${url})`;

  const alt = markdownReferenceAlt(reference?.alt);
  if (alt) return alt;
  if (url) return url;
  onSchemaDrift();
  return '';
}

function clientWidgetReference(reference: any, onSchemaDrift: SchemaDriftReporter): string {
  const matched = stableString(reference?.matched_text);
  const prefix = 'genui';
  if (!matched.startsWith(prefix) || !matched.endsWith('')) {
    onSchemaDrift();
    return '';
  }
  try {
    const payload = JSON.parse(matched.slice(prefix.length, -1));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid widget payload');
    const candidate = Object.values(payload).find(
      (value) => value && typeof value === 'object' && !Array.isArray(value),
    ) as Record<string, any> | undefined;
    const meta =
      candidate?.meta && typeof candidate.meta === 'object' && !Array.isArray(candidate.meta) ? candidate.meta : {};
    const title = stableString(meta.title) || stableString(candidate?.title);
    const description = stableString(meta.description) || stableString(candidate?.description);
    if (title && description) return `${title} — ${description}`;
    if (title || description) return title || description;
  } catch (_error) {
    onSchemaDrift();
    return '';
  }
  onSchemaDrift();
  return '';
}

function transformOutsideInlineCode(text: string, transform: (text: string) => string): string {
  let output = '';
  let last = 0;
  let index = 0;
  while (index < text.length) {
    if (text[index] !== '`') {
      index += 1;
      continue;
    }
    let openerEnd = index;
    while (text[openerEnd] === '`') openerEnd += 1;
    const delimiterLength = openerEnd - index;
    let cursor = openerEnd;
    let closerEnd = -1;
    while (cursor < text.length) {
      const start = text.indexOf('`', cursor);
      if (start < 0) break;
      let end = start;
      while (text[end] === '`') end += 1;
      if (end - start === delimiterLength) {
        closerEnd = end;
        break;
      }
      cursor = end;
    }
    if (closerEnd < 0) {
      index = openerEnd;
      continue;
    }
    output += transform(text.slice(last, index)) + text.slice(index, closerEnd);
    last = closerEnd;
    index = closerEnd;
  }
  return output + transform(text.slice(last));
}

function transformOutsideCodeFences(
  markdown: string,
  transform: (text: string) => string,
  preserveStructuredLayout = false,
): string {
  const result: string[] = [];
  let outside: string[] = [];
  let fenceChar = '';
  let fenceLength = 0;
  let layoutDepth = 0;
  let indentedCode = false;
  let previousBlank = true;
  const flush = () => {
    if (!outside.length) return;
    const content = outside.join('\n');
    const hasLayoutRoot = /(?:^|\n) {0,3}<(?:row|box|col|grid|flow|card|carousel)\b[^>]*>\s*(?:\n|$)/.test(content);
    result.push(
      preserveStructuredLayout && hasLayoutRoot ? transform(content) : transformOutsideInlineCode(content, transform),
    );
    outside = [];
  };
  for (const line of markdown.split('\n')) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    const blank = !line.trim();
    const indented = /^( {4}|\t)/.test(line);
    const layoutOpen =
      /^\s*<(?:row|box|col|grid|grid-item|flow|flow-item|card|carousel|carousel-item|text|title|caption|badge)\b[^>]*>\s*$/.test(
        line,
      );
    const layoutClose =
      /^\s*<\/(?:row|box|col|grid|grid-item|flow|flow-item|card|carousel|carousel-item|text|title|caption|badge)>\s*$/.test(
        line,
      );
    if (!fenceLength) {
      if (indentedCode) {
        if (blank || indented) {
          result.push(line);
          previousBlank = blank;
          continue;
        }
        indentedCode = false;
      }
      if (indented && previousBlank && !layoutDepth) {
        flush();
        result.push(line);
        indentedCode = true;
        previousBlank = false;
        continue;
      }
      if (!marker) {
        outside.push(line);
        if (layoutOpen && (layoutDepth > 0 || !indented)) layoutDepth += 1;
        if (layoutClose && layoutDepth > 0) layoutDepth -= 1;
        previousBlank = blank;
        continue;
      }
      flush();
      fenceChar = marker[1]![0]!;
      fenceLength = marker[1]!.length;
    } else if (marker && marker[1]![0] === fenceChar && marker[1]!.length >= fenceLength && !marker[2]!.trim()) {
      fenceLength = 0;
    }
    result.push(line);
    previousBlank = blank;
  }
  flush();
  return result.join('\n');
}

function renderContentReferences(message: any, text: string, onSchemaDrift: SchemaDriftReporter): string {
  const rawReferences = message?.metadata?.content_references;
  if (rawReferences != null && !Array.isArray(rawReferences)) {
    onSchemaDrift();
  }
  const references = Array.isArray(rawReferences) ? rawReferences : [];
  return transformOutsideCodeFences(text, (outside) => {
    let output = outside;
    const replaced = new Set<string>();

    for (const reference of references) {
      if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
        onSchemaDrift();
        continue;
      }
      const type = stableString(reference.type).toLowerCase();
      const matched = stableString(reference.matched_text);
      if (type === 'sources_footnote' || !matched || replaced.has(matched) || !matched.includes('')) continue;
      if (!output.includes(matched)) continue;

      let replacement = '';
      if (type === 'grouped_webpages') {
        replacement = groupedWebpageReference(reference, onSchemaDrift);
      } else if (type === 'client_defined_widget') {
        replacement = clientWidgetReference(reference, onSchemaDrift);
      } else if (type === 'hidden') {
        replacement = '';
      } else {
        replacement = markdownReferenceAlt(reference.alt);
        if (!replacement) onSchemaDrift();
      }
      output = output.split(matched).join(replacement);
      replaced.add(matched);
    }

    const internalTokens = /[^]*/g;
    if (internalTokens.test(output)) {
      onSchemaDrift();
      output = output.replace(internalTokens, '');
    }
    return output;
  });
}

function normalizeRichUiMarkup(markdown: string): string {
  if (
    !/<(?:Chart|MapWidgetV2|box|row|col|grid|grid-item|flow|flow-item|card|table|carousel|text|title|caption|badge|divider|Cite|Link|Entity|AsyncImage|icon)\b/.test(
      markdown,
    )
  ) {
    return markdown;
  }
  return transformOutsideCodeFences(
    markdown,
    (outside) => transformOutsideCodeFences(normalizeDilMarkdown(outside), structuredRichUiMarkdown),
    true,
  );
}

function renderTextParts(message: any, onSchemaDrift: SchemaDriftReporter, normalizeLayout = false): string {
  const format = (source: string) =>
    renderContentReferences(message, normalizeLayout ? normalizeRichUiMarkup(source) : source, onSchemaDrift);
  const parts = currentParts(message, onSchemaDrift);
  const output: string[] = [];
  for (const part of parts) {
    if (isImagePart(part)) continue;
    if (isFilePart(part)) {
      if (
        !currentAttachments(message, onSchemaDrift).some(
          (attachment) => stableString(attachment?.id) === chatgptFileIdFromAssetPointer(part.asset_pointer),
        )
      )
        onSchemaDrift();
      continue;
    }
    const text = primitivePartText(part);
    if (text) {
      output.push(text);
      continue;
    }
    if (part != null && typeof part === 'object') onSchemaDrift();
  }
  if (output.length) return format(output.join('\n'));

  const content = message?.content;
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    for (const key of ['text', 'content']) {
      const fallback = stableString(content[key]);
      if (!fallback) continue;
      onSchemaDrift();
      return format(fallback);
    }
    if (Object.keys(content).some((key) => key !== 'content_type' && key !== 'parts')) onSchemaDrift();
  }
  return '';
}

function readOptionalReasoningString(
  record: Record<string, unknown>,
  key: string,
  onSchemaDrift: SchemaDriftReporter,
): string {
  if (!Object.prototype.hasOwnProperty.call(record, key) || record[key] == null) return '';
  if (typeof record[key] === 'string') return stableString(record[key]);
  onSchemaDrift();
  return '';
}

function renderThoughts(message: any, onSchemaDrift: SchemaDriftReporter): string {
  const raw = message?.content?.thoughts;
  if (raw != null && !Array.isArray(raw)) onSchemaDrift();
  const rawThoughts = Array.isArray(raw) ? raw : [];
  const rendered: Array<{ summary: string; body: string }> = rawThoughts
    .map((thought: any): { summary: string; body: string } | null => {
      if (!thought || typeof thought !== 'object' || Array.isArray(thought)) {
        onSchemaDrift();
        return null;
      }
      const record = thought as Record<string, unknown>;
      const summary = readOptionalReasoningString(record, 'summary', onSchemaDrift);
      const content = readOptionalReasoningString(record, 'content', onSchemaDrift);
      if (record.chunks != null && !Array.isArray(record.chunks)) onSchemaDrift();
      const chunks = Array.isArray(record.chunks) ? record.chunks : [];
      const chunkText = chunks
        .map((chunk: any) => {
          if (typeof chunk === 'string') return stableString(chunk);
          if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) {
            onSchemaDrift();
            return '';
          }
          const chunkRecord = chunk as Record<string, unknown>;
          const text =
            readOptionalReasoningString(chunkRecord, 'content', onSchemaDrift) ||
            readOptionalReasoningString(chunkRecord, 'text', onSchemaDrift) ||
            readOptionalReasoningString(chunkRecord, 'summary', onSchemaDrift);
          if (
            !text &&
            Object.keys(chunkRecord).some((key) => key !== 'content' && key !== 'text' && key !== 'summary')
          ) {
            onSchemaDrift();
          }
          return text;
        })
        .filter(Boolean)
        .join('');
      const body = content || chunkText;
      if (
        !summary &&
        !body &&
        Object.keys(record).some((key) => key !== 'summary' && key !== 'content' && key !== 'chunks')
      ) {
        onSchemaDrift();
      }
      return summary || body ? { summary, body } : null;
    })
    .filter((value: { summary: string; body: string } | null): value is { summary: string; body: string } => !!value);

  const summariesWithBody = new Set(rendered.filter((item) => item.summary && item.body).map((item) => item.summary));
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of rendered) {
    if (!item.body && summariesWithBody.has(item.summary)) continue;
    const markdown = [item.summary ? `**${item.summary}**` : '', item.body].filter(Boolean).join('\n\n');
    if (!markdown || seen.has(markdown)) continue;
    seen.add(markdown);
    output.push(markdown);
  }
  return output.join('\n\n');
}

function renderAuxiliary(message: any, onSchemaDrift: SchemaDriftReporter): string {
  const parts = currentParts(message, onSchemaDrift);
  if (currentAttachments(message, onSchemaDrift).length || parts.some(isImagePart)) onSchemaDrift();
  const type = contentType(message);
  if (type === 'thoughts') return renderThoughts(message, onSchemaDrift);
  if (type === 'reasoning_recap') {
    const content = message?.content?.content;
    if (content == null) return '';
    if (typeof content === 'string') return stableString(content);
    onSchemaDrift();
    return '';
  }
  if (message?.channel === 'commentary' && type === 'text') return renderTextParts(message, onSchemaDrift);
  onSchemaDrift();
  return '';
}

function matchingAttachment(message: any, fileId: string, onSchemaDrift: SchemaDriftReporter): any | null {
  if (!fileId) return null;
  const attachments = currentAttachments(message, onSchemaDrift);
  return attachments.find((item: any) => item && typeof item === 'object' && stableString(item.id) === fileId) || null;
}

function imageAlt(message: any, attachment: any): string {
  return stableString(attachment?.name) || stableString(message?.metadata?.image_gen_title);
}

function renderNonImageAttachments(message: any, onSchemaDrift: SchemaDriftReporter): string {
  const attachments = currentAttachments(message, onSchemaDrift);
  const text: string[] = [];
  for (const attachment of attachments) {
    const mimeType = stableString(attachment?.mime_type).toLowerCase();
    if (mimeType.startsWith('image/')) continue;
    const name = stableString(attachment?.name)
      .replace(/[\r\n]/g, ' ')
      .slice(0, 200);
    if (
      !stableString(attachment?.id) ||
      !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mimeType) ||
      !name
    ) {
      onSchemaDrift();
      continue;
    }
    const codeFence = '`'.repeat(Math.max(1, ...(name.match(/`+/g) || []).map((run) => run.length + 1)));
    text.push(`附件：${codeFence}${name}${codeFence}（${mimeType}）`);
  }
  return Array.from(new Set(text)).join('\n');
}

function hasUnsupportedAttachmentMetadata(
  message: any,
  images: PendingImage[],
  onSchemaDrift: SchemaDriftReporter,
): boolean {
  const attachments = currentAttachments(message, onSchemaDrift);
  if (!attachments.length) return false;
  const imageFileIds = new Set(images.map((image) => image.fileId).filter(Boolean));
  return attachments.some((attachment: any) => {
    if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) return true;
    const id = stableString(attachment.id);
    const mimeType = stableString(attachment.mime_type).toLowerCase();
    if (!id || !mimeType) return true;
    if (!mimeType.startsWith('image/')) return !stableString(attachment.name);
    return !imageFileIds.has(id);
  });
}

function collectMessageImages(message: any, onSchemaDrift: SchemaDriftReporter): PendingImage[] {
  const turnId = messageTurnId(message);
  const parts = currentParts(message, onSchemaDrift);
  const assets: PendingImage[] = [];
  for (const part of parts) {
    if (!isImagePart(part)) continue;
    const fileId = chatgptFileIdFromAssetPointer(part.asset_pointer);
    if (!fileId) {
      onSchemaDrift();
      continue;
    }
    const attachment = matchingAttachment(message, fileId, onSchemaDrift);
    assets.push({
      fileId,
      alt: imageAlt(message, attachment),
      turnId,
    });
  }
  return assets;
}

function hasNonImagePartContent(message: any, onSchemaDrift: SchemaDriftReporter): boolean {
  const parts = currentParts(message, onSchemaDrift);
  return parts.some((part: unknown) => !isImagePart(part));
}

function currentPageMessages(raw: unknown, currentNode: unknown): any[] {
  if (!Array.isArray(raw) || !raw.length) throw apiSnapshotError('chatgpt_api_messages_invalid');
  const lastId = stableString(raw.at(-1)?.id);
  if (!lastId || lastId !== stableString(currentNode)) throw apiSnapshotError('chatgpt_api_current_node_invalid');
  const seen = new Set<string>();
  for (const message of raw) {
    const id = stableString(message?.id);
    if (!id || seen.has(id)) throw apiSnapshotError('chatgpt_api_message_id_invalid');
    seen.add(id);
  }
  return raw;
}

function currentTurnInfo(branch: any[]): {
  state: ChatgptApiCurrentTurnState;
  turnId: string;
} {
  let executionTurnId = '';
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const message = branch[index];
    if (!message || isHidden(message) || contentType(message) === 'model_editable_context') continue;
    const role = messageRole(message);
    if (role === 'system' || role === 'developer') continue;
    const turnId = messageTurnId(message);

    // Tool pipeline nodes can trail a user-visible turn without proving that the turn is still open.
    if (role === 'tool' || (role === 'assistant' && message.recipient !== 'all')) {
      if (!executionTurnId && turnId) executionTurnId = turnId;
      continue;
    }
    if (role === 'user') {
      return executionTurnId ? { state: 'unknown', turnId: executionTurnId } : { state: 'open', turnId };
    }
    if (role !== 'assistant') return { state: 'unknown', turnId: turnId || executionTurnId };

    if (message.channel !== 'final') return { state: 'open', turnId: turnId || executionTurnId };
    const status = stableString(message.status).toLowerCase();
    const isComplete = message?.metadata?.is_complete;
    if (isComplete === true || status === 'finished_successfully') return { state: 'finalized', turnId };
    if (isComplete === false || status === 'in_progress' || status === 'streaming') return { state: 'open', turnId };
    return { state: 'unknown', turnId };
  }
  return { state: 'unknown', turnId: executionTurnId };
}

function appendBlocks(parts: string[]): string {
  return parts.filter((part) => part.trim().length > 0).join('\n\n');
}

function safeImageAlt(value: unknown): string {
  return String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/]/g, '\\]')
    .trim()
    .slice(0, 200);
}

function renderImageBlocks(images: readonly PendingImage[]): string {
  const seen = new Set<string>();
  const blocks: string[] = [];
  for (const image of images) {
    const target = buildChatgptFileCacheKey(image.fileId);
    if (!target || seen.has(target)) continue;
    seen.add(target);
    blocks.push(`![${safeImageAlt(image.alt)}](${target})`);
  }
  return blocks.join('\n');
}

export function buildChatgptApiSnapshot(input: {
  data: any;
  conversationId: string;
  conversationUrl: string;
  capturedAt?: number;
}): ChatgptApiSnapshotResult {
  const conversationId = stableString(input.conversationId);
  if (!conversationId) throw apiSnapshotError('conversation_identity_invalid');
  const responseId = stableString(input.data?.conversation_id);
  if (!responseId || responseId !== conversationId) throw apiSnapshotError('conversation_identity_mismatch');

  const branch = currentPageMessages(input.data?.messages, input.data?.current_node);
  const backendCurrentTurn = currentTurnInfo(branch);
  const capturedAt = Number.isFinite(input.capturedAt) ? Number(input.capturedAt) : Date.now();
  const messages: any[] = [];
  const seenMessageKeys = new Set<string>();
  const partialReasons = new Set<string>();
  let pendingAuxiliary: PendingAuxiliary[] = [];
  let pendingImages: PendingImage[] = [];
  let precedingUserId = '';

  const markSchemaDrift = () => partialReasons.add(SCHEMA_DRIFT_REASON);
  const markUnownedAuxiliary = () => partialReasons.add(UNOWNED_AUXILIARY_REASON);
  const latestUserIndex = branch.findLastIndex((message) => messageRole(message) === 'user' && !isHidden(message));
  const latestTurn = branch.slice(latestUserIndex + 1);
  const hasFinal = latestTurn.some(
    (message) =>
      messageRole(message) === 'assistant' &&
      message.recipient === 'all' &&
      message.channel === 'final' &&
      (message.status === 'finished_successfully' || message.metadata?.is_complete === true),
  );
  const isStreaming =
    !hasFinal &&
    latestTurn.some(
      (message) =>
        !isHidden(message) &&
        messageRole(message) === 'assistant' &&
        message.recipient === 'all' &&
        (message.status === 'in_progress' || message.status === 'streaming' || message.metadata?.is_complete === false),
    );
  if (isStreaming) partialReasons.add(UNFINISHED_TURN_REASON);

  const flushPendingImages = () => {
    if (!pendingImages.length) return;
    const key = buildChatgptGeneratedImageMessageKey(pendingImages.map((image) => image.fileId));
    if (!key) {
      markSchemaDrift();
      pendingImages = [];
      return;
    }
    if (seenMessageKeys.has(key)) {
      markSchemaDrift();
      pendingImages = [];
      return;
    }
    seenMessageKeys.add(key);
    messages.push({
      messageKey: key,
      role: 'assistant',
      contentMarkdown: renderImageBlocks(pendingImages),
      sequence: messages.length,
      updatedAt: capturedAt,
    });
    pendingImages = [];
  };

  const flushPendingWithoutOwner = () => {
    flushPendingImages();
    if (pendingAuxiliary.length) {
      markUnownedAuxiliary();
      pendingAuxiliary = [];
    }
  };

  const flushPendingStableTurn = () => {
    flushPendingImages();
    if (!pendingAuxiliary.length) return;
    const turnId = pendingAuxiliary[0]?.turnId || '';
    const ownsOneStableTurn = !!turnId && pendingAuxiliary.every((item) => item.turnId === turnId);
    const ownsPrecedingUser = !!precedingUserId && pendingAuxiliary.every((item) => !item.turnId);
    const ownerId = ownsOneStableTurn ? turnId : ownsPrecedingUser ? precedingUserId : '';
    const markdown = appendBlocks(pendingAuxiliary.map((item) => item.markdown));
    pendingAuxiliary = [];
    if (!ownerId || !markdown) {
      markUnownedAuxiliary();
      return;
    }

    const key = `${CHATGPT_API_PROVISIONAL_TURN_KEY_PREFIX}${ownerId}`;
    if (seenMessageKeys.has(key)) {
      markSchemaDrift();
      return;
    }
    seenMessageKeys.add(key);
    messages.push({
      messageKey: key,
      role: 'assistant',
      contentMarkdown: composeThinkingMarkdown(markdown, ''),
      sequence: messages.length,
      updatedAt: capturedAt,
    });
  };

  const pendingMatchesTurn = (turnId: string): boolean => {
    const known = [...pendingAuxiliary.map((item) => item.turnId), ...pendingImages.map((item) => item.turnId)].filter(
      Boolean,
    );
    if (!known.length) return true;
    if (!turnId) return false;
    return !known.some((value) => value !== turnId);
  };

  const startTurn = (turnId: string) => {
    if (!pendingMatchesTurn(turnId)) flushPendingWithoutOwner();
  };

  for (const message of branch) {
    if (!message || isHidden(message)) continue;
    const role = messageRole(message);
    const type = contentType(message);
    const id = stableString(message.id);
    const turnId = messageTurnId(message);

    if (role === 'system' || role === 'developer') continue;
    if (type === 'model_editable_context') continue;

    if (role === 'user') {
      // A later user message proves the preceding assistant turn is closed even when ChatGPT never emitted a final node.
      // Keep its visible reasoning/progress under the stable turn id instead of discarding it.
      flushPendingStableTurn();
      if (!id) {
        markSchemaDrift();
        continue;
      }
      if (type !== 'text' && type !== 'multimodal_text') markSchemaDrift();
      const parts = currentParts(message, markSchemaDrift);
      const images = collectMessageImages(message, markSchemaDrift);
      const attachments = currentAttachments(message, markSchemaDrift);
      if (images.length && type !== 'multimodal_text') markSchemaDrift();
      if (hasUnsupportedAttachmentMetadata(message, images, markSchemaDrift)) markSchemaDrift();
      const markdown = appendBlocks([
        renderTextParts(message, markSchemaDrift),
        renderImageBlocks(images),
        renderNonImageAttachments(message, markSchemaDrift),
      ]);
      const hasOpaquePayload = parts.length > 0 || attachments.length > 0;
      if (!markdown && !hasOpaquePayload) continue;
      if (seenMessageKeys.has(id)) throw apiSnapshotError('duplicate_message_key');
      precedingUserId = id;
      seenMessageKeys.add(id);
      messages.push({
        messageKey: id,
        role: 'user',
        contentMarkdown: markdown,
        sequence: messages.length,
        updatedAt: capturedAt,
      });
      continue;
    }

    if (role === 'assistant') {
      // Tool-call messages are execution-pipeline nodes, not standalone conversation messages.
      // Unknown tool recipients stay ignorable even when ChatGPT adds new tool protocols.
      if (message.recipient !== 'all') continue;

      const isStableOwner = message.channel === 'final';
      if (isStableOwner) {
        startTurn(turnId);
        if (type !== 'text') markSchemaDrift();
        const finalImages = collectMessageImages(message, markSchemaDrift);
        if (hasUnsupportedAttachmentMetadata(message, finalImages, markSchemaDrift)) markSchemaDrift();
        pendingImages.push(...finalImages);

        const markdown = composeThinkingMarkdown(
          appendBlocks(pendingAuxiliary.map((item) => item.markdown)),
          appendBlocks([
            renderTextParts(message, markSchemaDrift, true),
            renderImageBlocks(pendingImages),
            renderNonImageAttachments(message, markSchemaDrift),
          ]),
        );
        let imageOwnerKey = buildChatgptGeneratedImageMessageKey(pendingImages.map((image) => image.fileId));
        if (pendingImages.length && !imageOwnerKey) {
          markSchemaDrift();
          pendingImages = [];
          imageOwnerKey = '';
        }
        const ownerKey =
          imageOwnerKey ||
          (backendCurrentTurn.state === 'open' && turnId && turnId === backendCurrentTurn.turnId
            ? `${CHATGPT_API_PROVISIONAL_TURN_KEY_PREFIX}${turnId}`
            : id);
        if (!ownerKey) {
          markSchemaDrift();
          flushPendingWithoutOwner();
          continue;
        }
        if (!markdown && !pendingImages.length) {
          pendingAuxiliary = [];
          continue;
        }
        if (seenMessageKeys.has(ownerKey)) throw apiSnapshotError('duplicate_message_key');
        seenMessageKeys.add(ownerKey);
        messages.push({
          messageKey: ownerKey,
          role: 'assistant',
          contentMarkdown: markdown,
          sequence: messages.length,
          updatedAt: capturedAt,
        });
        pendingAuxiliary = [];
        pendingImages = [];
        continue;
      }

      const isAuxiliary =
        type === 'thoughts' || type === 'reasoning_recap' || (message.channel === 'commentary' && type === 'text');
      if (isAuxiliary) {
        startTurn(turnId);
        const markdown = renderAuxiliary(message, markSchemaDrift);
        if (markdown) {
          pendingAuxiliary.push({ turnId, markdown });
        }
        continue;
      }

      // A new recipient=all assistant shape may be visible, but its DOM ownership is unknown.
      // Preserve obvious text under the backend message id and downgrade instead of aborting the conversation.
      markSchemaDrift();
      flushPendingWithoutOwner();
      const markdown = renderTextParts(message, markSchemaDrift);
      if (!id || !markdown) continue;
      if (seenMessageKeys.has(id)) throw apiSnapshotError('duplicate_message_key');
      seenMessageKeys.add(id);
      messages.push({
        messageKey: id,
        role: 'assistant',
        contentMarkdown: markdown,
        sequence: messages.length,
        updatedAt: capturedAt,
      });
      continue;
    }

    if (role === 'tool') {
      // Tool-returned screenshots and other visual execution artifacts are model inputs, not conversation assets.
      // ChatGPT currently marks user-visible generated images with image_gen_title; only those tool images are kept.
      const rawParts = message?.content?.parts;
      if (!Array.isArray(rawParts) || !rawParts.some(isImagePart) || !isGeneratedImageToolResult(message)) continue;
      startTurn(turnId);
      const images = collectMessageImages(message, markSchemaDrift);
      if (message.recipient !== 'all' || type !== 'multimodal_text') markSchemaDrift();
      if (hasNonImagePartContent(message, markSchemaDrift)) markSchemaDrift();
      if (
        hasUnsupportedAttachmentMetadata(message, images, markSchemaDrift) ||
        currentAttachments(message, markSchemaDrift).some(
          (attachment) => !stableString(attachment?.mime_type).startsWith('image/'),
        )
      )
        markSchemaDrift();
      pendingImages.push(...images);
      continue;
    }

    markSchemaDrift();
  }

  flushPendingStableTurn();
  if (!messages.length) throw apiSnapshotError('no_visible_messages');

  const title = stableString(input.data?.title) || 'ChatGPT';
  const snapshot = {
    conversation: {
      sourceType: 'chat',
      source: 'chatgpt',
      conversationKey: conversationId,
      title,
      url: input.conversationUrl,
      warningFlags: [],
    },
    messages,
    captureMeta: {
      completeness: partialReasons.size ? ('partial' as const) : ('complete' as const),
      identityVerified: true,
      ...(partialReasons.size ? { reasons: Array.from(partialReasons) } : null),
    },
  };

  return { snapshot };
}
