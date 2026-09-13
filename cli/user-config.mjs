import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

function configDir(homeDir = homedir()) {
  return join(homeDir, 'Library', 'Application Support', 'SyncNos', 'cli');
}

function configPath(homeDir = homedir()) {
  return join(configDir(homeDir), 'config.json');
}

async function ensureConfigDir(homeDir = homedir(), uid = process.getuid?.()) {
  const path = configDir(homeDir);
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('CLI config path must be a real directory');
  if (Number.isInteger(uid) && Number(stat.uid) !== Number(uid))
    throw new Error('CLI config directory has the wrong owner');
  await chmod(path, 0o700);
  return path;
}

export async function readUserConfig({ homeDir = homedir() } = {}) {
  const path = configPath(homeDir);
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

export async function writeUserConfig(config, { homeDir = homedir(), uid = process.getuid?.() } = {}) {
  const dir = await ensureConfigDir(homeDir, uid);
  const path = join(dir, 'config.json');
  const preferredCliInstanceId = String(config?.preferredCliInstanceId || '').trim() || null;
  const payload = `${JSON.stringify({ preferredCliInstanceId }, null, 2)}\n`;
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await chmod(temp, 0o600);
    await rename(temp, path);
    await chmod(path, 0o600);
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
