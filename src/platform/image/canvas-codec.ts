export type RasterizedPngCandidate = {
  blob: Blob;
  originalPixels: Uint8ClampedArray;
  optimizedPixels: Uint8ClampedArray;
};

const MAX_PIXELS = 4_194_304;

function dimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24 || ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return null;
  const read = (at: number) => bytes[at]! * 0x1000000 + bytes[at + 1]! * 65536 + bytes[at + 2]! * 256 + bytes[at + 3]!;
  return { width: read(16), height: read(20) };
}

function checkPixels(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_PIXELS ||
    height > Math.floor(MAX_PIXELS / width)
  ) {
    throw new Error('image_pixel_budget');
  }
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Image optimization cancelled', 'AbortError');
}

async function decode(blob: Blob, signal?: AbortSignal) {
  checkCancelled(signal);
  if (typeof createImageBitmap !== 'function') throw new Error('image_codec_unavailable');
  const bitmap = await createImageBitmap(blob);
  try {
    checkCancelled(signal);
    checkPixels(bitmap.width, bitmap.height);
    const canvas: OffscreenCanvas | HTMLCanvasElement =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(bitmap.width, bitmap.height)
        : (() => {
            if (typeof document === 'undefined') throw new Error('image_codec_unavailable');
            const el = document.createElement('canvas');
            el.width = bitmap.width;
            el.height = bitmap.height;
            return el;
          })();
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error('image_codec_unavailable');
    ctx.drawImage(bitmap, 0, 0);
    const pixels = new Uint8ClampedArray(ctx.getImageData(0, 0, bitmap.width, bitmap.height).data);
    return { width: bitmap.width, height: bitmap.height, pixels, canvas };
  } finally {
    bitmap.close();
  }
}

/** Browser-native PNG codec; rejects large images before allocating decoded pixel buffers. */
export async function renderPngCandidate(source: Blob, signal?: AbortSignal): Promise<RasterizedPngCandidate> {
  const header = new Uint8Array(await source.slice(0, 24).arrayBuffer());
  const parsed = dimensions(header);
  if (!parsed) throw new Error('image_dimensions_unknown');
  checkPixels(parsed.width, parsed.height);

  const original = await decode(source, signal);
  if (original.width !== parsed.width || original.height !== parsed.height) throw new Error('image_dimensions_changed');
  checkCancelled(signal);
  const canvas = original.canvas;
  const blob =
    'convertToBlob' in canvas
      ? await canvas.convertToBlob({ type: 'image/png' })
      : await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('image_encode_failed'))), 'image/png');
        });
  checkCancelled(signal);
  if (blob.type !== 'image/png') throw new Error('image_mime_mismatch');
  const optimized = await decode(blob, signal);
  if (optimized.width !== original.width || optimized.height !== original.height) {
    throw new Error('image_dimensions_changed');
  }
  return { blob, originalPixels: original.pixels, optimizedPixels: optimized.pixels };
}
