import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve, win32 } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LOCAL_DATA_PROTOCOL_VERSION, LOCAL_DATA_SCHEMA_VERSION } from '@services/local-data/contracts';
import { nativeHostContract } from '@services/local-data/native-host-contract';

import { getNativeHostRegistrationLocations } from '../../packages/syncnoscli/src/install/host-registration';
import { createConversationsRepository } from '../../packages/syncnoscli/src/sqlite/conversations-repository';
import { openReadWriteForHost } from '../../packages/syncnoscli/src/sqlite/database';
import { createMessagesRepository } from '../../packages/syncnoscli/src/sqlite/messages-repository';
import { resolveSyncNosRuntimePaths } from '../../packages/syncnoscli/src/runtime/paths';

const repoRoot = resolve(__dirname, '../..');
const packageRoot = resolve(repoRoot, 'packages/syncnoscli');
const emptyPackageFixture = resolve(__dirname, 'fixtures/empty-package.json');
const temporaryRoots: string[] = [];
const runPackedE2E = process.env.SYNCNOSCLI_PACKED_INSTALL_E2E === '1';
const disposableRunner = process.env.SYNCNOSCLI_DISPOSABLE_RUNNER === '1';
const runGlobalE2E = runPackedE2E && (process.platform !== 'win32' || disposableRunner);

type SqlitePrebuildTarget =
  | 'darwin-arm64'
  | 'darwin-x64'
  | 'linux-arm64'
  | 'linux-x64'
  | 'linuxmusl-arm64'
  | 'linuxmusl-x64'
  | 'win32-arm64'
  | 'win32-x64';

type ProcessResult = Readonly<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  stderrBytes: Buffer;
  stdout: string;
  stdoutBytes: Buffer;
}>;

type NpmPackResult = Readonly<{
  filename: string;
  files?: ReadonlyArray<Readonly<{ path?: string }>>;
}>;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function packageInstallRoot(prefix: string): string {
  return process.platform === 'win32'
    ? join(prefix, 'node_modules', '@chiimagnus', 'syncnoscli')
    : join(prefix, 'lib', 'node_modules', '@chiimagnus', 'syncnoscli');
}

function packageBinPath(prefix: string): string {
  return process.platform === 'win32' ? join(prefix, 'syncnoscli.cmd') : join(prefix, 'bin', 'syncnoscli');
}

function sqliteTarget(): SqlitePrebuildTarget {
  if (process.arch !== 'x64' && process.arch !== 'arm64') throw new Error(`unsupported test arch: ${process.arch}`);
  if (process.platform === 'darwin' || process.platform === 'win32') return `${process.platform}-${process.arch}`;
  if (process.platform !== 'linux') throw new Error(`unsupported test platform: ${process.platform}`);
  const report = process.report.getReport() as { header?: { glibcVersionRuntime?: unknown } };
  return `${typeof report.header?.glibcVersionRuntime === 'string' ? 'linux' : 'linuxmusl'}-${process.arch}`;
}

function npmCliPath(): string {
  const candidate = String(process.env.npm_execpath || '');
  if (!candidate || !isAbsolute(candidate)) {
    throw new Error('packed install tests must run through npm so npm_execpath is available');
  }
  return resolve(candidate);
}

function isolatedEnvironment(home: string, cache: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    npm_config_cache: cache,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    NO_UPDATE_NOTIFIER: '1',
  };
  if (process.platform === 'win32') {
    const parsed = win32.parse(home);
    environment.HOMEDRIVE = parsed.root.replace(/\\$/, '');
    environment.HOMEPATH = home.slice(parsed.root.length - 1);
  }
  return environment;
}

