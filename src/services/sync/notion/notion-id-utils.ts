import { normalizeNotionId } from '@services/shared/notion-id';

// Copy-link URLs identify the object in the last path segment. Query and fragment
// IDs identify views or blocks and must never be used as the object ID.
export function normalizeNotionIdInput(input: string): string {
  const raw = input.trim();
  const direct = normalizeNotionId(raw);
  if (direct) return direct;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    const segment = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) || '');
    const match = /(?:^|-)([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(segment);
    return normalizeNotionId(match?.[1]);
  } catch {
    return '';
  }
}
