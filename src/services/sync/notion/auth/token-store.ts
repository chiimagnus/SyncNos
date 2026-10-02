import { storageGet, storageSet } from '@platform/storage/local';

export const NOTION_OAUTH_TOKEN_KEY = 'notion_oauth_token_v1';

export type NotionOAuthTokenV1 = {
  accessToken: string;
  workspaceId: string;
  workspaceName: string;
  createdAt: number;
};

export function parseNotionOAuthToken(value: unknown): NotionOAuthTokenV1 | null {
  const raw = value as Partial<NotionOAuthTokenV1> | null;
  if (!raw || typeof raw !== 'object') return null;
  const accessToken = typeof raw.accessToken === 'string' ? raw.accessToken.trim() : '';
  const createdAt = Number(raw.createdAt);
  if (!accessToken || !Number.isFinite(createdAt) || createdAt <= 0) return null;
  return {
    accessToken,
    workspaceId: typeof raw.workspaceId === 'string' ? raw.workspaceId : '',
    workspaceName: typeof raw.workspaceName === 'string' ? raw.workspaceName : '',
    createdAt,
  };
}

export async function getNotionOAuthToken(): Promise<NotionOAuthTokenV1 | null> {
  const res = await storageGet([NOTION_OAUTH_TOKEN_KEY]);
  return (res?.[NOTION_OAUTH_TOKEN_KEY] as NotionOAuthTokenV1 | null) ?? null;
}

export async function replaceNotionOAuthToken(value: unknown): Promise<NotionOAuthTokenV1> {
  const token = parseNotionOAuthToken(value);
  if (!token) throw new Error('notion_oauth_token_invalid');
  await storageSet({ [NOTION_OAUTH_TOKEN_KEY]: token });
  return token;
}