async function runProcess(
  file: string,
  argv: readonly string[],
  input: Readonly<{ cwd?: string; env?: NodeJS.ProcessEnv; stdin?: Uint8Array; timeoutMs?: number }> = {},
): Promise<ProcessResult> {
  return await new Promise<ProcessResult>((resolveProcess, rejectProcess) => {
    const child = spawn(file, [...argv], {
      cwd: input.cwd,
      env: input.env,
      shell: false,
      stdio: 'pipe',
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill();
      rejectProcess(new Error(`${file} timed out`));
    }, input.timeoutMs ?? 60_000);
    child.stdout.on('data', (chunk: Buffer) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(Buffer.from(chunk)));
    child.once('error', (error) => {
      clearTimeout(timeout);
      rejectProcess(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      const stdoutBytes = Buffer.concat(stdout);
      const stderrBytes = Buffer.concat(stderr);
      resolveProcess({
        code,
        signal,
        stdout: stdoutBytes.toString('utf8'),
        stdoutBytes,
        stderr: stderrBytes.toString('utf8'),
        stderrBytes,
      });
    });
    if (input.stdin) child.stdin.end(Buffer.from(input.stdin));
    else child.stdin.end();
  });
}

async function runNpm(argv: readonly string[], input: Readonly<{ cwd?: string; env?: NodeJS.ProcessEnv }> = {}) {
  return await runProcess(process.execPath, [npmCliPath(), ...argv], {
    cwd: input.cwd ?? repoRoot,
    env: input.env,
    timeoutMs: 180_000,
  });
}

async function packTarball(root: string): Promise<Readonly<{ path: string; result: NpmPackResult }>> {
  const result = await runNpm(['pack', '--workspace=@chiimagnus/syncnoscli', '--json', '--pack-destination', root]);
  expect(result, result.stderr).toMatchObject({ code: 0, signal: null });
  const packed = JSON.parse(result.stdout) as NpmPackResult[];
  expect(packed).toHaveLength(1);
  const entry = packed[0]!;
  return Object.freeze({ path: resolve(root, entry.filename), result: entry });
}

function expectNoNativeBuildLog(result: ProcessResult): void {
  expect(`${result.stdout}\n${result.stderr}`).not.toMatch(
    /node-gyp|gyp info|prebuild-install|cmake|msbuild|building from source|force_build/i,
  );
}

function parseCliJson(result: ProcessResult): any {
  expect(result.stdout.trim()).not.toBe('');
  return JSON.parse(result.stdout);
}

async function runPackedCli(packageInstallPath: string, argv: readonly string[], environment: NodeJS.ProcessEnv) {
  return await runProcess(process.execPath, [join(packageInstallPath, 'dist', 'cli.cjs'), ...argv], {
    env: environment,
    timeoutMs: 30_000,
  });
}

async function createReadonlyFixture(home: string) {
  const paths = resolveSyncNosRuntimePaths({ homeDirectory: home });
  const handle = await openReadWriteForHost({ paths });
  try {
    const conversations = createConversationsRepository(handle.database);
    const messages = createMessagesRepository(handle.database);
    const conversation = conversations.upsertConversation({
      conversationKey: 'packed-install-needle',
      lastCapturedAt: 42,
      source: 'chatgpt',
      sourceType: 'chat',
      title: 'Packed install needle',
    });
    messages.syncConversationMessages(conversation.id, [
      {
        contentText: 'Packed install needle body.',
        messageKey: 'packed-install-message',
        role: 'assistant',
        sequence: 1,
        updatedAt: 42,
      },
    ]);
  } finally {
    handle.close();
  }
  return paths;
}

async function scanPublishedPackageForRepositoryPath(installedPackageRoot: string): Promise<void> {
  const candidates = [
    'package.json',
    'README.md',
    'README.zh-CN.md',
    join('dist', 'cli.cjs'),
    join('dist', 'lifecycle.cjs'),
    join('dist', 'native-host.cjs'),
    join('prebuilds', 'manifest.json'),
  ];
  const repositoryNeedle = Buffer.from(repoRoot, 'utf8');
  for (const relative of candidates) {
    const bytes = await readFile(join(installedPackageRoot, relative));
    expect(bytes.includes(repositoryNeedle), relative).toBe(false);
  }
}

function peMachine(bytes: Buffer): number {
  expect(bytes.subarray(0, 2).toString('ascii')).toBe('MZ');
  const peOffset = bytes.readUInt32LE(0x3c);
  expect(bytes.subarray(peOffset, peOffset + 4).toString('ascii')).toBe('PE\0\0');
  return bytes.readUInt16LE(peOffset + 4);
}

async function verifyPackedWindowsPrebuilds(installedPackageRoot: string): Promise<void> {
  const manifestBytes = await readFile(join(installedPackageRoot, 'prebuilds', 'manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as {
    version: number;
    sourceSha256: string;
    artifacts: Record<string, { file: string; sha256: string }>;
  };
  expect(manifest.version).toBe(1);
  expect(Object.keys(manifest.artifacts).sort()).toEqual(['win32-arm64', 'win32-x64']);
  const expectedMachines: Record<string, number> = { 'win32-arm64': 0xaa64, 'win32-x64': 0x8664 };
  for (const name of ['win32-arm64', 'win32-x64'] as const) {
    const artifact = manifest.artifacts[name]!;
    const bytes = await readFile(join(installedPackageRoot, 'prebuilds', artifact.file));
    expect(sha256(bytes)).toBe(artifact.sha256);
    expect(peMachine(bytes)).toBe(expectedMachines[name]);
  }
}

async function verifyInstalledSqliteDependency(
  installedPackageRoot: string,
): Promise<Readonly<{ prebuildPath: string }>> {
  const sqliteRoot = join(installedPackageRoot, 'node_modules', 'better-sqlite3');
  const packageJson = JSON.parse(await readFile(join(sqliteRoot, 'package.json'), 'utf8')) as Record<string, any>;
  const target = sqliteTarget();
  expect(packageJson.version).toBe('13.0.3');
  expect(packageJson.gypfile).toBe(false);
  expect(packageJson.scripts ?? {}).not.toHaveProperty('preinstall');
  expect(packageJson.scripts ?? {}).not.toHaveProperty('install');
  expect(packageJson.scripts ?? {}).not.toHaveProperty('postinstall');
  expect(packageJson.exports?.[`./${target}`]).toBe(`./lib/${target}.js`);
  expect(packageJson.exports?.['.']).toBe('./lib/index.js');
  const prebuildPath = join(sqliteRoot, 'prebuilds', `${target}.node`);
  await expect(access(prebuildPath)).resolves.toBeUndefined();
  return Object.freeze({ prebuildPath });
}

function nativeFrame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value, null, 2), 'utf8');
  expect(body.includes(0x0a)).toBe(true);
  const frame = Buffer.allocUnsafe(body.length + 4);
  frame.writeUInt32LE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

