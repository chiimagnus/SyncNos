import {
  buildChatgptFileCacheKey,
  buildChatgptGeneratedImageMessageKey,
  chatgptFileIdFromAssetPointer,
} from '@services/shared/chatgpt-image-identity';

type ChatgptMappingNode = {
  id?: unknown;
  parent?: unknown;
  message?: any;
};

export type ChatgptApiSnapshotResult = {
  snapshot: any;
};

type PendingImage = {
  fileId: string;
  cacheKey: string;
  alt: string;
  turnId: string;
};

type PendingAuxiliary = {
  turnId: string;
  kind: 'thoughts' | 'reasoning_recap' | 'commentary';
  markdown: string;
};

const INTERNAL_CONTENT_TYPES = new Set(['model_editable_context']);
const SCHEMA_DRIFT_REASON = 'chatgpt_api_schema_drift_partial';
const UNOWNED_AUXILIARY_REASON = 'chatgpt_api_unowned_auxiliary_omitted';
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

function renderTextParts(message: any, onSchemaDrift: SchemaDriftReporter): string {
  const parts = currentParts(message, onSchemaDrift);
  const output: string[] = [];
  for (const part of parts) {
    if (isImagePart(part)) continue;
    const text = primitivePartText(part);
    if (text) {
      output.push(text);
      continue;
    }
    if (part != null && typeof part === 'object') onSchemaDrift();
  }
  if (output.length) return output.join('\n');

  const content = message?.content;
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    for (const key of ['text', 'content']) {
      const fallback = stableString(content[key]);
      if (!fallback) continue;
      onSchemaDrift();
      return fallback;
    }
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
    if (!id || !mimeType.startsWith('image/')) return true;
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
      cacheKey: buildChatgptFileCacheKey(fileId),
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

function currentBranchNodes(mapping: unknown, currentNode: unknown): ChatgptMappingNode[] {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw apiSnapshotError('mapping_invalid');
  const nodes = mapping as Record<string, ChatgptMappingNode>;
  let nodeId = stableString(currentNode);
  if (!nodeId || !nodes[nodeId]) throw apiSnapshotError('mapping_current_node_invalid');

  const branch: ChatgptMappingNode[] = [];
  const seen = new Set<string>();
  while (nodeId) {
    if (seen.has(nodeId)) throw apiSnapshotError('mapping_cycle');
    seen.add(nodeId);
    const node = nodes[nodeId];
    if (!node) throw apiSnapshotError('mapping_parent_missing');
    branch.push(node);
    const parent = node.parent;
    if (parent == null || parent === '') break;
    nodeId = stableString(parent);
    if (!nodeId) throw apiSnapshotError('mapping_parent_missing');
  }
  branch.reverse();
  return branch;
}

function responseConversationId(data: any): string {
  return stableString(data?.conversation_id);
}

function appendBlocks(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n');
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
    const target = stableString(image.cacheKey);
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
  fallbackTitle?: string;
  capturedAt?: number;
}): ChatgptApiSnapshotResult {
  const conversationId = stableString(input.conversationId);
  if (!conversationId) throw apiSnapshotError('conversation_identity_invalid');
  const responseId = responseConversationId(input.data);
  if (responseId && responseId !== conversationId) throw apiSnapshotError('conversation_identity_mismatch');

  const branch = currentBranchNodes(input.data?.mapping, input.data?.current_node);
  const capturedAt = Number.isFinite(input.capturedAt) ? Number(input.capturedAt) : Date.now();
  const messages: any[] = [];
  const seenMessageKeys = new Set<string>();
  const partialReasons = new Set<string>();
  let pendingAuxiliary: PendingAuxiliary[] = [];
  let pendingImages: PendingImage[] = [];

  const markSchemaDrift = () => partialReasons.add(SCHEMA_DRIFT_REASON);
  const markUnownedAuxiliary = () => partialReasons.add(UNOWNED_AUXILIARY_REASON);

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

  for (const node of branch) {
    const message = node?.message;
    if (!message || isHidden(message)) continue;
    const role = messageRole(message);
    const type = contentType(message);
    const id = stableString(message.id);
    const turnId = messageTurnId(message);

    if (role === 'system' || role === 'developer') continue;
    if (INTERNAL_CONTENT_TYPES.has(type)) continue;

    if (role === 'user') {
      flushPendingWithoutOwner();
      if (!id) {
        markSchemaDrift();
        continue;
      }
      if (type !== 'text' && type !== 'multimodal_text') markSchemaDrift();
      const parts = currentParts(message, markSchemaDrift);
      const images = collectMessageImages(message, markSchemaDrift);
      const attachments = currentAttachments(message, markSchemaDrift);
      if ((images.length || attachments.length) && type !== 'multimodal_text') markSchemaDrift();
      if (hasUnsupportedAttachmentMetadata(message, images, markSchemaDrift)) markSchemaDrift();
      const markdown = appendBlocks([renderTextParts(message, markSchemaDrift), renderImageBlocks(images)]);
      const hasOpaquePayload = parts.length > 0 || attachments.length > 0;
      if (!markdown && !hasOpaquePayload) continue;
      if (seenMessageKeys.has(id)) throw apiSnapshotError('duplicate_message_key');
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

        const markdown = appendBlocks([
          ...pendingAuxiliary.map((item) => item.markdown),
          renderTextParts(message, markSchemaDrift),
          renderImageBlocks(pendingImages),
        ]);
        let imageOwnerKey = buildChatgptGeneratedImageMessageKey(pendingImages.map((image) => image.fileId));
        if (pendingImages.length && !imageOwnerKey) {
          markSchemaDrift();
          pendingImages = [];
          imageOwnerKey = '';
        }
        const ownerKey = imageOwnerKey || id;
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
          pendingAuxiliary.push({
            turnId,
            kind: type === 'thoughts' ? 'thoughts' : type === 'reasoning_recap' ? 'reasoning_recap' : 'commentary',
            markdown,
          });
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
      if (hasUnsupportedAttachmentMetadata(message, images, markSchemaDrift)) markSchemaDrift();
      pendingImages.push(...images);
      continue;
    }

    markSchemaDrift();
  }

  flushPendingWithoutOwner();
  if (!messages.length) throw apiSnapshotError('no_visible_messages');

  const title = stableString(input.data?.title) || stableString(input.fallbackTitle) || 'ChatGPT';
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
