import { storageGet, storageRemove, storageSet } from '@platform/storage/local';
import { tabsCreate, tabsRemove } from '@platform/webext/tabs';
import { webNavigationOnCommittedAddListener } from '@platform/webext/web-navigation';
import { createSecureOAuthState, isExactOAuthRedirect } from '@services/sync/oauth-guard';
import { NOTION_OAUTH_TOKEN_KEY, type NotionOAuthTokenV1 } from '@services/sync/notion/auth/token-store';

const DEFAULT_NOTION_OAUTH_CLIENT_ID = '2a8d872b-594c-8060-9a2b-00377c27ec32';

const KEY_PENDING_STATE = 'notion_oauth_pending_state';
const KEY_LAST_ERROR = 'notion_oauth_last_error';

let authMutationQueue: Promise<void> = Promise.resolve();

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

function enqueueAuthMutation<T>(operation: () => Promise<T>): Promise<T> {
  const run = authMutationQueue.then(operation, operation);
  authMutationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function toError(message: unknown) {
  return new Error(String(message || 'unknown error'));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const ms = Number.isFinite(timeoutMs) ? timeoutMs : 12_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...(init || {}), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function exchangeNotionCodeForToken(code: string, { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}) {
  const cfg = getNotionOAuthDefaults();
  if (!cfg.tokenExchangeProxyUrl) throw toError('token exchange proxy url not configured');

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await (fetchImpl === fetch
        ? fetchWithTimeout(
            cfg.tokenExchangeProxyUrl,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
              },
              body: JSON.stringify({ code, redirectUri: cfg.redirectUri }),
            },
            12_000,
          )
        : fetchImpl(cfg.tokenExchangeProxyUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ code, redirectUri: cfg.redirectUri }),
          }));

      const text = await response.text();
      if (!response.ok) throw toError(`token exchange failed: HTTP ${response.status} ${text}`);
      const json = JSON.parse(text);
      if (!json || !json.access_token) throw toError('no access_token in response');
      return json;
    } catch (error) {
      lastError = error;
      const message = String((error as any)?.message || error || '');
      const transient = /aborted|timeout|network|fetch/i.test(message);
      if (attempt >= 2 || !transient) break;
      await sleep(700);
    }
  }

  throw lastError || toError('token exchange failed');
}

async function readPendingState(): Promise<string> {
  const values = await storageGet([KEY_PENDING_STATE]);
  return String(values?.[KEY_PENDING_STATE] || '');
}

async function removeTab(tabId: number) {
  try {
    await tabsRemove(Number(tabId));
  } catch (_error) {
    // Closing the callback tab is best-effort after the durable auth commit succeeds.
  }
}

export async function startNotionOAuthAttempt(): Promise<{ state: string }> {
  return enqueueAuthMutation(async () => {
    const state = createSecureOAuthState();
    const cfg = getNotionOAuthDefaults();
    const url = new URL(cfg.authorizationUrl);
    url.searchParams.set('client_id', DEFAULT_NOTION_OAUTH_CLIENT_ID);
    url.searchParams.set('response_type', cfg.responseType);
    url.searchParams.set('owner', cfg.owner);
    url.searchParams.set('redirect_uri', cfg.redirectUri);
    url.searchParams.set('state', state);

    await storageSet({ [KEY_PENDING_STATE]: state, [KEY_LAST_ERROR]: '' });
    try {
      await tabsCreate({ url: url.toString(), active: true });
    } catch (error) {
      await storageRemove([KEY_PENDING_STATE]);
      throw error;
    }
    return { state };
  });
}

export async function clearNotionOAuthAttemptAndToken(): Promise<void> {
  return enqueueAuthMutation(() => storageRemove([NOTION_OAUTH_TOKEN_KEY, KEY_PENDING_STATE, KEY_LAST_ERROR]));
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
  if (!isExactOAuthRedirect(url, cfg.redirectUri)) return false;

  const parsed = new URL(url);
  const code = parsed.searchParams.get('code') || '';
  const state = parsed.searchParams.get('state') || '';
  const error = parsed.searchParams.get('error') || '';
  if (!state) return false;

  if (error) {
    return enqueueAuthMutation(async () => {
      if ((await readPendingState()) !== state) return false;
      await storageSet({ [KEY_PENDING_STATE]: '', [KEY_LAST_ERROR]: error });
      return true;
    });
  }
  if (!code) return false;

  const current = await enqueueAuthMutation(async () => (await readPendingState()) === state);
  if (!current) return false;

  let tokenJson: any;
  try {
    tokenJson = await exchangeNotionCodeForToken(code, { fetchImpl });
  } catch (error) {
    const message = (error as any)?.message ? String((error as any).message) : String(error || 'token exchange failed');
    await enqueueAuthMutation(async () => {
      if ((await readPendingState()) !== state) return false;
      await storageSet({ [KEY_PENDING_STATE]: '', [KEY_LAST_ERROR]: message });
      return true;
    });
    return true;
  }

  const token: NotionOAuthTokenV1 = {
    accessToken: String(tokenJson.access_token || ''),
    workspaceId: String(tokenJson.workspace?.id || ''),
    workspaceName: String(tokenJson.workspace?.name || ''),
    createdAt: now(),
  };
  const committed = await enqueueAuthMutation(async () => {
    if ((await readPendingState()) !== state) return false;
    await storageSet({
      [NOTION_OAUTH_TOKEN_KEY]: token,
      [KEY_PENDING_STATE]: '',
      [KEY_LAST_ERROR]: '',
    });
    return true;
  });
  if (committed) await removeTab(Number(details?.tabId));
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
