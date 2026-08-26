import { GITHUB_APP_CONFIG } from '@services/sync/github/github-app-config';
import {
  getGithubAuthState,
  updateGithubAuthState,
  type GithubConnectedAuthState,
} from '@services/sync/github/auth/auth-store';

export const GITHUB_TOKEN_REFRESH_SKEW_MS = 5 * 60_000;

export type GithubAuthServiceErrorCode = 'github_auth_required' | 'github_auth_refresh_failed';

export class GithubAuthServiceError extends Error {
  constructor(readonly code: GithubAuthServiceErrorCode) {
    super(code);
    this.name = 'GithubAuthServiceError';
  }
}

type AuthServiceDeps = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  refreshSkewMs?: number;
};

let refreshInFlight: { refreshToken: string; promise: Promise<string> } | null = null;

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value === value.trim() ? value : null;
}

function buildRefreshedState(json: any, now: number): GithubConnectedAuthState | null {
  const accessToken = nonEmptyString(json?.access_token);
  const refreshToken = nonEmptyString(json?.refresh_token);
  const expiresIn = positiveNumber(json?.expires_in);
  const refreshExpiresIn = positiveNumber(json?.refresh_token_expires_in);
  if (!accessToken || !refreshToken || !expiresIn || !refreshExpiresIn) return null;

  return {
    version: 1,
    state: 'connected',
    token: {
      accessToken,
      accessExpiresAt: now + expiresIn * 1_000,
      refreshToken,
      refreshExpiresAt: now + refreshExpiresIn * 1_000,
      createdAt: now,
    },
  };
}

async function clearIfCurrentToken(accessToken: string, refreshToken?: string): Promise<void> {
  await updateGithubAuthState((current) => {
    if (current.state !== 'connected' || current.token.accessToken !== accessToken) return current;
    if (refreshToken != null && current.token.refreshToken !== refreshToken) return current;
    return { version: 1, state: 'disconnected' };
  });
}

async function refreshAccessToken(
  accessToken: string,
  refreshToken: string,
  fetchImpl: typeof fetch,
  now: () => number,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(GITHUB_APP_CONFIG.accessTokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: GITHUB_APP_CONFIG.clientId,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
  } catch (_error) {
    throw new GithubAuthServiceError('github_auth_refresh_failed');
  }

  let json: any;
  try {
    json = await response.json();
  } catch (_error) {
    throw new GithubAuthServiceError('github_auth_refresh_failed');
  }

  if (!response.ok) {
    if (response.status === 400 || response.status === 401) {
      await clearIfCurrentToken(accessToken, refreshToken);
      throw new GithubAuthServiceError('github_auth_required');
    }
    throw new GithubAuthServiceError('github_auth_refresh_failed');
  }

  const refreshed = buildRefreshedState(json, now());
  if (!refreshed) throw new GithubAuthServiceError('github_auth_refresh_failed');

  let applied = false;
  const current = await updateGithubAuthState((state) => {
    if (
      state.state !== 'connected' ||
      state.token.accessToken !== accessToken ||
      state.token.refreshToken !== refreshToken
    ) {
      return state;
    }
    applied = true;
    return refreshed;
  });
  if (applied) return refreshed.token.accessToken;
  if (current.state === 'connected') return current.token.accessToken;
  throw new GithubAuthServiceError('github_auth_required');
}

function refreshSingleFlight(
  accessToken: string,
  refreshToken: string,
  fetchImpl: typeof fetch,
  now: () => number,
): Promise<string> {
  if (refreshInFlight?.refreshToken === refreshToken) return refreshInFlight.promise;
  const promise = refreshAccessToken(accessToken, refreshToken, fetchImpl, now).finally(() => {
    if (refreshInFlight?.promise === promise) refreshInFlight = null;
  });
  refreshInFlight = { refreshToken, promise };
  return promise;
}

export async function clearGithubAuthForAccessToken(accessToken: string): Promise<void> {
  await updateGithubAuthState((current) => {
    if (current.state !== 'connected' || current.token.accessToken !== accessToken) return current;
    return { version: 1, state: 'disconnected' };
  });
}

export async function getValidAccessToken({
  fetchImpl = fetch,
  now = () => Date.now(),
  refreshSkewMs = GITHUB_TOKEN_REFRESH_SKEW_MS,
}: AuthServiceDeps = {}): Promise<string> {
  const state = await getGithubAuthState();
  if (state.state !== 'connected') throw new GithubAuthServiceError('github_auth_required');

  const nowMs = now();
  const expiresAt = state.token.accessExpiresAt;
  if (expiresAt == null || expiresAt - nowMs > Math.max(0, refreshSkewMs)) return state.token.accessToken;

  const refreshToken = state.token.refreshToken;
  const refreshExpiresAt = state.token.refreshExpiresAt;
  if (!refreshToken || (refreshExpiresAt != null && refreshExpiresAt <= nowMs)) {
    await clearIfCurrentToken(state.token.accessToken, refreshToken);
    throw new GithubAuthServiceError('github_auth_required');
  }

  return refreshSingleFlight(state.token.accessToken, refreshToken, fetchImpl, now);
}
