export interface Env {
  NOTION_CLIENT_ID: string;
  NOTION_CLIENT_SECRET: string;
}

const NOTION_TOKEN_URL = 'https://api.notion.com/v1/oauth/token';
const REDIRECT_URI = 'https://chiimagnus.github.io/syncnos-oauth/callback';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    const url = new URL(request.url);
    if (url.pathname !== '/notion/oauth/exchange') {
      return withCors(new Response('Not Found', { status: 404 }));
    }

    if (request.method !== 'POST') {
      return withCors(new Response('Method Not Allowed', { status: 405 }));
    }

    if (request.headers.get('Content-Type') !== 'application/json') {
      return withCors(new Response('Expected Content-Type to be application/json', { status: 400 }));
    }

    const limitResult = await bestEffortRateLimit(request, {
      windowSeconds: 10 * 60,
      maxRequests: 30,
      keyPrefix: 'rl:notion-oauth-exchange:'
    });
    if (!limitResult.ok) {
      const retryAfterSeconds = 'retryAfterSeconds' in limitResult ? limitResult.retryAfterSeconds : 60;
      return withCors(new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }));
    }

    let body: any = null;
    try {
      body = await request.json();
    } catch (_e) {
      return withCors(new Response('Invalid JSON body', { status: 400 }));
    }

    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    if (!code) {
      return withCors(new Response('Missing code', { status: 400 }));
    }

    const clientId = (env.NOTION_CLIENT_ID || '').trim();
    const clientSecret = (env.NOTION_CLIENT_SECRET || '').trim();
    if (!clientId || !clientSecret) {
      return withCors(new Response('Notion OAuth client is not configured', { status: 500 }));
    }

    const form = new URLSearchParams();
    form.set('grant_type', 'authorization_code');
    form.set('code', code);
    form.set('redirect_uri', REDIRECT_URI);

    const basic = btoa(`${clientId}:${clientSecret}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(NOTION_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Authorization: `Basic ${basic}`
      },
      body: form.toString(),
      signal: controller.signal
    }).finally(() => clearTimeout(timeout));

    const text = await res.text();
    if (!res.ok) {
      return withCors(new Response(text || 'Token exchange failed', { status: res.status }));
    }

    return withCors(new Response(text, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
  }
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'POST,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function bestEffortRateLimit(
  request: Request,
  opts: { windowSeconds: number; maxRequests: number; keyPrefix: string }
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const ip = request.headers.get('CF-Connecting-IP')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || '';
  if (!ip) return { ok: true };

  const now = Date.now();
  const windowMs = Math.max(1_000, opts.windowSeconds * 1000);
  const resetAt = now - (now % windowMs) + windowMs;
  const cacheKey = new Request(`https://rate-limit.invalid/${opts.keyPrefix}${encodeURIComponent(ip)}`);
  const cache = (caches as any)?.default as Cache | undefined;
  if (!cache) return { ok: true };

  let count = 0;
  try {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const json = await hit.json().catch(() => null);
      count = (json && typeof json.count === 'number' && isFinite(json.count)) ? json.count : 0;
    }
  } catch (_e) {
    return { ok: true };
  }

  if (count >= opts.maxRequests) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)) };
  }

  const next = { count: count + 1 };
  const ttlSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
  await cache.put(
    cacheKey,
    new Response(JSON.stringify(next), { headers: { 'Cache-Control': `max-age=${ttlSeconds}` } })
  );
  return { ok: true };
}

function handleOptions(request: Request) {
  const headers = request.headers;
  if (
    headers.get('Origin') !== null &&
    headers.get('Access-Control-Request-Method') !== null &&
    headers.get('Access-Control-Request-Headers') !== null
  ) {
    const respHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    };
    return new Response(null, { headers: respHeaders });
  }
  return new Response(null, { headers: { Allow: 'POST,OPTIONS' } });
}
