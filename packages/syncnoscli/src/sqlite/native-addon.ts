import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, type Stats } from 'node:fs';
import { createRequire } from 'node:module';
import { posix, win32 } from 'node:path';

import { LocalDataContractError } from '@services/local-data/contracts';

export const BETTER_SQLITE3_VERSION = '13.0.3' as const;

export const BETTER_SQLITE3_PREBUILD_SHA256 = Object.freeze({
  'darwin-arm64': '98e0e8acd01c632fe5615243e1296af0372826f8783b18fc31c506f73c47459c',
  'darwin-x64': 'e6db154afe9d250e242e2ea3d45d273718ab80a0751d08873637553031752d21',
  'linux-arm64': '8ba771f284dfd9430e3ef8e2ffc373ed7cc5a92fc7c4c0c7baf39dd672863485',
  'linux-x64': '6fd4292c6c5f352436cd85c9e1cb286978efa43c20ae350973f83414ced9991d',
  'linuxmusl-arm64': '09d5927246024b6d93c079ae1079554cbdd85790792342bf24636987dce7a786',
  'linuxmusl-x64': 'd661495d2dd4a026ccda893dd8ea1e2c245c3a681bd28224064953c8a9cc0a72',
  'win32-arm64': 'a47870d114b98baecaff0baa51cfb93d6280d43f064280adaadefafb6949f1bf',
  'win32-x64': 'e21e5efd71fba66578e95b62554d9028064a80dafd7221bf8a8ef155de8d240a',
} as const);

export type BetterSqlite3Target = keyof typeof BETTER_SQLITE3_PREBUILD_SHA256;
export type BetterSqlite3Constructor = typeof import('better-sqlite3');

type NativeAddonPathApi = typeof posix;
type NativeAddonFileStatus = Pick<Stats, 'isFile' | 'isSymbolicLink'>;

export type NativeAddonDependencies = Readonly<{
  arch?: string;
  lstat?: (path: string) => NativeAddonFileStatus;
  loadModule?: (specifier: string) => unknown;
  platform?: NodeJS.Platform;
  processReport?: () => unknown;
  readFile?: (path: string) => Buffer;
  realpath?: (path: string) => string;
  resolveModule?: (specifier: string) => string;
}>;

export type LoadedBetterSqlite3 = Readonly<{
  constructor: BetterSqlite3Constructor;
  packageRoot: string;
  prebuildPath: string;
  target: BetterSqlite3Target;
}>;

export class NativeAddonError extends LocalDataContractError {
  constructor() {
    super('UNSUPPORTED_PLATFORM');
    this.name = 'NativeAddonError';
  }
}

const packageRequire = createRequire(__filename);

function unsupported(): never {
  throw new NativeAddonError();
}

function pathApi(platform: NodeJS.Platform): NativeAddonPathApi {
  return platform === 'win32' ? win32 : posix;
}

function samePath(api: NativeAddonPathApi, left: string, right: string): boolean {
  return api === win32 ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function strictRecord(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    unsupported();
  }
  return value as Record<string, unknown>;
}

function nativeTarget(input: {
  arch: string;
  platform: NodeJS.Platform;
  processReport: () => unknown;
}): BetterSqlite3Target {
  if (input.arch !== 'arm64' && input.arch !== 'x64') unsupported();
  if (input.platform === 'darwin' || input.platform === 'win32') return `${input.platform}-${input.arch}`;
  if (input.platform !== 'linux') unsupported();

  let report: unknown;
  try {
    report = input.processReport();
  } catch (_error) {
    unsupported();
  }
  const header = strictRecord(strictRecord(report).header);
  const isGlibc = typeof header.glibcVersionRuntime === 'string' && header.glibcVersionRuntime.length > 0;
  return `${isGlibc ? 'linux' : 'linuxmusl'}-${input.arch}`;
}

/** Resolves the one official prebuild target without asking package main to search or compile. */
export function resolveBetterSqlite3Target(
  input: {
    arch?: string;
    platform?: NodeJS.Platform;
    processReport?: () => unknown;
  } = {},
): BetterSqlite3Target {
  return nativeTarget({
    arch: input.arch ?? process.arch,
    platform: input.platform ?? process.platform,
    processReport: input.processReport ?? (() => process.report.getReport()),
  });
}

