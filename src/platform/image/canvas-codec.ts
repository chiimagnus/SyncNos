export type RasterizedImageCandidate = {
  blob: Blob;
  width: number;
  height: number;
  originalPixels: Uint8ClampedArray;
  optimizedPixels: Uint8ClampedArray;
};

const MAX_PIXELS = 4_194_304;
const HEADER_BYTES = 64 * 1024;

function u16be(bytes: Uint8Array, at: number): number {
  return bytes[at]! * 256 + bytes[at + 1]!;
}

function u32be(bytes: Uint8Array, at: number): number {
  return bytes[at]! * 0x1000000 + bytes[at + 1]! * 65536 + bytes[at + 2]! * 256 + bytes[at + 3]!;
}

function rasterDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) {
    return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) return null;
  let cursor = 2;
  while (cursor + 4 <= bytes.length) {
    if (bytes[cursor] !== 255) return null;
    while (bytes[cursor] === 255) cursor++;
    const marker = bytes[cursor++]!;
    if (marker === 216 || marker === 1 || (marker >= 208 && marker <= 215)) continue;
    if (marker === 217 || marker === 218) return null;
    if (cursor + 2 > bytes.length) return null;
    const length = u16be(bytes, cursor);
    if (length < 2 || cursor + length > bytes.length) return null;
    if ([192, 193, 194, 195, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
      if (length < 7) return null;
      return { width: u16be(bytes, cursor + 5), height: u16be(bytes, cursor + 3) };
    }
    cursor += length;
  }
  return null;
}

function assertBudget(width: number, height: number): void {
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

async function decodePixels(
  blob: Blob,
  signal?: AbortSignal,
): Promise<{
  image: ImageBitmap;
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  canvas: OffscreenCanvas | HTMLCanvasElement;
}> {
  if (signal?.aborted) throw new DOMException('Image optimization cancelled', 'AbortError');
  if (typeof createImageBitmap !== 'function') throw new Error('image_codec_unavailable');
  const image = await createImageBitmap(blob);
  try {
    const width = image.width;
    const height = image.height;
    assertBudget(width, height);
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : (() => {
            if (typeof document === 'undefined') throw new Error('image_codec_unavailable');
            const element = document.createElement('canvas');
            element.width = width;
            element.height = height;
            return element;
          })();
    const context = canvas.getContext('2d', { willReadFrequently: true }) as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;
    if (!context) throw new Error('image_codec_unavailable');
    context.drawImage(image, 0, 0);
    const pixels = new Uint8ClampedArray(context.getImageData(0, 0, width, height).data);
    return { image, pixels, canvas, width, height };
  } catch (error) {
    image.close();
    throw error;
  }
}

async function canvasBlob(canvas: OffscreenCanvas | HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return await canvas.convertToBlob({ type, ...(quality == null ? null : { quality }) });
  }
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('image_encode_failed'));
      },
      type,
      quality,
    );
  });
}

/** Browser-native encoding. Pixel budget is checked from source headers before allocating decoded images. */
export async function renderImageCandidate(
  source: Blob,
  type: 'image/png' | 'image/jpeg' | 'image/webp',
  quality?: number,
  signal?: AbortSignal,
): Promise<RasterizedImageCandidate> {
  const firstBytes = new Uint8Array(await source.slice(0, HEADER_BYTES).arrayBuffer());
  const dimensions = rasterDimensions(firstBytes);
  if (!dimensions) throw new Error('image_dimensions_unknown');
  assertBudget(dimensions.width, dimensions.height);

  const original = await decodePixels(source, signal);
  try {
    if (original.width !== dimensions.width || original.height !== dimensions.height) {
      throw new Error('image_dimensions_changed');
    }
    if (signal?.aborted) throw new DOMException('Image optimization cancelled', 'AbortError');
    const output = await canvasBlob(original.canvas, type, quality);
    if (signal?.aborted) throw new DOMException('Image optimization cancelled', 'AbortError');
    const optimized = await decodePixels(output, signal);
    try {
      if (optimized.width !== original.width || optimized.height !== original.height) {
        throw new Error('image_dimensions_changed');
      }
      return {
        blob: output,
        width: original.width,
        height: original.height,
        originalPixels: original.pixels,
        optimizedPixels: optimized.pixels,
      };
    } finally {
      optimized.image.close();
    }
  } finally {
    original.image.close();
  }
}
