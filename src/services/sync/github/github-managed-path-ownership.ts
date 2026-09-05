import { isSafeGithubCleanupPath } from '@platform/idb/github-cleanup-outbox-record';
import { aiTagForSource, stableConversationId10 } from '@services/conversations/domain/file-naming';
import { sanitizeFilenamePart } from '@services/conversations/domain/markdown';
import { GITHUB_OUTPUT_FOLDERS } from '@services/sync/github/settings-store';

const GITHUB_MANAGED_ASSET_FILE_RE = /^[0-9a-f]{64}\.[a-z0-9]{1,10}$/;

export function githubOutputFolderForConversation(conversation: any): string {
  const sourceType = String(conversation?.sourceType || '').trim();
  if (sourceType === 'article') return GITHUB_OUTPUT_FOLDERS.article;
  if (sourceType === 'video') return GITHUB_OUTPUT_FOLDERS.video;
  return GITHUB_OUTPUT_FOLDERS.chat;
}

function isOwnedNoteBasename(basename: string, conversation: any): boolean {
  const stableId = stableConversationId10(conversation || {});
  const sourcePrefix = sanitizeFilenamePart(aiTagForSource(conversation?.source), 'unknown', 24);
  const prefix = `${sourcePrefix}-`;
  const suffix = `-${stableId}`;
  if (!basename.startsWith(prefix) || !basename.endsWith(suffix)) return false;

  const titlePart = basename.slice(prefix.length, -suffix.length);
  if (!titlePart || titlePart.length > 80) return false;
  return sanitizeFilenamePart(titlePart, 'Untitled', 80) === titlePart;
}

export function isGithubManagedPathOwnedByConversation(
  path: string,
  kind: 'markdown' | 'asset',
  conversation: any,
): boolean {
  if (!isSafeGithubCleanupPath(path)) return false;
  const folder = githubOutputFolderForConversation(conversation);
  const segments = path.split('/');

  if (kind === 'markdown') {
    if (segments.length !== 2 || segments[0] !== folder) return false;
    const filename = segments[1] || '';
    const basename = filename.endsWith('.md') ? filename.slice(0, -3) : '';
    return !!basename && isOwnedNoteBasename(basename, conversation);
  }

  if (segments.length !== 3 || segments[0] !== folder) return false;
  const namespace = segments[1] || '';
  const filename = segments[2] || '';
  if (!GITHUB_MANAGED_ASSET_FILE_RE.test(filename) || !namespace.endsWith('.assets')) return false;
  const noteBasename = namespace.slice(0, -'.assets'.length);
  return !!noteBasename && isOwnedNoteBasename(noteBasename, conversation);
}
