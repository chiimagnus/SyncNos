#!/usr/bin/env node

import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { contract } from './contract.mjs';
import { requestEndpoint } from './ipc.mjs';
import {
  isRegistryPathForInstance,
  listRegistryRecords,
  removeFileIfExists,
  removeRegistryEntryIfOwned,
  socketPathForInstance,
} from './runtime-registry.mjs';
import { clearPreferredInstance, readUserConfig, setPreferredInstance } from './user-config.mjs';

const EXIT = Object.freeze({ success: 0, usage: 2, instance: 3, transport: 4, business: 5 });
const DEFAULT_PING_TIMEOUT_MS = 750;

function envelopeOk(data) {
  return { ok: true, data, error: null };
}

function envelopeError(code, message, extra = null) {
  return { ok: false, data: null, error: { code, message, extra } };
}

function codedError(code, message, exitCode = EXIT.transport, extra = null) {
  const error = new Error(message || code);
  error.code = code;
  error.exitCode = exitCode;
  error.extra = extra;
  return error;
}

function parseArgs(argv) {
  const args = Array.from(argv || []);
  if (!args.length || args.includes('--help') || args.includes('-h')) return { command: 'help' };
  const command = args.shift();
  const options = { command, instance: null, human: false, setDefault: null, clearDefault: false };
  while (args.length) {
    const token = args.shift();
    if (token === '--instance') {
      const value = String(args.shift() || '').trim();
      if (!value) throw codedError('usage_error', '--instance requires an id', EXIT.usage);
      options.instance = value;
      continue;
    }
    if (token === '--human') {
      options.human = true;
      continue;
    }
    if (token === '--set-default') {
      const value = String(args.shift() || '').trim();
      if (!value) throw codedError('usage_error', '--set-default requires an id', EXIT.usage);
      options.setDefault = value;
      continue;
    }
    if (token === '--clear-default') {
      options.clearDefault = true;
      continue;
    }
    throw codedError('usage_error', `Unknown argument: ${token}`, EXIT.usage);
  }
  return options;
}

function isConfirmedStaleEndpointError(error) {
  return ['ENOENT', 'ECONNREFUSED'].includes(String(error?.code || ''));
}

async function cleanupStaleRecord(record, runtimeDir) {
  if (!record?.entry) {
    await removeFileIfExists(record?.path || '').catch(() => false);
    return;
  }
  const entry = record.entry;
  if (!isRegistryPathForInstance(record.path, entry.cliInstanceId)) return;
  const removed = await removeRegistryEntryIfOwned(record.path, entry.processNonce).catch(() => false);
  if (!removed) return;
  try {
    const expectedEndpoint = socketPathForInstance(runtimeDir, entry.cliInstanceId);
    if (String(entry.endpoint || '') === expectedEndpoint)
      await removeFileIfExists(expectedEndpoint).catch(() => false);
  } catch {
    // Registry is already removed; never unlink an unverified endpoint path.
  }
}

export async function discoverInstances({
  runtimeRoot,
  cleanupStale = true,
  pingTimeoutMs = DEFAULT_PING_TIMEOUT_MS,
} = {}) {
  const { runtimeDir, records } = await listRegistryRecords({ root: runtimeRoot });
  const online = [];
  const offline = [];
  const invalid = [];

  for (const record of records) {
    if (!record.entry) {
      invalid.push({ path: record.path, error: record.error || 'invalid registry' });
      if (cleanupStale) await cleanupStaleRecord(record, runtimeDir);
      continue;
    }
    const entry = record.entry;
    try {
      const ping = await requestEndpoint(
        entry.endpoint,
        { method: 'system.ping', params: {} },
        { timeoutMs: pingTimeoutMs, maxResponseBytes: contract.nativeMessaging.extensionToHostMaxBytes },
      );
      if (Number(ping?.protocolVersion) !== Number(contract.protocolVersion)) {
        offline.push({ entry, reason: 'protocol_mismatch', response: ping });
        continue;
      }
      if (ping?.ok !== true) {
        offline.push({ entry, reason: String(ping?.error?.code || 'extension_ping_failed'), response: ping });
        continue;
      }
      if (String(ping?.data?.cliInstanceId || '') !== String(entry.cliInstanceId || '')) {
        offline.push({ entry, reason: 'instance_identity_mismatch', response: ping });
        continue;
      }
      online.push({ entry, ping: ping.data });
    } catch (error) {
      offline.push({
        entry,
        reason: String(error?.code || 'endpoint_unreachable'),
        error: String(error?.message || error),
      });
      if (cleanupStale && isConfirmedStaleEndpointError(error)) await cleanupStaleRecord(record, runtimeDir);
    }
  }

  return { runtimeDir, online, offline, invalid };
}

