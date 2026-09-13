import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import process from 'node:process';

import { resolveCliSupportPaths } from './install.mjs';

function configDir(options = {}) {
  return resolveCliSupportPaths(options).supportDir;
}

function configPath(options = {}) {
  const support = resolveCliSupportPaths(options);
  const path = (options.platform || process.platform) === 'win32' ? win32 : posix;
  return path.resolve(support.supportDir, 'config.json');
}

async function ensureConfigDir(options = {}) {
  const platform = options.platform || process.platform;
  const path = configDir(options);
  await mkdir(path, { recursive: true, ...(platform === 'win32' ? {} : { mode: 0o700 }) });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('CLI config path must be a real directory');
  const uid = options.uid ?? process.getuid?.();
  if (platform !== 'win32' && Number.isInteger(uid) && Number(stat.uid) !== Number(uid)) {
    throw new Error('CLI config directory has the wrong owner');
  }
  if (platform !== 'win32') await chmod(path, 0o700);
  return path;
}

export async function readUserConfig(options = {}) {
  const path = configPath(options);
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return {
      preferredCliInstanceId: String(parsed?.preferredCliInstanceId || '').trim() || null,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { preferredCliInstanceId: null };
    if (error instanceof SyntaxError) throw new Error('Invalid SyncNos CLI config');
    throw error;
  }
}

export async function writeUserConfig(config, options = {}) {
  const platform = options.platform || process.platform;
  await ensureConfigDir(options);
  const path = configPath(options);
  const preferredCliInstanceId = String(config?.preferredCliInstanceId || '').trim() || null;
  const payload = `${JSON.stringify({ preferredCliInstanceId }, null, 2)}\n`;
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, payload, {
      encoding: 'utf8',
      ...(platform === 'win32' ? {} : { mode: 0o600 }),
      flag: 'wx',
    });
    if (platform !== 'win32') await chmod(temp, 0o600);
    await rename(temp, path);
    if (platform !== 'win32') await chmod(path, 0o600);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
  return { preferredCliInstanceId };
}

export async function setPreferredInstance(cliInstanceId, options) {
  const value = String(cliInstanceId || '').trim();
  if (!value) throw new Error('CLI instance id is required');
  return await writeUserConfig({ preferredCliInstanceId: value }, options);
}

export async function clearPreferredInstance(options) {
  return await writeUserConfig({ preferredCliInstanceId: null }, options);
}

export const userConfigPaths = { configDir, configPath };
