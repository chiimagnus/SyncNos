import {
  LocalDataContractError,
  createHostFactsFailure,
  createHostFactsSuccess,
  hostFactsCommandRequiresConnectedSession,
  parseNativeHostStreamResponseData,
  parseHostFactsRequest,
  type HostFactsRequest,
  type LocalDataErrorCode,
} from '@services/local-data/contracts';

import { isOwnedFirefoxNativeHostManifest } from '../install/host-registration';
import { cleanupStaleHostImportStaging, getFactsMigrationReceipt } from '../sqlite/archive-import';
import { openReadOnly, openReadWriteForHost, type SyncNosSqliteHandle } from '../sqlite/database';
import { readFactsRevision } from '../sqlite/revision';
import { getSqliteDatabaseUuid } from '../sqlite/schema';
import {
  isNativeHostConnectedMutationCommand,
  isNativeHostConnectedReadCommand,
  readNativeHostConnectedCommand,
  writeNativeHostConnectedCommand,
} from './dispatcher';
import {
  NativeHostLaunchError,
  createNativeHostImportSession,
  encodeNativeHostJson,
  validateNativeHostLaunch,
  writeNativeHostByteStream,
  type NativeHostLaunchDependencies,
} from './session';
import {
  NativeMessagingFramingError,
  readNativeMessages,
  writeNativeMessage,
  type NativeMessagingInput,
  type NativeMessagingOutput,
} from './stdio';

type NativeHostErrorOutput = Readonly<{
  write: (chunk: string) => boolean;
}>;

type DatabaseOpener = () => Promise<SyncNosSqliteHandle>;

export type NativeHostMainInput = Readonly<{
  argv?: readonly string[];
  isProcessAlive?: (processId: number) => boolean;
  isOwnedFirefoxManifest?: NativeHostLaunchDependencies['isOwnedFirefoxManifest'];
  openReadOnly?: DatabaseOpener;
  openReadWriteForHost?: DatabaseOpener;
  platform?: NodeJS.Platform;
  signal?: AbortSignal;
  stderr?: NativeHostErrorOutput;
  stdin?: NativeMessagingInput;
  stdout?: NativeMessagingOutput;
}>;

function writeDiagnostic(stderr: NativeHostErrorOutput, message: string): void {
  try {
    stderr.write(`${message}\n`);
  } catch (_error) {
    // A Native Host must never use stdout as a diagnostic fallback.
  }
}

function errorCode(error: unknown, session: boolean): LocalDataErrorCode {
  if (error instanceof LocalDataContractError) return error.code;
  if (error instanceof NativeMessagingFramingError) {
    if (error.code === 'FRAME_TOO_LARGE') return 'PAYLOAD_TOO_LARGE';
    return session ? 'MIGRATION_VALIDATION_FAILED' : 'INVALID_ARGUMENT';
  }
  return 'INVALID_ARGUMENT';
}

function closeHandle(handle: SyncNosSqliteHandle | null): void {
  try {
    handle?.close();
  } catch (_error) {
    // The command result/error is already determined; a closed process cannot reuse this handle.
  }
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return !(error && typeof error === 'object' && (error as { code?: unknown }).code === 'ESRCH');
  }
}