export function selectInstance(online, { explicitId = null, preferredId = null } = {}) {
  const instances = Array.isArray(online) ? online : [];
  const byId = new Map(instances.map((item) => [String(item?.entry?.cliInstanceId || ''), item]));
  const explicit = String(explicitId || '').trim();
  if (explicit) {
    const selected = byId.get(explicit);
    if (!selected)
      throw codedError('instance_offline', `Requested SyncNos instance is not online: ${explicit}`, EXIT.instance);
    return selected;
  }

  const preferred = String(preferredId || '').trim();
  if (preferred && byId.has(preferred)) return byId.get(preferred);
  if (instances.length === 1) return instances[0];
  if (instances.length === 0) {
    throw codedError('extension_unreachable', 'No online SyncNos browser instance is available', EXIT.transport);
  }
  throw codedError(
    'instance_ambiguous',
    'Multiple SyncNos instances are online; choose one or set a default',
    EXIT.instance,
    { candidates: instances.map((item) => item.entry.cliInstanceId) },
  );
}

async function selectedInstance(options, context) {
  const [discovery, config] = await Promise.all([
    discoverInstances({ runtimeRoot: context.runtimeRoot, cleanupStale: true }),
    readUserConfig({ homeDir: context.homeDir }),
  ]);
  const selected = selectInstance(discovery.online, {
    explicitId: options.instance,
    preferredId: config.preferredCliInstanceId,
  });
  return { selected, discovery, config };
}

const TRANSPORT_RESPONSE_CODES = new Set([
  'transport_error',
  'protocol_mismatch',
  'native_host_closed',
  'native_host_not_ready',
  'request_too_large',
  'response_too_large',
  'ipc_error',
  'ipc_timeout',
  'ipc_truncated',
  'ipc_message_too_large',
]);

async function requestSelected(selected, method, params = {}) {
  const response = await requestEndpoint(
    selected.entry.endpoint,
    { method, params },
    { maxResponseBytes: contract.nativeMessaging.extensionToHostMaxBytes },
  );
  if (Number(response?.protocolVersion) !== Number(contract.protocolVersion)) {
    throw codedError('protocol_mismatch', 'CLI protocol version mismatch', EXIT.transport);
  }
  if (response?.ok !== true) {
    const code = String(response?.error?.code || 'business_error');
    throw codedError(
      code,
      String(response?.error?.message || 'SyncNos request failed'),
      TRANSPORT_RESPONSE_CODES.has(code) ? EXIT.transport : EXIT.business,
    );
  }
  return response.data;
}

function publicInstance(item, preferredId) {
  const entry = item.entry;
  return {
    cliInstanceId: entry.cliInstanceId,
    browserFamily: entry.browserFamily,
    extensionVersion: entry.extensionVersion,
    runtimeId: entry.runtimeId,
    protocolVersion: entry.protocolVersion,
    startedAt: entry.startedAt,
    preferred: String(preferredId || '') === String(entry.cliInstanceId || ''),
  };
}

function formatHuman(result) {
  if (!result?.ok) return `ERROR ${result?.error?.code || 'unknown'}: ${result?.error?.message || 'failed'}\n`;
  return `${JSON.stringify(result.data, null, 2)}\n`;
}

function writeResult(stream, result, human = false) {
  stream.write(human ? formatHuman(result) : `${JSON.stringify(result)}\n`);
}

