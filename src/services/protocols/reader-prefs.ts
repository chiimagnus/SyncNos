// Framework-agnostic reader preference model.
// MUST NOT import React or touch the DOM. Pure data/normalization only.

export const READER_PREFS_STORAGE_KEY = 'reader_prefs_v1';

export const READER_FONT_FAMILIES = ['serif', 'sans', 'mono'] as const;
export type ReaderFontFamily = (typeof READER_FONT_FAMILIES)[number];

export const READER_TEXT_ALIGNS = ['left', 'justify'] as const;
export type ReaderTextAlign = (typeof READER_TEXT_ALIGNS)[number];

export const READER_THEMES = ['system', 'light', 'sepia', 'dark', 'black'] as const;
export type ReaderTheme = (typeof READER_THEMES)[number];

export const READER_TTS_ENGINES = ['web', 'ai'] as const;
export type ReaderTtsEngineId = (typeof READER_TTS_ENGINES)[number];

export const READER_TTS_AUDIO_FORMATS = ['opus', 'mp3', 'wav', 'aac', 'flac'] as const;
export type ReaderTtsAudioFormat = (typeof READER_TTS_AUDIO_FORMATS)[number];

export type ReaderTtsPrefs = {
  engine: ReaderTtsEngineId;
  rate: number;
  webVoiceURI: string;
  aiEndpoint: string;
  aiApiKey: string;
  aiModel: string;
  aiVoice: string;
  aiFormat: ReaderTtsAudioFormat;
};

export type ReaderPrefs = {
  fontFamily: ReaderFontFamily;
  fontSize: number;
  lineHeight: number;
  contentWidth: number;
  letterSpacing: number;
  textAlign: ReaderTextAlign;
  theme: ReaderTheme;
  tts: ReaderTtsPrefs;
};

export type ReaderPrefsPatch = Omit<Partial<ReaderPrefs>, 'tts'> & {
  tts?: Partial<ReaderTtsPrefs>;
};

export const READER_PREFS_LIMITS = {
  fontSize: { min: 14, max: 34 },
  lineHeight: { min: 1.2, max: 2.4 },
  contentWidth: { min: 480, max: 2000 },
  letterSpacing: { min: 0, max: 0.08 },
  tts: {
    rate: { min: 0.8, max: 2 },
  },
} as const;

export const DEFAULT_READER_TTS_PREFS: ReaderTtsPrefs = {
  engine: 'web',
  rate: 1,
  webVoiceURI: '',
  aiEndpoint: 'http://localhost:8880/v1',
  aiApiKey: '',
  aiModel: 'kokoro',
  aiVoice: 'af_sky',
  aiFormat: 'opus',
};

export type ReaderTypographyPreset = Pick<
  ReaderPrefs,
  'fontFamily' | 'fontSize' | 'lineHeight' | 'contentWidth' | 'letterSpacing' | 'textAlign'
>;

// Default typography is the canonical reset and the reset target for reader layout.
export const DEFAULT_READER_TYPOGRAPHY_PRESET: ReaderTypographyPreset = {
  fontFamily: 'serif',
  fontSize: 21,
  lineHeight: 1.75,
  contentWidth: 1000,
  letterSpacing: 0,
  textAlign: 'left',
};

export const DEFAULT_READER_PREFS: ReaderPrefs = {
  ...DEFAULT_READER_TYPOGRAPHY_PRESET,
  theme: 'system',
  tts: DEFAULT_READER_TTS_PREFS,
};

export const READER_FONT_STACKS: Record<ReaderFontFamily, string> = {
  serif: 'Georgia, "Times New Roman", "Songti SC", "Noto Serif CJK SC", serif',
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans CJK SC", sans-serif',
  mono: '"SF Mono", "JetBrains Mono", Menlo, Consolas, "Noto Sans Mono CJK SC", monospace',
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function resolveEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function normalizeReaderTtsPrefs(raw: unknown): ReaderTtsPrefs {
  const obj = asRecord(raw);
  const d = DEFAULT_READER_TTS_PREFS;
  return {
    engine: resolveEnum(obj.engine, READER_TTS_ENGINES, d.engine),
    rate: clampNumber(obj.rate, READER_PREFS_LIMITS.tts.rate.min, READER_PREFS_LIMITS.tts.rate.max, d.rate),
    webVoiceURI: typeof obj.webVoiceURI === 'string' ? obj.webVoiceURI : d.webVoiceURI,
    aiEndpoint: typeof obj.aiEndpoint === 'string' && obj.aiEndpoint.trim() ? obj.aiEndpoint.trim() : d.aiEndpoint,
    aiApiKey: typeof obj.aiApiKey === 'string' ? obj.aiApiKey : d.aiApiKey,
    aiModel: typeof obj.aiModel === 'string' && obj.aiModel.trim() ? obj.aiModel.trim() : d.aiModel,
    aiVoice: typeof obj.aiVoice === 'string' && obj.aiVoice.trim() ? obj.aiVoice.trim() : d.aiVoice,
    aiFormat: resolveEnum(obj.aiFormat, READER_TTS_AUDIO_FORMATS, d.aiFormat),
  };
}

export function normalizeReaderPrefs(raw: unknown): ReaderPrefs {
  const obj = asRecord(raw);
  const L = READER_PREFS_LIMITS;
  const d = DEFAULT_READER_PREFS;
  return {
    fontFamily: resolveEnum(obj.fontFamily, READER_FONT_FAMILIES, d.fontFamily),
    fontSize: clampNumber(obj.fontSize, L.fontSize.min, L.fontSize.max, d.fontSize),
    lineHeight: clampNumber(obj.lineHeight, L.lineHeight.min, L.lineHeight.max, d.lineHeight),
    contentWidth: clampNumber(obj.contentWidth, L.contentWidth.min, L.contentWidth.max, d.contentWidth),
    letterSpacing: clampNumber(obj.letterSpacing, L.letterSpacing.min, L.letterSpacing.max, d.letterSpacing),
    textAlign: resolveEnum(obj.textAlign, READER_TEXT_ALIGNS, d.textAlign),
    theme: resolveEnum(obj.theme, READER_THEMES, d.theme),
    tts: normalizeReaderTtsPrefs(obj.tts),
  };
}

// Resolve prefs from a flat storage record:
// 1) reader_prefs_v1 present -> normalize it
// 2) else -> defaults
export function resolveReaderPrefsFromStorage(storage: Record<string, unknown> | null | undefined): ReaderPrefs {
  const store = storage ?? {};
  if (store[READER_PREFS_STORAGE_KEY] != null) {
    return normalizeReaderPrefs(store[READER_PREFS_STORAGE_KEY]);
  }
  return normalizeReaderPrefs(undefined);
}

export function buildReaderPrefsStoragePatch(prefs: unknown): { [READER_PREFS_STORAGE_KEY]: ReaderPrefs } {
  return { [READER_PREFS_STORAGE_KEY]: normalizeReaderPrefs(prefs) };
}

// Typography-only CSS variables. Intentionally excludes the legacy reader theme:
// the article theme button now writes the global app theme mode instead.
export function readerPrefsToCssVars(prefs: unknown): Record<string, string> {
  const p = normalizeReaderPrefs(prefs);
  return {
    '--reader-font-family': READER_FONT_STACKS[p.fontFamily],
    '--reader-font-size': `${p.fontSize}px`,
    '--reader-line-height': String(p.lineHeight),
    '--reader-content-width': `${p.contentWidth}px`,
    '--reader-letter-spacing': `${p.letterSpacing}em`,
    '--reader-text-align': p.textAlign,
  };
}
