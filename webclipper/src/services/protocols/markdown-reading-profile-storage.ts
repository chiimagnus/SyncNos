import {
  resolveMarkdownReadingProfileId,
  type MarkdownReadingProfileId,
} from '@services/protocols/markdown-reading-profiles';

export const MARKDOWN_READING_PROFILE_STORAGE_KEY = 'markdown_reading_profile_v1';

export function normalizeStoredMarkdownReadingProfile(value: unknown): MarkdownReadingProfileId {
  return resolveMarkdownReadingProfileId(value);
}

export function buildMarkdownReadingProfileStoragePatch(value: unknown): {
  [MARKDOWN_READING_PROFILE_STORAGE_KEY]: MarkdownReadingProfileId;
} {
  return {
    [MARKDOWN_READING_PROFILE_STORAGE_KEY]: normalizeStoredMarkdownReadingProfile(value),
  };
}
