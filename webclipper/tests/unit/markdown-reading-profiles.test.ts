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
      expect(String(preset.roleOverrides?.user || '')).toContain('[&_a]:tw-font-semibold');

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

  it('keeps notion profile compact while preserving readability floors', () => {
    const medium = MARKDOWN_READING_PROFILE_PRESETS.medium;
    const notion = MARKDOWN_READING_PROFILE_PRESETS.notion;

    expect(Number.parseFloat(notion.spec.fontSize)).toBeLessThan(Number.parseFloat(medium.spec.fontSize));
    expect(readMeasureCh(notion.spec.measure)).toBeLessThan(readMeasureCh(medium.spec.measure));
    expect(Number(notion.spec.lineHeight)).toBeGreaterThanOrEqual(1.5);
    expect(String(notion.typographyClassName)).toContain('[&_ul]:tw-mb-[0.55rem]');
    expect(String(notion.typographyClassName)).toContain('[&_blockquote]:tw-mb-[0.75rem]');
  });

  it('keeps book profile immersive with serif + CJK fallback', () => {
    const medium = MARKDOWN_READING_PROFILE_PRESETS.medium;
    const book = MARKDOWN_READING_PROFILE_PRESETS.book;

    expect(Number.parseFloat(book.spec.fontSize)).toBeGreaterThanOrEqual(Number.parseFloat(medium.spec.fontSize));
    expect(readMeasureCh(book.spec.measure)).toBeGreaterThan(readMeasureCh(medium.spec.measure));
    expect(Number(book.spec.lineHeight)).toBeGreaterThanOrEqual(1.5);
    expect(String(book.spec.fontStack)).toContain('Noto Serif CJK SC');
    expect(String(book.typographyClassName)).toContain('[&_p]:tw-max-w-[74ch]');
    expect(String(book.typographyClassName)).toContain('[&_pre>code]:tw-leading-[1.6]');
  });
});
