import { describe, expect, it } from 'vitest';

import {
  MARKDOWN_READING_PROFILE_IDS,
  resolveMarkdownReadingProfileId,
  type MarkdownReadingProfileId,
} from '../../src/services/protocols/markdown-reading-profiles';
import {
  MARKDOWN_READING_PROFILE_PRESET_LIST,
  MARKDOWN_READING_PROFILE_PRESETS,
  getMarkdownReadingProfilePreset,
} from '../../src/ui/shared/markdown-reading-profile-presets';

function readMeasureCh(measure: string): number {
  const matched = /^(\d+(?:\.\d+)?)ch$/i.exec(String(measure || '').trim());
  if (!matched) return Number.NaN;
  return Number(matched[1]);
}

describe('markdown reading profile contract', () => {
  it('resolves known profile ids and falls back to medium for unknown values', () => {
    expect(resolveMarkdownReadingProfileId('medium')).toBe('medium');
    expect(resolveMarkdownReadingProfileId('NOTION')).toBe('notion');
    expect(resolveMarkdownReadingProfileId(' book ')).toBe('book');
    expect(resolveMarkdownReadingProfileId('legacy')).toBe('medium');
    expect(resolveMarkdownReadingProfileId('')).toBe('medium');
    expect(resolveMarkdownReadingProfileId(null)).toBe('medium');
  });

  it('keeps preset ids fully aligned with stable profile ids', () => {
    const idsFromPresetMap = Object.keys(MARKDOWN_READING_PROFILE_PRESETS).sort();
    const idsFromContract = Array.from(MARKDOWN_READING_PROFILE_IDS).sort();
    expect(idsFromPresetMap).toEqual(idsFromContract);

    const idsFromPresetList = MARKDOWN_READING_PROFILE_PRESET_LIST.map((preset) => preset.id);
    expect(idsFromPresetList).toEqual(MARKDOWN_READING_PROFILE_IDS);
  });

  it('keeps each preset spec complete and readable', () => {
    for (const profileId of MARKDOWN_READING_PROFILE_IDS) {
      const preset = MARKDOWN_READING_PROFILE_PRESETS[profileId as MarkdownReadingProfileId];
      expect(preset.id).toBe(profileId);
      expect(String(preset.spec.labelKey || '')).toBeTruthy();
      expect(String(preset.spec.fontStack || '')).toBeTruthy();
      expect(String(preset.spec.fontSize || '')).toMatch(/px$/);
      expect(Number(preset.spec.lineHeight)).toBeGreaterThanOrEqual(1.5);
      expect(String(preset.spec.paragraphGap || '')).toBeTruthy();
      expect(readMeasureCh(preset.spec.measure)).toBeLessThanOrEqual(80);
      expect(String(preset.spec.codeScale || '')).toBeTruthy();
      expect(String(preset.typographyClassName || '')).toContain('tw-text-[');
      expect(String(preset.typographyClassName || '')).toContain('[&_p]:tw-max-w-[');

      expect(Object.keys(preset.spec.headingScale)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
      for (const [heading, size] of Object.entries(preset.spec.headingScale)) {
        expect(String(size || '')).toMatch(/px$/);
        expect(Number.parseFloat(size)).toBeGreaterThan(0);
        expect(String(heading || '')).toMatch(/^h[1-6]$/);
      }
    }
  });

  it('returns medium preset when profile id is unknown', () => {
    expect(getMarkdownReadingProfilePreset('legacy').id).toBe('medium');
    expect(getMarkdownReadingProfilePreset('notion').id).toBe('notion');
  });
});