function assertRegularFile(status: NativeAddonFileStatus): void {
  if (status.isSymbolicLink() || !status.isFile()) unsupported();
}

function packageJson(bytes: Buffer): Record<string, unknown> {
  try {
    return strictRecord(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch (_error) {
    unsupported();
  }
}

function assertPackageContract(value: Record<string, unknown>, target: BetterSqlite3Target): void {
  if (value.name !== 'better-sqlite3' || value.version !== BETTER_SQLITE3_VERSION || value.gypfile !== false)
    unsupported();
  const scripts = value.scripts === undefined ? Object.create(null) : strictRecord(value.scripts);
  if ('preinstall' in scripts || 'install' in scripts || 'postinstall' in scripts) unsupported();
  const exports = strictRecord(value.exports);
  if (exports[`./${target}`] !== `./lib/${target}.js`) unsupported();
}

function resolveDependencies(input: NativeAddonDependencies | undefined) {
  return {
    arch: input?.arch ?? process.arch,
    lstat: input?.lstat ?? lstatSync,
    loadModule: input?.loadModule ?? ((specifier: string) => packageRequire(specifier)),
    platform: input?.platform ?? process.platform,
    processReport: input?.processReport ?? (() => process.report.getReport()),
    readFile: input?.readFile ?? readFileSync,
    realpath: input?.realpath ?? realpathSync,
    resolveModule: input?.resolveModule ?? ((specifier: string) => packageRequire.resolve(specifier)),
  };
}

/**
 * Verifies the exact package and one bundled native binary before loading it.
 * There is deliberately no package-main import, compiler invocation, or source-build fallback here.
 */
export function loadBetterSqlite3(input: NativeAddonDependencies = {}): LoadedBetterSqlite3 {
  const dependencies = resolveDependencies(input);
  const target = nativeTarget(dependencies);
  const api = pathApi(dependencies.platform);
  let packageJsonPath: string;
  let packageJsonRealPath: string;
  let packageRoot: string;
  let targetModuleResolvedPath: string;
  let targetModulePath: string;
  let targetModuleRealPath: string;
  let prebuildPath: string;
  try {
    packageJsonPath = dependencies.resolveModule('better-sqlite3/package.json');
    assertRegularFile(dependencies.lstat(packageJsonPath));
    packageJsonRealPath = dependencies.realpath(packageJsonPath);
    assertRegularFile(dependencies.lstat(packageJsonRealPath));
    packageRoot = api.dirname(packageJsonRealPath);
    assertPackageContract(packageJson(dependencies.readFile(packageJsonRealPath)), target);

    targetModulePath = api.join(packageRoot, 'lib', `${target}.js`);
    targetModuleResolvedPath = dependencies.resolveModule(`better-sqlite3/${target}`);
    assertRegularFile(dependencies.lstat(targetModuleResolvedPath));
    targetModuleRealPath = dependencies.realpath(targetModuleResolvedPath);
    if (!samePath(api, targetModulePath, targetModuleRealPath)) unsupported();
    assertRegularFile(dependencies.lstat(targetModuleRealPath));

    prebuildPath = api.join(packageRoot, 'prebuilds', `${target}.node`);
    assertRegularFile(dependencies.lstat(prebuildPath));
    if (dependencies.realpath(prebuildPath) !== prebuildPath) unsupported();
    if (sha256(dependencies.readFile(prebuildPath)) !== BETTER_SQLITE3_PREBUILD_SHA256[target]) unsupported();
  } catch (error) {
    if (error instanceof NativeAddonError) throw error;
    unsupported();
  }

  let constructor: unknown;
  try {
    constructor = dependencies.loadModule(`better-sqlite3/${target}`);
  } catch (_error) {
    unsupported();
  }
  if (typeof constructor !== 'function') unsupported();
  return Object.freeze({
    constructor: constructor as BetterSqlite3Constructor,
    packageRoot: packageRoot!,
    prebuildPath: prebuildPath!,
    target,
  });
}
