import { randomUUID } from 'node:crypto';
import { posix, win32 } from 'node:path';

import {
  LOCAL_DATA_PROTOCOL_VERSION,
  MAX_NATIVE_IMAGE_SLICE_BYTES,
  LocalDataContractError,
  getStreamByteLimit,
  isNativeHostSessionCompleteControl,
  parseNativeHostSessionCompleteControl,
  type LocalDataStreamOperation,
  type HostFactsRequest,
} from '@services/local-data/contracts';
import { nativeHostContract } from '@services/local-data/native-host-contract';
import { OrderedFrameDigestAccumulator } from '@services/local-data/digest';
import { encodeCanonicalJson } from '@services/local-data/facts-archive';
import { createNativeWireDataFrame } from '@services/local-data/native-wire';

import {
  createStagedFactsImporter,
  type FactsArchiveImportResult,
  type HostImportStagingOwner,
  type StagedFactsImporter,
} from '../sqlite/archive-import';
import type { SyncNosSqliteDatabase } from '../sqlite/schema';
import { nodeDigestProvider } from '../runtime/node-digest';
import { writeNativeMessage, type NativeMessagingOutput } from './stdio';

export type NativeHostLaunchPlatform = 'darwin' | 'linux' | 'win32';

export type NativeHostLaunchIdentity = Readonly<{
  browser: 'chrome' | 'edge' | 'firefox';
  firefoxManifestPath?: string;
}>;

export type NativeHostLaunchDependencies = Readonly<{
  /** P2-T10 supplies this with registrar sidecar ownership verification. */
  isOwnedFirefoxManifest?: (path: string) => boolean | Promise<boolean>;
}>;

export class NativeHostLaunchError extends Error {
  constructor(readonly code: 'INVALID_LAUNCH' | 'UNSUPPORTED_PLATFORM') {
    super('This process was not started by an allowed SyncNos browser registration.');
    this.name = 'NativeHostLaunchError';
  }
}

function launchFailure(code: NativeHostLaunchError['code'] = 'INVALID_LAUNCH'): never {
  throw new NativeHostLaunchError(code);
}

function pathApi(platform: NativeHostLaunchPlatform): typeof posix {
  return platform === 'win32' ? win32 : posix;
}

function isSupportedPlatform(value: NodeJS.Platform): value is NativeHostLaunchPlatform {
  return value === 'darwin' || value === 'linux' || value === 'win32';
}

function exactChromiumLaunch(argv: readonly string[], origin: string, platform: NativeHostLaunchPlatform): boolean {
  if (platform === 'win32') {
    return argv.length === 2 && argv[0] === origin && /^--parent-window=(?:0|[1-9][0-9]*)$/.test(argv[1] ?? '');
  }
  return argv.length === 1 && argv[0] === origin;
}

/**
 * Authenticates the browser launch before stdin is even inspected. Chromium is bound
 * to its canonical origin; Firefox additionally needs its P2-T10 registrar proof.
 */
export async function validateNativeHostLaunch(
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
  dependencies: NativeHostLaunchDependencies = {},
): Promise<NativeHostLaunchIdentity> {
  if (!isSupportedPlatform(platform)) launchFailure('UNSUPPORTED_PLATFORM');
  if (!Array.isArray(argv) || argv.some((value) => typeof value !== 'string')) launchFailure();

  if (exactChromiumLaunch(argv, nativeHostContract.browsers.chrome.origin, platform)) {
    return Object.freeze({ browser: 'chrome' });
  }
  if (exactChromiumLaunch(argv, nativeHostContract.browsers.edge.origin, platform)) {
    return Object.freeze({ browser: 'edge' });
  }

  if (argv.length !== 2 || argv[1] !== nativeHostContract.browsers.firefox.geckoId) launchFailure();
  const manifestPath = argv[0] ?? '';
  const api = pathApi(platform);
  if (!api.isAbsolute(manifestPath) || api.resolve(manifestPath) !== manifestPath) launchFailure();
  if (!(await dependencies.isOwnedFirefoxManifest?.(manifestPath))) launchFailure();
  return Object.freeze({ browser: 'firefox', firefoxManifestPath: manifestPath });
}

function streamTooLarge(operation: LocalDataStreamOperation, actualBytes: number): never {
  throw new LocalDataContractError('PAYLOAD_TOO_LARGE', {
    actualBytes,
    declaredBytes: actualBytes,
    limitBytes: getStreamByteLimit(operation),
    operation,
  });
}

