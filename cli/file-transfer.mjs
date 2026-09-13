import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';

function codedError(code, message, extra = null) {
  const error = new Error(message || code);
  error.code = code;
  error.extra = extra;
  return error;
}

async function lstatOrNull(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export function requireAbsoluteFilePath(value, label = 'path') {
  const path = String(value || '').trim();
  if (!path || !isAbsolute(path)) throw codedError('path_not_absolute', `${label} must be an absolute path`);
  return path;
}

export function decodeBase64Chunk(value, maxBytes) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0) {
    throw codedError('file_chunk_invalid_base64', 'Invalid file chunk Base64');
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw codedError('file_chunk_invalid_base64', 'Invalid file chunk Base64');
  }
  const bytes = Buffer.from(value, 'base64');
  if (Number.isFinite(maxBytes) && bytes.length > maxBytes) {
    throw codedError('file_chunk_too_large', 'File chunk exceeds protocol chunk size');
  }
  return bytes;
}

export class OutputFileReceiver {
  constructor({ outputPath, tempPath, handle, force }) {
    this.outputPath = outputPath;
    this.tempPath = tempPath;
    this.handle = handle;
    this.force = force;
    this.hash = createHash('sha256');
    this.byteSize = 0;
    this.closed = false;
    this.committed = false;
  }

  async write(bytes) {
    if (this.closed || this.committed) throw codedError('file_transfer_state', 'Output file is not writable');
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesWritten } = await this.handle.write(buffer, offset, buffer.length - offset, null);
      if (!bytesWritten) throw codedError('output_write_failed', 'Failed to write output file');
      offset += bytesWritten;
    }
    this.hash.update(buffer);
    this.byteSize += buffer.length;
  }

  async finish({ totalBytes, sha256 }) {
    if (this.committed) throw codedError('file_transfer_state', 'Output file transfer is already committed');
    const expectedBytes = Number(totalBytes);
    if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes !== this.byteSize) {
      throw codedError('file_transfer_size_mismatch', 'File transfer byte count mismatch');
    }
    const actualSha256 = this.hash.digest('hex');
    const expectedSha256 = String(sha256 || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expectedSha256) || actualSha256 !== expectedSha256) {
      throw codedError('file_transfer_hash_mismatch', 'File transfer SHA-256 mismatch');
    }
    await this.close();
    if (!this.force && (await lstatOrNull(this.outputPath))) {
      throw codedError('output_exists', 'Output file already exists');
    }
    await rename(this.tempPath, this.outputPath);
    this.committed = true;
    return { path: this.outputPath, byteSize: this.byteSize, sha256: actualSha256 };
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.handle.close();
  }

  async abort() {
    try {
      await this.close();
    } catch {
      // Continue cleanup even when close itself fails.
    }
    if (!this.committed) await unlink(this.tempPath).catch(() => {});
  }
}

export async function createOutputFileReceiver(outputPathInput, { force = false } = {}) {
  const outputPath = requireAbsoluteFilePath(outputPathInput, 'output path');
  const parentPath = dirname(outputPath);
  const parent = await lstatOrNull(parentPath);
  if (!parent || !parent.isDirectory())
    throw codedError('output_parent_missing', 'Output parent directory does not exist');

  const existing = await lstatOrNull(outputPath);
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw codedError('output_unsafe', 'Output path must be a regular file');
    }
    if (!force) throw codedError('output_exists', 'Output file already exists');
  }

  const tempPath = join(parentPath, `.${basename(outputPath)}.syncnos-${randomUUID()}.tmp`);
  const handle = await open(tempPath, 'wx', 0o600);
  return new OutputFileReceiver({ outputPath, tempPath, handle, force: force === true });
}

export async function openInputFile(inputPathInput) {
  const inputPath = requireAbsoluteFilePath(inputPathInput, 'input path');
  let handle;
  try {
    handle = await open(inputPath, 'r');
  } catch (error) {
    if (error?.code === 'ENOENT') throw codedError('input_not_found', 'Input file does not exist');
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw codedError('input_not_regular', 'Input path must be a regular file');
    return {
      path: inputPath,
      handle,
      byteSize: Number(stat.size),
      suggestedFilename: basename(inputPath),
    };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

export async function* readInputFileChunks(handle, byteSize, chunkBytes) {
  let position = 0;
  while (position < byteSize) {
    const length = Math.min(chunkBytes, byteSize - position);
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    if (bytesRead <= 0) throw codedError('input_truncated', 'Input file changed while being read');
    position += bytesRead;
    yield buffer.subarray(0, bytesRead);
  }
}
