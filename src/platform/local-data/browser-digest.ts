import type { DigestProvider } from '@services/local-data/digest';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

export const browserDigestProvider: DigestProvider = {
  async sha256(bytes) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error('Web Crypto SHA-256 is unavailable');
    const ownedBytes = new Uint8Array(bytes.byteLength);
    ownedBytes.set(bytes);
    return hex(new Uint8Array(await subtle.digest('SHA-256', ownedBytes)));
  },
};
