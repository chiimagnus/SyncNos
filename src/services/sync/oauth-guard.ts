export function createSecureOAuthState(): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('oauth_secure_random_unavailable');
  }

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

export function isExactOAuthRedirect(actualUrl: string, redirectUri: string): boolean {
  try {
    const actual = new URL(String(actualUrl || ''));
    const expected = new URL(String(redirectUri || ''));
    return actual.origin === expected.origin && actual.pathname === expected.pathname;
  } catch (_error) {
    return false;
  }
}
