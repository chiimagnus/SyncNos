import { storageGet, storageRemove, storageSet } from '@platform/storage/local';
import { tabsCreate, tabsRemove } from '@platform/webext/tabs';
import { webNavigationOnCommittedAddListener } from '@platform/webext/web-navigation';
import { createSecureOAuthState, isExactOAuthRedirect } from '@services/sync/oauth-guard';
import {
  getNotionConnectionToken,
  NOTION_TOKEN_KEY,
  NOTION_PENDING_STATE_KEY as KEY_PENDING_STATE,
  NOTION_LAST_ERROR_KEY as KEY_LAST_ERROR,
  type NotionConnectionTokenV1,
} from '@services/sync/notion/auth/token-store';
import { notionFetch } from '@services/sync/notion/notion-api';

const DEFAULT_NOTION_OAUTH_CLIENT_ID = '2a8d872b-594c-8060-9a2b-00377c27ec32';

export const NOTION_OAUTH_NETWORK_ERROR = 'notion_oauth_network_unavailable';
export const NOTION_OAUTH_SERVICE_ERROR = 'notion_oauth_service_unavailable';
export const NOTION_INTERNAL_AUTH_ERRORS = {
  alreadyConnected: 'notion_already_connected',
  invalidToken: 'notion_internal_token_invalid',
  wrongTokenType: 'notion_internal_token_required',
  network: 'notion_api_unreachable',
  permission: 'notion_internal_token_permission',
  rateLimited: 'notion_api_rate_limited',
  service: 'notion_api_unavailable',
} as const;

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
    redirectUri: 'https://chiimagnus.github.io/SyncNos/syncnos-oauth/callback/',
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

async function requestOAuthWorker(init: RequestInit, fetchImpl = fetch, timeoutMs = 12_000) {
  const url = getNotionOAuthDefaults().tokenExchangeProxyUrl;
  try {
    return await (fetchImpl === fetch ? fetchWithTimeout(url, init, timeoutMs) : fetchImpl(url, init));
  } catch (cause) {
    throw new Error(NOTION_OAUTH_NETWORK_ERROR, { cause });
  }
}

async function exchangeNotionCodeForToken(code: string, { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}) {
  const cfg = getNotionOAuthDefaults();

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await requestOAuthWorker(
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ code, redirectUri: cfg.redirectUri }),
        },
        fetchImpl,
      );

      const text = await response.text();
      if (!response.ok) throw toError(`token exchange failed: HTTP ${response.status} ${text}`);
      const json = JSON.parse(text);
      if (!json || !json.access_token) throw toError('no access_token in response');
      return json;
    } catch (error) {
      lastError = error;
      const transient = error instanceof Error && error.message === NOTION_OAUTH_NETWORK_ERROR;
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

export async function getNotionOAuthAttemptSummary(): Promise<{ pending: boolean; errorPresent: boolean }> {
  const values = await storageGet([KEY_PENDING_STATE, KEY_LAST_ERROR]);
  return {
    pending: !!String(values?.[KEY_PENDING_STATE] || '').trim(),
    errorPresent: !!String(values?.[KEY_LAST_ERROR] || '').trim(),
  };
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
    if ((await getNotionConnectionToken())?.connectionMethod === 'internal') {
      throw internalAuthError(NOTION_INTERNAL_AUTH_ERRORS.alreadyConnected);
    }
    const state = createSecureOAuthState();
    const cfg = getNotionOAuthDefaults();
    const url = new URL(cfg.authorizationUrl);
    url.searchParams.set('client_id', DEFAULT_NOTION_OAUTH_CLIENT_ID);
    url.searchParams.set('response_type', cfg.responseType);
    url.searchParams.set('owner', cfg.owner);
    url.searchParams.set('redirect_uri', cfg.redirectUri);
    url.searchParams.set('state', state);

    try {
      const response = await requestOAuthWorker({ method: 'OPTIONS', cache: 'no-store' }, fetch, 6_000);
      if (!response.ok) throw new Error(NOTION_OAUTH_SERVICE_ERROR);
    } catch (error) {
      await storageSet({ [KEY_PENDING_STATE]: '', [KEY_LAST_ERROR]: (error as Error).message });
      throw error;
    }

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

function internalAuthError(code: (typeof NOTION_INTERNAL_AUTH_ERRORS)[keyof typeof NOTION_INTERNAL_AUTH_ERRORS]) {
  return Object.assign(new Error(code), { code });
}

export async function connectNotionInternalToken(input: unknown): Promise<void> {
  return enqueueAuthMutation(async () => {
    if ((await getNotionConnectionToken())?.accessToken) {
      throw internalAuthError(NOTION_INTERNAL_AUTH_ERRORS.alreadyConnected);
    }
    const accessToken = typeof input === 'string' ? input.trim() : '';
    if (!accessToken || /[^\x21-\x7e]/.test(accessToken)) {
      throw internalAuthError(NOTION_INTERNAL_AUTH_ERRORS.invalidToken);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    let user: any;
    try {
      user = await notionFetch({ accessToken, method: 'GET', path: '/v1/users/me', signal: controller.signal });
    } catch (error) {
      const status = Number((error as { status?: number })?.status || 0);
      if (status === 400 || status === 401) throw internalAuthError(NOTION_INTERNAL_AUTH_ERRORS.invalidToken);
      if (status === 403) throw internalAuthError(NOTION_INTERNAL_AUTH_ERRORS.permission);
      if (status === 429) throw internalAuthError(NOTION_INTERNAL_AUTH_ERRORS.rateLimited);
      if (controller.signal.aborted || error instanceof TypeError) {
        throw internalAuthError(NOTION_INTERNAL_AUTH_ERRORS.network);
      }
      throw internalAuthError(NOTION_INTERNAL_AUTH_ERRORS.service);
    } finally {
      clearTimeout(timer);
    }
    if (
      user?.object !== 'user' ||
      typeof user.id !== 'string' ||
      !user.id ||
      user?.type !== 'bot' ||
      user?.bot?.owner?.type !== 'workspace'
    ) {
      throw internalAuthError(NOTION_INTERNAL_AUTH_ERRORS.wrongTokenType);
    }
    if ((await getNotionConnectionToken())?.accessToken) {
      throw internalAuthError(NOTION_INTERNAL_AUTH_ERRORS.alreadyConnected);
    }
    const token: NotionConnectionTokenV1 = {
      accessToken,
      workspaceId: typeof user.bot.workspace_id === 'string' ? user.bot.workspace_id : '',
      workspaceName: typeof user.bot.workspace_name === 'string' ? user.bot.workspace_name : '',
      createdAt: Date.now(),
      connectionMethod: 'internal',
    };
    await storageSet({ [NOTION_TOKEN_KEY]: token, [KEY_PENDING_STATE]: '', [KEY_LAST_ERROR]: '' });
  });
}

export async function clearNotionOAuthAttemptAndToken(): Promise<void> {
  return enqueueAuthMutation(() => storageRemove([NOTION_TOKEN_KEY, KEY_PENDING_STATE, KEY_LAST_ERROR]));
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

  const token: NotionConnectionTokenV1 = {
    accessToken: String(tokenJson.access_token || ''),
    workspaceId: String(tokenJson.workspace?.id || ''),
    workspaceName: String(tokenJson.workspace?.name || ''),
    createdAt: now(),
  };
  const committed = await enqueueAuthMutation(async () => {
    if ((await readPendingState()) !== state) return false;
    await storageSet({
      [NOTION_TOKEN_KEY]: token,
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
