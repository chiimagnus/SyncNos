import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderImageCandidate } from '@platform/image/canvas-codec';

function pngHeader(width: number, height: number): Blob {
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
        8,
        6,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
      ]),
    ],
    { type: 'image/png' },
  );
}

function setupCanvas(output: Blob, pixels: number[] = [1, 2, 3, 255]) {
  const closes: Array<ReturnType<typeof vi.fn>> = [];
  const createBitmap = vi.fn(async () => {
    const close = vi.fn();
    closes.push(close);
    return { width: 1, height: 1, close };
  });
  vi.stubGlobal('createImageBitmap', createBitmap);
  const convertToBlob = vi.fn(async () => output);
  const drawImage = vi.fn();
  const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray(pixels) }));
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(_width: number, _height: number) {}
      getContext() {
        return { drawImage, getImageData };
      }
      convertToBlob = convertToBlob;
    },
  );
  return { closes, createBitmap, convertToBlob, drawImage, getImageData };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('browser canvas codec', () => {
  it('prevents extreme dimensions before any image decode or allocation', async () => {
    const fn = vi.fn();
    vi.stubGlobal('createImageBitmap', fn);
    await expect(renderImageCandidate(pngHeader(100_000, 100_000), 'image/png')).rejects.toThrow('image_pixel_budget');
    expect(fn).not.toHaveBeenCalled();
  });

  it('decodes only within budget, validates image dimensions and closes both ImageBitmaps', async () => {
    const output = pngHeader(1, 1);
    const canvas = setupCanvas(output);
    const result = await renderImageCandidate(pngHeader(1, 1), 'image/png');
    expect(result).toMatchObject({ blob: output, width: 1, height: 1 });
    expect([...result.originalPixels]).toEqual([1, 2, 3, 255]);
    expect(canvas.convertToBlob).toHaveBeenCalledWith({ type: 'image/png' });
    expect(canvas.closes).toHaveLength(2);
    for (const close of canvas.closes) expect(close).toHaveBeenCalledOnce();
  });

  it('closes bitmaps when encode fails, rather than leaking GPU resources', async () => {
    const canvas = setupCanvas(pngHeader(1, 1));
    canvas.convertToBlob.mockRejectedValueOnce(new Error('codec failed'));
    await expect(renderImageCandidate(pngHeader(1, 1), 'image/png')).rejects.toThrow('codec failed');
    expect(canvas.closes).toHaveLength(1);
    expect(canvas.closes[0]).toHaveBeenCalledOnce();
  });

  it('skips if no decoding API is available or task was cancelled', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    await expect(renderImageCandidate(pngHeader(1, 1), 'image/png')).rejects.toThrow('image_codec_unavailable');
    const controller = new AbortController();
    controller.abort();
    await expect(renderImageCandidate(pngHeader(1, 1), 'image/png', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
