import { describe, expect, it } from 'vitest';

import { parseHostnameFromUrl } from '../../src/services/url-cleaning/hostname';

describe('domain', () => {
  it('parses hostname from url', () => {
    expect(parseHostnameFromUrl('https://www.sspai.com/post/1')).toBe('www.sspai.com');
    expect(parseHostnameFromUrl('')).toBe('');
    expect(parseHostnameFromUrl('notaurl')).toBe('');
  });

  // Note: we intentionally keep full hostnames (no eTLD+1 merging) for UX clarity.
});
