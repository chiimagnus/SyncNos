import { conversationKinds as builtInConversationKinds } from '../../protocols/conversation-kinds.ts';
import {
  buildConversationBasename,
  stableConversationHash16,
  stableConversationId10,
} from '../../domains/conversations/file-naming';
import runtimeContext from '../../runtime-context.ts';

const DEFAULT_OBSIDIAN_FOLDER = 'SyncNos-AIChats';

function safeString(v: unknown) {
  return String(v == null ? '' : v).trim();
}

function normalizeFolderPath(input: unknown) {
  const value = safeString(input);
  if (!value) return '';
  return value
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => String(segment || '').trim())
    .filter((segment) => !!segment && segment !== '.' && segment !== '..')
    .join('/');
}

function getConversationKinds() {
  const injected = (runtimeContext as any).conversationKinds;
  if (injected && typeof injected.pick === 'function') return injected;
  if (builtInConversationKinds && typeof builtInConversationKinds.pick === 'function') {
    return builtInConversationKinds;
  }
  return null;
}

function folderForConversation(
  conversation: any,
  {
    folderByKindId,
    defaultFolder,
  }: { folderByKindId?: Record<string, unknown>; defaultFolder?: string } = {},
) {
  const conversationKinds = getConversationKinds();
  if (conversationKinds && typeof conversationKinds.pick === 'function') {
    try {
      const kind = conversationKinds.pick(conversation);
      const kindId = kind && kind.id ? safeString(kind.id) : '';
      const overrideFolderRaw =
        kindId && folderByKindId && typeof folderByKindId === 'object'
          ? safeString(folderByKindId[kindId])
          : '';
      const overrideFolder = normalizeFolderPath(overrideFolderRaw);
      if (overrideFolder) return overrideFolder;

      const folder = kind && kind.obsidian && kind.obsidian.folder ? safeString(kind.obsidian.folder) : '';
      const normalized = normalizeFolderPath(folder);
      if (normalized) return normalized;
    } catch (_e) {
      // ignore
    }
  }
  const fallback = normalizeFolderPath(defaultFolder);
  return fallback || DEFAULT_OBSIDIAN_FOLDER;
}

function buildStableNotePath(conversation: any, opts?: { folderByKindId?: Record<string, unknown>; defaultFolder?: string }) {
  const c = conversation || {};
  const folder = folderForConversation(c, opts || {});
  const filename = `${buildConversationBasename(c)}.md`;
  return folder ? `${folder}/${filename}` : filename;
}

function buildLegacyHashNotePath(conversation: any, opts?: { folderByKindId?: Record<string, unknown>; defaultFolder?: string }) {
  const c = conversation || {};
  const source = safeString(c.source) || 'unknown';
  const folder = folderForConversation(c, opts || {});
  const id = stableConversationHash16(c);
  const filename = `${source}-${id}.md`;
  return folder ? `${folder}/${filename}` : filename;
}

const api = {
  DEFAULT_OBSIDIAN_FOLDER,
  folderForConversation,
  normalizeFolderPath,
  buildStableNotePath,
  buildLegacyHashNotePath,
  stableConversationHash16,
  stableConversationId10,
};

(runtimeContext as any).obsidianNotePath = api;

export {
  DEFAULT_OBSIDIAN_FOLDER,
  folderForConversation,
  normalizeFolderPath,
  buildStableNotePath,
  buildLegacyHashNotePath,
  stableConversationHash16,
  stableConversationId10,
};
export default api;
