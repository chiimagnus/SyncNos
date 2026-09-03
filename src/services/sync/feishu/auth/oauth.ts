import { storageGet, storageRemove, storageSet } from '@platform/storage/local';
import { tabsCreate, tabsRemove } from '@platform/webext/tabs';
import { webNavigationOnCommittedAddListener } from '@platform/webext/web-navigation';
import { createSecureOAuthState, isExactOAuthRedirect } from '@services/sync/oauth-guard';
import {
  FEISHU_OAUTH_TOKEN_KEY,
  getFeishuOAuthToken,
  type FeishuOAuthTokenV1,
} from '@services/sync/feishu/auth/token-store';

declare const __SYNCNOS_FEISHU_OAUTH_CLIENT_ID__: string | undefined;
declare const __SYNCNOS_FEISHU_OAUTH_TOKEN_EXCHANGE_PROXY_URL__: string | undefined;

const FEISHU_TOKEN_URL = 'https://open.feishu.cn/open-apis/authen/v2/oauth/token';

const DEFAULT_FEISHU_OAUTH_CLIENT_ID =
  typeof __SYNCNOS_FEISHU_OAUTH_CLIENT_ID__ === 'string' ? __SYNCNOS_FEISHU_OAUTH_CLIENT_ID__ : '';
const DEFAULT_FEISHU_OAUTH_TOKEN_EXCHANGE_PROXY_URL =
  typeof __SYNCNOS_FEISHU_OAUTH_TOKEN_EXCHANGE_PROXY_URL__ === 'string'
    ? __SYNCNOS_FEISHU_OAUTH_TOKEN_EXCHANGE_PROXY_URL__
    : '';

const KEY_CLIENT_ID = 'feishu_oauth_client_id';
const KEY_CLIENT_SECRET = 'feishu_oauth_client_secret';
const KEY_TOKEN_EXCHANGE_PROXY_URL = 'feishu_oauth_token_exchange_proxy_url';
const KEY_PENDING_STATE = 'feishu_oauth_pending_state';
const KEY_LAST_ERROR = 'feishu_oauth_last_error';

let authMutationQueue: Promise<void> = Promise.resolve();

export type FeishuOAuthDefaults = {
  authorizationUrl: string;
  redirectUri: string;
  responseType: 'code';
  scope: string;
};

export type FeishuOAuthConfig = {
  clientId: string;
  clientSecret: string;
  tokenExchangeProxyUrl: string;
};

export type FeishuOAuthConfigInput = {
  clientId?: unknown;
  clientSecret?: unknown;
  tokenExchangeProxyUrl?: unknown;
};

export type FeishuOAuthConfigSummary = {
  clientId: string;
  clientSecretPresent: boolean;
  tokenExchangeProxyUrl: string;
};

