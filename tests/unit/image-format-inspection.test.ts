import { describe, expect, it, vi } from 'vitest';
import { inspectImageBlob } from '@services/insight/image-format';

const bytes = (...values: number[]) => new Blob([Uint8Array.from(values)], { type: 'image/png' });
const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const pngChunk = (type: string, data: number[] = []) => [0, 0, 0, data.length, ...ascii(type), ...data, 0, 0, 0, 0];
const gifFrame = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 1, 2, 0];
const gifHeader = [...ascii('GIF89a'), 1, 0, 1, 0, 0, 0, 0];
const webpChunk = (name: string, data: number[]) => [
  ...ascii(name),
  data.length,
  0,
  0,
  0,
  ...data,
  ...(data.length % 2 ? [0] : []),
];
const webp = (chunks: number[]) => {
  const size = chunks.length + 4;
  return new Blob([Uint8Array.from([...ascii('RIFF'), size, 0, 0, 0, ...ascii('WEBP'), ...chunks])], {
    type: 'image/webp',
  });
};

describe('image format inspection', () => {
  it('distinguishes static PNG from APNG with multiple frames', async () => {
    const head = [...pngSignature, ...pngChunk('IHDR', new Array(13).fill(0))];
    expect(await inspectImageBlob(bytes(...head, ...pngChunk('IDAT')))).toEqual({
      format: 'png',
      animation: 'static',
    });
    expect(
      await inspectImageBlob(bytes(...head, ...pngChunk('acTL', [0, 0, 0, 2, 0, 0, 0, 1]), ...pngChunk('IDAT'))),
    ).toEqual({
      format: 'apng',
      animation: 'animated',
    });
    expect(
      await inspectImageBlob(bytes(...head, ...pngChunk('acTL', [0, 0, 0, 1, 0, 0, 0, 1]), ...pngChunk('IDAT'))),
    ).toEqual({ format: 'apng', animation: 'static' });
  });

  it('does not call a single GIF frame animated or assume a truncated stream is static', async () => {
    expect(await inspectImageBlob(bytes(...gifHeader, ...gifFrame, 0x3b))).toEqual({
      format: 'gif',
      animation: 'static',
    });
    expect(await inspectImageBlob(bytes(...gifHeader, ...gifFrame, ...gifFrame, 0x3b))).toEqual({
      format: 'gif',
      animation: 'animated',
    });
    expect(await inspectImageBlob(bytes(...gifHeader, ...gifFrame))).toEqual({
      format: 'gif',
      animation: 'unknown',
    });
  });

  it('confirms animation only from two WebP frames, not merely from a format suffix', async () => {
    const animated = [
      ...webpChunk('VP8X', [0x02, ...new Array(9).fill(0)]),
      ...webpChunk('ANIM', new Array(6).fill(0)),
      ...webpChunk('ANMF', new Array(16).fill(0)),
      ...webpChunk('ANMF', new Array(16).fill(0)),
    ];
    expect(await inspectImageBlob(webp(animated))).toEqual({ format: 'webp', animation: 'animated' });
    expect(await inspectImageBlob(webp(webpChunk('VP8 ', new Array(4).fill(0))))).toEqual({
      format: 'webp',
      animation: 'static',
    });
    expect(await inspectImageBlob(webp(animated.slice(0, 24)))).toEqual({
      format: 'webp',
      animation: 'unknown',
    });
  });

  it('reads only a bounded Blob slice and treats unsupported formats conservatively', async () => {
    const big = new Blob([Uint8Array.from([255, 216, 255]), new Uint8Array(2_000_000)], { type: 'image/jpeg' });
    const slice = vi.spyOn(big, 'slice');
    vi.spyOn(big, 'arrayBuffer').mockRejectedValue(new Error('must not read entire Blob'));
    expect(await inspectImageBlob(big)).toEqual({ format: 'jpeg', animation: 'static' });
    expect(slice).toHaveBeenCalledWith(0, expect.any(Number));
    expect(slice.mock.calls[0]?.[1]).toBeLessThanOrEqual(65536);
    expect(
      await inspectImageBlob(new Blob([Uint8Array.from(ascii('<svg></svg>'))], { type: 'image/svg+xml' })),
    ).toEqual({
      format: 'svg',
      animation: 'unknown',
    });
    expect(await inspectImageBlob(new Blob([Uint8Array.from(ascii('bad data'))], { type: 'image/gif' }))).toEqual({
      format: 'unknown',
      animation: 'unknown',
    });
  });
});