/** Streams one bounded Host result as P1 NativeWire frames and then terminates the port direction. */
export async function writeNativeHostByteStream(
  input: Readonly<{
    bytes: Uint8Array;
    operation: LocalDataStreamOperation;
    output: NativeMessagingOutput;
  }>,
): Promise<void> {
  if (!(input.bytes instanceof Uint8Array)) throw new LocalDataContractError('INVALID_ARGUMENT');
  if (input.bytes.byteLength > getStreamByteLimit(input.operation)) {
    streamTooLarge(input.operation, input.bytes.byteLength);
  }
  const sessionId = randomUUID();
  let sequence = 0;
  const digest = await OrderedFrameDigestAccumulator.create(nodeDigestProvider);
  await writeNativeMessage(input.output, {
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    sessionId,
    sequence: sequence++,
    type: 'begin',
    operation: input.operation,
    declaredTotalBytes: input.bytes.byteLength,
  });
  for (let offset = 0; offset < input.bytes.byteLength; offset += MAX_NATIVE_IMAGE_SLICE_BYTES) {
    const frame = await createNativeWireDataFrame({
      bytes: input.bytes.subarray(offset, offset + MAX_NATIVE_IMAGE_SLICE_BYTES),
      offset,
      provider: nodeDigestProvider,
      sequence: sequence++,
      sessionId,
    });
    await digest.append({ sequence: frame.sequence, byteLength: frame.byteLength, digest: frame.sliceDigest });
    await writeNativeMessage(input.output, frame);
  }
  await writeNativeMessage(input.output, {
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    sessionId,
    sequence: sequence++,
    type: 'end',
    digest: digest.finalize(),
  });
  await writeNativeMessage(input.output, {
    protocolVersion: LOCAL_DATA_PROTOCOL_VERSION,
    sessionId,
    sequence,
    type: 'terminal',
    status: 'ok',
  });
}

/** Encodes one bounded Host result before its response header declares the exact byte count. */
export function encodeNativeHostJson(value: unknown): Uint8Array {
  try {
    return encodeCanonicalJson(value).bytes;
  } catch (_error) {
    throw new LocalDataContractError('INVALID_ARGUMENT');
  }
}

export type NativeHostImportSession = Readonly<{
  accept: (value: unknown) => Promise<NativeHostImportSessionEvent>;
  cleanup: () => void;
}>;

export type NativeHostImportSessionEvent =
  | Readonly<{ kind: 'continue' }>
  | Readonly<{ kind: 'complete'; result: FactsArchiveImportResult }>;

export type CreateNativeHostImportSessionInput = Readonly<{
  createImporter?: (
    input: Readonly<{ database: SyncNosSqliteDatabase; owner?: HostImportStagingOwner; request: unknown }>,
  ) => Promise<StagedFactsImporter>;
  database: SyncNosSqliteDatabase;
  owner?: HostImportStagingOwner;
  request: HostFactsRequest;
}>;

/**
 * Keeps only one P1 migration importer alive for one connected Native Messaging port.
 * EOF, cancellation, malformed frames, and SIGTERM all call cleanup through the Host's
 * enclosing finally block.
 */
export async function createNativeHostImportSession(
  input: CreateNativeHostImportSessionInput,
): Promise<NativeHostImportSession> {
  if (input.request.command !== 'IMPORT_FACTS') throw new LocalDataContractError('INVALID_ARGUMENT');
  const importer = await (input.createImporter ?? createStagedFactsImporter)({
    database: input.database,
    owner: input.owner ?? Object.freeze({ processId: process.pid, token: randomUUID() }),
    request: input.request.payload,
  });
  let terminal = false;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    importer.cleanup();
  };

  return Object.freeze({
    accept: async (value) => {
      if (terminal) throw new LocalDataContractError('MIGRATION_VALIDATION_FAILED');
      try {
        if (!isNativeHostSessionCompleteControl(value)) {
          await importer.acceptFrame(value);
          return Object.freeze({ kind: 'continue' as const });
        }
        const control = parseNativeHostSessionCompleteControl(value);
        const result = await importer.complete(control.manifest);
        terminal = true;
        return Object.freeze({ kind: 'complete' as const, result });
      } catch (error) {
        terminal = true;
        cleanup();
        throw error;
      }
    },
    cleanup: () => {
      terminal = true;
      cleanup();
    },
  });
}
