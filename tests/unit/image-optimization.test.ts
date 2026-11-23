import { beforeEach, describe, expect, it, vi } from 'vitest';

const codec = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('@platform/image/canvas-codec', () => ({
  renderImageCandidate: (...args: unknown[]) => codec.render(...args),
}));

import { createImageOptimizationPreview } from '@services/conversations/data/image-optimization';

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const pngChunk = (name: string, data: number[] = []) => [
  0,
  0,
  0,
  data.length,
  ...Array.from(name, (ch) => ch.charCodeAt(0)),
  ...data,
  0,
  0,
  0,
  0,
];
const png = (extra: number[] = []) =>
  new Blob(
    [Uint8Array.from([...pngSignature, ...pngChunk('IHDR', Array(13).fill(0)), ...extra, ...pngChunk('IDAT')])],
    { type: 'image/png' },
  );
const jpeg = (marker: number[] = []) =>
  new Blob([Uint8Array.from([0xff, 0xd8, ...marker, 0xff, 0xd9])], { type: 'image/jpeg' });
const staticPixels = new Uint8ClampedArray([64, 128, 192, 255]);
const encoded = (blob: Blob, input = staticPixels, output = staticPixels) => ({
  blob,
  width: 1,
  height: 1,
  originalPixels: input,
  optimizedPixels: output,
});

beforeEach(() => {
  codec.render.mockReset();
});

describe('safe image optimization preview', () => {
  it('rejects animated, legacy and unsupported formats without invoking the codec', async () => {
    const apng = png(pngChunk('acTL', [0, 0, 0, 1, 0, 0, 0, 1]));
    expect(await createImageOptimizationPreview({ blob: apng })).toMatchObject({
      ok: false,
      reason: 'unsupported-format',
    });
    expect(await createImageOptimizationPreview({ blob: new Blob(['GIF89a'], { type: 'image/gif' }) })).toMatchObject({
      ok: false,
      reason: 'unsupported-format',
    });
    expect(
      await createImageOptimizationPreview({ blob: new Blob(['<svg/>'], { type: 'image/svg+xml' }) }),
    ).toMatchObject({
      ok: false,
      reason: 'unsupported-format',
    });
    expect(await createImageOptimizationPreview({ blob: new Blob([]) })).toMatchObject({
      ok: false,
      reason: 'invalid-source',
    });
    expect(codec.render).not.toHaveBeenCalled();
  });

  it('refuses a mismatched source media type and a JPEG containing EXIF metadata', async () => {
    expect(
      await createImageOptimizationPreview({
        blob: png(),
        contentType: 'image/jpeg',
      }),
    ).toMatchObject({ ok: false, reason: 'mime-mismatch' });
    expect(
      await createImageOptimizationPreview({
        blob: jpeg([0xff, 0xe1, 0x00, 0x04, 0x45, 0x78]),
      }),
    ).toMatchObject({ ok: false, reason: 'metadata-unsafe' });
    expect(codec.render).not.toHaveBeenCalled();
  });

  it('offers a PNG only if the encoded image is smaller and pixels match exactly', async () => {
    const original = new Blob([await png().arrayBuffer(), new Uint8Array(300)], { type: 'image/png' });
    const output = png();
    codec.render.mockResolvedValueOnce(encoded(output));
    const preview = await createImageOptimizationPreview({ blob: original });
    expect(preview).toMatchObject({
      ok: true,
      contentType: 'image/png',
      originalBytes: original.size,
      optimizedBytes: output.size,
      width: 1,
      height: 1,
    });
    if (preview.ok) {
      expect(preview.optimizedBlob).toBe(output);
      expect(preview.savedBytes).toBe(original.size - output.size);
    }
    expect(codec.render).toHaveBeenCalledWith(original, 'image/png', undefined);
  });

  it('will not claim safe savings for fallback PNG, larger output, changed pixels or bad dimensions', async () => {
    const original = new Blob([await png().arrayBuffer(), new Uint8Array(300)], { type: 'image/png' });
    codec.render.mockResolvedValueOnce(encoded(new Blob(['tiny'], { type: 'image/jpeg' })));
    expect(await createImageOptimizationPreview({ blob: original })).toMatchObject({
      ok: false,
      reason: 'mime-mismatch',
    });
    codec.render.mockResolvedValueOnce(
      encoded(new Blob([await png().arrayBuffer(), new Uint8Array(original.size + 12)], { type: 'image/png' })),
    );
    expect(await createImageOptimizationPreview({ blob: original })).toMatchObject({
      ok: false,
      reason: 'no-savings',
    });
    codec.render.mockResolvedValueOnce(encoded(png(), staticPixels, new Uint8ClampedArray([64, 128, 193, 255])));
    expect(await createImageOptimizationPreview({ blob: original })).toMatchObject({
      ok: false,
      reason: 'pixels-changed',
    });
    codec.render.mockResolvedValueOnce({ ...encoded(png()), height: 0 });
    expect(await createImageOptimizationPreview({ blob: original })).toMatchObject({
      ok: false,
      reason: 'invalid-image',
    });
  });

  it('rejects pixel changes in JPEG as well as a smaller output with the wrong media type', async () => {
    const original = new Blob([await jpeg().arrayBuffer(), new Uint8Array(400)], { type: 'image/jpeg' });
    codec.render.mockResolvedValueOnce(encoded(jpeg(), staticPixels, new Uint8ClampedArray([65, 128, 192, 255])));
    expect(await createImageOptimizationPreview({ blob: original })).toMatchObject({
      ok: false,
      reason: 'pixels-changed',
    });
    expect(codec.render).toHaveBeenCalledWith(original, 'image/jpeg', undefined);
    const webp = new Blob(
      [
        Uint8Array.from([
          ...Array.from('RIFF', (c) => c.charCodeAt(0)),
          16,
          0,
          0,
          0,
          ...Array.from('WEBPVP8 ', (c) => c.charCodeAt(0)),
          4,
          0,
          0,
          0,
          1,
          2,
          3,
          4,
        ]),
      ],
      { type: 'image/webp' },
    );
    codec.render.mockResolvedValueOnce(encoded(webp));
    expect(await createImageOptimizationPreview({ blob: original })).toMatchObject({
      ok: false,
      reason: 'mime-mismatch',
    });
  });

  it('reports codec errors instead of returning an unverified image', async () => {
    codec.render.mockRejectedValueOnce(new Error('decode failed'));
    expect(await createImageOptimizationPreview({ blob: png() })).toMatchObject({
      ok: false,
      reason: 'decode-failed',
    });
    codec.render.mockRejectedValueOnce(new Error('image_pixel_budget'));
    expect(await createImageOptimizationPreview({ blob: png() })).toMatchObject({
      ok: false,
      reason: 'too-large',
    });
    expect(codec.render).toHaveBeenCalledTimes(2);
  });
});
