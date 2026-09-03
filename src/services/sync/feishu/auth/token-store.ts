import { storageGet } from '@platform/storage/local';

export const FEISHU_OAUTH_TOKEN_KEY = 'feishu_oauth_token_v1';

export type FeishuOAuthTokenV1 = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  createdAt: number;
};

export async function getFeishuOAuthToken(): Promise<FeishuOAuthTokenV1 | null> {
  const res = await storageGet([FEISHU_OAUTH_TOKEN_KEY]);
  return (res?.[FEISHU_OAUTH_TOKEN_KEY] as FeishuOAuthTokenV1 | null) ?? null;
}
