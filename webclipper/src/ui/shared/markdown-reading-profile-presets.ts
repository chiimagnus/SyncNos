import {
  MARKDOWN_READING_PROFILE_IDS,
  resolveMarkdownReadingProfileId,
  type MarkdownReadingProfileId,
  type MarkdownReadingProfileSpec,
} from '@services/protocols/markdown-reading-profiles';

export type MarkdownBubbleRole = 'user' | 'assistant';

export type MarkdownReadingProfilePreset = {
  id: MarkdownReadingProfileId;
  spec: MarkdownReadingProfileSpec;
  typographyClassName: string;
  roleOverrides?: Partial<Record<MarkdownBubbleRole, string>>;
};

function buildHeadingScale(bodyFontPx: number) {
  return {
    h1: `${Math.round(bodyFontPx * 1.95 * 1000) / 1000}px`,
    h2: `${Math.round(bodyFontPx * 1.55 * 1000) / 1000}px`,
    h3: `${Math.round(bodyFontPx * 1.3 * 1000) / 1000}px`,
    h4: `${Math.round(bodyFontPx * 1.15 * 1000) / 1000}px`,
    h5: `${Math.round(bodyFontPx * 1.05 * 1000) / 1000}px`,
    h6: `${Math.round(bodyFontPx * 1 * 1000) / 1000}px`,
  };
}

const mediumSpec: MarkdownReadingProfileSpec = {
  id: 'medium',
  labelKey: 'markdownReadingProfileMediumLabel',
  fontStack:
    '"Charter","Iowan Old Style","Palatino Linotype","Noto Serif CJK SC","Source Han Serif SC","Songti SC",serif',
  fontSize: '16px',
  lineHeight: '1.65',
  paragraphGap: '0.9rem',
  measure: '68ch',
  headingScale: buildHeadingScale(16),
  codeScale: '0.88em',
};

const notionSpec: MarkdownReadingProfileSpec = {
  id: 'notion',
  labelKey: 'markdownReadingProfileNotionLabel',
  fontStack:
    '"ui-sans-serif","Inter","Noto Sans CJK SC","Source Han Sans SC","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif',
  fontSize: '14px',
  lineHeight: '1.55',
  paragraphGap: '0.75rem',
  measure: '64ch',
  headingScale: buildHeadingScale(14),
  codeScale: '0.85em',
};

const bookSpec: MarkdownReadingProfileSpec = {
  id: 'book',
  labelKey: 'markdownReadingProfileBookLabel',
  fontStack:
    '"Literata","Baskerville","Noto Serif CJK SC","Source Han Serif SC","Songti SC","STSong",serif',
  fontSize: '17px',
  lineHeight: '1.75',
  paragraphGap: '1rem',
  measure: '72ch',
  headingScale: buildHeadingScale(17),
  codeScale: '0.86em',
};

export const MARKDOWN_READING_PROFILE_PRESETS: Record<MarkdownReadingProfileId, MarkdownReadingProfilePreset> = {
  medium: {
    id: 'medium',
    spec: mediumSpec,
    typographyClassName: [
      'tw-text-[16px] tw-leading-[1.65] tw-font-[var(--markdown-font-medium)]',
      '[&_p]:tw-max-w-[68ch] [&_li]:tw-max-w-[68ch] [&_blockquote]:tw-max-w-[68ch]',
      '[&_p]:tw-mb-[0.9rem]',
      '[&_h1]:tw-text-[31.2px] [&_h2]:tw-text-[24.8px] [&_h3]:tw-text-[20.8px] [&_h4]:tw-text-[18.4px] [&_h5]:tw-text-[16.8px] [&_h6]:tw-text-[16px]',
      '[&_pre>code]:tw-text-[0.88em] [&_code]:tw-text-[0.88em]',
    ].join(' '),
    roleOverrides: {
      user: [
        '[&_a]:tw-text-[color-mix(in_srgb,var(--info)_76%,var(--text-primary))]',
        '[&_a]:tw-font-semibold [&_a]:tw-underline-offset-[2px] [&_a]:tw-decoration-2',
        '[&_a]:tw-decoration-[color-mix(in_srgb,var(--info)_62%,var(--text-primary))]',
      ].join(' '),
    },
  },
  notion: {
    id: 'notion',
    spec: notionSpec,
    typographyClassName: [
      'tw-text-[14px] tw-leading-[1.55] tw-font-[var(--markdown-font-notion)]',
      '[&_p]:tw-max-w-[64ch] [&_li]:tw-max-w-[64ch] [&_blockquote]:tw-max-w-[64ch]',
      '[&_p]:tw-mb-[0.75rem]',
      '[&_h1]:tw-text-[27.3px] [&_h2]:tw-text-[21.7px] [&_h3]:tw-text-[18.2px] [&_h4]:tw-text-[16.1px] [&_h5]:tw-text-[14.7px] [&_h6]:tw-text-[14px]',
      '[&_pre>code]:tw-text-[0.85em] [&_code]:tw-text-[0.85em]',
    ].join(' '),
    roleOverrides: {
      user: [
        '[&_a]:tw-text-[color-mix(in_srgb,var(--info)_74%,var(--text-primary))]',
        '[&_a]:tw-font-semibold [&_a]:tw-underline-offset-[2px] [&_a]:tw-decoration-2',
      ].join(' '),
    },
  },
  book: {
    id: 'book',
    spec: bookSpec,
    typographyClassName: [
      'tw-text-[17px] tw-leading-[1.75] tw-font-[var(--markdown-font-book)]',
      '[&_p]:tw-max-w-[72ch] [&_li]:tw-max-w-[72ch] [&_blockquote]:tw-max-w-[72ch]',
      '[&_p]:tw-mb-[1rem]',
      '[&_h1]:tw-text-[33.15px] [&_h2]:tw-text-[26.35px] [&_h3]:tw-text-[22.1px] [&_h4]:tw-text-[19.55px] [&_h5]:tw-text-[17.85px] [&_h6]:tw-text-[17px]',
      '[&_pre>code]:tw-text-[0.86em] [&_code]:tw-text-[0.86em]',
    ].join(' '),
    roleOverrides: {
      user: [
        '[&_a]:tw-text-[color-mix(in_srgb,var(--info)_76%,var(--text-primary))]',
        '[&_a]:tw-font-semibold [&_a]:tw-underline-offset-[2px] [&_a]:tw-decoration-2',
      ].join(' '),
    },
  },
};

export const MARKDOWN_READING_PROFILE_PRESET_LIST: ReadonlyArray<MarkdownReadingProfilePreset> =
  MARKDOWN_READING_PROFILE_IDS.map((id) => MARKDOWN_READING_PROFILE_PRESETS[id]);

export function getMarkdownReadingProfilePreset(profile: unknown): MarkdownReadingProfilePreset {
  const id = resolveMarkdownReadingProfileId(profile);
  return MARKDOWN_READING_PROFILE_PRESETS[id];
}
