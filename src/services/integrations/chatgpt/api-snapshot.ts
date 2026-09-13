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

export type ChatgptProtectedImageAsset = {
  ref: string;
  fileId: string;
  cacheKey: string;
  targetMessageKey: string;
  alt: string;
  mimeType: string;
  sizeBytes: number | null;
};

export type ChatgptProtectedImages = {
  conversationKey: string;
  assets: ChatgptProtectedImageAsset[];
};

export type ChatgptApiSnapshotResult = {
  snapshot: any;
  chatgptProtectedImages: ChatgptProtectedImages | null;
};

type PendingImage = Omit<ChatgptProtectedImageAsset, 'targetMessageKey'> & {
  turnId: string;
};

type PendingAuxiliary = {
  turnId: string;
  kind: 'thoughts' | 'reasoning_recap' | 'commentary';
  markdown: string;
};

const INTERNAL_CONTENT_TYPES = new Set(['model_editable_context']);

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

function currentParts(message: any): unknown[] {
  const raw = message?.content?.parts;
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw apiSnapshotError('unsupported_content');
  return raw;
}

function currentAttachments(message: any): any[] {
  const raw = message?.metadata?.attachments;
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw apiSnapshotError('unsupported_content');
  return raw;
}

function renderTextParts(message: any): string {
  const parts = currentParts(message);
  const output: string[] = [];
  for (const part of parts) {
    if (isImagePart(part)) continue;
    const text = primitivePartText(part);
    if (text) {
      output.push(text);
      continue;
    }
    if (part && typeof part === 'object') throw apiSnapshotError('unsupported_content');
  }
  return output.join('\n');
}

function readOptionalReasoningString(record: Record<string, unknown>, key: string): string {
  if (!Object.prototype.hasOwnProperty.call(record, key) || record[key] == null) return '';
  if (typeof record[key] !== 'string') throw apiSnapshotError('unsupported_content');
  return stableString(record[key]);
}