export function getFeishuOAuthDefaults(): FeishuOAuthDefaults {
  return {
    authorizationUrl: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
    redirectUri: 'https://chiimagnus.github.io/syncnos-oauth/callback',
    responseType: 'code',
    scope: 'docx:document docx:document.block:convert drive:drive',
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

function safeString(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

function normalizeHttpsUrlOrEmpty(value: unknown, { strict = false }: { strict?: boolean } = {}): string {
  const raw = safeString(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') throw new Error('invalid protocol');
    return url.toString();
  } catch (_error) {
    if (strict) throw new Error('Feishu token exchange proxy url must be https');
    return '';
  }
}

function normalizeAuthConfigInput(input: FeishuOAuthConfigInput = {}): FeishuOAuthConfig {
  return {
    clientId: safeString(input.clientId),
    clientSecret: safeString(input.clientSecret),
    tokenExchangeProxyUrl: normalizeHttpsUrlOrEmpty(input.tokenExchangeProxyUrl, { strict: true }),
  };
}

async function readAuthConfig(): Promise<FeishuOAuthConfig> {
  const values = await storageGet([KEY_CLIENT_ID, KEY_CLIENT_SECRET, KEY_TOKEN_EXCHANGE_PROXY_URL]);
  return {
    clientId: safeString(values?.[KEY_CLIENT_ID]),
    clientSecret: safeString(values?.[KEY_CLIENT_SECRET]),
    tokenExchangeProxyUrl: normalizeHttpsUrlOrEmpty(values?.[KEY_TOKEN_EXCHANGE_PROXY_URL]),
  };
}

function configEquals(left: FeishuOAuthConfig, right: FeishuOAuthConfig): boolean {
  return (
    left.clientId === right.clientId &&
    left.clientSecret === right.clientSecret &&
    left.tokenExchangeProxyUrl === right.tokenExchangeProxyUrl
  );
}

function toSafeConfigSummary(config: FeishuOAuthConfig): FeishuOAuthConfigSummary {
  return {
    clientId: config.clientId,
    clientSecretPresent: !!config.clientSecret,
    tokenExchangeProxyUrl: config.tokenExchangeProxyUrl,
  };
}

async function readPendingState(): Promise<string> {
  const values = await storageGet([KEY_PENDING_STATE]);
  return safeString(values?.[KEY_PENDING_STATE]);
}

async function writeAuthConfig(config: FeishuOAuthConfig): Promise<void> {
  await storageSet({
    [KEY_CLIENT_ID]: config.clientId,
    [KEY_CLIENT_SECRET]: config.clientSecret,
    [KEY_TOKEN_EXCHANGE_PROXY_URL]: config.tokenExchangeProxyUrl,
  });
}

async function saveAuthConfigInsideOwner(config: FeishuOAuthConfig): Promise<boolean> {
  const current = await readAuthConfig();
  if (configEquals(current, config)) return false;

  // Invalidate the old attempt before changing the credentials it captured. If the
  // subsequent config write fails, failing closed is safer than reviving that attempt.
  await storageRemove([KEY_PENDING_STATE]);
  await writeAuthConfig(config);
  return true;
}

function validateStartConfig(config: FeishuOAuthConfig): void {
  if (!config.clientId) throw new Error('Feishu OAuth client id not configured');
  if (!config.clientSecret && !config.tokenExchangeProxyUrl) {
    throw new Error('Feishu OAuth requires client secret (direct) or token exchange proxy url (worker)');
  }
}

function buildAuthorizationUrl(config: FeishuOAuthConfig): string {
  const defaults = getFeishuOAuthDefaults();
  const url = new URL(defaults.authorizationUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('app_id', config.clientId);
  url.searchParams.set('redirect_uri', defaults.redirectUri);
  url.searchParams.set('state', createSecureOAuthState());
  url.searchParams.set('response_type', defaults.responseType);
  url.searchParams.set('scope', defaults.scope);
  return url.toString();
}

function authorizationState(url: string): string {
  return new URL(url).searchParams.get('state') || '';
}

export async function saveFeishuOAuthConfig(input: FeishuOAuthConfigInput): Promise<FeishuOAuthConfigSummary> {
  return enqueueAuthMutation(async () => {
    const current = await readAuthConfig();
    const has = (key: keyof FeishuOAuthConfigInput) => Object.prototype.hasOwnProperty.call(input, key);
    const next = normalizeAuthConfigInput({
      clientId: has('clientId') ? input.clientId : current.clientId,
      clientSecret: has('clientSecret') ? input.clientSecret : current.clientSecret,
      tokenExchangeProxyUrl: has('tokenExchangeProxyUrl') ? input.tokenExchangeProxyUrl : current.tokenExchangeProxyUrl,
    });
    await saveAuthConfigInsideOwner(next);
    return toSafeConfigSummary(next);
  });
}

export async function startFeishuOAuthAttempt(input: FeishuOAuthConfigInput): Promise<{ state: string }> {
  const config = normalizeAuthConfigInput(input);
  validateStartConfig(config);

  return enqueueAuthMutation(async () => {
    await saveAuthConfigInsideOwner(config);
    const authorizationUrl = buildAuthorizationUrl(config);
    const state = authorizationState(authorizationUrl);
    if (!state) throw new Error('feishu oauth state generation failed');

    await storageSet({ [KEY_PENDING_STATE]: state, [KEY_LAST_ERROR]: '' });
    try {
      await tabsCreate({ url: authorizationUrl, active: true });
    } catch (error) {
      if ((await readPendingState()) === state) await storageRemove([KEY_PENDING_STATE]);
      throw error;
    }
    return { state };
  });
}

export async function clearFeishuOAuthAttemptAndToken(): Promise<string[]> {
  return enqueueAuthMutation(async () => {
    const keys = [FEISHU_OAUTH_TOKEN_KEY, KEY_PENDING_STATE, KEY_LAST_ERROR];
    await storageRemove(keys);
    return keys;
  });
}

export async function ensureDefaultFeishuOAuthClientId(): Promise<void> {
  if (!safeString(DEFAULT_FEISHU_OAUTH_CLIENT_ID)) return;
  try {
    await enqueueAuthMutation(async () => {
      const current = await readAuthConfig();
      if (current.clientId) return;
      await saveAuthConfigInsideOwner({ ...current, clientId: safeString(DEFAULT_FEISHU_OAUTH_CLIENT_ID) });
    });
  } catch (_error) {
    // Startup defaulting is best-effort and must not block the background worker.
  }
}

export async function ensureDefaultFeishuOAuthProxyUrl(): Promise<void> {
  const defaultProxy = normalizeHttpsUrlOrEmpty(DEFAULT_FEISHU_OAUTH_TOKEN_EXCHANGE_PROXY_URL);
  if (!defaultProxy) return;
  try {
    await enqueueAuthMutation(async () => {
      const current = await readAuthConfig();
      if (current.clientSecret || current.tokenExchangeProxyUrl) return;
      await saveAuthConfigInsideOwner({ ...current, tokenExchangeProxyUrl: defaultProxy });
    });
  } catch (_error) {
    // Startup defaulting is best-effort and must not block the background worker.
  }
}

function normalizeOAuthTokenResponse(
  json: any,
): { access_token: string; refresh_token?: string; expires_in?: number } | null {
  if (!json || typeof json !== 'object') return null;

  const accessToken = typeof json.access_token === 'string' ? json.access_token : '';
  if (accessToken) {
    return {
      access_token: accessToken,
      refresh_token: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
      expires_in: Number.isFinite(Number(json.expires_in)) ? Number(json.expires_in) : undefined,
    };
  }

  const data = (json as any).data;
  const nestedAccess = typeof data?.access_token === 'string' ? data.access_token : '';
  if (!nestedAccess) return null;
  return {
    access_token: nestedAccess,
    refresh_token: typeof data?.refresh_token === 'string' ? data.refresh_token : undefined,
    expires_in: Number.isFinite(Number(data?.expires_in)) ? Number(data.expires_in) : undefined,
  };
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

async function fetchOAuthJson(
  url: string,
  init: RequestInit,
  { fetchImpl = fetch, retry = false }: { fetchImpl?: typeof fetch; retry?: boolean } = {},
) {
  let lastError: unknown = null;
  const attempts = retry ? 2 : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await (fetchImpl === fetch ? fetchWithTimeout(url, init, 12_000) : fetchImpl(url, init));
      const text = await response.text();
      if (!response.ok) throw toError(`token exchange failed: HTTP ${response.status} ${text}`);
      const json = text ? JSON.parse(text) : null;
      const normalized = normalizeOAuthTokenResponse(json);
      if (!normalized?.access_token) throw toError('token exchange failed: missing access_token');
      return normalized;
    } catch (error) {
      lastError = error;
      const message = String((error as any)?.message || error || '');
      const transient = /aborted|timeout|network|fetch/i.test(message);
      if (attempt >= attempts || !transient) break;
      await sleep(700);
    }
  }
  throw lastError || toError('token exchange failed');
}

async function exchangeFeishuCodeForToken(
  code: string,
  config: FeishuOAuthConfig,
  { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {},
) {
  const defaults = getFeishuOAuthDefaults();
  if (config.clientSecret) {
    if (!config.clientId) throw toError('Feishu OAuth client id not configured');
    return fetchOAuthJson(
      FEISHU_TOKEN_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: defaults.redirectUri,
        }),
      },
      { fetchImpl, retry: true },
    );
  }

  if (!config.clientId) throw toError('Feishu OAuth client id not configured');
  if (!config.tokenExchangeProxyUrl) throw toError('token exchange proxy url not configured');
  return fetchOAuthJson(
    config.tokenExchangeProxyUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code, redirectUri: defaults.redirectUri, clientId: config.clientId }),
    },
    { fetchImpl, retry: true },
  );
}

function parseQueryFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    return {
      code: parsed.searchParams.get('code') || '',
      state: parsed.searchParams.get('state') || '',
      error: parsed.searchParams.get('error') || '',
    };
  } catch (_error) {
    return { code: '', state: '', error: '' };
  }
}

async function removeTab(tabId: number) {
  if (!Number.isFinite(tabId) || tabId < 0) return;
  try {
    await tabsRemove(tabId);
  } catch (_error) {
    // Callback-tab cleanup is best-effort after the durable auth commit succeeds.
  }
}

export type FeishuOAuthCallbackDetails = {
  url: string;
  tabId?: number;
};

export async function handleFeishuOAuthCallbackNavigation(
  details: FeishuOAuthCallbackDetails,
  { fetchImpl = fetch, now = () => Date.now() }: { fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<boolean> {
  const defaults = getFeishuOAuthDefaults();
  const url = String(details?.url || '');
  if (!isExactOAuthRedirect(url, defaults.redirectUri)) return false;

  const { code, state, error } = parseQueryFromUrl(url);
  if (!state) return false;

  if (error) {
    return enqueueAuthMutation(async () => {
      if ((await readPendingState()) !== state) return false;
      await storageRemove([KEY_PENDING_STATE]);
      await storageSet({ [KEY_LAST_ERROR]: error });
      return true;
    });
  }
  if (!code) return false;

  const capturedConfig = await enqueueAuthMutation(async () => {
    if ((await readPendingState()) !== state) return null;
    return readAuthConfig();
  });
  if (!capturedConfig) return false;

  let tokenJson: Awaited<ReturnType<typeof exchangeFeishuCodeForToken>>;
  try {
    tokenJson = await exchangeFeishuCodeForToken(code, capturedConfig, { fetchImpl });
  } catch (networkError) {
    const message =
      (networkError as any)?.message != null
        ? String((networkError as any).message)
        : String(networkError || 'token exchange failed');
    await enqueueAuthMutation(async () => {
      if ((await readPendingState()) !== state) return false;
      await storageRemove([KEY_PENDING_STATE]);
      await storageSet({ [KEY_LAST_ERROR]: message });
      return true;
    });
    return true;
  }

  const expiresInSeconds = Number(tokenJson.expires_in) || 0;
  const nowMs = now();
  const token: FeishuOAuthTokenV1 = {
    accessToken: safeString(tokenJson.access_token),
    refreshToken: safeString(tokenJson.refresh_token),
    expiresAt: expiresInSeconds > 0 ? nowMs + expiresInSeconds * 1000 : nowMs,
    createdAt: nowMs,
  };

  const committed = await enqueueAuthMutation(async () => {
    if ((await readPendingState()) !== state) return false;
    await storageSet({ [FEISHU_OAUTH_TOKEN_KEY]: token, [KEY_LAST_ERROR]: '' });
    await storageRemove([KEY_PENDING_STATE]);
    return true;
  });
  if (committed) await removeTab(Number(details?.tabId));
  return true;
}

function deriveRefreshProxyUrl(exchangeProxyUrl: string): string {
  const raw = safeString(exchangeProxyUrl);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.pathname.endsWith('/refresh')) return url.toString();
    if (url.pathname.endsWith('/exchange')) {
      url.pathname = url.pathname.replace(/\/exchange$/i, '/refresh');
      return url.toString();
    }
    url.pathname = `${url.pathname.replace(/\/$/, '')}/refresh`;
    return url.toString();
  } catch (_error) {
    return '';
  }
}

