import { storageGet, storageSet } from '@platform/storage/local';

export const FEISHU_OAUTH_TOKEN_KEY = 'feishu_oauth_token_v1';

export type FeishuOAuthTokenV1 = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  createdAt: number;
};

export function parseFeishuOAuthToken(value: unknown): FeishuOAuthTokenV1 | null {
  const raw = value as Partial<FeishuOAuthTokenV1> | null;
  if (!raw || typeof raw !== 'object') return null;
  const accessToken = typeof raw.accessToken === 'string' ? raw.accessToken.trim() : '';
  const refreshToken = typeof raw.refreshToken === 'string' ? raw.refreshToken.trim() : '';
  const expiresAt = Number(raw.expiresAt);
  const createdAt = Number(raw.createdAt);
  if (!accessToken || !Number.isFinite(expiresAt) || expiresAt <= 0 || !Number.isFinite(createdAt) || createdAt <= 0) {
    return null;
  }
  return { accessToken, refreshToken, expiresAt, createdAt };
}

export async function getFeishuOAuthToken(): Promise<FeishuOAuthTokenV1 | null> {
  const res = await storageGet([FEISHU_OAUTH_TOKEN_KEY]);
  return (res?.[FEISHU_OAUTH_TOKEN_KEY] as FeishuOAuthTokenV1 | null) ?? null;
}

export async function replaceFeishuOAuthToken(value: unknown): Promise<FeishuOAuthTokenV1> {
  const token = parseFeishuOAuthToken(value);
  if (!token) throw new Error('feishu_oauth_token_invalid');
  await storageSet({ [FEISHU_OAUTH_TOKEN_KEY]: token });
  return token;
}
