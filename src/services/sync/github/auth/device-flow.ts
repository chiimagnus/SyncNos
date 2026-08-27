import { GITHUB_APP_CONFIG } from '@services/sync/github/github-app-config';
import {
  getGithubAuthState,
  replaceGithubAuthState,
  toGithubSafeAuthSummary,
  updateGithubAuthState,
  type GithubAuthState,
  type GithubConnectedAuthState,
  type GithubPendingAuthState,
  type GithubSafeAuthSummary,
} from '@services/sync/github/auth/auth-store';

export type GithubDeviceFlowErrorCode =
  | 'github_device_start_failed'
  | 'github_device_poll_failed'
  | 'github_device_not_pending'
  | 'github_device_verification_uri_invalid'
  | 'github_device_expired'
  | 'github_device_denied'
  | 'github_device_disabled'
  | 'github_device_invalid';

export class GithubDeviceFlowError extends Error {
  constructor(readonly code: GithubDeviceFlowErrorCode) {
    super(code);
    this.name = 'GithubDeviceFlowError';
  }
}

type DeviceFlowDeps = {
  fetchImpl?: typeof fetch;
  now?: () => number;
};

type PendingUpdateResult = {
  applied: boolean;
  state: GithubAuthState;
};

let startInFlight: Promise<GithubSafeAuthSummary> | null = null;

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value === value.trim() ? value : null;
}

function formBody(fields: Record<string, string>): URLSearchParams {
  return new URLSearchParams(fields);
}

async function parseJsonResponse(response: Response, code: GithubDeviceFlowErrorCode): Promise<any> {
  try {
    return await response.json();
  } catch (_error) {
    throw new GithubDeviceFlowError(code);
  }
}

async function updateCurrentPending(
  deviceCode: string,
  update: (current: GithubPendingAuthState) => GithubAuthState,
): Promise<PendingUpdateResult> {
  let applied = false;
  const state = await updateGithubAuthState((current) => {
    if (current.state !== 'pending' || current.pending.deviceCode !== deviceCode) return current;
    applied = true;
    return update(current);
  });
  return { applied, state };
}

async function claimCurrentPendingPoll(deviceCode: string, pollAt: number): Promise<PendingUpdateResult> {
  let claimed = false;
  const state = await updateGithubAuthState((current) => {
    if (current.state !== 'pending' || current.pending.deviceCode !== deviceCode) return current;
    if (pollAt < current.pending.nextPollAt || pollAt >= current.pending.expiresAt) return current;
    claimed = true;
    return {
      ...current,
      pending: {
        ...current.pending,
        nextPollAt: pollAt + current.pending.intervalMs,
      },
    };
  });
  return { applied: claimed, state };
}

async function deferFailedPoll(deviceCode: string, pollAt: number): Promise<GithubSafeAuthSummary> {
  const deferred = await updateCurrentPending(deviceCode, (current) => ({
    ...current,
    pending: {
      ...current.pending,
      nextPollAt: Math.max(current.pending.nextPollAt, pollAt + current.pending.intervalMs),
    },
  }));
  if (!deferred.applied) return toGithubSafeAuthSummary(deferred.state);
  throw new GithubDeviceFlowError('github_device_poll_failed');
}

function buildConnectedState(json: any, now: number): GithubConnectedAuthState | null {
  const accessToken = nonEmptyString(json?.access_token);
  if (!accessToken) return null;

  const expiresIn = json?.expires_in == null ? null : positiveNumber(json.expires_in);
  if (json?.expires_in != null && expiresIn == null) return null;
  const refreshToken = json?.refresh_token == null ? null : nonEmptyString(json.refresh_token);
  if (json?.refresh_token != null && refreshToken == null) return null;
  const refreshExpiresIn =
    json?.refresh_token_expires_in == null ? null : positiveNumber(json.refresh_token_expires_in);
  if (json?.refresh_token_expires_in != null && refreshExpiresIn == null) return null;
  if (refreshExpiresIn != null && refreshToken == null) return null;

  return {
    version: 1,
    state: 'connected',
    token: {
      accessToken,
      ...(expiresIn == null ? {} : { accessExpiresAt: now + expiresIn * 1_000 }),
      ...(refreshToken == null ? {} : { refreshToken }),
      ...(refreshExpiresIn == null ? {} : { refreshExpiresAt: now + refreshExpiresIn * 1_000 }),
      createdAt: now,
    },
  };
}

