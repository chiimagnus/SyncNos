export const MARKDOWN_READING_PROFILE_IDS = ['medium', 'notion', 'book'] as const;

export type MarkdownReadingProfileId = (typeof MARKDOWN_READING_PROFILE_IDS)[number];

export type MarkdownReadingProfileSpec = {
  id: MarkdownReadingProfileId;
  labelKey: string;
  fontStack: string;
  fontSize: string;
  lineHeight: string;
  paragraphGap: string;
  measure: string;
  headingScale: {
    h1: string;
    h2: string;
    h3: string;
    h4: string;
    h5: string;
    h6: string;
  };
  codeScale: string;
};

const MARKDOWN_READING_PROFILE_ID_SET = new Set<string>(MARKDOWN_READING_PROFILE_IDS);

export function isMarkdownReadingProfileId(value: unknown): value is MarkdownReadingProfileId {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  return MARKDOWN_READING_PROFILE_ID_SET.has(raw);
}

export function resolveMarkdownReadingProfileId(value: unknown): MarkdownReadingProfileId {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (isMarkdownReadingProfileId(raw)) return raw;
  return 'medium';
}
