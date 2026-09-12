import { describe, expect, it } from 'vitest';

import {
  canonicalizeVideoUrl,
  detectSupportedVideoPagePlatform,
  detectVideoPlatformHost,
} from '../../src/services/url-cleaning/video-url';

describe('video URL classification', () => {
  it('recognizes the supported Bilibili BV contract and canonicalizes multipart identity', () => {
    const base = 'https://www.bilibili.com/video/BV1FwY4zkEef/';
    expect(detectVideoPlatformHost(base)).toBe('bilibili');
    expect(detectSupportedVideoPagePlatform(base)).toBe('bilibili');
    expect(canonicalizeVideoUrl(base)).toBe(base);

    expect(canonicalizeVideoUrl(`${base}?p=2&utm_source=x#part`)).toBe(`${base}?p=2`);
    expect(canonicalizeVideoUrl(`${base}?p=1&utm_source=x`)).toBe(base);
    expect(canonicalizeVideoUrl(`${base}?p=0`)).toBe(base);
    expect(canonicalizeVideoUrl(`${base}?p=not-a-number`)).toBe(base);

    const watchLater =
      'https://www.bilibili.com/list/watchlater?bvid=BV1FwY4zkEef&oid=115049943269792&utm_source=x#part';
    expect(detectSupportedVideoPagePlatform(watchLater)).toBe('bilibili');
    expect(canonicalizeVideoUrl(watchLater)).toBe(base);
    expect(
      canonicalizeVideoUrl('https://www.bilibili.com/list/watchlater?bvid=BV1FwY4zkEef&oid=115049943269792&p=2#part'),
    ).toBe(`${base}?p=2`);
  });

  it('distinguishes a video-capable host from a supported Bilibili page', () => {
    expect(detectVideoPlatformHost('https://www.bilibili.com/')).toBe('bilibili');
    expect(detectSupportedVideoPagePlatform('https://www.bilibili.com/')).toBeNull();
    expect(detectSupportedVideoPagePlatform('https://www.bilibili.com/opus/123')).toBeNull();
    expect(detectSupportedVideoPagePlatform('https://www.bilibili.com/video/av123')).toBeNull();
    expect(detectSupportedVideoPagePlatform('https://www.bilibili.com/video/BV-foo')).toBeNull();
    expect(detectSupportedVideoPagePlatform('https://www.bilibili.com/video/not-a-video-id')).toBeNull();
    expect(detectSupportedVideoPagePlatform('https://www.bilibili.com/list/watchlater?oid=115049943269792')).toBeNull();
    expect(detectSupportedVideoPagePlatform('https://www.bilibili.com/list/watchlater?bvid=BV-foo')).toBeNull();
    expect(detectSupportedVideoPagePlatform('https://www.bilibili.com/list/123?bvid=BV1FwY4zkEef')).toBeNull();
    expect(detectSupportedVideoPagePlatform('https://www.bilibili.com/opus/123?bvid=BV1FwY4zkEef')).toBeNull();
    expect(detectVideoPlatformHost('https://m.bilibili.com/video/BV1FwY4zkEef/')).toBeNull();
  });

  it('supports YouTube watch and youtu.be without promoting Shorts or the homepage', () => {
    expect(detectVideoPlatformHost('https://www.youtube.com/')).toBe('youtube');
    expect(detectSupportedVideoPagePlatform('https://www.youtube.com/')).toBeNull();
    expect(detectSupportedVideoPagePlatform('https://www.youtube.com/watch?v=abc123')).toBe('youtube');
    expect(detectSupportedVideoPagePlatform('https://youtu.be/abc123?t=2')).toBe('youtube');
    expect(detectSupportedVideoPagePlatform('https://youtu.be/abc123/extra')).toBeNull();
    expect(canonicalizeVideoUrl('https://youtu.be/abc123/extra#fragment')).toBe('https://youtu.be/abc123/extra');
    expect(canonicalizeVideoUrl('https://youtu.be/abc123?t=2#fragment')).toBe('https://www.youtube.com/watch?v=abc123');
    expect(canonicalizeVideoUrl('https://www.youtube.com/watch?v=abc123&list=ignored#fragment')).toBe(
      'https://www.youtube.com/watch?v=abc123',
    );

    const shorts = 'https://www.youtube.com/shorts/abc123?feature=share#fragment';
    expect(detectSupportedVideoPagePlatform(shorts)).toBeNull();
    expect(canonicalizeVideoUrl(shorts)).toBe('https://www.youtube.com/shorts/abc123?feature=share');
    expect(detectVideoPlatformHost('https://m.youtube.com/watch?v=abc123')).toBeNull();
  });

  it('fails closed for malformed and non-http URLs', () => {
    for (const value of ['', 'not a url', 'file:///tmp/video', 'chrome://extensions']) {
      expect(detectVideoPlatformHost(value)).toBeNull();
      expect(detectSupportedVideoPagePlatform(value)).toBeNull();
      expect(canonicalizeVideoUrl(value)).toBe('');
    }
  });

  it('does not rewrite unsupported paths into supported canonical forms', () => {
    const unsupportedBilibili = 'https://www.bilibili.com/video/av123?foo=bar#fragment';
    expect(canonicalizeVideoUrl(unsupportedBilibili)).toBe('https://www.bilibili.com/video/av123?foo=bar');

    const unsupportedSubdomain = 'https://m.bilibili.com/video/BV1FwY4zkEef/?p=2#fragment';
    expect(canonicalizeVideoUrl(unsupportedSubdomain)).toBe('https://m.bilibili.com/video/BV1FwY4zkEef/?p=2');
  });
});