function renderThoughts(message: any): string {
  const raw = message?.content?.thoughts;
  if (raw != null && !Array.isArray(raw)) throw apiSnapshotError('unsupported_content');
  const rawThoughts = Array.isArray(raw) ? raw : [];
  const rendered: Array<{ summary: string; body: string }> = rawThoughts
    .map((thought: any): { summary: string; body: string } | null => {
      if (!thought || typeof thought !== 'object' || Array.isArray(thought)) {
        throw apiSnapshotError('unsupported_content');
      }
      const record = thought as Record<string, unknown>;
      const summary = readOptionalReasoningString(record, 'summary');
      const content = readOptionalReasoningString(record, 'content');
      if (record.chunks != null && !Array.isArray(record.chunks)) throw apiSnapshotError('unsupported_content');
      const chunks = Array.isArray(record.chunks) ? record.chunks : [];
      const chunkText = chunks
        .map((chunk: any) => {
          if (typeof chunk === 'string') return stableString(chunk);
          if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) {
            throw apiSnapshotError('unsupported_content');
          }
          const chunkRecord = chunk as Record<string, unknown>;
          const text =
            readOptionalReasoningString(chunkRecord, 'content') ||
            readOptionalReasoningString(chunkRecord, 'text') ||
            readOptionalReasoningString(chunkRecord, 'summary');
          if (
            !text &&
            Object.keys(chunkRecord).some((key) => key !== 'content' && key !== 'text' && key !== 'summary')
          ) {
            throw apiSnapshotError('unsupported_content');
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
        throw apiSnapshotError('unsupported_content');
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

function assertAssistantNonToolHasNoImages(message: any): void {
  if (currentAttachments(message).length || currentParts(message).some(isImagePart)) {
    throw apiSnapshotError('unsupported_content');
  }
}

function renderAuxiliary(message: any): string {
  assertAssistantNonToolHasNoImages(message);
  const type = contentType(message);
  if (type === 'thoughts') return renderThoughts(message);
  if (type === 'reasoning_recap') {
    const content = message?.content?.content;
    if (content != null && typeof content !== 'string') throw apiSnapshotError('unsupported_content');
    return stableString(content);
  }
  if (message?.channel === 'commentary' && type === 'text') return renderTextParts(message);
  throw apiSnapshotError('unsupported_content');
}

function matchingAttachment(message: any, fileId: string): any | null {
  if (!fileId) return null;
  const attachments = currentAttachments(message);
  return attachments.find((item: any) => item && typeof item === 'object' && stableString(item.id) === fileId) || null;
}

function imageAlt(message: any, attachment: any): string {
  return stableString(attachment?.name) || stableString(message?.metadata?.image_gen_title);
}

function hasUnsupportedAttachmentMetadata(message: any, images: PendingImage[]): boolean {
  const attachments = currentAttachments(message);
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

function collectMessageImages(message: any): PendingImage[] {
  const messageId = stableString(message?.id);
  const turnId = messageTurnId(message);
  const parts = currentParts(message);
  const assets: PendingImage[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!isImagePart(part)) continue;
    const fileId = chatgptFileIdFromAssetPointer(part.asset_pointer);
    const attachment = matchingAttachment(message, fileId);
    const mimeType = stableString(part.mime_type) || stableString(attachment?.mime_type);
    const sizeValue = Number(part.size_bytes ?? attachment?.size);
    const ref = fileId || `${messageId || 'image'}:${index}`;
    assets.push({
      ref,
      fileId,
      cacheKey: buildChatgptFileCacheKey(fileId),
      alt: imageAlt(message, attachment),
      mimeType,
      sizeBytes: Number.isFinite(sizeValue) && sizeValue > 0 ? sizeValue : null,
      turnId,
    });
  }
  return assets;
}

function hasNonImagePartContent(message: any): boolean {
  const parts = currentParts(message);
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

function assignAssets(
  targetMessageKey: string,
  pending: PendingImage[],
  output: ChatgptProtectedImageAsset[],
  seenBindings: Set<string>,
): void {
  for (const asset of pending) {
    const resourceKey = asset.fileId || asset.ref;
    if (!resourceKey) continue;
    const bindingKey = `${targetMessageKey}\u0000${resourceKey}`;
    if (seenBindings.has(bindingKey)) continue;
    seenBindings.add(bindingKey);
    const { turnId: _turnId, ...persistable } = asset;
    output.push({ ...persistable, targetMessageKey });
  }
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
  const protectedAssets: ChatgptProtectedImageAsset[] = [];
  const seenMessageKeys = new Set<string>();
  const seenAssetBindings = new Set<string>();
  let pendingAuxiliary: PendingAuxiliary[] = [];
  let pendingImages: PendingImage[] = [];
  let pendingImageToolCallTurnId = '';

  const flushImageOnly = () => {
    if (!pendingImages.length) {
      if (pendingAuxiliary.length) throw apiSnapshotError('unsupported_content');
      return;
    }
    if (pendingAuxiliary.some((item) => item.kind !== 'reasoning_recap')) {
      throw apiSnapshotError('unsupported_content');
    }
    const imageTurnId = pendingImages.map((image) => image.turnId).find(Boolean) || '';
    if (pendingAuxiliary.some((item) => item.turnId && item.turnId !== imageTurnId)) {
      throw apiSnapshotError('unsupported_content');
    }
    pendingAuxiliary = [];
    const key = buildChatgptGeneratedImageMessageKey(pendingImages.map((image) => image.fileId));
    if (!key) throw apiSnapshotError('conversation_identity_invalid');
    if (seenMessageKeys.has(key)) throw apiSnapshotError('duplicate_message_key');
    seenMessageKeys.add(key);
    messages.push({
      messageKey: key,
      role: 'assistant',
      contentMarkdown: '',
      sequence: messages.length,
      updatedAt: capturedAt,
    });
    assignAssets(key, pendingImages, protectedAssets, seenAssetBindings);
    pendingImages = [];
  };

  const assertPendingTurnMatches = (turnId: string) => {
    const known = [...pendingAuxiliary.map((item) => item.turnId), ...pendingImages.map((item) => item.turnId)].filter(
      Boolean,
    );
    if (turnId && known.some((value) => value !== turnId)) throw apiSnapshotError('unsupported_content');
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
      if (pendingImageToolCallTurnId) throw apiSnapshotError('unsupported_tool_turn');
      flushImageOnly();
      if (pendingAuxiliary.length) throw apiSnapshotError('unsupported_content');
      if (!id) throw apiSnapshotError('conversation_identity_invalid');
      if (type !== 'text' && type !== 'multimodal_text') throw apiSnapshotError('unsupported_content');
      const images = collectMessageImages(message);
      if ((images.length || currentAttachments(message).length) && type !== 'multimodal_text') {
        throw apiSnapshotError('unsupported_content');
      }
      if (hasUnsupportedAttachmentMetadata(message, images)) throw apiSnapshotError('unsupported_content');
      const markdown = renderTextParts(message);
      if (!markdown && !images.length) continue;
      if (seenMessageKeys.has(id)) throw apiSnapshotError('duplicate_message_key');
      seenMessageKeys.add(id);
      messages.push({
        messageKey: id,
        role: 'user',
        contentMarkdown: markdown,
        sequence: messages.length,
        updatedAt: capturedAt,
      });
      assignAssets(id, images, protectedAssets, seenAssetBindings);
      continue;
    }

    if (role === 'assistant') {
      if (message.recipient !== 'all') {
        const isPendingImageToolCall = message.channel === 'commentary' && type === 'code' && !!turnId;
        if (!isPendingImageToolCall) throw apiSnapshotError('unsupported_tool_turn');
        if (pendingImageToolCallTurnId) throw apiSnapshotError('unsupported_tool_turn');
        pendingImageToolCallTurnId = turnId;
        continue;
      }
      if (pendingImageToolCallTurnId) throw apiSnapshotError('unsupported_tool_turn');
      const isStableOwner = message.channel === 'final' && type === 'text';
      if (isStableOwner) {
        if (!id) throw apiSnapshotError('conversation_identity_invalid');
        assertAssistantNonToolHasNoImages(message);
        assertPendingTurnMatches(turnId);
        const markdown = appendBlocks([...pendingAuxiliary.map((item) => item.markdown), renderTextParts(message)]);
        if (!markdown && !pendingImages.length) {
          pendingAuxiliary = [];
          continue;
        }
        const imageOwnerKey = buildChatgptGeneratedImageMessageKey(pendingImages.map((image) => image.fileId));
        if (pendingImages.length && !imageOwnerKey) throw apiSnapshotError('conversation_identity_invalid');
        const ownerKey = imageOwnerKey || id;
        if (seenMessageKeys.has(ownerKey)) throw apiSnapshotError('duplicate_message_key');
        seenMessageKeys.add(ownerKey);
        messages.push({
          messageKey: ownerKey,
          role: 'assistant',
          contentMarkdown: markdown,
          sequence: messages.length,
          updatedAt: capturedAt,
        });
        assignAssets(ownerKey, pendingImages, protectedAssets, seenAssetBindings);
        pendingAuxiliary = [];
        pendingImages = [];
        continue;
      }

      const isAuxiliary =
        type === 'thoughts' || type === 'reasoning_recap' || (message.channel === 'commentary' && type === 'text');
      if (!isAuxiliary) throw apiSnapshotError('unsupported_content');
      const markdown = renderAuxiliary(message);
      if (markdown) {
        pendingAuxiliary.push({
          turnId,
          kind: type === 'thoughts' ? 'thoughts' : type === 'reasoning_recap' ? 'reasoning_recap' : 'commentary',
          markdown,
        });
      }
      continue;
    }

    if (role === 'tool') {
      const images = collectMessageImages(message);
      if (
        message.recipient !== 'all' ||
        type !== 'multimodal_text' ||
        !images.length ||
        hasNonImagePartContent(message) ||
        hasUnsupportedAttachmentMetadata(message, images) ||
        !pendingImageToolCallTurnId ||
        pendingImageToolCallTurnId !== turnId
      ) {
        throw apiSnapshotError('unsupported_tool_turn');
      }
      pendingImageToolCallTurnId = '';
      pendingImages.push(...images);
      continue;
    }

    throw apiSnapshotError('unsupported_content');
  }

  if (pendingImageToolCallTurnId) throw apiSnapshotError('unsupported_tool_turn');
  flushImageOnly();
  if (pendingAuxiliary.length) throw apiSnapshotError('unsupported_content');
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
      completeness: 'complete' as const,
      identityVerified: true,
    },
  };

  return {
    snapshot,
    chatgptProtectedImages: protectedAssets.length
      ? { conversationKey: conversationId, assets: protectedAssets }
      : null,
  };
}
