import { storageGet, storageSet } from '@platform/storage/local';
import { hasAsciiControlCharacter } from '@platform/validation/ascii-control';

export const GITHUB_AUTH_STATE_KEY = 'github_auth_state_v1';

export type GithubDisconnectedAuthState = { version: 1; state: 'disconnected' };
export type GithubPendingAuthState = {
  version: 1;
  state: 'pending';
  pending: {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    expiresAt: number;
    intervalMs: number;
    nextPollAt: number;
    createdAt: number;
  };
};
export type GithubConnectedAuthState = {
  version: 1;
  state: 'connected';
  token: {
    accessToken: string;
    accessExpiresAt?: number;
    refreshToken?: string;
    refreshExpiresAt?: number;
    createdAt: number;
  };
};
export type GithubAuthState = GithubDisconnectedAuthState | GithubPendingAuthState | GithubConnectedAuthState;

export type GithubSafeAuthSummary =
  | { state: 'disconnected' }
  | { state: 'pending'; userCode: string; verificationUri: string; expiresAt: number; nextPollAt: number }
  | { state: 'connected' };

const DISCONNECTED: GithubDisconnectedAuthState = Object.freeze({ version: 1, state: 'disconnected' });
let mutationQueue: Promise<void> = Promise.resolve();

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isSecretString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim() && !hasAsciiControlCharacter(value);
}

function parseGithubAuthState(value: unknown): GithubAuthState {
  const raw = value as any;
  if (!raw || typeof raw !== 'object' || raw.version !== 1) return { ...DISCONNECTED };
  if (raw.state === 'disconnected') return { ...DISCONNECTED };

  if (raw.state === 'pending') {
    const pending = raw.pending;
    if (
      !pending ||
      typeof pending !== 'object' ||
      !isSecretString(pending.deviceCode) ||
      !isSecretString(pending.userCode) ||
      !isSecretString(pending.verificationUri) ||
      !isFiniteNonNegative(pending.createdAt) ||
      !isFiniteNonNegative(pending.expiresAt) ||
      !isFiniteNonNegative(pending.intervalMs) ||
      pending.intervalMs <= 0 ||
      !isFiniteNonNegative(pending.nextPollAt) ||
      pending.expiresAt <= pending.createdAt ||
      pending.nextPollAt < pending.createdAt
    ) {
      return { ...DISCONNECTED };
    }
    return {
      version: 1,
      state: 'pending',
      pending: {
        deviceCode: pending.deviceCode,
        userCode: pending.userCode,
        verificationUri: pending.verificationUri,
        expiresAt: pending.expiresAt,
        intervalMs: pending.intervalMs,
        nextPollAt: pending.nextPollAt,
        createdAt: pending.createdAt,
      },
    };
  }

  if (raw.state === 'connected') {
    const token = raw.token;
    if (
      !token ||
      typeof token !== 'object' ||
      !isSecretString(token.accessToken) ||
      !isFiniteNonNegative(token.createdAt) ||
      (token.accessExpiresAt != null && !isFiniteNonNegative(token.accessExpiresAt)) ||
      (token.refreshToken != null && !isSecretString(token.refreshToken)) ||
      (token.refreshExpiresAt != null && !isFiniteNonNegative(token.refreshExpiresAt)) ||
      (token.refreshExpiresAt != null && token.refreshToken == null)
    ) {
      return { ...DISCONNECTED };
    }
    return {
      version: 1,
      state: 'connected',
      token: {
        accessToken: token.accessToken,
        ...(token.accessExpiresAt == null ? {} : { accessExpiresAt: token.accessExpiresAt }),
        ...(token.refreshToken == null ? {} : { refreshToken: token.refreshToken }),
        ...(token.refreshExpiresAt == null ? {} : { refreshExpiresAt: token.refreshExpiresAt }),
        createdAt: token.createdAt,
      },
    };
  }

  return { ...DISCONNECTED };
}

function requireValidGithubAuthState(value: GithubAuthState): GithubAuthState {
  const parsed = parseGithubAuthState(value);
  if (value.state !== parsed.state) throw new Error('github_auth_state_invalid');
  if (value.state === 'pending' && parsed.state === 'pending') return parsed;
  if (value.state === 'connected' && parsed.state === 'connected') return parsed;
  if (value.state === 'disconnected' && parsed.state === 'disconnected') return parsed;
  throw new Error('github_auth_state_invalid');
}

async function readRawGithubAuthState(): Promise<GithubAuthState> {
  const values = await storageGet([GITHUB_AUTH_STATE_KEY]);
  return parseGithubAuthState(values[GITHUB_AUTH_STATE_KEY]);
}

async function writeRawGithubAuthState(state: GithubAuthState): Promise<void> {
  await storageSet({ [GITHUB_AUTH_STATE_KEY]: state });
}

function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
  const run = mutationQueue.then(operation, operation);
  mutationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function getGithubAuthState(): Promise<GithubAuthState> {
  return readRawGithubAuthState();
}

export function toGithubSafeAuthSummary(state: GithubAuthState): GithubSafeAuthSummary {
  if (state.state === 'pending') {
    return {
      state: 'pending',
      userCode: state.pending.userCode,
      verificationUri: state.pending.verificationUri,
      expiresAt: state.pending.expiresAt,
      nextPollAt: state.pending.nextPollAt,
    };
  }
  return { state: state.state };
}

export async function getGithubSafeAuthSummary(): Promise<GithubSafeAuthSummary> {
  return toGithubSafeAuthSummary(await getGithubAuthState());
}

export async function replaceGithubAuthState(state: GithubAuthState): Promise<GithubAuthState> {
  const next = requireValidGithubAuthState(state);
  return enqueueMutation(async () => {
    await writeRawGithubAuthState(next);
    return next;
  });
}

export async function updateGithubAuthState(
  update: (current: GithubAuthState) => GithubAuthState | Promise<GithubAuthState>,
): Promise<GithubAuthState> {
  return enqueueMutation(async () => {
    const current = await readRawGithubAuthState();
    const next = requireValidGithubAuthState(await update(current));
    await writeRawGithubAuthState(next);
    return next;
  });
}

export async function clearGithubAuthState(): Promise<GithubDisconnectedAuthState> {
  return (await replaceGithubAuthState({ ...DISCONNECTED })) as GithubDisconnectedAuthState;
}
