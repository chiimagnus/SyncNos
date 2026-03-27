import { describe, expect, it } from 'vitest';

import {
  MARKDOWN_READING_PROFILE_STORAGE_KEY,
  buildMarkdownReadingProfileStoragePatch,
  normalizeStoredMarkdownReadingProfile,
} from '../../src/services/protocols/markdown-reading-profile-storage';

describe('markdown reading profile storage contract', () => {
  it('keeps storage key stable', () => {
    expect(MARKDOWN_READING_PROFILE_STORAGE_KEY).toBe('markdown_reading_profile_v1');
  });

  it('normalizes known/unknown values with medium fallback', () => {
    expect(normalizeStoredMarkdownReadingProfile('medium')).toBe('medium');
    expect(normalizeStoredMarkdownReadingProfile('NOTION')).toBe('notion');
    expect(normalizeStoredMarkdownReadingProfile(' book ')).toBe('book');
    expect(normalizeStoredMarkdownReadingProfile('legacy')).toBe('medium');
    expect(normalizeStoredMarkdownReadingProfile(undefined)).toBe('medium');
  });

  it('builds storage patch with normalized value only', () => {
    expect(buildMarkdownReadingProfileStoragePatch('notion')).toEqual({
      markdown_reading_profile_v1: 'notion',
    });

    expect(buildMarkdownReadingProfileStoragePatch('invalid')).toEqual({
      markdown_reading_profile_v1: 'medium',
    });
  });
});
