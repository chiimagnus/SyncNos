import { storageGet, storageSet } from '@platform/storage/local';

export const NOTION_TOKEN_KEY = 'notion_oauth_token_v1';
export const NOTION_PENDING_STATE_KEY = 'notion_oauth_pending_state';
export const NOTION_LAST_ERROR_KEY = 'notion_oauth_last_error';

export type NotionConnectionTokenV1 = {
  accessToken: string;
  workspaceId: string;
  workspaceName: string;
  createdAt: number;
  connectionMethod?: 'internal';
};

export function parseNotionConnectionToken(value: unknown): NotionConnectionTokenV1 | null {
  const raw = value as Partial<NotionConnectionTokenV1> | null;
  if (!raw || typeof raw !== 'object') return null;
  const accessToken = typeof raw.accessToken === 'string' ? raw.accessToken.trim() : '';
  const createdAt = Number(raw.createdAt);
  if (!accessToken || !Number.isFinite(createdAt) || createdAt <= 0) return null;
  return {
    accessToken,
    workspaceId: typeof raw.workspaceId === 'string' ? raw.workspaceId : '',
    workspaceName: typeof raw.workspaceName === 'string' ? raw.workspaceName : '',
    createdAt,
    ...(raw.connectionMethod === 'internal' ? { connectionMethod: 'internal' as const } : {}),
  };
}

export async function getNotionConnectionToken(): Promise<NotionConnectionTokenV1 | null> {
  const res = await storageGet([NOTION_TOKEN_KEY]);
  return (res?.[NOTION_TOKEN_KEY] as NotionConnectionTokenV1 | null) ?? null;
}

export async function replaceNotionConnectionToken(value: unknown): Promise<NotionConnectionTokenV1> {
  const token = parseNotionConnectionToken(value);
  if (!token) throw new Error('notion_oauth_token_invalid');
  await storageSet({ [NOTION_TOKEN_KEY]: token, [NOTION_PENDING_STATE_KEY]: '', [NOTION_LAST_ERROR_KEY]: '' });
  return token;
}
