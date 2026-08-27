import { replaceAsciiControlCharacters } from '@platform/validation/ascii-control';
import { GITHUB_APP_CONFIG } from '@services/sync/github/github-app-config';
import { clearGithubAuthForAccessToken, getValidAccessToken } from '@services/sync/github/auth/github-auth-service';

export const GITHUB_API_VERSION = '2026-03-10';
export const GITHUB_API_DEFAULT_TIMEOUT_MS = 15_000;
export const GITHUB_READ_MAX_ATTEMPTS = 3;
export const GITHUB_MUTATION_RATE_LIMIT_MAX_ATTEMPTS = 3;
export const GITHUB_MUTATION_MIN_INTERVAL_MS = 1_000;
export const GITHUB_SECONDARY_RATE_LIMIT_BASE_DELAY_MS = 60_000;

export type GithubApiErrorCode =
  | 'github_auth_required'
  | 'github_auth_refresh_failed'
  | 'github_http_error'
  | 'github_network_error'
  | 'github_timeout'
  | 'github_response_invalid'
  | 'github_outcome_unknown'
  | 'github_rate_limited';

export class GithubApiError extends Error {
  constructor(
    readonly code: GithubApiErrorCode,
    readonly status: number,
    readonly safeMessage: string,
    readonly requestId?: string,
    readonly retryAfterMs?: number,
    readonly rateLimitRemaining?: number,
    readonly rateLimitResetAt?: number,
  ) {
    super(safeMessage || code);
    this.name = 'GithubApiError';
  }
}

export type GithubApiClock = {
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
};

