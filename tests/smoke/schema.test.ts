import { describe, expect, it } from 'vitest';
import * as normalize from '@services/shared/normalize.ts';

describe('smoke', () => {
  it('normalizeText trims and normalizes newlines', () => {
    expect(normalize.normalizeText(' a \r\nb \r c\t \n')).toBe('a\nb\nc');
  });

  it('fnv1a32 is stable', () => {
    expect(normalize.fnv1a32('hello')).toBe(normalize.fnv1a32('hello'));
    expect(normalize.fnv1a32('hello')).not.toBe(normalize.fnv1a32('hello!'));
  });
});
