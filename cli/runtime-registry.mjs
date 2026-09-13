import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import process from 'node:process';

export const DARWIN_UNIX_SOCKET_PATH_MAX_BYTES = 103;
export const LINUX_UNIX_SOCKET_PATH_MAX_BYTES = 107;
const RUNTIME_DIR_PREFIX = 'sn-';
const REGISTRY_SUFFIX = '.json';
const SOCKET_SUFFIX = '.sock';
const WINDOWS_PIPE_PREFIX = '\\\\.\\pipe\\syncnos-cli-';

function errorWithCode(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

export function runtimeInstanceHash(cliInstanceId) {
  const value = String(cliInstanceId || '').trim();
  if (!value) throw errorWithCode('invalid_instance_id', 'CLI instance id is required');
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

export function validatePrivateDirectoryStat(stat, expectedUid = process.getuid?.()) {
  if (stat && typeof stat.isSymbolicLink === 'function' && stat.isSymbolicLink()) {
    throw errorWithCode('runtime_dir_symlink', 'CLI runtime directory must not be a symlink');
  }
  if (!stat || typeof stat.isDirectory !== 'function' || !stat.isDirectory()) {
    throw errorWithCode('runtime_dir_not_directory', 'CLI runtime path is not a directory');
  }
  if (Number.isInteger(expectedUid) && Number(stat.uid) !== Number(expectedUid)) {
    throw errorWithCode('runtime_dir_wrong_owner', 'CLI runtime directory is not owned by the current user');
  }
}

export async function ensureRuntimeDir({ root = tmpdir(), uid = process.getuid?.() } = {}) {
  const effectiveUid = Number.isInteger(uid) ? uid : 0;
  const path = join(root, `${RUNTIME_DIR_PREFIX}${effectiveUid}`);
  const isWindows = process.platform === 'win32';
  try {
    await mkdir(path, isWindows ? {} : { mode: 0o700 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  const stat = await lstat(path);
  validatePrivateDirectoryStat(stat, uid);
  if (!isWindows) await chmod(path, 0o700);
  return path;
}

export function socketPathForInstance(runtimeDir, cliInstanceId, { platform = process.platform } = {}) {
  const hash = runtimeInstanceHash(cliInstanceId);
  if (platform === 'win32') return `${WINDOWS_PIPE_PREFIX}${hash}`;
  const path = join(runtimeDir, `${hash}${SOCKET_SUFFIX}`);
  const maxBytes = platform === 'darwin' ? DARWIN_UNIX_SOCKET_PATH_MAX_BYTES : LINUX_UNIX_SOCKET_PATH_MAX_BYTES;
  if (Buffer.byteLength(path, 'utf8') > maxBytes) {
    throw errorWithCode('socket_path_too_long', 'CLI Unix socket path exceeds the platform limit');
  }
  return path;
}

export function isWindowsNamedPipeEndpoint(endpoint) {
  const value = String(endpoint || '');
  return value.startsWith('\\\\.\\pipe\\') || value.startsWith('\\\\?\\pipe\\');
}

export function registryPathForInstance(runtimeDir, cliInstanceId) {
  return join(runtimeDir, `${runtimeInstanceHash(cliInstanceId)}${REGISTRY_SUFFIX}`);
}

export function createProcessNonce() {
  return randomUUID();
}

export async function readRegistryEntry(path) {
  const raw = await readFile(path, 'utf8');
  const entry = JSON.parse(raw);
  if (!entry || typeof entry !== 'object') throw errorWithCode('registry_invalid', 'Invalid CLI registry entry');
  if (!String(entry.cliInstanceId || '').trim() || !String(entry.endpoint || '').trim()) {
    throw errorWithCode('registry_invalid', 'Invalid CLI registry entry');
  }
  return entry;
}

export async function writeRegistryEntry(path, entry) {
  const payload = `${JSON.stringify(entry)}\n`;
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const isWindows = process.platform === 'win32';
  try {
    await writeFile(tempPath, payload, { encoding: 'utf8', ...(isWindows ? {} : { mode: 0o600 }), flag: 'wx' });
    if (!isWindows) await chmod(tempPath, 0o600);
    await rename(tempPath, path);
    if (!isWindows) await chmod(path, 0o600);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

export async function removeRegistryEntryIfOwned(path, processNonce) {
  try {
    const current = await readRegistryEntry(path);
    if (String(current.processNonce || '') !== String(processNonce || '')) return false;
    await unlink(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    if (error?.code === 'registry_invalid' || error instanceof SyntaxError) return false;
    throw error;
  }
}

export async function removeFileIfExists(path) {
  try {
    await unlink(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function listRegistryRecords({ root = tmpdir(), uid = process.getuid?.() } = {}) {
  const runtimeDir = await ensureRuntimeDir({ root, uid });
  const names = await readdir(runtimeDir);
  const records = [];
  for (const name of names.sort()) {
    if (!name.endsWith(REGISTRY_SUFFIX)) continue;
    const path = join(runtimeDir, name);
    try {
      const entry = await readRegistryEntry(path);
      records.push({ path, entry, error: null });
    } catch (error) {
      records.push({ path, entry: null, error: String(error?.message || error || 'invalid registry') });
    }
  }
  return { runtimeDir, records };
}

export function isRegistryPathForInstance(path, cliInstanceId) {
  return basename(path) === `${runtimeInstanceHash(cliInstanceId)}${REGISTRY_SUFFIX}`;
}
