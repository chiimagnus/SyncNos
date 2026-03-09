import { storageGet, storageRemove, storageSet } from '../../../platform/storage/local';
import { setNotionOAuthToken, type NotionOAuthTokenV1 } from './token-store';
import { tabsRemove } from '../../../platform/webext/tabs';
import { webNavigationOnCommittedAddListener } from '../../../platform/webext/web-navigation';

const DEFAULT_NOTION_OAUTH_CLIENT_ID = '2a8d872b-594c-8060-9a2b-00377c27ec32';

const KEY_CLIENT_ID = 'notion_oauth_client_id';
const KEY_CLIENT_SECRET = 'notion_oauth_client_secret';
const KEY_PENDING_STATE = 'notion_oauth_pending_state';
const KEY_LAST_ERROR = 'notion_oauth_last_error';

export type NotionOAuthDefaults = {
  authorizationUrl: string;
  tokenExchangeProxyUrl: string;
  redirectUri: string;
  owner: 'user';
  responseType: 'code';
};

export function getNotionOAuthDefaults(): NotionOAuthDefaults {
  return {
    authorizationUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenExchangeProxyUrl: 'https://syncnos-notion-oauth.chiimagnus.workers.dev/notion/oauth/exchange',
    redirectUri: 'https://chiimagnus.github.io/syncnos-oauth/callback',
    owner: 'user',
    responseType: 'code',
  };
}

function toError(message: unknown) {
  return new Error(String(message || 'unknown error'));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const ms = Number.isFinite(timeoutMs) ? timeoutMs : 12_000;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...(init || {}), signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function exchangeNotionCodeForToken(
  code: string,
  { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {},
) {
  const cfg = getNotionOAuthDefaults();
  if (!cfg.tokenExchangeProxyUrl) throw toError('token exchange proxy url not configured');

  let lastErr: any = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const res = await (fetchImpl === fetch
        ? fetchWithTimeout(cfg.tokenExchangeProxyUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ code, redirectUri: cfg.redirectUri }),
          }, 12_000)
        : fetchImpl(cfg.tokenExchangeProxyUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ code, redirectUri: cfg.redirectUri }),
          }));

      const text = await res.text();
      if (!res.ok) throw toError(`token exchange failed: HTTP ${res.status} ${text}`);
      const json = JSON.parse(text);
      if (!json || !json.access_token) throw toError('no access_token in response');
      return json;
    } catch (e) {
      lastErr = e;
      const msg = String((e as any)?.message || e || '');
      const transient = /aborted|timeout|network|fetch/i.test(msg);
      if (attempt >= 2 || !transient) break;
      // eslint-disable-next-line no-await-in-loop
      await sleep(700);
    }
  }

  throw lastErr || toError('token exchange failed');
}

function parseQueryFromUrl(url: string) {
  try {
    const u = new URL(url);
    return {
      code: u.searchParams.get('code') || '',
      state: u.searchParams.get('state') || '',
      error: u.searchParams.get('error') || '',
    };
  } catch (_e) {
    return { code: '', state: '', error: 'invalid_url' };
  }
}

async function removeTab(tabId: number) {
  try {
    await tabsRemove(Number(tabId));
  } catch (_e) {
    // ignore
  }
}

export async function ensureDefaultNotionOAuthClientId(): Promise<void> {
  try {
    const res = await storageGet([KEY_CLIENT_ID]);
    const currentId = res?.[KEY_CLIENT_ID] ? String(res[KEY_CLIENT_ID]) : '';
    if (!currentId) {
      await storageSet({ [KEY_CLIENT_ID]: DEFAULT_NOTION_OAUTH_CLIENT_ID });
    }
    await storageRemove([KEY_CLIENT_SECRET]);
  } catch (_e) {
    // ignore (best-effort)
  }
}

export type NotionOAuthCallbackDetails = {
  url: string;
  tabId?: number;
};

export async function handleNotionOAuthCallbackNavigation(
  details: NotionOAuthCallbackDetails,
  { fetchImpl = fetch, now = () => Date.now() }: { fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<boolean> {
  const cfg = getNotionOAuthDefaults();
  const url = String(details?.url || '');
  if (!url || !url.startsWith(cfg.redirectUri)) return false;

  const { code, state, error } = parseQueryFromUrl(url);
  if (error) {
    await storageSet({ [KEY_LAST_ERROR]: error });
    return true;
  }
  if (!code || !state) return false;

  const res = await storageGet([KEY_PENDING_STATE]);
  const pending = res?.[KEY_PENDING_STATE] ? String(res[KEY_PENDING_STATE]) : '';
  if (!pending || pending !== state) return false;

  try {
    const tokenJson = await exchangeNotionCodeForToken(code, { fetchImpl });
    const token: NotionOAuthTokenV1 = {
      accessToken: String(tokenJson.access_token || ''),
      workspaceId: String(tokenJson.workspace?.id || ''),
      workspaceName: String(tokenJson.workspace?.name || ''),
      createdAt: now(),
    };
    await setNotionOAuthToken(token);
    await storageRemove([KEY_PENDING_STATE]);
    await storageSet({ [KEY_LAST_ERROR]: '' });
    await removeTab(Number(details?.tabId));
  } catch (e) {
    await storageSet({
      [KEY_LAST_ERROR]: (e as any)?.message ? String((e as any).message) : String(e || 'token exchange failed'),
    });
  }

  return true;
}

export function setupNotionOAuthNavigationListener(): void {
  webNavigationOnCommittedAddListener((details: any) => {
    handleNotionOAuthCallbackNavigation({
      url: String(details?.url || ''),
      tabId: Number(details?.tabId),
    }).catch(() => {});
  });
}
