import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { createZipBlob, extractZipEntries } from '@services/sync/backup/zip-utils';

function u16(n: number) {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
}

function u32(n: number) {
  return new Uint8Array([
    n & 0xff,
    (n >>> 8) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 24) & 0xff,
  ]);
}

function concat(chunks: Uint8Array[]) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeDeflatedZipEntry({ name, data }: { name: string; data: Uint8Array }) {
  const nameBytes = new TextEncoder().encode(name);
  const compressed = deflateRawSync(data);
  const size = data.length >>> 0;
  const compSize = compressed.length >>> 0;
  const hash = crc32(data);
  const localOffset = 0;

  const localHeader = concat([
    u32(0x04034b50),
    u16(20),
    u16(0),
    u16(8),
    u16(0),
    u16(0),
    u32(hash),
    u32(compSize),
    u32(size),
    u16(nameBytes.length),
    u16(0),
    nameBytes,
  ]);

  const centralHeader = concat([
    u32(0x02014b50),
    u16(20),
    u16(20),
    u16(0),
    u16(8),
    u16(0),
    u16(0),
    u32(hash),
    u32(compSize),
    u32(size),
    u16(nameBytes.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(localOffset),
    nameBytes,
  ]);

  const centralDir = centralHeader;
  const localPart = concat([localHeader, compressed]);

  const endRecord = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(1),
    u16(1),
    u32(centralDir.length),
    u32(localPart.length),
    u16(0),
  ]);

  return concat([localPart, centralDir, endRecord]);
}

describe('backup zip-utils', () => {
  it('extractZipEntries reads stored zips created by createZipBlob', async () => {
    const blob = await createZipBlob([
      { name: 'a.txt', data: 'hello' },
      { name: 'dir/b.txt', data: 'world' },
    ]);
    const entries = await extractZipEntries(blob);
    expect(Array.from(entries.keys()).sort()).toEqual(['a.txt', 'dir/b.txt']);
    expect(new TextDecoder().decode(entries.get('a.txt'))).toBe('hello');
    expect(new TextDecoder().decode(entries.get('dir/b.txt'))).toBe('world');
  });

  it('extractZipEntries reads deflated (method=8) entries', async () => {
    const big = 'a'.repeat(150_000);
    const bytes = makeDeflatedZipEntry({
      name: 'sources/chatgpt/c1.json',
      data: new TextEncoder().encode(JSON.stringify({ ok: true, big })),
    });
    const blob = new Blob([bytes], { type: 'application/zip' });
    const entries = await extractZipEntries(blob);
    expect(new TextDecoder().decode(entries.get('sources/chatgpt/c1.json'))).toBe(
      JSON.stringify({ ok: true, big }),
    );
  });

  it('extractZipEntries strips a single top-level folder prefix (rezipped backups)', async () => {
    const blob = await createZipBlob([
      { name: 'SyncNos-Backup-Example/manifest.json', data: '{"ok":true}' },
      { name: 'SyncNos-Backup-Example/sources/conversations.csv', data: 'a,b,c' },
      { name: 'SyncNos-Backup-Example/sources/chatgpt/c1.json', data: '{"hello":"world"}' },
    ]);
    const entries = await extractZipEntries(blob);
    expect(entries.has('manifest.json')).toBe(true);
    expect(entries.has('sources/conversations.csv')).toBe(true);
    expect(entries.has('sources/chatgpt/c1.json')).toBe(true);
    expect(new TextDecoder().decode(entries.get('manifest.json')!)).toBe('{"ok":true}');
  });
});
