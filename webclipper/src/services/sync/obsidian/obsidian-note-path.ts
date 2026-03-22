import { conversationKinds as builtInConversationKinds } from '@services/protocols/conversation-kinds.ts';
import {
  buildConversationBasename,
  stableConversationHash16,
  stableConversationId10,
} from '@services/conversations/domain/file-naming';

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

type ResolveExistingNotePathInput = {
  conversation: any;
  client: any;
  noteJsonAccept?: string;
  folderByKindId?: Record<string, unknown>;
  defaultFolder?: string;
  readSyncnosObject?: (frontmatter: unknown) => any;
};

async function resolveExistingNotePath({
  conversation,
  client,
  noteJsonAccept,
  folderByKindId,
  defaultFolder,
  readSyncnosObject,
}: ResolveExistingNotePathInput) {
  const convo = conversation || {};
  const desiredFilePath = buildStableNotePath(convo, { folderByKindId, defaultFolder });
  const desiredFolder = (() => {
    const p = safeString(desiredFilePath);
    const idx = p.lastIndexOf('/');
    return idx > 0 ? p.slice(0, idx) : '';
  })();
  const legacyHashFilePath = buildLegacyHashNotePath(convo, { folderByKindId, defaultFolder });
  const stableId = stableConversationId10(convo);
  const accept = safeString(noteJsonAccept) || 'application/vnd.olrapi.note+json';

  if (!client || typeof client.getVaultFile !== 'function') {
    return {
      ok: false,
      desiredFilePath,
      resolvedFilePath: '',
      found: false,
      error: {
        code: 'invalid_client',
        message: 'Obsidian client is unavailable.',
      },
    };
  }

  async function tryGetNote(path: string) {
    const filePath = safeString(path);
    if (!filePath) return { ok: true, found: false, path: '' };

    const res = await client.getVaultFile(filePath, { accept });
    if (res && res.ok) {
      return {
        ok: true,
        found: true,
        path: filePath,
        data: res.data,
      };
    }
    if (res && (res.status === 404 || safeString(res?.error?.code) === 'not_found')) {
      return { ok: true, found: false, path: filePath };
    }
    return {
      ok: false,
      found: false,
      path: filePath,
      error: res?.error || {
        code: 'http_error',
        status: Number(res?.status) || 0,
        message: 'Obsidian request failed.',
      },
    };
  }

  const desiredResult = await tryGetNote(desiredFilePath);
  if (!desiredResult.ok) {
    return {
      ok: false,
      desiredFilePath,
      resolvedFilePath: '',
      found: false,
      error: desiredResult.error,
    };
  }
  if (desiredResult.found) {
    return {
      ok: true,
      desiredFilePath,
      resolvedFilePath: desiredFilePath,
      found: true,
      matchedBy: 'stable',
      note: desiredResult.data || null,
    };
  }

  if (legacyHashFilePath && legacyHashFilePath !== desiredFilePath) {
    const legacyResult = await tryGetNote(legacyHashFilePath);
    if (!legacyResult.ok) {
      return {
        ok: false,
        desiredFilePath,
        resolvedFilePath: '',
        found: false,
        error: legacyResult.error,
      };
    }
    if (legacyResult.found) {
      return {
        ok: true,
        desiredFilePath,
        resolvedFilePath: legacyHashFilePath,
        found: true,
        matchedBy: 'legacy',
        note: legacyResult.data || null,
      };
    }
  }

  if (desiredFolder && stableId && typeof client.listVaultDir === 'function' && typeof readSyncnosObject === 'function') {
    const listRes = await client.listVaultDir(desiredFolder);
    if (!listRes?.ok && Number(listRes?.status) !== 404 && safeString(listRes?.error?.code) !== 'not_found') {
      return {
        ok: false,
        desiredFilePath,
        resolvedFilePath: '',
        found: false,
        error: listRes?.error || {
          code: 'http_error',
          status: Number(listRes?.status) || 0,
          message: 'Failed to list Obsidian folder.',
        },
      };
    }

    const files = listRes?.ok && Array.isArray((listRes.data as any)?.files) ? (listRes.data as any).files : [];
    const suffix = `-${stableId}.md`.toLowerCase();
    const candidates = files
      .map((entry: unknown) => safeString(entry))
      .filter((entry: string) => !!entry && !entry.endsWith('/') && entry.toLowerCase().endsWith(suffix));

    for (const entry of candidates) {
      const fullPath = entry.includes('/') ? entry : desiredFolder ? `${desiredFolder}/${entry}` : entry;
      if (!fullPath || fullPath === desiredFilePath) continue;
      const candidateResult = await tryGetNote(fullPath);
      if (!candidateResult.ok) {
        return {
          ok: false,
          desiredFilePath,
          resolvedFilePath: '',
          found: false,
          error: candidateResult.error,
        };
      }
      if (!candidateResult.found) continue;

      const frontmatter =
        candidateResult.data && typeof candidateResult.data === 'object' && candidateResult.data.frontmatter && typeof candidateResult.data.frontmatter === 'object'
          ? candidateResult.data.frontmatter
          : null;
      const parsed = readSyncnosObject(frontmatter);
      if (
        parsed &&
        parsed.ok &&
        parsed.data &&
        safeString(parsed.data.source) === safeString(convo.source) &&
        safeString(parsed.data.conversationKey) === safeString(convo.conversationKey)
      ) {
        return {
          ok: true,
          desiredFilePath,
          resolvedFilePath: fullPath,
          found: true,
          matchedBy: 'candidate',
          note: candidateResult.data || null,
        };
      }
    }
  }

  return {
    ok: true,
    desiredFilePath,
    resolvedFilePath: desiredFilePath,
    found: false,
    matchedBy: 'missing',
    note: null,
  };
}

const api = {
  DEFAULT_OBSIDIAN_FOLDER,
  folderForConversation,
  normalizeFolderPath,
  buildStableNotePath,
  buildLegacyHashNotePath,
  resolveExistingNotePath,
  stableConversationId10,
};

export {
  DEFAULT_OBSIDIAN_FOLDER,
  folderForConversation,
  normalizeFolderPath,
  buildStableNotePath,
  buildLegacyHashNotePath,
  resolveExistingNotePath,
  stableConversationId10,
};
export default api;
