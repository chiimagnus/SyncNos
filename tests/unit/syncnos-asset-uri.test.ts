import { describe, expect, it } from 'vitest';

import { formatSyncnosAssetUrl, isSyncnosAssetUrl, parseSyncnosAssetId } from '@services/shared/syncnos-asset-uri';

describe('syncnos asset uri', () => {
  it('classifies the private scheme independently from strict id parsing', () => {
    expect(isSyncnosAssetUrl('syncnos-asset://12')).toBe(true);
    expect(isSyncnosAssetUrl(' SYNCNOS-ASSET://nope ')).toBe(true);
    expect(isSyncnosAssetUrl('syncnos-asset://0')).toBe(true);
    expect(isSyncnosAssetUrl('<syncnos-asset://12>')).toBe(false);
    expect(isSyncnosAssetUrl('https://example.com/a.png')).toBe(false);
  });

  it('parses only positive safe-integer asset ids', () => {
    expect(parseSyncnosAssetId('syncnos-asset://12')).toBe(12);
    expect(parseSyncnosAssetId(' SYNCNOS-ASSET://0012 ')).toBe(12);
    for (const value of [
      'syncnos-asset://0',
      'syncnos-asset://-1',
      'syncnos-asset://1.5',
      'syncnos-asset://nope',
      'syncnos-asset://12/path',
      'syncnos-asset://12?x=1',
      'syncnos-asset://9007199254740992',
      '<syncnos-asset://12>',
    ]) {
      expect(parseSyncnosAssetId(value)).toBeNull();
    }
  });

  it('serializes only positive safe-integer ids', () => {
    expect(formatSyncnosAssetUrl(42)).toBe('syncnos-asset://42');
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
      expect(() => formatSyncnosAssetUrl(value)).toThrow(RangeError);
    }
  });
});
