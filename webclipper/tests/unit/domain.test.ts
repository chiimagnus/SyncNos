import { describe, expect, it } from 'vitest';

import { parseRegistrableDomainFromUrl, parseHostnameFromUrl, toRegistrableDomain } from '../../src/ui/shared/domain';

describe('domain', () => {
  it('parses hostname from url', () => {
    expect(parseHostnameFromUrl('https://www.sspai.com/post/1')).toBe('www.sspai.com');
    expect(parseHostnameFromUrl('')).toBe('');
    expect(parseHostnameFromUrl('notaurl')).toBe('');
  });

  it('normalizes to registrable domain (heuristic)', () => {
    expect(toRegistrableDomain('www.sspai.com')).toBe('sspai.com');
    expect(toRegistrableDomain('m.dedao.cn')).toBe('dedao.cn');
    expect(toRegistrableDomain('foo.github.io')).toBe('foo.github.io');
    expect(toRegistrableDomain('localhost')).toBe('localhost');
    expect(toRegistrableDomain('127.0.0.1')).toBe('127.0.0.1');
  });

  it('parses registrable domain from url', () => {
    expect(parseRegistrableDomainFromUrl('https://www.sspai.com/post/1')).toBe('sspai.com');
    expect(parseRegistrableDomainFromUrl('https://m.dedao.cn/xxx')).toBe('dedao.cn');
    expect(parseRegistrableDomainFromUrl('https://foo.github.io/bar')).toBe('foo.github.io');
    expect(parseRegistrableDomainFromUrl('notaurl')).toBe('');
  });
});

