import { describe, it, expect } from 'vitest';
import {
  DEFAULT_READER_PREFS,
  DEFAULT_READER_TYPOGRAPHY_PRESET,
  DEFAULT_READER_TTS_PREFS,
  READER_PREFS_LIMITS,
  READER_PREFS_STORAGE_KEY,
  normalizeReaderPrefs,
  resolveReaderPrefsFromStorage,
  buildReaderPrefsStoragePatch,
  readerPrefsToCssVars,
} from '@services/protocols/reader-prefs';

describe('normalizeReaderPrefs', () => {
  it('returns defaults for empty/invalid input', () => {
    expect(normalizeReaderPrefs(undefined)).toEqual(DEFAULT_READER_PREFS);
    expect(normalizeReaderPrefs(null)).toEqual(DEFAULT_READER_PREFS);
    expect(normalizeReaderPrefs('garbage')).toEqual(DEFAULT_READER_PREFS);
  });

  it('uses the default typography preset and updated limits', () => {
    expect(DEFAULT_READER_TYPOGRAPHY_PRESET).toEqual({
      fontFamily: 'serif',
      fontSize: 21,
      lineHeight: 1.75,
      contentWidth: 1000,
      letterSpacing: 0,
      textAlign: 'left',
    });
    expect(DEFAULT_READER_PREFS.contentWidth).toBe(1000);
    expect(READER_PREFS_LIMITS.contentWidth.max).toBe(2000);
    expect(READER_PREFS_LIMITS.letterSpacing.min).toBe(0);
    expect(READER_PREFS_LIMITS.tts.rate.min).toBe(0.8);
    expect(READER_PREFS_LIMITS.tts.rate.max).toBe(2);
  });

  it('clamps out-of-range numbers to limits', () => {
    const high = normalizeReaderPrefs({
      fontSize: 999,
      lineHeight: 99,
      contentWidth: 9999,
      letterSpacing: 1,
    });
    expect(high.fontSize).toBe(READER_PREFS_LIMITS.fontSize.max);
    expect(high.lineHeight).toBe(READER_PREFS_LIMITS.lineHeight.max);
    expect(high.contentWidth).toBe(READER_PREFS_LIMITS.contentWidth.max);
    expect(high.letterSpacing).toBe(READER_PREFS_LIMITS.letterSpacing.max);

    const low = normalizeReaderPrefs({
      fontSize: 1,
      lineHeight: 0,
      contentWidth: 10,
      letterSpacing: -5,
    });
    expect(low.fontSize).toBe(READER_PREFS_LIMITS.fontSize.min);
    expect(low.lineHeight).toBe(READER_PREFS_LIMITS.lineHeight.min);
    expect(low.contentWidth).toBe(READER_PREFS_LIMITS.contentWidth.min);
    expect(low.letterSpacing).toBe(0);
  });

  it('normalizes legacy negative letter spacing to zero', () => {
    const p = normalizeReaderPrefs({ letterSpacing: -0.01 });
    expect(p.letterSpacing).toBe(0);
  });

  it('falls back enums on invalid values and clamps tts.rate', () => {
    const p = normalizeReaderPrefs({
      fontFamily: 'comic',
      textAlign: 'center',
      tts: { engine: 'magic', aiFormat: 'midi', rate: 99 },
    });
    expect(p.fontFamily).toBe(DEFAULT_READER_PREFS.fontFamily);
    expect(p.textAlign).toBe(DEFAULT_READER_PREFS.textAlign);
    expect(p.tts.engine).toBe(DEFAULT_READER_TTS_PREFS.engine);
    expect(p.tts.aiFormat).toBe(DEFAULT_READER_TTS_PREFS.aiFormat);
    expect(p.tts.rate).toBe(READER_PREFS_LIMITS.tts.rate.max);
  });

  it('preserves valid values', () => {
    const p = normalizeReaderPrefs({
      fontFamily: 'mono',
      fontSize: 22,
      lineHeight: 1.5,
      contentWidth: 800,
      letterSpacing: 0.05,
      textAlign: 'justify',
      tts: { engine: 'ai', rate: 1.5, aiFormat: 'mp3', aiModel: 'kokoro', aiVoice: 'af_sky' },
    });
    expect(p.fontFamily).toBe('mono');
    expect(p.fontSize).toBe(22);
    expect(p.tts.engine).toBe('ai');
    expect(p.tts.rate).toBe(1.5);
    expect(p.tts.aiFormat).toBe('mp3');
  });
});

describe('resolveReaderPrefsFromStorage', () => {
  it('uses reader_prefs_v1 when present', () => {
    const p = resolveReaderPrefsFromStorage({
      [READER_PREFS_STORAGE_KEY]: { fontSize: 30 },
    });
    expect(p.fontSize).toBe(30);
  });

  it('returns defaults for empty storage', () => {
    expect(resolveReaderPrefsFromStorage({})).toEqual(DEFAULT_READER_PREFS);
    expect(resolveReaderPrefsFromStorage(null)).toEqual(DEFAULT_READER_PREFS);
  });
});

describe('buildReaderPrefsStoragePatch', () => {
  it('wraps a normalized prefs under the storage key', () => {
    const patch = buildReaderPrefsStoragePatch({ fontSize: 999 });
    expect(Object.keys(patch)).toEqual([READER_PREFS_STORAGE_KEY]);
    expect(patch[READER_PREFS_STORAGE_KEY].fontSize).toBe(READER_PREFS_LIMITS.fontSize.max);
  });
});

describe('readerPrefsToCssVars', () => {
  it('emits typography-only reader CSS vars', () => {
    const vars = readerPrefsToCssVars({ fontSize: 20, lineHeight: 1.6 });
    expect(vars['--reader-font-size']).toBe('20px');
    expect(vars['--reader-line-height']).toBe('1.6');
    expect(readerPrefsToCssVars({ letterSpacing: -0.02 })['--reader-letter-spacing']).toBe('0em');
    expect(vars['--reader-text-align']).toBe(DEFAULT_READER_PREFS.textAlign);
    expect(Object.keys(vars).some((key) => key.toLowerCase().includes('theme'))).toBe(false);
  });
});
