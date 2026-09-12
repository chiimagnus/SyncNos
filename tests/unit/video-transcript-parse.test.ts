import { describe, expect, it } from 'vitest';

import {
  parseBilibiliSubtitleJson,
  parseBilibiliViewPointsJson,
  parseWebVtt,
  parseYoutubeJson3,
  parseYoutubeTimedtextXml,
} from '../../src/collectors/video/video-transcript-parse';

describe('video transcript parsers', () => {
  it('preserves Bilibili fractional cue timing and drops platform-only fields', () => {
    const cues = parseBilibiliSubtitleJson(
      JSON.stringify({
        body: [
          {
            from: 1.234,
            to: 3.456,
            content: '  hello  ',
            sid: 7,
            location: 2,
            music: 0,
            font_color: '#fff',
          },
        ],
      }),
    );

    expect(cues).toEqual([{ start: 1.234, end: 3.456, text: 'hello' }]);
  });

  it('accepts only the current top-level Bilibili subtitle body shape', () => {
    expect(parseBilibiliSubtitleJson(JSON.stringify({ data: { body: [{ from: 1, to: 2, content: 'x' }] } }))).toEqual(
      [],
    );
    expect(parseBilibiliSubtitleJson(JSON.stringify({ result: { body: [{ from: 1, to: 2, content: 'x' }] } }))).toEqual(
      [],
    );
    expect(
      parseBilibiliSubtitleJson(JSON.stringify({ subtitle: { body: [{ from: 1, to: 2, content: 'x' }] } })),
    ).toEqual([]);
  });

  it('rejects missing, blank, negative, and non-finite starts without inventing zero', () => {
    const cues = parseBilibiliSubtitleJson(
      JSON.stringify({
        body: [
          { from: null, to: 1, content: 'null' },
          { from: '', to: 1, content: 'empty' },
          { from: '   ', to: 1, content: 'blank' },
          { from: -1, to: 1, content: 'negative' },
          { from: 'nope', to: 1, content: 'nan' },
          { from: 2, to: 1, content: 'bad-end' },
          { from: 3, to: '', content: 'blank-end' },
          { from: 4, to: 5, content: '' },
        ],
      }),
    );

    expect(cues).toEqual([
      { start: 2, text: 'bad-end' },
      { start: 3, text: 'blank-end' },
    ]);
  });

  it('parses YouTube timedtext start and dur independently', () => {
    expect(
      parseYoutubeTimedtextXml('<transcript><text start="1.234" dur="2.222">A &amp; B</text></transcript>'),
    ).toEqual([{ start: 1.234, end: 3.456, text: 'A & B' }]);
    expect(parseYoutubeTimedtextXml('<transcript><text dur="2">missing start</text></transcript>')).toEqual([]);
    expect(parseYoutubeTimedtextXml('<transcript><text start="2" dur="">blank dur</text></transcript>')).toEqual([
      { start: 2, text: 'blank dur' },
    ]);
  });

  it('rejects invalid YouTube json3 timing without inventing zero', () => {
    const json = JSON.stringify({
      events: [
        { tStartMs: null, dDurationMs: 1000, segs: [{ utf8: 'null' }] },
        { tStartMs: '', dDurationMs: 1000, segs: [{ utf8: 'empty' }] },
        { tStartMs: -1, dDurationMs: 1000, segs: [{ utf8: 'negative' }] },
        { tStartMs: 1500, dDurationMs: null, segs: [{ utf8: 'no end' }] },
        { tStartMs: 2500, dDurationMs: -1, segs: [{ utf8: 'bad duration' }] },
        { tStartMs: 3500, dDurationMs: 500, segs: [{ utf8: 'timed' }] },
      ],
    });

    expect(parseYoutubeJson3(json)).toEqual([
      { start: 1.5, text: 'no end' },
      { start: 2.5, text: 'bad duration' },
      { start: 3.5, end: 4, text: 'timed' },
    ]);
  });

  it('keeps WebVTT fractional timing and ignores an end before start', () => {
    expect(parseWebVtt('WEBVTT\n\n00:01.234 --> 00:03.456\nhello\n\n00:05.000 --> 00:04.000\nsecond')).toEqual([
      { start: 1.234, end: 3.456, text: 'hello' },
      { start: 5, text: 'second' },
    ]);
  });

  it('parses Bilibili view_points into platform-neutral chapters', () => {
    const chapters = parseBilibiliViewPointsJson(
      JSON.stringify({
        code: 0,
        data: {
          view_points: [
            {
              content: '  Intro\nsection  ',
              from: 0,
              to: 30.5,
              type: 1,
              imgUrl: 'https://example.com/image.jpg',
              logoUrl: 'https://example.com/logo.png',
              team_type: 2,
              team_name: 'team',
            },
            { content: 'Bad end', from: 31, to: 20 },
            { content: '', from: 40, to: 50 },
            { content: 'Bad start', from: null, to: 50 },
          ],
        },
      }),
    );

    expect(chapters).toEqual([
      { title: 'Intro section', startSeconds: 0, endSeconds: 30.5 },
      { title: 'Bad end', startSeconds: 31, endSeconds: null },
    ]);
  });

  it('distinguishes an explicit empty chapter list from an unknown response', () => {
    expect(parseBilibiliViewPointsJson(JSON.stringify({ code: 0, data: { view_points: [] } }))).toEqual([]);
    expect(parseBilibiliViewPointsJson(JSON.stringify({ code: -1, data: { view_points: [] } }))).toBeNull();
    expect(parseBilibiliViewPointsJson(JSON.stringify({ code: 0, data: {} }))).toBeNull();
    expect(parseBilibiliViewPointsJson('{bad')).toBeNull();
  });
});