function tokenIdentityMatches(
  left: FeishuOAuthTokenV1 | null,
  right: Pick<FeishuOAuthTokenV1, 'accessToken' | 'refreshToken'>,
) {
  return (
    !!left &&
    safeString(left.accessToken) === safeString(right.accessToken) &&
    safeString(left.refreshToken) === safeString(right.refreshToken)
  );
}

async function refreshTokenOverNetwork(
  current: FeishuOAuthTokenV1,
  config: FeishuOAuthConfig,
  { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {},
) {
  const refreshToken = safeString(current.refreshToken);
  if (!refreshToken) throw new Error('Feishu refresh token missing');

  if (config.clientSecret) {
    if (!config.clientId) throw new Error('Feishu OAuth client id not configured');
    return fetchOAuthJson(
      FEISHU_TOKEN_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }),
      },
      { fetchImpl },
    );
  }

  const refreshProxyUrl = deriveRefreshProxyUrl(config.tokenExchangeProxyUrl);
  if (!refreshProxyUrl) throw new Error('Feishu token refresh proxy url not configured');
  return fetchOAuthJson(
    refreshProxyUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken, clientId: config.clientId }),
    },
    { fetchImpl },
  );
}

export async function refreshFeishuOAuthToken(
  current: FeishuOAuthTokenV1,
  { fetchImpl = fetch, now = () => Date.now() }: { fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<FeishuOAuthTokenV1> {
  const precheck = await enqueueAuthMutation(async () => {
    const durable = await getFeishuOAuthToken();
    if (!tokenIdentityMatches(durable, current)) {
      if (durable?.accessToken) return { kind: 'current' as const, token: durable };
      throw new Error('Feishu is not connected');
    }
    return { kind: 'refresh' as const, config: await readAuthConfig() };
  });
  if (precheck.kind === 'current') return precheck.token;

  const capturedConfig = precheck.config;
  const tokenJson = await refreshTokenOverNetwork(current, capturedConfig, { fetchImpl });
  const accessToken = safeString(tokenJson.access_token);
  if (!accessToken) throw new Error('token refresh failed: missing access_token');
  const nowMs = now();
  const expiresInSeconds = Number(tokenJson.expires_in) || 0;
  const next: FeishuOAuthTokenV1 = {
    accessToken,
    refreshToken: safeString(tokenJson.refresh_token) || safeString(current.refreshToken),
    expiresAt: expiresInSeconds > 0 ? nowMs + expiresInSeconds * 1000 : nowMs,
    createdAt: nowMs,
  };

  return enqueueAuthMutation(async () => {
    const durable = await getFeishuOAuthToken();
    if (!tokenIdentityMatches(durable, current)) {
      if (durable?.accessToken) return durable;
      throw new Error('Feishu is not connected');
    }

    const currentConfig = await readAuthConfig();
    if (!configEquals(currentConfig, capturedConfig)) {
      throw new Error('feishu_oauth_refresh_stale_config');
    }

    await storageSet({ [FEISHU_OAUTH_TOKEN_KEY]: next });
    return next;
  });
}

export async function resolveFeishuAccessToken(
  options: { fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<string> {
  const token = await getFeishuOAuthToken();
  if (!token || !safeString(token.accessToken)) throw new Error('Feishu is not connected');
  const now = options.now?.() ?? Date.now();
  const expiresAt = Number(token.expiresAt) || 0;
  if (!expiresAt || expiresAt - now > 45_000) return safeString(token.accessToken);

  const refreshed = await refreshFeishuOAuthToken(token, options);
  const accessToken = safeString(refreshed.accessToken);
  if (!accessToken) throw new Error('Feishu is not connected');
  return accessToken;
}

export function setupFeishuOAuthNavigationListener(): void {
  webNavigationOnCommittedAddListener((details: any) => {
    handleFeishuOAuthCallbackNavigation({
      url: String(details?.url || ''),
      tabId: Number(details?.tabId),
    }).catch(() => {});
  });
}
