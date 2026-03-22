const NOTE_JSON_ACCEPT = 'application/vnd.olrapi.note+json';

function safeString(value: unknown) {
  return String(value == null ? '' : value).trim();
}

function stripTrailingSlashes(url: unknown) {
  return String(url || '').replace(/\/+$/, '');
}

function isHttpUrl(url: unknown) {
  return /^http:\/\//i.test(String(url || '').trim());
}

function isHttpsUrl(url: unknown) {
  return /^https:\/\//i.test(String(url || '').trim());
}

function encodeVaultPath(path: unknown) {
  return safeString(path)
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function classifyError(status: unknown) {
  const code = Number(status);
  if (code === 401 || code === 403) return 'auth_error';
  if (code === 404) return 'not_found';
  if (code === 400) return 'bad_request';
  if (!Number.isFinite(code) || code <= 0) return 'network_error';
  return 'http_error';
}

async function readBodyAsText(res: any) {
  try {
    return await res.text();
  } catch (_e) {
    return '';
  }
}

async function readBodyAsJsonOrText(res: any) {
  const contentType = String(res?.headers?.get?.('content-type') || '').toLowerCase();
  if (contentType.includes('application/json') || contentType.includes('+json')) {
    try {
      return await res.json();
    } catch (_e) {
      // fall through
    }
  }
  const text = await readBodyAsText(res);
  try {
    return JSON.parse(text);
  } catch (_e) {
    return text;
  }
}

function toErrorObject({ status, body, fallbackMessage }: { status: unknown; body: any; fallbackMessage?: string }) {
  const numericStatus = Number(status);
  const errorCode = body && typeof body === 'object' && Number.isFinite(body.errorCode) ? Number(body.errorCode) : null;
  const message =
    body && typeof body === 'object' && body.message
      ? String(body.message)
      : String(fallbackMessage || 'request failed');
  return {
    code: classifyError(numericStatus),
    status: numericStatus,
    errorCode,
    message,
    body,
  };
}

function createClient({
  apiBaseUrl,
  apiKey,
  authHeaderName,
}: {
  apiBaseUrl?: unknown;
  apiKey?: unknown;
  authHeaderName?: unknown;
} = {}) {
  const baseUrl = stripTrailingSlashes(safeString(apiBaseUrl));
  if (isHttpsUrl(baseUrl)) {
    return {
      ok: false,
      error: {
        code: 'https_unsupported',
        status: 0,
        errorCode: null,
        message: 'HTTPS is not supported in this version. Use http://127.0.0.1:27123.',
        body: null,
      },
    };
  }
  if (!isHttpUrl(baseUrl)) {
    return {
      ok: false,
      error: {
        code: 'invalid_base_url',
        status: 0,
        errorCode: null,
        message: 'Invalid API Base URL. Expected http://127.0.0.1:27123.',
        body: null,
      },
    };
  }

  const headerName = safeString(authHeaderName) || 'Authorization';
  const key = safeString(apiKey);

  function buildUrl(route: unknown) {
    const value = String(route || '');
    if (!value.startsWith('/')) return `${baseUrl}/${value}`;
    return `${baseUrl}${value}`;
  }

  async function request(
    method: string,
    route: string,
    {
      headers,
      body,
      accept,
      contentType,
    }: {
      headers?: Record<string, string>;
      body?: unknown;
      accept?: string;
      contentType?: string;
    } = {},
  ) {
    if (typeof fetch !== 'function') {
      return {
        ok: false,
        status: 0,
        data: null,
        error: {
          code: 'network_error',
          status: 0,
          errorCode: null,
          message: 'fetch unavailable',
          body: null,
        },
      };
    }

    const h = new Headers(headers || {});
    if (accept) h.set('Accept', String(accept));
    if (contentType) h.set('Content-Type', String(contentType));
    if (key) h.set(headerName, `Bearer ${key}`);

    let res: any = null;
    try {
      res = await fetch(buildUrl(route), { method, headers: h, body: body as any });
    } catch (e: any) {
      return {
        ok: false,
        status: 0,
        data: null,
        error: {
          code: 'network_error',
          status: 0,
          errorCode: null,
          message: e?.message ? String(e.message) : 'network error',
          body: null,
        },
      };
    }

    const status = Number(res.status);
    if (res.ok) {
      if (status === 204) return { ok: true, status, data: null, error: null };
      const data = await readBodyAsJsonOrText(res);
      return { ok: true, status, data, error: null };
    }

    const bodyObj = await readBodyAsJsonOrText(res);
    return {
      ok: false,
      status,
      data: null,
      error: toErrorObject({ status, body: bodyObj, fallbackMessage: 'request failed' }),
    };
  }

  function getVaultFile(filePath: string, { accept }: { accept?: string } = {}) {
    const encoded = encodeVaultPath(filePath);
    return request('GET', `/vault/${encoded}`, { accept: accept || 'text/markdown' });
  }

  function normalizeBinaryBody(bytes: unknown): Blob | Uint8Array | null {
    if (typeof Blob !== 'undefined' && bytes instanceof Blob) return bytes;
    if (bytes instanceof Uint8Array) return bytes;
    if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
    if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return null;
  }

  function listVaultDir(pathToDirectory: string) {
    const encoded = encodeVaultPath(pathToDirectory);
    return request('GET', `/vault/${encoded}/`, { accept: 'application/json' });
  }

  function putVaultFile(filePath: string, markdown: unknown) {
    const encoded = encodeVaultPath(filePath);
    return request('PUT', `/vault/${encoded}`, {
      body: String(markdown || ''),
      contentType: 'text/markdown',
      accept: 'application/json',
    });
  }

  function putVaultBinaryFile(
    filePath: string,
    bytes: unknown,
    {
      contentType,
    }: {
      contentType?: string;
    } = {},
  ) {
    const body = normalizeBinaryBody(bytes);
    if (!body) {
      return Promise.resolve({
        ok: false,
        status: 0,
        data: null,
        error: {
          code: 'bad_request',
          status: 0,
          errorCode: null,
          message: 'invalid binary body',
          body: null,
        },
      });
    }
    const encoded = encodeVaultPath(filePath);
    return request('PUT', `/vault/${encoded}`, {
      body,
      contentType: safeString(contentType) || 'application/octet-stream',
      accept: 'application/json',
    });
  }

  function deleteVaultFile(filePath: string) {
    const encoded = encodeVaultPath(filePath);
    return request('DELETE', `/vault/${encoded}`, { accept: 'application/json' });
  }

  function openVaultFile(filePath: string) {
    const encoded = encodeVaultPath(filePath);
    return request('POST', `/open/${encoded}`, { accept: 'application/json' });
  }

  function getServerStatus() {
    return request('GET', '/', { accept: 'application/json' });
  }

  return {
    ok: true,
    error: null,
    NOTE_JSON_ACCEPT,
    getServerStatus,
    getVaultFile,
    listVaultDir,
    putVaultFile,
    putVaultBinaryFile,
    deleteVaultFile,
    openVaultFile,
  };
}

const api = {
  NOTE_JSON_ACCEPT,
  encodeVaultPath,
  createClient,
};

export { NOTE_JSON_ACCEPT, encodeVaultPath, createClient };
export default api;