function decodeNativeFrames(bytes: Buffer): unknown[] {
  const frames: unknown[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    expect(offset + 4).toBeLessThanOrEqual(bytes.length);
    const length = bytes.readUInt32LE(offset);
    offset += 4;
    expect(offset + length).toBeLessThanOrEqual(bytes.length);
    frames.push(JSON.parse(bytes.subarray(offset, offset + length).toString('utf8')));
    offset += length;
  }
  return frames;
}

async function runWindowsShim(paths: ReturnType<typeof resolveSyncNosRuntimePaths>): Promise<void> {
  if (process.platform !== 'win32') return;
  const result = await runProcess(
    paths.launcherPath,
    [nativeHostContract.browsers.chrome.origin, '--parent-window=0'],
    {
      stdin: nativeFrame({
        protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
        schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
        requestId: 'packed-windows-shim',
        command: 'GET_STATUS',
        payload: {},
      }),
      timeoutMs: 10_000,
    },
  );
  expect(result.stderr).toBe('');
  expect(result.signal).toBeNull();
  expect(decodeNativeFrames(result.stdoutBytes)).toMatchObject([{ ok: true, requestId: 'packed-windows-shim' }]);
}

function windowsSystemPath(relative: string): string {
  const systemRoot = String(process.env.SystemRoot || '');
  if (!systemRoot || !win32.isAbsolute(systemRoot)) throw new Error('SystemRoot is required for Windows packed E2E');
  return win32.join(systemRoot, relative);
}

async function windowsPowerShell(script: string, argument: string): Promise<string> {
  const executable = windowsSystemPath('System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  const result = await runProcess(executable, ['-NoProfile', '-NonInteractive', '-Command', script, argument]);
  expect(result, result.stderr).toMatchObject({ code: 0, signal: null });
  return result.stdout.trim();
}

async function windowsDirectorySddl(path: string): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  return await windowsPowerShell('(Get-Acl -LiteralPath $args[0]).Sddl', path);
}