function usage() {
  return [
    'Usage: syncnos <command> [options]',
    '',
    'Commands:',
    '  instances [--set-default <id> | --clear-default]',
    '  status [--instance <id>]',
    '  revision [--instance <id>]',
    '  doctor [--human]',
  ].join('\n');
}

export async function runCli(argv, { stdout = process.stdout, stderr = process.stderr, runtimeRoot, homeDir } = {}) {
  void stderr;
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    writeResult(stdout, envelopeError(error.code || 'usage_error', error.message), false);
    return error.exitCode || EXIT.usage;
  }
  if (options.command === 'help') {
    stdout.write(`${usage()}\n`);
    return EXIT.success;
  }

  const context = { runtimeRoot, homeDir };
  try {
    if (options.command === 'instances') {
      if (options.setDefault && options.clearDefault) {
        throw codedError('usage_error', '--set-default and --clear-default cannot be combined', EXIT.usage);
      }
      const discovery = await discoverInstances({ runtimeRoot, cleanupStale: true });
      let config = await readUserConfig({ homeDir });
      if (options.setDefault) {
        const match = discovery.online.find((item) => item.entry.cliInstanceId === options.setDefault);
        if (!match) throw codedError('instance_offline', 'Default instance must be online', EXIT.instance);
        config = await setPreferredInstance(options.setDefault, { homeDir });
      } else if (options.clearDefault) {
        config = await clearPreferredInstance({ homeDir });
      }
      writeResult(
        stdout,
        envelopeOk({
          preferredCliInstanceId: config.preferredCliInstanceId,
          instances: discovery.online.map((item) => publicInstance(item, config.preferredCliInstanceId)),
        }),
        options.human,
      );
      return EXIT.success;
    }

    if (options.command === 'status') {
      const { selected, config } = await selectedInstance(options, context);
      writeResult(
        stdout,
        envelopeOk({
          instance: publicInstance(selected, config.preferredCliInstanceId),
          ping: selected.ping,
        }),
        options.human,
      );
      return EXIT.success;
    }

    if (options.command === 'revision') {
      const { selected, config } = await selectedInstance(options, context);
      const revision = await requestSelected(selected, 'revision.get');
      writeResult(
        stdout,
        envelopeOk({ instance: publicInstance(selected, config.preferredCliInstanceId), revision }),
        options.human,
      );
      return EXIT.success;
    }

    if (options.command === 'doctor') {
      const [discovery, config] = await Promise.all([
        discoverInstances({ runtimeRoot, cleanupStale: false }),
        readUserConfig({ homeDir }),
      ]);
      let selection = null;
      let selectionError = null;
      try {
        selection = selectInstance(discovery.online, { preferredId: config.preferredCliInstanceId });
      } catch (error) {
        selectionError = { code: error.code || 'unknown', message: error.message };
      }
      const preferredOnline = config.preferredCliInstanceId
        ? discovery.online.some((item) => item.entry.cliInstanceId === config.preferredCliInstanceId)
        : null;
      writeResult(
        stdout,
        envelopeOk({
          healthy: !!selection,
          preferredCliInstanceId: config.preferredCliInstanceId,
          preferredOnline,
          selectedCliInstanceId: selection?.entry?.cliInstanceId || null,
          online: discovery.online.map((item) => publicInstance(item, config.preferredCliInstanceId)),
          offline: discovery.offline.map((item) => ({
            cliInstanceId: item.entry?.cliInstanceId || null,
            reason: item.reason,
          })),
          invalidRegistry: discovery.invalid,
          selectionError,
        }),
        options.human,
      );
      return EXIT.success;
    }

    throw codedError('usage_error', `Unknown command: ${options.command}`, EXIT.usage);
  } catch (error) {
    const exitCode = Number(error?.exitCode) || EXIT.transport;
    writeResult(
      stdout,
      envelopeError(
        String(error?.code || 'transport_error'),
        String(error?.message || error || 'CLI failed'),
        error?.extra ?? null,
      ),
      options.human,
    );
    return exitCode;
  }
}

const isMain = !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}

export { EXIT };