type GithubApiClientOptions = {
  getAccessToken?: () => Promise<string>;
  onUnauthorized?: (accessToken: string) => Promise<void> | void;
  fetchImpl?: typeof fetch;
  clock?: GithubApiClock;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

type GithubRequestOptions = {
  body?: unknown;
  timeoutMs?: number;
};

const DEFAULT_CLOCK: GithubApiClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

const DEFAULT_SLEEP = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function safeHeader(response: Response, name: string): string | undefined {
  const value = response.headers.get(name)?.trim();
  return value || undefined;
}

function parseRetryAfterMs(response: Response, now: number): number | undefined {
  const raw = safeHeader(response, 'retry-after');
  if (!raw) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.max(0, Math.ceil(Number(raw) * 1_000));
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

function parseRateLimitRemaining(response: Response): number | undefined {
  const raw = safeHeader(response, 'x-ratelimit-remaining');
  if (raw == null || !/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

function parseRateLimitResetAt(response: Response): number | undefined {
  const raw = safeHeader(response, 'x-ratelimit-reset');
  if (raw == null || !/^\d+$/.test(raw)) return undefined;
  return Number(raw) * 1_000;
}

function sanitizeMessage(value: unknown, accessToken: string): string {
  if (typeof value !== 'string') return '';
  let message = replaceAsciiControlCharacters(value, ' ').replace(/\s+/g, ' ').trim();
  if (accessToken) message = message.split(accessToken).join('[redacted]');
  message = message.replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]');
  return message.slice(0, 240);
}

async function readJson(response: Response): Promise<{ ok: true; value: any } | { ok: false }> {
  const text = await response.text();
  if (!text) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (_error) {
    return { ok: false };
  }
}

function buildResponseError(
  response: Response,
  json: any,
  accessToken: string,
  clock: GithubApiClock,
  code: GithubApiErrorCode = 'github_http_error',
): GithubApiError {
  return new GithubApiError(
    code,
    response.status,
    sanitizeMessage(json?.message, accessToken) || code,
    safeHeader(response, 'x-github-request-id'),
    parseRetryAfterMs(response, clock.now()),
    parseRateLimitRemaining(response),
    parseRateLimitResetAt(response),
  );
}

function validatePath(path: string): string {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || /^https?:/i.test(path)) {
    throw new GithubApiError('github_http_error', 0, 'github_api_path_invalid');
  }
  return path;
}

function isSecondaryRateLimit(error: GithubApiError): boolean {
  return (error.status === 403 || error.status === 429) && /secondary rate limit/i.test(error.safeMessage);
}

function isPrimaryRateLimit(error: GithubApiError): boolean {
  return (error.status === 403 || error.status === 429) && error.rateLimitRemaining === 0;
}

function isConfirmedRateLimit(error: GithubApiError): boolean {
  return isPrimaryRateLimit(error) || isSecondaryRateLimit(error);
}

function toOutcomeUnknown(error: GithubApiError): GithubApiError {
  return new GithubApiError(
    'github_outcome_unknown',
    error.status,
    'github_outcome_unknown',
    error.requestId,
    error.retryAfterMs,
    error.rateLimitRemaining,
    error.rateLimitResetAt,
  );
}

function toRateLimited(error: GithubApiError): GithubApiError {
  return new GithubApiError(
    'github_rate_limited',
    error.status,
    'github_rate_limited',
    error.requestId,
    error.retryAfterMs,
    error.rateLimitRemaining,
    error.rateLimitResetAt,
  );
}

export function createGithubApiClient({
  getAccessToken = getValidAccessToken,
  onUnauthorized = clearGithubAuthForAccessToken,
  fetchImpl = fetch,
  clock = DEFAULT_CLOCK,
  sleep = DEFAULT_SLEEP,
  timeoutMs = GITHUB_API_DEFAULT_TIMEOUT_MS,
}: GithubApiClientOptions = {}) {
  let mutationQueue: Promise<void> = Promise.resolve();
  let lastMutationStartedAt = Number.NEGATIVE_INFINITY;

  async function performAttempt<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    options: GithubRequestOptions,
  ): Promise<T> {
    const requestPath = validatePath(path);
    let accessToken: string;
    try {
      accessToken = await getAccessToken();
    } catch (error) {
      const code = (error as any)?.code;
      if (code === 'github_auth_required' || code === 'github_auth_refresh_failed') {
        throw new GithubApiError(code, 0, code);
      }
      throw error;
    }

    const controller = new AbortController();
    let timedOut = false;
    const requestTimeoutMs = Math.max(1, options.timeoutMs ?? timeoutMs);
    const timer = clock.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, requestTimeoutMs);

    try {
      const response = await fetchImpl(`${GITHUB_APP_CONFIG.apiBaseUrl}${requestPath}`, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${accessToken}`,
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: controller.signal,
      });

      const decoded = await readJson(response);
      if (response.status === 401) {
        try {
          await onUnauthorized(accessToken);
        } catch (_error) {
          // Authentication is still invalid even if local cleanup could not be persisted.
        }
        throw buildResponseError(
          response,
          decoded.ok ? decoded.value : null,
          accessToken,
          clock,
          'github_auth_required',
        );
      }
      if (!response.ok) throw buildResponseError(response, decoded.ok ? decoded.value : null, accessToken, clock);
      if (!decoded.ok) throw new GithubApiError('github_response_invalid', response.status, 'github_response_invalid');
      return decoded.value as T;
    } catch (error) {
      if (error instanceof GithubApiError) throw error;
      throw new GithubApiError(
        timedOut ? 'github_timeout' : 'github_network_error',
        0,
        timedOut ? 'github_timeout' : 'github_network_error',
      );
    } finally {
      clock.clearTimeout(timer);
    }
  }

  function confirmedRateLimitDelay(error: GithubApiError, attempt: number): number {
    if (error.retryAfterMs != null) return error.retryAfterMs;
    if (isPrimaryRateLimit(error) && error.rateLimitResetAt != null) {
      return Math.max(0, error.rateLimitResetAt - clock.now());
    }
    return Math.min(GITHUB_SECONDARY_RATE_LIMIT_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1), 5 * 60_000);
  }

  function readRetryDelay(error: GithubApiError, attempt: number): number {
    if (isConfirmedRateLimit(error)) return confirmedRateLimitDelay(error, attempt);
    if (error.retryAfterMs != null) return error.retryAfterMs;
    return Math.min(500 * 2 ** Math.max(0, attempt - 1), 4_000);
  }

  async function executeRead<T>(path: string, options: GithubRequestOptions): Promise<T> {
    for (let attempt = 1; attempt <= GITHUB_READ_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await performAttempt<T>('GET', path, options);
      } catch (error) {
        if (!(error instanceof GithubApiError)) throw error;
        const retryable =
          error.code === 'github_network_error' ||
          error.code === 'github_timeout' ||
          error.status === 429 ||
          error.status >= 500 ||
          isConfirmedRateLimit(error);
        if (!retryable) throw error;
        if (attempt >= GITHUB_READ_MAX_ATTEMPTS) {
          if (error.status === 429 || isConfirmedRateLimit(error)) throw toRateLimited(error);
          throw error;
        }
        await sleep(readRetryDelay(error, attempt));
      }
    }
    throw new GithubApiError('github_http_error', 0, 'github_retry_exhausted');
  }

  async function paceMutation(): Promise<void> {
    const waitMs = Math.max(0, lastMutationStartedAt + GITHUB_MUTATION_MIN_INTERVAL_MS - clock.now());
    if (waitMs > 0) await sleep(waitMs);
    lastMutationStartedAt = clock.now();
  }

  async function executeMutation<T>(method: 'POST' | 'PATCH', path: string, options: GithubRequestOptions): Promise<T> {
    for (let attempt = 1; attempt <= GITHUB_MUTATION_RATE_LIMIT_MAX_ATTEMPTS; attempt += 1) {
      await paceMutation();
      try {
        return await performAttempt<T>(method, path, options);
      } catch (error) {
        if (!(error instanceof GithubApiError)) throw error;
        if (
          error.code === 'github_network_error' ||
          error.code === 'github_timeout' ||
          error.code === 'github_response_invalid' ||
          error.status >= 500
        ) {
          throw toOutcomeUnknown(error);
        }
        if (!isConfirmedRateLimit(error)) throw error;
        if (attempt >= GITHUB_MUTATION_RATE_LIMIT_MAX_ATTEMPTS) throw toRateLimited(error);
        await sleep(confirmedRateLimitDelay(error, attempt));
      }
    }
    throw new GithubApiError('github_http_error', 0, 'github_retry_exhausted');
  }

  function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const run = mutationQueue.then(operation, operation);
    mutationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  return {
    request: <T>(method: 'GET' | 'POST' | 'PATCH', path: string, options: GithubRequestOptions = {}) =>
      method === 'GET'
        ? executeRead<T>(path, options)
        : enqueueMutation(() => executeMutation<T>(method, path, options)),
    get: <T>(path: string, options?: Omit<GithubRequestOptions, 'body'>) => executeRead<T>(path, options || {}),
    post: <T>(path: string, body?: unknown, options?: Omit<GithubRequestOptions, 'body'>) =>
      enqueueMutation(() => executeMutation<T>('POST', path, { ...options, body })),
    patch: <T>(path: string, body?: unknown, options?: Omit<GithubRequestOptions, 'body'>) =>
      enqueueMutation(() => executeMutation<T>('PATCH', path, { ...options, body })),
  };
}

export const githubApiClient = createGithubApiClient();