function nextMessageOrAbort(messages: AsyncIterator<unknown>, signal: AbortSignal): Promise<IteratorResult<unknown>> {
  if (signal.aborted) return Promise.reject(new LocalDataContractError('MIGRATION_VALIDATION_FAILED'));
  return new Promise<IteratorResult<unknown>>((resolve, reject) => {
    const onAbort = () => reject(new LocalDataContractError('MIGRATION_VALIDATION_FAILED'));
    signal.addEventListener('abort', onAbort, { once: true });
    void messages.next().then(
      (result) => {
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

function readSingleMessageCommand(handle: SyncNosSqliteHandle, request: HostFactsRequest): unknown {
  switch (request.command) {
    case 'GET_STATUS':
      return Object.freeze({
        databaseUuid: getSqliteDatabaseUuid(handle.database),
        factsRevision: readFactsRevision(handle.database),
        fts: handle.ftsCapability,
      });
    case 'GET_FACTS_REVISION':
      return Object.freeze({ factsRevision: readFactsRevision(handle.database) });
    case 'GET_MIGRATION_RECEIPT':
      return getFactsMigrationReceipt(handle.database, request.payload.migrationId);
    default:
      throw new LocalDataContractError('INVALID_ARGUMENT');
  }
}

async function writeHostFailure(
  stdout: NativeMessagingOutput,
  stderr: NativeHostErrorOutput,
  request: HostFactsRequest,
  error: unknown,
  session: boolean,
): Promise<void> {
  try {
    await writeNativeMessage(stdout, createHostFactsFailure(request.requestId, errorCode(error, session)));
  } catch (_writeError) {
    writeDiagnostic(stderr, 'SyncNos Native Host could not write its protocol response.');
  }
}

async function runSingleMessageCommand(
  request: HostFactsRequest,
  input: Readonly<{
    openReadOnly: DatabaseOpener;
    stderr: NativeHostErrorOutput;
    stdout: NativeMessagingOutput;
  }>,
): Promise<number> {
  let handle: SyncNosSqliteHandle | null = null;
  try {
    handle = await input.openReadOnly();
    await writeNativeMessage(
      input.stdout,
      createHostFactsSuccess(request.requestId, readSingleMessageCommand(handle, request)),
    );
    return 0;
  } catch (error) {
    await writeHostFailure(input.stdout, input.stderr, request, error, false);
    return 1;
  } finally {
    closeHandle(handle);
  }
}

async function runFactsImportSession(
  request: HostFactsRequest,
  messages: AsyncIterator<unknown>,
  input: Readonly<{
    openReadWriteForHost: DatabaseOpener;
    isProcessAlive: (processId: number) => boolean;
    signal: AbortSignal;
    stderr: NativeHostErrorOutput;
    stdout: NativeMessagingOutput;
  }>,
): Promise<number> {
  let handle: SyncNosSqliteHandle | null = null;
  let session: Awaited<ReturnType<typeof createNativeHostImportSession>> | null = null;
  try {
    handle = await input.openReadWriteForHost();
    cleanupStaleHostImportStaging(handle.database, { isProcessAlive: input.isProcessAlive });
    session = await createNativeHostImportSession({ database: handle.database, request });
    await writeNativeMessage(
      input.stdout,
      createHostFactsSuccess(request.requestId, Object.freeze({ accepted: true })),
    );

    for (;;) {
      if (input.signal.aborted) throw new LocalDataContractError('MIGRATION_VALIDATION_FAILED');
      const next = await nextMessageOrAbort(messages, input.signal);
      if (next.done) throw new LocalDataContractError('MIGRATION_VALIDATION_FAILED');
      const event = await session.accept(next.value);
      if (event.kind !== 'complete') continue;
      await writeNativeMessage(input.stdout, createHostFactsSuccess(request.requestId, event.result));
      return 0;
    }
  } catch (error) {
    await writeHostFailure(input.stdout, input.stderr, request, error, true);
    return 1;
  } finally {
    session?.cleanup();
    closeHandle(handle);
  }
}

async function runConnectedReadCommand(
  request: HostFactsRequest,
  input: Readonly<{
    openReadOnly: DatabaseOpener;
    stderr: NativeHostErrorOutput;
    stdout: NativeMessagingOutput;
  }>,
): Promise<number> {
  let handle: SyncNosSqliteHandle | null = null;
  let responseStarted = false;
  try {
    handle = await input.openReadOnly();
    const bytes = encodeNativeHostJson(readNativeHostConnectedCommand(handle.database, request));
    const stream = parseNativeHostStreamResponseData({
      stream: { operation: 'host-json', declaredTotalBytes: bytes.byteLength },
    });
    await writeNativeMessage(input.stdout, createHostFactsSuccess(request.requestId, stream));
    responseStarted = true;
    // ponytail: one bounded 64 MiB JSON buffer per read; switch to typed row streaming only if profiling finds a real limit.
    await writeNativeHostByteStream({ bytes, operation: stream.stream.operation, output: input.stdout });
    return 0;
  } catch (error) {
    if (responseStarted) {
      writeDiagnostic(input.stderr, 'SyncNos Native Host could not finish its streamed response.');
    } else {
      await writeHostFailure(input.stdout, input.stderr, request, error, true);
    }
    return 1;
  } finally {
    closeHandle(handle);
  }
}

async function runConnectedMutationCommand(
  request: HostFactsRequest,
  input: Readonly<{
    openReadWriteForHost: DatabaseOpener;
    stderr: NativeHostErrorOutput;
    stdout: NativeMessagingOutput;
  }>,
): Promise<number> {
  let handle: SyncNosSqliteHandle | null = null;
  let responseStarted = false;
  try {
    handle = await input.openReadWriteForHost();
    const bytes = encodeNativeHostJson(writeNativeHostConnectedCommand(handle.database, request));
    const stream = parseNativeHostStreamResponseData({
      stream: { operation: 'host-json', declaredTotalBytes: bytes.byteLength },
    });
    await writeNativeMessage(input.stdout, createHostFactsSuccess(request.requestId, stream));
    responseStarted = true;
    await writeNativeHostByteStream({ bytes, operation: stream.stream.operation, output: input.stdout });
    return 0;
  } catch (error) {
    if (responseStarted) {
      writeDiagnostic(input.stderr, 'SyncNos Native Host could not finish its streamed response.');
    } else {
      await writeHostFailure(input.stdout, input.stderr, request, error, true);
    }
    return 1;
  } finally {
    closeHandle(handle);
  }
}

async function runConnectedCommand(
  request: HostFactsRequest,
  messages: AsyncIterator<unknown>,
  input: Readonly<{
    openReadOnly: DatabaseOpener;
    openReadWriteForHost: DatabaseOpener;
    isProcessAlive: (processId: number) => boolean;
    signal: AbortSignal;
    stderr: NativeHostErrorOutput;
    stdout: NativeMessagingOutput;
  }>,
): Promise<number> {
  if (isNativeHostConnectedReadCommand(request.command)) {
    return await runConnectedReadCommand(request, {
      openReadOnly: input.openReadOnly,
      stderr: input.stderr,
      stdout: input.stdout,
    });
  }
  if (isNativeHostConnectedMutationCommand(request.command)) {
    return await runConnectedMutationCommand(request, {
      openReadWriteForHost: input.openReadWriteForHost,
      stderr: input.stderr,
      stdout: input.stdout,
    });
  }
  if (request.command === 'IMPORT_FACTS') return await runFactsImportSession(request, messages, input);
  await writeHostFailure(
    input.stdout,
    input.stderr,
    request,
    new LocalDataContractError('INVALID_ARGUMENT', { stage: 'connected-session-required' }),
    true,
  );
  return 1;
}

/**
 * Runs exactly one Native Messaging request or connected session. There is no server
 * loop beyond that request, and every path closes its SQLite handle before returning.
 */
export async function runNativeHost(input: NativeHostMainInput = {}): Promise<number> {
  const argv = input.argv ?? process.argv.slice(2);
  const stdin = input.stdin ?? process.stdin;
  const stdout = input.stdout ?? process.stdout;
  const stderr = input.stderr ?? process.stderr;
  const openReadOnlyConnection = input.openReadOnly ?? openReadOnly;
  const openReadWriteConnection = input.openReadWriteForHost ?? openReadWriteForHost;

  try {
    await validateNativeHostLaunch(argv, input.platform ?? process.platform, {
      isOwnedFirefoxManifest: input.isOwnedFirefoxManifest ?? isOwnedFirefoxNativeHostManifest,
    });
  } catch (error) {
    writeDiagnostic(
      stderr,
      error instanceof NativeHostLaunchError
        ? 'SyncNos Native Host rejected this browser launch.'
        : 'SyncNos Native Host could not validate this browser launch.',
    );
    return 1;
  }

  const controller = new AbortController();
  const signal = input.signal ?? controller.signal;
  const onSigterm = () => {
    controller.abort();
    // Let the pending async iterator settle so this one-shot process can reach its
    // session finally block instead of keeping an inherited stdin pipe alive.
    if (stdin === process.stdin && !process.stdin.destroyed) process.stdin.destroy();
  };
  if (!input.signal) process.once('SIGTERM', onSigterm);
  try {
    const messages = readNativeMessages(stdin)[Symbol.asyncIterator]();
    const first = await nextMessageOrAbort(messages, signal);
    if (first.done) {
      writeDiagnostic(stderr, 'SyncNos Native Host received no request.');
      return 1;
    }

    let request: HostFactsRequest;
    try {
      request = parseHostFactsRequest(first.value);
    } catch (_error) {
      writeDiagnostic(stderr, 'SyncNos Native Host rejected an invalid request.');
      return 1;
    }

    if (!hostFactsCommandRequiresConnectedSession(request.command)) {
      return await runSingleMessageCommand(request, {
        openReadOnly: openReadOnlyConnection,
        stderr,
        stdout,
      });
    }
    return await runConnectedCommand(request, messages, {
      openReadOnly: openReadOnlyConnection,
      openReadWriteForHost: openReadWriteConnection,
      isProcessAlive: input.isProcessAlive ?? isProcessAlive,
      signal,
      stderr,
      stdout,
    });
  } catch (_error) {
    writeDiagnostic(stderr, 'SyncNos Native Host rejected an invalid Native Messaging frame.');
    return 1;
  } finally {
    if (!input.signal) process.removeListener('SIGTERM', onSigterm);
  }
}

if (require.main === module) {
  void runNativeHost().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
