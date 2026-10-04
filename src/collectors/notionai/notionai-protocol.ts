import { normalizeNotionId } from '@services/shared/notion-id';

export const NOTION_AI_TRANSCRIPT_REQUEST = 'SYNCNOS_NOTIONAI_TRANSCRIPT_REQUEST';
export const NOTION_AI_TRANSCRIPT_RESPONSE = 'SYNCNOS_NOTIONAI_TRANSCRIPT_RESPONSE';

export function notionAiApiThreadId(value: unknown): string {
  const compact = normalizeNotionId(value);
  return compact ? compact.replace(/^(........)(....)(....)(....)(............)$/, '$1-$2-$3-$4-$5') : '';
}
