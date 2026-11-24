import { describe, expect, it } from 'vitest';

import { normalizeNotionIdInput } from '@services/sync/notion/notion-id-utils';

describe('notion-id-utils', () => {
  it('keeps 32-hex id as-is (lowercased)', () => {
    expect(normalizeNotionIdInput('346be9d6386a81748c6af9b7db455770')).toBe('346be9d6386a81748c6af9b7db455770');
    expect(normalizeNotionIdInput('346BE9D6386A81748C6AF9B7DB455770')).toBe('346be9d6386a81748c6af9b7db455770');
  });

  it('strips hyphens from UUID input', () => {
    expect(normalizeNotionIdInput('346be9d6-386a-8174-8c6a-f9b7db455770')).toBe('346be9d6386a81748c6af9b7db455770');
  });

  it('extracts database id from full notion url (prefers pathname over v=)', () => {
    expect(
      normalizeNotionIdInput(
        'https://app.notion.com/chiimagnus/346be9d6386a81748c6af9b7db455770?v=346be9d6386a81269331000cdd947d5e&source=copy_link',
      ),
    ).toBe('346be9d6386a81748c6af9b7db455770');
  });

  it('accepts current workspace links, title slugs, trailing slashes and hyphenated IDs', () => {
    const id = '0123456789abcdef0123456789abcdef';
    const dashed = '01234567-89ab-cdef-0123-456789abcdef';
    const view = 'f'.repeat(32);
    expect(normalizeNotionIdInput(`https://app.notion.com/p/example/${id}?v=${view}&source=copy_link`)).toBe(id);
    expect(normalizeNotionIdInput(`https://www.notion.so/example/Title-${dashed}/?v=${view}#${view}`)).toBe(id);
    expect(normalizeNotionIdInput(`https://example.notion.site/%E6%B5%8B%E8%AF%95-${id}`)).toBe(id);
    expect(normalizeNotionIdInput(`  https://custom.example/Title-${id}  `)).toBe(id);
  });

  it('never mistakes a view, block or earlier path segment for the object ID', () => {
    const id = 'a'.repeat(32);
    for (const input of [
      `https://app.notion.com/p/example/?v=${id}`,
      `https://app.notion.com/p/example/#${id}`,
      `https://app.notion.com/p/example/${id}/invalid?v=${id}`,
      `https://www.notion.so/Title-${id}-extra`,
      `notion://www.notion.so/${id}`,
      `database ID: ${id}`,
      'https://www.notion.so/%ZZ',
    ])
      expect(normalizeNotionIdInput(input)).toBe('');
  });

  it('returns empty for non-id input', () => {
    expect(normalizeNotionIdInput('')).toBe('');
    expect(normalizeNotionIdInput('not an id')).toBe('');
    expect(normalizeNotionIdInput('https://app.notion.com/')).toBe('');
  });
});
