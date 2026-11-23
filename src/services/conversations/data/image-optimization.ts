import { renderImageCandidate } from '@platform/image/canvas-codec';
import { inspectImageBlob } from '@services/insight/image-format';

export type ImageOptimizationMode = 'pixel-exact' | 'lossy-preview';
export type ImageOptimizationSkipReason =
  | 'invalid-source'
  | 'unsupported-format'
  | 'mime-mismatch'
  | 'metadata-unsafe'
  | 'no-savings'
  | 'pixels-changed'
  | 'invalid-image'
  | 'too-large'
  | 'decode-failed'
  | 'codec-unavailable'
  | 'cancelled';

export type ImageOptimizationPreview =
  | { ok: false; reason: ImageOptimizationSkipReason }
  | {
      ok: true;
      mode: ImageOptimizationMode;
      originalBlob: Blob;
      optimizedBlob: Blob;
      originalBytes: number;
      optimizedBytes: number;
      savedBytes: number;
      contentType: 'image/png' | 'image/jpeg' | 'image/webp';
      width: number;
      height: number;
      pixelsEqual: boolean;
    };

async function containsJpegMetadata(blob: Blob): Promise<boolean> {
  const bytes = new Uint8Array(await blob.slice(0, 64 * 1024).arrayBuffer());
  let cursor = 2;
  while (cursor + 4 <= bytes.length) {
    if (bytes[cursor] !== 255) return false;
    while (bytes[cursor] === 255) cursor++;
    const marker = bytes[cursor++]!;
    if (marker >= 208 && marker <= 215) continue;
    if (marker === 217 || marker === 218) return false;
    if (cursor + 2 > bytes.length) break;
    const length = bytes[cursor]! * 256 + bytes[cursor + 1]!;
    if (length < 2 || cursor + length > bytes.length) break;
    if ([225, 226, 237].includes(marker)) return true;
    cursor += length;
  }
  // Truncated headers cannot safely establish the absence of EXIF / color profile metadata.
  return cursor + 4 > bytes.length && blob.size > bytes.length;
}

function samePixels(left: Uint8ClampedArray, right: Uint8ClampedArray): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/** Read-only preview; it never changes IndexedDB or remote content. */
export async function createImageOptimizationPreview(input: {
  blob: Blob;
  contentType?: string;
  mode?: ImageOptimizationMode;
  signal?: AbortSignal;
}): Promise<ImageOptimizationPreview> {
  const { blob, signal } = input;
  if (signal?.aborted) return { ok: false, reason: 'cancelled' };
  if (!(blob instanceof Blob) || blob.size === 0) return { ok: false, reason: 'invalid-source' };
  const mode = input.mode || 'pixel-exact';

  try {
    const { format, animation } = await inspectImageBlob(blob);
    if (animation !== 'static' || (format !== 'png' && format !== 'jpeg')) {
      return { ok: false, reason: 'unsupported-format' };
    }
    if (mode === 'lossy-preview' && format !== 'jpeg') return { ok: false, reason: 'unsupported-format' };
    const expectedSource = format === 'png' ? 'image/png' : 'image/jpeg';
    const claim = String(input.contentType || blob.type || expectedSource)
      .split(';')[0]!
      .trim()
      .toLowerCase();
    if (claim !== expectedSource || (blob.type && blob.type !== expectedSource)) {
      return { ok: false, reason: 'mime-mismatch' };
    }
    if (format === 'jpeg' && (await containsJpegMetadata(blob))) {
      return { ok: false, reason: 'metadata-unsafe' };
    }

    const targetType = expectedSource;
    const quality = mode === 'lossy-preview' ? 0.9 : undefined;
    const result = await renderImageCandidate(blob, targetType, quality, signal);
    if (signal?.aborted) return { ok: false, reason: 'cancelled' };
    if (
      !Number.isSafeInteger(result.width) ||
      result.width < 1 ||
      !Number.isSafeInteger(result.height) ||
      result.height < 1 ||
      result.originalPixels.length !== result.width * result.height * 4 ||
      result.optimizedPixels.length !== result.originalPixels.length
    ) {
      return { ok: false, reason: 'invalid-image' };
    }
    if (result.blob.type !== targetType) return { ok: false, reason: 'mime-mismatch' };
    const outputFormat = await inspectImageBlob(result.blob);
    if (outputFormat.format !== format || outputFormat.animation !== 'static') {
      return { ok: false, reason: 'mime-mismatch' };
    }
    const pixelsEqual = samePixels(result.originalPixels, result.optimizedPixels);
    if (mode === 'pixel-exact' && !pixelsEqual) return { ok: false, reason: 'pixels-changed' };
    if (result.blob.size === 0 || result.blob.size >= blob.size) return { ok: false, reason: 'no-savings' };
    return {
      ok: true,
      mode,
      originalBlob: blob,
      optimizedBlob: result.blob,
      originalBytes: blob.size,
      optimizedBytes: result.blob.size,
      savedBytes: blob.size - result.blob.size,
      contentType: targetType,
      width: result.width,
      height: result.height,
      pixelsEqual,
    };
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      return { ok: false, reason: 'cancelled' };
    }
    const code = error instanceof Error ? error.message : '';
    if (code === 'image_pixel_budget') return { ok: false, reason: 'too-large' };
    if (code === 'image_dimensions_unknown' || code === 'image_dimensions_changed') {
      return { ok: false, reason: 'invalid-image' };
    }
    if (code === 'image_codec_unavailable') return { ok: false, reason: 'codec-unavailable' };
    return { ok: false, reason: 'decode-failed' };
  }
}
