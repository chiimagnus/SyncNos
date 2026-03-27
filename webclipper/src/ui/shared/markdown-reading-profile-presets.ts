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
  bubbleClassName?: string;
  bubbleRoleOverrides?: Partial<Record<MarkdownBubbleRole, string>>;
  roleOverrides?: Partial<Record<MarkdownBubbleRole, string>>;
};

function buildHeadingScale(bodyFontPx: number) {
  return {
    h1: `${Math.round(bodyFontPx * 1.9 * 1000) / 1000}px`,
    h2: `${Math.round(bodyFontPx * 1.5 * 1000) / 1000}px`,
    h3: `${Math.round(bodyFontPx * 1.28 * 1000) / 1000}px`,
    h4: `${Math.round(bodyFontPx * 1.14 * 1000) / 1000}px`,
    h5: `${Math.round(bodyFontPx * 1.04 * 1000) / 1000}px`,
    h6: `${Math.round(bodyFontPx * 1 * 1000) / 1000}px`,
  };
}

const mediumSpec: MarkdownReadingProfileSpec = {
  id: 'medium',
  labelKey: 'markdownReadingProfileMediumLabel',
  fontStack:
    '"Charter","Iowan Old Style","Palatino Linotype","Noto Serif CJK SC","Source Han Serif SC","Songti SC",serif',
  fontSize: '17px',
  lineHeight: '1.75',
  paragraphGap: '1rem',
  measure: '66ch',
  headingScale: buildHeadingScale(17),
  codeScale: '0.9em',
};

const notionSpec: MarkdownReadingProfileSpec = {
  id: 'notion',
  labelKey: 'markdownReadingProfileNotionLabel',
  fontStack:
    '"ui-sans-serif","Inter","Noto Sans CJK SC","Source Han Sans SC","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif',
  fontSize: '15px',
  lineHeight: '1.65',
  paragraphGap: '0.72rem',
  measure: '64ch',
  headingScale: buildHeadingScale(15),
  codeScale: '0.84em',
};

const bookSpec: MarkdownReadingProfileSpec = {
  id: 'book',
  labelKey: 'markdownReadingProfileBookLabel',
  fontStack:
    '"Literata","Baskerville","Noto Serif CJK SC","Source Han Serif SC","Songti SC","STSong",serif',
  fontSize: '18px',
  lineHeight: '1.88',
  paragraphGap: '1.2rem',
  measure: '72ch',
  headingScale: buildHeadingScale(18),
  codeScale: '0.85em',
};

