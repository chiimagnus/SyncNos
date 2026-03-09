import { storageGet, storageRemove, storageSet } from '../../../platform/storage/local';

export const NOTION_OAUTH_TOKEN_KEY = 'notion_oauth_token_v1';

export type NotionOAuthTokenV1 = {
  accessToken: string;
  workspaceId: string;
  workspaceName: string;
  createdAt: number;
};

export async function getNotionOAuthToken(): Promise<NotionOAuthTokenV1 | null> {
  const res = await storageGet([NOTION_OAUTH_TOKEN_KEY]);
  return (res?.[NOTION_OAUTH_TOKEN_KEY] as NotionOAuthTokenV1 | null) ?? null;
}

export async function setNotionOAuthToken(token: NotionOAuthTokenV1 | null): Promise<void> {
  await storageSet({ [NOTION_OAUTH_TOKEN_KEY]: token ?? null });
}

export async function clearNotionOAuthToken(): Promise<void> {
  await storageRemove([NOTION_OAUTH_TOKEN_KEY]);
}