async function expectWindowsHidden(path: string): Promise<void> {
  if (process.platform !== 'win32') return;
  const attributes = await windowsPowerShell('(Get-Item -LiteralPath $args[0] -Force).Attributes.ToString()', path);
  expect(attributes.split(',').map((value) => value.trim())).toContain('Hidden');
}

function windowsRegistryKeys(): string[] {
  const host = nativeHostContract.host.name;
  return [
    `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${host}`,
    `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${host}`,
    `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${host}`,
  ];
}

async function runWindowsRegistry(argv: readonly string[]): Promise<ProcessResult> {
  return await runProcess(windowsSystemPath('System32\\reg.exe'), argv);
}

async function queryWindowsRegistry(key: string, view: '32' | '64'): Promise<ProcessResult> {
  return await runWindowsRegistry(['query', key, '/ve', `/reg:${view}`]);
}

async function writeWindowsRegistrySibling(key: string): Promise<void> {
  if (process.platform !== 'win32') return;
  const result = await runWindowsRegistry([
    'add',
    key,
    '/v',
    'SyncNosPackedKeep',
    '/t',
    'REG_SZ',
    '/d',
    'keep-sibling',
    '/f',
    '/reg:64',
  ]);
  expect(result, result.stderr).toMatchObject({ code: 0, signal: null });
}

async function expectAndRemoveWindowsRegistrySibling(key: string): Promise<void> {
  if (process.platform !== 'win32') return;
  const query = await runWindowsRegistry(['query', key, '/v', 'SyncNosPackedKeep', '/reg:64']);
  expect(query, query.stderr).toMatchObject({ code: 0, signal: null });
  expect(query.stdout).toContain('keep-sibling');
  const removeValue = await runWindowsRegistry(['delete', key, '/v', 'SyncNosPackedKeep', '/f', '/reg:64']);
  expect(removeValue, removeValue.stderr).toMatchObject({ code: 0, signal: null });
  await runWindowsRegistry(['delete', key, '/f', '/reg:64']);
}

async function expectWindowsRegistryAbsent(): Promise<void> {
  if (process.platform !== 'win32') return;
  for (const key of windowsRegistryKeys()) {
    for (const view of ['32', '64'] as const) expect((await queryWindowsRegistry(key, view)).code).not.toBe(0);
  }
}