async function startDeviceFlowRequest({
  fetchImpl = fetch,
  now = () => Date.now(),
}: DeviceFlowDeps = {}): Promise<GithubSafeAuthSummary> {
  let response: Response;
  try {
    response = await fetchImpl(GITHUB_APP_CONFIG.deviceCodeUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody({ client_id: GITHUB_APP_CONFIG.clientId }),
    });
  } catch (_error) {
    throw new GithubDeviceFlowError('github_device_start_failed');
  }

  const json = await parseJsonResponse(response, 'github_device_start_failed');
  if (!response.ok) throw new GithubDeviceFlowError('github_device_start_failed');

  const deviceCode = nonEmptyString(json?.device_code);
  const userCode = nonEmptyString(json?.user_code);
  const verificationUri = nonEmptyString(json?.verification_uri);
  const expiresIn = positiveNumber(json?.expires_in);
  const interval = positiveNumber(json?.interval);
  if (!deviceCode || !userCode || !verificationUri || !expiresIn || !interval) {
    throw new GithubDeviceFlowError('github_device_start_failed');
  }
  if (verificationUri !== GITHUB_APP_CONFIG.deviceVerificationUrl) {
    throw new GithubDeviceFlowError('github_device_verification_uri_invalid');
  }

  const createdAt = now();
  const state = await replaceGithubAuthState({
    version: 1,
    state: 'pending',
    pending: {
      deviceCode,
      userCode,
      verificationUri,
      createdAt,
      expiresAt: createdAt + expiresIn * 1_000,
      intervalMs: interval * 1_000,
      nextPollAt: createdAt + interval * 1_000,
    },
  });
  return toGithubSafeAuthSummary(state);
}

export function startDeviceFlow(deps: DeviceFlowDeps = {}): Promise<GithubSafeAuthSummary> {
  if (startInFlight) return startInFlight;
  const promise = startDeviceFlowRequest(deps).finally(() => {
    if (startInFlight === promise) startInFlight = null;
  });
  startInFlight = promise;
  return promise;
}

export async function pollDeviceFlowOnce({
  fetchImpl = fetch,
  now = () => Date.now(),
}: DeviceFlowDeps = {}): Promise<GithubSafeAuthSummary> {
  const state = await getGithubAuthState();
  if (state.state !== 'pending') throw new GithubDeviceFlowError('github_device_not_pending');

  const pollAt = now();
  const deviceCode = state.pending.deviceCode;
  if (pollAt >= state.pending.expiresAt) {
    const cleared = await updateCurrentPending(deviceCode, () => ({ version: 1, state: 'disconnected' }));
    if (!cleared.applied) return toGithubSafeAuthSummary(cleared.state);
    throw new GithubDeviceFlowError('github_device_expired');
  }
  if (pollAt < state.pending.nextPollAt) return toGithubSafeAuthSummary(state);

  const claim = await claimCurrentPendingPoll(deviceCode, pollAt);
  if (!claim.applied) return toGithubSafeAuthSummary(claim.state);

  let response: Response;
  try {
    response = await fetchImpl(GITHUB_APP_CONFIG.accessTokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formBody({
        client_id: GITHUB_APP_CONFIG.clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
  } catch (_error) {
    return deferFailedPoll(deviceCode, pollAt);
  }

  let json: any;
  try {
    json = await parseJsonResponse(response, 'github_device_poll_failed');
  } catch (_error) {
    return deferFailedPoll(deviceCode, pollAt);
  }
  const connected = buildConnectedState(json, pollAt);
  if (response.ok && connected) {
    const saved = await updateCurrentPending(deviceCode, () => connected);
    return toGithubSafeAuthSummary(saved.state);
  }

  const error = nonEmptyString(json?.error);
  if (error === 'authorization_pending') {
    const pending = await updateCurrentPending(deviceCode, (current) => ({
      ...current,
      pending: { ...current.pending, nextPollAt: pollAt + current.pending.intervalMs },
    }));
    return toGithubSafeAuthSummary(pending.state);
  }
  if (error === 'slow_down') {
    const pending = await updateCurrentPending(deviceCode, (current) => {
      const intervalMs = current.pending.intervalMs + 5_000;
      return { ...current, pending: { ...current.pending, intervalMs, nextPollAt: pollAt + intervalMs } };
    });
    return toGithubSafeAuthSummary(pending.state);
  }

  const terminalCodes: Record<string, GithubDeviceFlowErrorCode> = {
    expired_token: 'github_device_expired',
    access_denied: 'github_device_denied',
    device_flow_disabled: 'github_device_disabled',
    incorrect_device_code: 'github_device_invalid',
  };
  const terminalCode = error ? terminalCodes[error] : undefined;
  if (terminalCode) {
    const cleared = await updateCurrentPending(deviceCode, () => ({ version: 1, state: 'disconnected' }));
    if (!cleared.applied) return toGithubSafeAuthSummary(cleared.state);
    throw new GithubDeviceFlowError(terminalCode);
  }

  return deferFailedPoll(deviceCode, pollAt);
}

export async function cancelDeviceFlow(): Promise<GithubSafeAuthSummary> {
  const next = await updateGithubAuthState((current) =>
    current.state === 'pending' ? { version: 1, state: 'disconnected' } : current,
  );
  return toGithubSafeAuthSummary(next);
}
