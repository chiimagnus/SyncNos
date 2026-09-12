import { describe, expect, it } from 'vitest';

import {
  formatVideoChaptersMarkdown,
  formatVideoTimecode,
  formatVideoTranscriptMarkdown,
  normalizeCanonicalVideoChapters,
  normalizeCanonicalVideoTranscriptCues,
  toCanonicalVideoTranscriptCues,
} from '../../src/services/conversations/domain/video-content';

describe('canonical video content domain', () => {
  it('maps source cues to exact canonical timing without sorting or merging', () => {
    expect(
      toCanonicalVideoTranscriptCues([
        { start: 1.234, end: 3.456, text: 'first', sid: 1 },
        { start: 5, end: 4, text: 'bad end' },
        { start: null, end: 8, text: 'bad start' },
        { start: 9, end: 10, text: '' },
      ]),
    ).toEqual([
      { startSeconds: 1.234, endSeconds: 3.456, text: 'first' },
      { startSeconds: 5, endSeconds: null, text: 'bad end' },
    ]);
  });

  it('accepts only canonical cue keys and strips extras', () => {
    expect(
      normalizeCanonicalVideoTranscriptCues([
        { startSeconds: 1.234, endSeconds: 3.456, text: 'cue', rawExtra: true },
        { start: 5, end: 6, text: 'legacy alias' },
      ]),
    ).toEqual([{ startSeconds: 1.234, endSeconds: 3.456, text: 'cue' }]);
  });

  it('accepts only canonical chapter keys, strips extras, and preserves order', () => {
    expect(
      normalizeCanonicalVideoChapters([
        { title: ' First\nchapter ', startSeconds: 10, endSeconds: 20, imgUrl: 'raw' },
        { title: 'Second', startSeconds: 0, endSeconds: null },
        { content: 'raw alias', from: 30, to: 40 },
      ]),
    ).toEqual([
      { title: 'First chapter', startSeconds: 10, endSeconds: 20 },
      { title: 'Second', startSeconds: 0, endSeconds: null },
    ]);
  });

  it('formats millisecond timecodes without losing precision', () => {
    expect(formatVideoTimecode(1.234)).toBe('00:01.234');
    expect(formatVideoTimecode(3.456)).toBe('00:03.456');
    expect(formatVideoTimecode(62)).toBe('01:02');
    expect(formatVideoTimecode(3661.007)).toBe('01:01:01.007');
  });

  it('formats transcript ranges from canonical cues only', () => {
    expect(
      formatVideoTranscriptMarkdown([
        { startSeconds: 1.234, endSeconds: 3.456, text: 'hello' },
        { startSeconds: 5, endSeconds: null, text: 'world' },
      ]),
    ).toBe('[00:01.234 → 00:03.456] hello\n[00:05] world');
  });

  it('formats canonical chapters as a dedicated markdown section', () => {
    expect(
      formatVideoChaptersMarkdown([
        { title: 'Intro', startSeconds: 0, endSeconds: 30 },
        { title: 'Main', startSeconds: 30.5, endSeconds: null },
      ]),
    ).toBe('## Chapters\n\n- [00:00 → 00:30] Intro\n- [00:30.500] Main');
    expect(formatVideoChaptersMarkdown([])).toBe('');
  });
});
