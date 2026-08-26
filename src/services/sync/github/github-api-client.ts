import { GITHUB_APP_CONFIG } from '@services/sync/github/github-app-config';
import { clearGithubAuthForAccessToken, getValidAccessToken } from '@services/sync/github/auth/github-auth-service';

export const GITHUB_API_VERSION = '2026-03-10';
export const GITHUB_API_DEFAULT_TIMEOUT_MS = 15_000;

export type GithubApiErrorCode =
  | 'github_auth_required'
  | 'github_http_error'
  | 'github_network_error'
  | 'github_timeout'
  | 'github_response_invalid';

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
  let message = value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

export function createGithubApiClient({
  getAccessToken = getValidAccessToken,
  onUnauthorized = clearGithubAuthForAccessToken,
  fetchImpl = fetch,
  clock = DEFAULT_CLOCK,
  timeoutMs = GITHUB_API_DEFAULT_TIMEOUT_MS,
}: GithubApiClientOptions = {}) {
  async function request<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    options: GithubRequestOptions = {},
  ): Promise<T> {
    const requestPath = validatePath(path);
    const accessToken = await getAccessToken();
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

  return {
    request,
    get: <T>(path: string, options?: Omit<GithubRequestOptions, 'body'>) => request<T>('GET', path, options),
    post: <T>(path: string, body?: unknown, options?: Omit<GithubRequestOptions, 'body'>) =>
      request<T>('POST', path, { ...options, body }),
    patch: <T>(path: string, body?: unknown, options?: Omit<GithubRequestOptions, 'body'>) =>
      request<T>('PATCH', path, { ...options, body }),
  };
}

export const githubApiClient = createGithubApiClient();