export const MARKDOWN_READING_PROFILE_PRESETS: Record<MarkdownReadingProfileId, MarkdownReadingProfilePreset> = {
  medium: {
    id: 'medium',
    spec: mediumSpec,
    bubbleClassName: 'tw-shadow-[0_1px_0_rgb(0_0_0/3%)]',
    bubbleRoleOverrides: {
      assistant:
        'tw-rounded-[16px] tw-px-4 tw-py-3.5 tw-bg-[color-mix(in_srgb,var(--bg-card)_97%,white)] tw-border-[color-mix(in_srgb,var(--border)_64%,transparent)]',
      user: 'tw-rounded-[16px] tw-px-4 tw-py-3.5 tw-bg-[color-mix(in_srgb,var(--bubble-user-bg)_86%,var(--bg-card))] tw-border-[color-mix(in_srgb,var(--bubble-user-border)_68%,transparent)]',
    },
    typographyClassName: [
      'tw-text-[17px] tw-leading-[1.75] tw-font-[var(--markdown-font-medium)] tw-tracking-[0.004em]',
      '[&_p]:tw-max-w-[66ch] [&_li]:tw-max-w-[66ch] [&_blockquote]:tw-max-w-[66ch]',
      '[&_p]:tw-mb-[1rem]',
      '[&_h1]:tw-text-[32.3px] [&_h1]:tw-leading-[1.18] [&_h1]:tw-tracking-[-0.014em] [&_h1]:tw-font-[640]',
      '[&_h2]:tw-text-[25.5px] [&_h2]:tw-leading-[1.22] [&_h2]:tw-tracking-[-0.01em] [&_h2]:tw-font-[620]',
      '[&_h3]:tw-text-[21.8px] [&_h3]:tw-leading-[1.28] [&_h3]:tw-font-[610]',
      '[&_h4]:tw-text-[19.4px] [&_h4]:tw-leading-[1.34] [&_h4]:tw-font-[600]',
      '[&_h5]:tw-text-[17.7px] [&_h5]:tw-leading-[1.38] [&_h5]:tw-font-[600] [&_h6]:tw-text-[17px] [&_h6]:tw-leading-[1.42] [&_h6]:tw-font-[600]',
      '[&_blockquote]:tw-pl-5 [&_blockquote]:tw-pr-1 [&_blockquote]:tw-py-[2px] [&_blockquote]:tw-text-[color-mix(in_srgb,var(--text-primary)_82%,var(--text-secondary))] [&_blockquote]:tw-italic [&_blockquote]:before:tw-content-[""] [&_blockquote]:before:tw-absolute [&_blockquote]:before:tw-left-0 [&_blockquote]:before:tw-top-1 [&_blockquote]:before:tw-bottom-1 [&_blockquote]:before:tw-w-[3px] [&_blockquote]:before:tw-rounded-full [&_blockquote]:before:tw-bg-[color-mix(in_srgb,var(--text-primary)_22%,transparent)]',
      '[&_pre>code]:tw-text-[0.9em] [&_pre>code]:tw-leading-[1.55] [&_code]:tw-text-[0.9em] [&_kbd]:tw-text-[0.88em]',
      '[&_th]:tw-text-[0.87em] [&_th]:tw-leading-[1.5] [&_td]:tw-text-[0.87em] [&_td]:tw-leading-[1.5]',
      '[&_.syncnos-md-image-link]:tw-text-[0.85em] [&_.syncnos-md-image-link]:tw-leading-[1.48]',
      '[&_a]:tw-text-[color-mix(in_srgb,var(--text-primary)_88%,var(--info))] [&_a]:tw-underline [&_a]:tw-underline-offset-[3px] [&_a]:tw-decoration-[color-mix(in_srgb,var(--text-primary)_40%,transparent)] [&_a:hover]:tw-decoration-[color-mix(in_srgb,var(--text-primary)_60%,transparent)]',
    ].join(' '),
    roleOverrides: {
      user: [
        '[&_a]:tw-text-[color-mix(in_srgb,var(--secondary-foreground)_84%,var(--info))]',
        '[&_a]:tw-decoration-[color-mix(in_srgb,var(--secondary-foreground)_45%,transparent)]',
      ].join(' '),
    },
  },
  notion: {
    id: 'notion',
    spec: notionSpec,
    bubbleRoleOverrides: {
      assistant:
        'tw-rounded-[12px] tw-px-3.5 tw-py-3 tw-bg-[var(--bg-card)] tw-border-[color-mix(in_srgb,var(--border)_82%,transparent)]',
      user: 'tw-rounded-[12px] tw-px-3.5 tw-py-3 tw-bg-[color-mix(in_srgb,var(--bubble-user-bg)_92%,var(--bg-card))] tw-border-[color-mix(in_srgb,var(--bubble-user-border)_82%,transparent)]',
    },
    typographyClassName: [
      'tw-text-[15px] tw-leading-[1.65] tw-font-[var(--markdown-font-notion)] tw-tracking-[0.001em]',
      '[&_p]:tw-max-w-[64ch] [&_li]:tw-max-w-[64ch] [&_blockquote]:tw-max-w-[64ch]',
      '[&_p]:tw-mb-[0.72rem]',
      '[&_ul]:tw-mb-[0.58rem] [&_ol]:tw-mb-[0.58rem] [&_blockquote]:tw-mb-[0.8rem]',
      '[&_h1]:tw-text-[28.5px] [&_h1]:tw-leading-[1.2] [&_h1]:tw-font-[660]',
      '[&_h2]:tw-text-[22.5px] [&_h2]:tw-leading-[1.24] [&_h2]:tw-font-[640]',
      '[&_h3]:tw-text-[19.2px] [&_h3]:tw-leading-[1.28] [&_h3]:tw-font-[620]',
      '[&_h4]:tw-text-[17.1px] [&_h4]:tw-leading-[1.33] [&_h4]:tw-font-[610]',
      '[&_h5]:tw-text-[15.6px] [&_h5]:tw-leading-[1.4] [&_h5]:tw-font-[600] [&_h6]:tw-text-[15px] [&_h6]:tw-leading-[1.45] [&_h6]:tw-font-[600]',
      '[&_blockquote]:tw-rounded-[8px] [&_blockquote]:tw-pl-4 [&_blockquote]:tw-pr-2 [&_blockquote]:tw-py-2 [&_blockquote]:tw-bg-[color-mix(in_srgb,var(--bg-sunken)_58%,var(--bg-card))] [&_blockquote]:tw-text-[color-mix(in_srgb,var(--text-primary)_78%,var(--text-secondary))] [&_blockquote]:before:tw-content-[""] [&_blockquote]:before:tw-absolute [&_blockquote]:before:tw-left-0 [&_blockquote]:before:tw-top-[6px] [&_blockquote]:before:tw-bottom-[6px] [&_blockquote]:before:tw-w-[2px] [&_blockquote]:before:tw-rounded-full [&_blockquote]:before:tw-bg-[color-mix(in_srgb,var(--info)_45%,var(--border))]',
      '[&_pre>code]:tw-text-[0.84em] [&_pre>code]:tw-leading-[1.48] [&_code]:tw-text-[0.84em] [&_kbd]:tw-text-[0.84em]',
      '[&_th]:tw-text-[0.83em] [&_th]:tw-leading-[1.42] [&_td]:tw-text-[0.83em] [&_td]:tw-leading-[1.42]',
      '[&_.syncnos-md-image-link]:tw-text-[0.83em] [&_.syncnos-md-image-link]:tw-leading-[1.4]',
      '[&_a]:tw-text-[color-mix(in_srgb,var(--info)_84%,var(--text-primary))] [&_a]:tw-underline [&_a]:tw-underline-offset-[2px] [&_a]:tw-decoration-[color-mix(in_srgb,var(--info)_58%,transparent)] [&_a:hover]:tw-decoration-[color-mix(in_srgb,var(--info)_78%,transparent)]',
    ].join(' '),
    roleOverrides: {
      user: [
        '[&_a]:tw-text-[color-mix(in_srgb,var(--secondary-foreground)_82%,var(--info))]',
        '[&_a]:tw-decoration-[color-mix(in_srgb,var(--secondary-foreground)_44%,transparent)]',
      ].join(' '),
    },
  },
  book: {
    id: 'book',
    spec: bookSpec,
    bubbleClassName: 'tw-shadow-[0_1px_0_rgb(0_0_0/2%)]',
    bubbleRoleOverrides: {
      assistant:
        'tw-rounded-[9px] tw-px-5 tw-py-4 tw-bg-[color-mix(in_srgb,var(--bg-card)_86%,var(--bg-primary))] tw-border-[color-mix(in_srgb,var(--border)_56%,transparent)]',
      user: 'tw-rounded-[10px] tw-px-[18px] tw-py-3.5 tw-bg-[color-mix(in_srgb,var(--bubble-user-bg)_78%,var(--bg-primary))] tw-border-[color-mix(in_srgb,var(--bubble-user-border)_66%,transparent)]',
    },
    typographyClassName: [
      'tw-text-[18px] tw-leading-[1.88] tw-font-[var(--markdown-font-book)] tw-tracking-[0.002em]',
      '[&_p]:tw-max-w-[72ch] [&_li]:tw-max-w-[72ch] [&_blockquote]:tw-max-w-[72ch]',
      '[&_p]:tw-mb-[1.2rem] [&_ul]:tw-mb-[1rem] [&_ol]:tw-mb-[1rem] [&_blockquote]:tw-mb-[1.12rem]',
      '[&_h1]:tw-text-[34.2px] [&_h1]:tw-leading-[1.17] [&_h1]:tw-tracking-[-0.012em] [&_h1]:tw-font-[610]',
      '[&_h2]:tw-text-[27px] [&_h2]:tw-leading-[1.22] [&_h2]:tw-tracking-[-0.008em] [&_h2]:tw-font-[600]',
      '[&_h3]:tw-text-[23px] [&_h3]:tw-leading-[1.28] [&_h3]:tw-font-[600]',
      '[&_h4]:tw-text-[20.5px] [&_h4]:tw-leading-[1.34] [&_h4]:tw-font-[590]',
      '[&_h5]:tw-text-[18.7px] [&_h5]:tw-leading-[1.4] [&_h5]:tw-font-[590] [&_h6]:tw-text-[18px] [&_h6]:tw-leading-[1.46] [&_h6]:tw-font-[590]',
      '[&_blockquote]:tw-pl-6 [&_blockquote]:tw-pr-2 [&_blockquote]:tw-py-0 [&_blockquote]:tw-text-[color-mix(in_srgb,var(--text-primary)_76%,var(--text-secondary))] [&_blockquote]:tw-italic [&_blockquote]:before:tw-content-none',
      '[&_pre>code]:tw-text-[0.85em] [&_pre>code]:tw-leading-[1.62] [&_code]:tw-text-[0.85em] [&_kbd]:tw-text-[0.84em]',
      '[&_th]:tw-text-[0.86em] [&_th]:tw-leading-[1.48] [&_td]:tw-text-[0.86em] [&_td]:tw-leading-[1.48]',
      '[&_.syncnos-md-image-link]:tw-text-[0.85em] [&_.syncnos-md-image-link]:tw-leading-[1.45]',
      '[&_a]:tw-text-[color-mix(in_srgb,var(--text-primary)_86%,var(--info))] [&_a]:tw-underline [&_a]:tw-underline-offset-[3px] [&_a]:tw-decoration-[color-mix(in_srgb,var(--text-primary)_46%,transparent)] [&_a:hover]:tw-decoration-[color-mix(in_srgb,var(--text-primary)_62%,transparent)]',
    ].join(' '),
    roleOverrides: {
      user: [
        '[&_a]:tw-text-[color-mix(in_srgb,var(--secondary-foreground)_84%,var(--info))]',
        '[&_a]:tw-decoration-[color-mix(in_srgb,var(--secondary-foreground)_46%,transparent)]',
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
