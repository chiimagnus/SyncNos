import { CHATGPT_ORIGIN } from '@services/shared/chatgpt-route';
import { fnv1a32 } from '@services/shared/normalize.ts';

const CHATGPT_FILE_ID_RE = /^file_[A-Za-z0-9_-]+$/;
const CHATGPT_SEDIMENT_POINTER_RE = /^sediment:\/\/(file_[A-Za-z0-9_-]+)$/;
const CHATGPT_FILE_URL_RE = /^chatgpt-file:\/\/(file_[A-Za-z0-9_-]+)$/i;
const CHATGPT_ESTUARY_PATH = '/backend-api/estuary/content';

export function normalizeChatgptFileId(value: unknown): string {
  const fileId = String(value || '').trim();
  return CHATGPT_FILE_ID_RE.test(fileId) ? fileId : '';
}

export function chatgptFileIdFromAssetPointer(value: unknown): string {
  if (typeof value !== 'string') return '';
  return CHATGPT_SEDIMENT_POINTER_RE.exec(value.trim())?.[1] || '';
}

export function buildChatgptFileCacheKey(value: unknown): string {
  const fileId = normalizeChatgptFileId(value);
  return fileId ? `chatgpt-file://${fileId}` : '';
}

export function hasChatgptFileScheme(value: unknown): boolean {
  return typeof value === 'string' && /^chatgpt-file:\/\//i.test(value.trim());
}

export function chatgptFileIdFromUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  return CHATGPT_FILE_URL_RE.exec(value.trim())?.[1] || '';
}

export function chatgptFileIdFromEstuaryUrl(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.origin !== CHATGPT_ORIGIN || url.pathname !== CHATGPT_ESTUARY_PATH) return '';
    return normalizeChatgptFileId(url.searchParams.get('id'));
  } catch {
    return '';
  }
}

export function buildChatgptGeneratedImageMessageKey(fileIds: Iterable<unknown>): string {
  const normalized = Array.from(fileIds, normalizeChatgptFileId)
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort();
  if (!normalized.length) return '';
  return `chatgpt_image_${fnv1a32(normalized.join('\n'))}:assistant:0`;
}