async function expectWindowsRegistryOwned(paths: ReturnType<typeof resolveSyncNosRuntimePaths>): Promise<void> {
  if (process.platform !== 'win32') return;
  const locations = getNativeHostRegistrationLocations(paths);
  for (const [index, key] of windowsRegistryKeys().entries()) {
    for (const view of ['32', '64'] as const) {
      const result = await queryWindowsRegistry(key, view);
      expect(result, result.stderr).toMatchObject({ code: 0, signal: null });
      expect(result.stdout).toContain(locations[index]!.manifestPath);
    }
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('SyncNos CLI packed install contract', () => {
  it('packs only the rebuilt release surface with both Windows PE shims', async () => {
    const root = await mkdtemp(join(tmpdir(), 'syncnoscli-pack-contract-'));
    temporaryRoots.push(root);
    const packed = await packTarball(root);
    const files = packed.result.files?.map((file) => String(file.path || '')) ?? [];
    const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as Record<string, any>;

    expect(files).toContain('dist/cli.cjs');
    expect(files).toContain('dist/lifecycle.cjs');
    expect(files).toContain('dist/native-host.cjs');
    expect(files).toContain('prebuilds/manifest.json');
    expect(files).toContain('prebuilds/win32-x64/syncnos-native-host.exe');
    expect(files).toContain('prebuilds/win32-arm64/syncnos-native-host.exe');
    expect(files.some((file) => file.startsWith('src/') || file.startsWith('tests/'))).toBe(false);
    expect(packageJson.scripts?.prepack).toBe('node build.mjs');
  });

  const packedE2E = runGlobalE2E ? it : it.skip;
  packedE2E(
    'installs the tarball locally without side effects, then exercises isolated global doctor/read-only/registration/uninstall',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'syncnoscli-packed-e2e-'));
      temporaryRoots.push(root);
      const home = join(root, 'home');
      const cache = join(root, 'npm-cache');
      const localProject = join(root, 'local-project');
      const globalPrefix = join(root, 'global-prefix');
      await Promise.all([mkdir(home, { recursive: true }), mkdir(cache, { recursive: true }), mkdir(localProject)]);
      await copyFile(emptyPackageFixture, join(localProject, 'package.json'));
      const environment = isolatedEnvironment(home, cache);
      const packed = await packTarball(root);

      if (process.platform === 'win32') await expectWindowsRegistryAbsent();
      const localInstall = await runNpm(['install', '--no-audit', '--no-fund', '--no-package-lock', packed.path], {
        cwd: localProject,
        env: environment,
      });
      expect(localInstall, localInstall.stderr).toMatchObject({ code: 0, signal: null });
      expectNoNativeBuildLog(localInstall);
      await expect(access(join(home, '.syncnoscli'))).rejects.toMatchObject({ code: 'ENOENT' });
      if (process.platform === 'win32') await expectWindowsRegistryAbsent();

      const globalInstall = await runNpm(
        ['install', '--global', '--prefix', globalPrefix, '--no-audit', '--no-fund', packed.path],
        { env: environment },
      );
      expect(globalInstall, globalInstall.stderr).toMatchObject({ code: 0, signal: null });
      expectNoNativeBuildLog(globalInstall);
      const installedPackageRoot = packageInstallRoot(globalPrefix);
      await expect(access(installedPackageRoot)).resolves.toBeUndefined();
      await expect(access(packageBinPath(globalPrefix))).resolves.toBeUndefined();
      await expect(access(join(home, '.syncnoscli'))).rejects.toMatchObject({ code: 'ENOENT' });
      await scanPublishedPackageForRepositoryPath(installedPackageRoot);
      await verifyPackedWindowsPrebuilds(installedPackageRoot);
      const sqlite = await verifyInstalledSqliteDependency(installedPackageRoot);

      const installedPackageJson = JSON.parse(await readFile(join(installedPackageRoot, 'package.json'), 'utf8')) as {
        version: string;
      };
      const version = await runPackedCli(installedPackageRoot, ['--version'], environment);
      expect(version).toMatchObject({ code: 0, signal: null });
      expect(version.stdout.trim()).toBe(installedPackageJson.version);

      const doctorBefore = await runPackedCli(installedPackageRoot, ['doctor'], environment);
      expect(doctorBefore).toMatchObject({ code: 0, signal: null });
      expect(parseCliJson(doctorBefore)).toMatchObject({
        ok: true,
        data: {
          runtime: { state: 'absent' },
          database: { state: 'not_initialized' },
          launcher: { state: 'absent' },
        },
      });

      const paths = await createReadonlyFixture(home);
      const unknownPath = join(paths.runtimeDirectory, 'keep-user-file.txt');
      await writeFile(unknownPath, 'keep-user-file', 'utf8');
      const databaseBefore = await readFile(paths.databasePath);
      const aclBefore = await windowsDirectorySddl(paths.runtimeDirectory);
      await expectWindowsHidden(paths.runtimeDirectory);

      const list = await runPackedCli(installedPackageRoot, ['conversations', 'list'], environment);
      expect(list).toMatchObject({ code: 0, signal: null });
      expect(parseCliJson(list)).toMatchObject({
        ok: true,
        data: { items: [{ conversationKey: 'packed-install-needle', title: 'Packed install needle' }] },
      });
      const search = await runPackedCli(installedPackageRoot, ['search', 'needle'], environment);
      expect(search).toMatchObject({ code: 0, signal: null });
      expect(parseCliJson(search)).toMatchObject({
        ok: true,
        data: { items: [{ conversationKey: 'packed-install-needle' }] },
      });
      await expect(readFile(paths.databasePath)).resolves.toEqual(databaseBefore);

      const prebuildBytes = await readFile(sqlite.prebuildPath);
      await writeFile(sqlite.prebuildPath, Buffer.from('tampered packed sqlite prebuild'));
      const tampered = await runPackedCli(installedPackageRoot, ['stats'], environment);
      expect(tampered.code).toBe(1);
      expect(parseCliJson(tampered)).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_PLATFORM' } });
      await writeFile(sqlite.prebuildPath, prebuildBytes);

      const missingPath = `${sqlite.prebuildPath}.missing`;
      await rename(sqlite.prebuildPath, missingPath);
      const missing = await runPackedCli(installedPackageRoot, ['stats'], environment);
      expect(missing.code).toBe(1);
      expect(parseCliJson(missing)).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_PLATFORM' } });
      await rename(missingPath, sqlite.prebuildPath);

      const doctorFix = await runPackedCli(installedPackageRoot, ['doctor', '--fix'], environment);
      expect(doctorFix).toMatchObject({ code: 0, signal: null });
      expect(parseCliJson(doctorFix)).toMatchObject({
        ok: true,
        data: { actions: expect.arrayContaining([{ name: 'native_host', status: 'repaired', reason: null }]) },
      });
      await expect(access(paths.launcherPath)).resolves.toBeUndefined();
      await expectWindowsHidden(paths.runtimeDirectory);
      expect(await windowsDirectorySddl(paths.runtimeDirectory)).toBe(aclBefore);

      const locations = getNativeHostRegistrationLocations(paths);
      if (process.platform === 'win32') {
        await expectWindowsRegistryOwned(paths);
        await writeWindowsRegistrySibling(windowsRegistryKeys()[0]!);
      } else {
        for (const location of locations) {
          await expect(access(location.manifestPath)).resolves.toBeUndefined();
          await expect(access(location.ownerPath)).resolves.toBeUndefined();
        }
      }
      await runWindowsShim(paths);

      const unregister = await runProcess(
        process.execPath,
        [join(installedPackageRoot, 'dist', 'lifecycle.cjs'), 'unregister'],
        {
          env: environment,
        },
      );
      expect(unregister, unregister.stderr).toMatchObject({ code: 0, signal: null });
      expect(unregister.stderr).toBe('');
      await expect(access(paths.launcherPath)).rejects.toMatchObject({ code: 'ENOENT' });
      if (process.platform === 'win32') {
        await expectWindowsRegistryAbsent();
        await expectAndRemoveWindowsRegistrySibling(windowsRegistryKeys()[0]!);
      } else {
        for (const location of locations) {
          await expect(access(location.manifestPath)).rejects.toMatchObject({ code: 'ENOENT' });
          await expect(access(location.ownerPath)).rejects.toMatchObject({ code: 'ENOENT' });
        }
      }
      expect(await windowsDirectorySddl(paths.runtimeDirectory)).toBe(aclBefore);

      await writeFile(paths.databaseWalPath, 'keep-wal', 'utf8');
      await writeFile(paths.databaseShmPath, 'keep-shm', 'utf8');
      const preserved = await Promise.all([
        readFile(paths.databasePath),
        readFile(paths.databaseWalPath),
        readFile(paths.databaseShmPath),
        readFile(unknownPath),
      ]);

      const uninstall = await runNpm(['uninstall', '--global', '--prefix', globalPrefix, '@chiimagnus/syncnoscli'], {
        env: environment,
      });
      expect(uninstall, uninstall.stderr).toMatchObject({ code: 0, signal: null });
      await expect(access(installedPackageRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(paths.databasePath)).resolves.toEqual(preserved[0]);
      await expect(readFile(paths.databaseWalPath)).resolves.toEqual(preserved[1]);
      await expect(readFile(paths.databaseShmPath)).resolves.toEqual(preserved[2]);
      await expect(readFile(unknownPath)).resolves.toEqual(preserved[3]);
      await expect(stat(paths.runtimeDirectory)).resolves.toMatchObject({});
      await expectWindowsHidden(paths.runtimeDirectory);
      if (process.platform === 'win32') await expectWindowsRegistryAbsent();
    },
    180_000,
  );
});
