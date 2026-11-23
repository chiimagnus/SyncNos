import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderPngCandidate } from '@platform/image/canvas-codec';

function header(width: number, height: number): Blob {
  return new Blob(
    [
      Uint8Array.from([
        137,
        80,
        78,
        71,
        13,
        10,
        26,
        10,
        0,
        0,
        0,
        13,
        73,
        72,
        68,
        82,
        (width >>> 24) & 255,
        (width >>> 16) & 255,
        (width >>> 8) & 255,
        width & 255,
        (height >>> 24) & 255,
        (height >>> 16) & 255,
        (height >>> 8) & 255,
        height & 255,
      ]),
    ],
    { type: 'image/png' },
  );
}

function codec(output: Blob) {
  const closed: Array<ReturnType<typeof vi.fn>> = [];
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => {
      const close = vi.fn();
      closed.push(close);
      return { width: 1, height: 1, close };
    }),
  );
  const convertToBlob = vi.fn(async () => output);
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      getContext() {
        return {
          drawImage: vi.fn(),
          getImageData: () => ({ data: new Uint8ClampedArray([5, 8, 13, 255]) }),
        };
      }
      convertToBlob = convertToBlob;
    },
  );
  return { closed, convertToBlob };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('native pixel-identical PNG encoding budget', () => {
  it('rejects huge pixel buffers before decoding or allocating canvases', async () => {
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    await expect(renderPngCandidate(header(100_000, 100_000))).rejects.toThrow('image_pixel_budget');
    expect(decode).not.toHaveBeenCalled();
  });

  it('encodes in the browser and releases both image bitmaps', async () => {
    const output = header(1, 1);
    const imageCodec = codec(output);
    const result = await renderPngCandidate(header(1, 1));
    expect(result.blob).toBe(output);
    expect([...result.originalPixels]).toEqual([5, 8, 13, 255]);
    expect([...result.optimizedPixels]).toEqual([5, 8, 13, 255]);
    expect(imageCodec.convertToBlob).toHaveBeenCalledWith({ type: 'image/png' });
    expect(imageCodec.closed).toHaveLength(2);
    imageCodec.closed.forEach((close) => expect(close).toHaveBeenCalledOnce());
  });

  it('closes the original bitmap on failure without claiming the output', async () => {
    const imageCodec = codec(header(1, 1));
    imageCodec.convertToBlob.mockRejectedValueOnce(new Error('encode failed'));
    await expect(renderPngCandidate(header(1, 1))).rejects.toThrow('encode failed');
    expect(imageCodec.closed).toHaveLength(1);
    expect(imageCodec.closed[0]).toHaveBeenCalledOnce();
  });

  it('requires a working codec and honors cancellation', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    await expect(renderPngCandidate(header(1, 1))).rejects.toThrow('image_codec_unavailable');
    const controller = new AbortController();
    controller.abort();
    await expect(renderPngCandidate(header(1, 1), controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
