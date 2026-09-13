#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { discoverInstalledBrowsers, listBrowserTargets } from './browser-targets.mjs';
import { contract } from './contract.mjs';
import {
  inspectCliInstallation,
  installNativeHost,
  installNativeHosts,
  isCliInstallPlatformSupported,
  uninstallNativeHost,
} from './install.mjs';
import { requestEndpoint } from './ipc.mjs';
import {
  isRegistryPathForInstance,
  isWindowsNamedPipeEndpoint,
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
  const options = {
    command,
    instance: null,
    human: false,
    setDefault: null,
    clearDefault: false,
    sourceKey: null,
    siteKey: null,
    limit: null,
    cursor: null,
    after: null,
    before: null,
    mergeExisting: false,
    keep: null,
    remove: null,
    text: null,
    to: null,
    provider: null,
    target: null,
    launch: false,
    noWait: false,
    timeout: null,
    output: null,
    force: false,
    browser: null,
    extensionId: null,
    positionals: [],
    provided: new Set(),
  };
  const readValue = (flag) => {
    const value = String(args.shift() || '').trim();
    if (!value) throw codedError('usage_error', `${flag} requires a value`, EXIT.usage);
    return value;
  };
  while (args.length) {
    const token = args.shift();
    if (token === '--instance') {
      options.instance = readValue(token);
      options.provided.add('instance');
      continue;
    }
    if (token === '--human') {
      options.human = true;
      options.provided.add('human');
      continue;
    }
    if (token === '--set-default') {
      options.setDefault = readValue(token);
      options.provided.add('setDefault');
      continue;
    }
    if (token === '--clear-default') {
      options.clearDefault = true;
      options.provided.add('clearDefault');
      continue;
    }
    if (token === '--source') {
      options.sourceKey = readValue(token);
      options.provided.add('sourceKey');
      continue;
    }
    if (token === '--site') {
      options.siteKey = readValue(token);
      options.provided.add('siteKey');
      continue;
    }
    if (token === '--limit') {
      options.limit = readValue(token);
      options.provided.add('limit');
      continue;
    }
    if (token === '--cursor') {
      options.cursor = readValue(token);
      options.provided.add('cursor');
      continue;
    }
    if (token === '--after') {
      options.after = readValue(token);
      options.provided.add('after');
      continue;
    }
    if (token === '--before') {
      options.before = readValue(token);
      options.provided.add('before');
      continue;
    }
    if (token === '--merge-existing') {
      options.mergeExisting = true;
      options.provided.add('mergeExisting');
      continue;
    }
    if (token === '--keep') {
      options.keep = readValue(token);
      options.provided.add('keep');
      continue;
    }
    if (token === '--remove') {
      options.remove = readValue(token);
      options.provided.add('remove');
      continue;
    }
    if (token === '--text') {
      options.text = readValue(token);
      options.provided.add('text');
      continue;
    }
    if (token === '--to') {
      options.to = readValue(token);
      options.provided.add('to');
      continue;
    }
    if (token === '--provider') {
      options.provider = readValue(token);
      options.provided.add('provider');
      continue;
    }
    if (token === '--target') {
      options.target = readValue(token);
      options.provided.add('target');
      continue;
    }
    if (token === '--launch') {
      options.launch = true;
      options.provided.add('launch');
      continue;
    }
    if (token === '--no-wait') {
      options.noWait = true;
      options.provided.add('noWait');
      continue;
    }
    if (token === '--timeout') {
      options.timeout = readValue(token);
      options.provided.add('timeout');
      continue;
    }
    if (token === '--output') {
      options.output = readValue(token);
      options.provided.add('output');
      continue;
    }
    if (token === '--force') {
      options.force = true;
      options.provided.add('force');
      continue;
    }
    if (token === '--browser') {
      options.browser = readValue(token);
      options.provided.add('browser');
      continue;
    }
    if (token === '--extension-id') {
      options.extensionId = readValue(token);
      options.provided.add('extensionId');
      continue;
    }
    if (String(token || '').startsWith('--')) throw codedError('usage_error', `Unknown argument: ${token}`, EXIT.usage);
    options.positionals.push(String(token));
  }
  return options;
}

function assertAllowedOptions(options, allowed) {
  for (const key of options.provided || []) {
    if (!allowed.has(key))
      throw codedError('usage_error', `Option is not valid for ${options.command}: ${key}`, EXIT.usage);
  }
}

function parsePositiveInteger(value, label, { max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw codedError('usage_error', `${label} must be a positive integer`, EXIT.usage);
  }
  return Math.min(number, max);
}

export function parseConversationCursorToken(value) {
  const text = String(value || '').trim();
  const parts = text.split(',');
  if (parts.length !== 2) throw codedError('usage_error', 'cursor must be <lastActivityAt>,<id>', EXIT.usage);
  const lastActivityAt = Number(parts[0]);
  const id = Number(parts[1]);
  if (!Number.isFinite(lastActivityAt) || lastActivityAt < 0 || !Number.isSafeInteger(id) || id <= 0) {
    throw codedError('usage_error', 'cursor must contain a finite timestamp and positive integer id', EXIT.usage);
  }
  return { lastActivityAt, id };
}

function formatConversationCursorToken(cursor) {
  if (!cursor) return null;
  const lastActivityAt = Number(cursor.lastActivityAt);
  const id = Number(cursor.id);
  if (!Number.isFinite(lastActivityAt) || !Number.isSafeInteger(id) || id <= 0) return null;
  return `${lastActivityAt},${id}`;
}

function parseIsoTimestamp(value, label) {
  if (value == null) return null;
  const text = String(value || '').trim();
  const timestamp = Date.parse(text);
  if (!/^\d{4}-\d{2}-\d{2}T/i.test(text) || !Number.isFinite(timestamp)) {
    throw codedError('usage_error', `${label} must be an ISO date-time`, EXIT.usage);
  }
  return timestamp;
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
    if (String(entry.endpoint || '') === expectedEndpoint && !isWindowsNamedPipeEndpoint(expectedEndpoint)) {
      await removeFileIfExists(expectedEndpoint).catch(() => false);
    }
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
    readUserConfig(context.configOptions),
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
  'native_host_client_disconnected',
  'native_host_request_cancelled',
  'request_too_large',
  'response_too_large',
  'ipc_error',
  'ipc_timeout',
  'ipc_truncated',
  'ipc_message_too_large',
  'file_transfer_timeout',
  'file_transfer_closed',
  'file_transfer_sequence',
  'file_transfer_hash_mismatch',
  'file_transfer_size_mismatch',
  'file_chunk_invalid_base64',
]);

async function requestSelected(selected, method, params = {}) {
  if (!contract.publicMethods.includes(method)) {
    throw codedError('cli_contract_method_missing', `RPC method is not declared public: ${method}`, EXIT.business);
  }
  const response = await requestEndpoint(
    selected.entry.endpoint,
    { method, params },
    { timeoutMs: 0, maxResponseBytes: contract.nativeMessaging.extensionToHostMaxBytes },
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
      response?.error?.extra ?? null,
    );
  }
  return response.data;
}

const SYNC_PROVIDERS = new Set(['notion', 'obsidian', 'feishu', 'github']);
const OPEN_TARGETS = new Set(['source', 'notion', 'obsidian', 'feishu', 'github']);

function parseOpenTarget(value) {
  const target = String(value || '')
    .trim()
    .toLowerCase();
  if (!OPEN_TARGETS.has(target)) {
    throw codedError('usage_error', 'target must be source, notion, obsidian, feishu, or github', EXIT.usage);
  }
  return target;
}

function parseSyncProvider(value, label = 'provider') {
  const provider = String(value || '')
    .trim()
    .toLowerCase();
  if (!SYNC_PROVIDERS.has(provider)) {
    throw codedError('usage_error', `${label} must be notion, obsidian, feishu, or github`, EXIT.usage);
  }
  return provider;
}

function providerConfigPatch(provider, keyInput, value) {
  const key = String(keyInput || '')
    .trim()
    .toLowerCase();
  const maps = {
    notion: {
      'parent-page-id': 'parentPageId',
      'parent-page-title': 'parentPageTitle',
      'chat-database-id': ['databaseIds', 'chat'],
      'article-database-id': ['databaseIds', 'article'],
      'video-database-id': ['databaseIds', 'video'],
    },
    feishu: {
      'client-id': 'clientId',
      'client-secret': 'clientSecret',
      'token-exchange-proxy-url': 'tokenExchangeProxyUrl',
      'chat-folder': 'chatFolder',
      'article-folder': 'articleFolder',
      'video-folder': 'videoFolder',
    },
    obsidian: {
      'api-base-url': 'apiBaseUrl',
      'api-key': 'apiKey',
      'auth-header-name': 'authHeaderName',
      'chat-folder': 'chatFolder',
      'article-folder': 'articleFolder',
      'video-folder': 'videoFolder',
    },
    github: {
      repository: 'repository',
      branch: 'branch',
    },
  };
  const target = maps[provider]?.[key];
  if (!target) throw codedError('usage_error', `Unknown ${provider} config key: ${key}`, EXIT.usage);
  if (Array.isArray(target)) return { [target[0]]: { [target[1]]: value } };
  return { [target]: value };
}

async function waitForSyncJob(selected, provider, jobId, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let observedExpectedJob = false;
  let lastObservedStatus = null;
  while (true) {
    const status = await requestSelected(selected, 'sync.status', { provider });
    lastObservedStatus = status;
    const job = status?.job && typeof status.job === 'object' ? status.job : null;
    const isExpectedJob = String(job?.id || '') === jobId;
    if (isExpectedJob) observedExpectedJob = true;

    if (isExpectedJob && status?.active === false) {
      if (job?.status === 'done') return status;
      if (job?.status === 'aborted') {
        throw codedError('sync_aborted', 'Sync job was aborted', EXIT.business, { provider, jobId, status });
      }
    }

    if (status?.active === false && !observedExpectedJob) {
      throw codedError('sync_start_failed', 'Accepted sync job never became durable', EXIT.business, {
        provider,
        jobId,
        lastObservedStatus,
      });
    }

    if (Date.now() >= deadline) {
      throw codedError('sync_wait_timeout', 'Timed out waiting for sync job', EXIT.business, {
        provider,
        jobId,
        lastObservedStatus,
      });
    }
    await sleep(250);
  }
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

export function diagnoseDoctorState({ installation, discovery, selection, selectionError }) {
  if (selection) {
    return { code: 'ok', message: 'A SyncNos browser instance is online.', candidateReasons: [] };
  }
  if (selectionError?.code === 'instance_ambiguous') {
    return {
      code: 'instance_ambiguous',
      message: 'Multiple SyncNos instances are online; choose one or set a default.',
      candidateReasons: [],
    };
  }
  const protocolMismatch = discovery?.offline?.find((item) => item?.reason === 'protocol_mismatch');
  if (protocolMismatch) {
    return {
      code: 'protocol_mismatch',
      message: 'A SyncNos endpoint is present but uses a different CLI protocol version.',
      candidateReasons: [],
    };
  }
  if (!installation?.platformSupported) {
    return {
      code: 'unsupported_platform',
      message: 'SyncNos CLI Native Messaging installation is supported on macOS, Windows, and Linux.',
      candidateReasons: [],
    };
  }
  const packageReady =
    installation?.package?.packagePresent === true &&
    installation?.package?.nodeExecutable === true &&
    installation?.package?.nativeHostPresent === true;
  if (!packageReady) {
    return {
      code: 'package_invalid',
      message: 'The installed SyncNos CLI package or Node/native-host runtime is incomplete.',
      candidateReasons: [],
    };
  }
  const validRegistrations = (installation?.registrations || []).filter((item) => item.present && item.valid);
  const anyRegistrationPresent = (installation?.registrations || []).some((item) => item.present);
  if (validRegistrations.length === 0) {
    if (anyRegistrationPresent || installation?.launcher?.present) {
      return {
        code: 'native_host_install_invalid',
        message: 'SyncNos Native Messaging launcher or registration is present but invalid or stale.',
        candidateReasons: [],
      };
    }
    return {
      code: 'native_host_not_installed',
      message: 'SyncNos Native Messaging host is not installed for any supported browser.',
      candidateReasons: [],
    };
  }
  if (
    !installation?.launcher?.matchesCurrentPackage ||
    installation?.launcher?.executable !== true ||
    installation?.launcher?.modeValid !== true
  ) {
    return {
      code: 'native_host_install_invalid',
      message: 'SyncNos Native Messaging launcher is stale or not executable.',
      candidateReasons: [],
    };
  }
  return {
    code: 'extension_unreachable',
    message: 'Native Messaging is installed, but no SyncNos browser instance is currently reachable.',
    candidateReasons: [
      'browser_not_running',
      'local_cli_integration_disabled',
      'native_messaging_permission_not_granted_or_revoked',
    ],
  };
}

function formatHuman(result) {
  if (!result?.ok) return `ERROR ${result?.error?.code || 'unknown'}: ${result?.error?.message || 'failed'}\n`;
  return `${JSON.stringify(result.data, null, 2)}\n`;
}

function writeResult(stream, result, human = false) {
  stream.write(human ? formatHuman(result) : `${JSON.stringify(result)}\n`);
}

function usage(platform = process.platform) {
  const browserIds = listBrowserTargets({ platform }).join('|') || '<browser-id>';
  return [
    'Usage: syncnos <command> [options]',
    '',
    'Commands:',
    `  install [--browser ${browserIds}] [--extension-id <id>]`,
    `  uninstall [--browser ${browserIds}]`,
    '  instances [--set-default <id> | --clear-default]',
    '  status [--instance <id>]',
    '  revision [--instance <id>]',
    '  list [--source <key>] [--site <key>] [--limit <n>] [--cursor <lastActivityAt>,<id>]',
    '  get <conversation-id>',
    '  search <query> [--source <key>] [--site <key>] [--after <iso>] [--before <iso>] [--limit <n>]',
    '  stats',
    '  conversation update-url <conversation-id> <url> [--merge-existing]',
    '  conversation merge --keep <conversation-id> --remove <conversation-id>',
    '  conversation delete <conversation-id> [...]',
    '  conversation backfill-images <conversation-id>',
    '  capture',
    '  comments list <conversation-id>',
    '  comments add <conversation-id> --text <text>',
    '  comments reply <conversation-id> <parent-id> --text <text>',
    '  comments delete <comment-id>',
    '  mention search [query...] [--limit <n>]',
    '  mention build <conversation-id>',
    '  open <conversation-id> [--target source|notion|obsidian|feishu|github] [--launch]',
    '  capabilities',
    '  notion auth status|start|disconnect',
    '  notion pages list',
    '  notion config get|set <key> <value>|reset-database <chat|article|video>',
    '  feishu auth status|start|disconnect',
    '  feishu config get|set <key> <value>',
    '  obsidian config get|set <key> <value>',
    '  obsidian test',
    '  github auth status|start|poll|cancel|disconnect',
    '  github repos list',
    '  github config get|set <key> <value>',
    '  github test|init',
    '  sync <conversation-id> [...] --to notion|obsidian|feishu|github [--no-wait] [--timeout <seconds>]',
    '  sync status --provider notion|obsidian|feishu|github',
    '  settings schema',
    '  settings get [public-key]',
    '  settings set <public-key> <value>',
    '  export markdown <conversation-id> [...] --output <path> [--force]',
    '  export json <conversation-id> [...] --output <path> [--force]',
    '  backup export --output <path> [--force]',
    '  backup import <path>',
    '  doctor [--human]',
  ].join('\n');
}

export async function runCli(
  argv,
  {
    stdout = process.stdout,
    stderr = process.stderr,
    runtimeRoot,
    homeDir,
    localAppDataDir,
    xdgDataHome,
    env = process.env,
    platform = process.platform,
    nodePath = process.execPath,
    nativeHostPath,
    registryRunner,
    browserPathExists,
  } = {},
) {
  void stderr;
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    writeResult(stdout, envelopeError(error.code || 'usage_error', error.message), false);
    return error.exitCode || EXIT.usage;
  }
  if (options.command === 'help') {
    stdout.write(`${usage(platform)}\n`);
    return EXIT.success;
  }

  const configOptions = { homeDir, localAppDataDir, xdgDataHome, env, platform };
  const context = { runtimeRoot, homeDir, platform, nodePath, nativeHostPath, configOptions };
  try {
    if (options.command === 'capabilities') {
      assertAllowedOptions(options, new Set(['human']));
      if (options.positionals.length) {
        throw codedError('usage_error', 'capabilities does not accept positional arguments', EXIT.usage);
      }
      writeResult(
        stdout,
        envelopeOk({
          protocolVersion: contract.protocolVersion,
          publicMethods: contract.publicMethods,
          browserRequired: contract.browserRequired,
        }),
        options.human,
      );
      return EXIT.success;
    }

    if (options.command === 'install') {
      assertAllowedOptions(options, new Set(['browser', 'extensionId', 'human']));
      if (options.positionals.length) {
        throw codedError('usage_error', 'install does not accept positional arguments', EXIT.usage);
      }
      if (options.extensionId && !options.browser) {
        throw codedError('usage_error', '--extension-id requires an explicit --browser', EXIT.usage);
      }
      if (options.browser) {
        const installed = await installNativeHost({
          browser: options.browser,
          extensionId: options.extensionId,
          homeDir,
          localAppDataDir,
          xdgDataHome,
          env,
          platform,
          nodePath,
          registryRunner,
          ...(nativeHostPath ? { nativeHostPath } : null),
        });
        writeResult(stdout, envelopeOk(installed), options.human);
        return EXIT.success;
      }

      if (!isCliInstallPlatformSupported(platform)) {
        throw codedError('unsupported_platform', `SyncNos CLI install does not support ${platform}`, EXIT.transport);
      }
      const detectedBrowsers = await discoverInstalledBrowsers({
        platform,
        homeDir,
        localAppDataDir,
        env,
        ...(browserPathExists ? { pathExists: browserPathExists } : null),
      });
      if (!detectedBrowsers.length) {
        throw codedError('browser_not_found', 'No supported browser installation was detected', EXIT.business);
      }
      const installed = await installNativeHosts({
        browsers: detectedBrowsers,
        homeDir,
        localAppDataDir,
        xdgDataHome,
        env,
        platform,
        nodePath,
        registryRunner,
        ...(nativeHostPath ? { nativeHostPath } : null),
      });
      const detectedIds = new Set(detectedBrowsers.map((item) => item.id));
      writeResult(
        stdout,
        envelopeOk({
          detectedBrowsers,
          registeredTargets: installed.registrations,
          notDetected: listBrowserTargets({ platform }).filter((id) => !detectedIds.has(id)),
          launcherPath: installed.launcherPath,
          nativeHostPath: installed.nativeHostPath,
          nodePath: installed.nodePath,
        }),
        options.human,
      );
      return EXIT.success;
    }

    if (options.command === 'uninstall') {
      assertAllowedOptions(options, new Set(['browser', 'human']));
      if (options.positionals.length) {
        throw codedError('usage_error', 'uninstall does not accept positional arguments', EXIT.usage);
      }
      const removed = await uninstallNativeHost({
        browser: options.browser,
        homeDir,
        localAppDataDir,
        xdgDataHome,
        env,
        platform,
        registryRunner,
      });
      writeResult(stdout, envelopeOk(removed), options.human);
      return EXIT.success;
    }

    if (options.command === 'instances') {
      assertAllowedOptions(options, new Set(['setDefault', 'clearDefault', 'human']));
      if (options.positionals.length)
        throw codedError('usage_error', 'instances does not accept positional arguments', EXIT.usage);
      if (options.setDefault && options.clearDefault) {
        throw codedError('usage_error', '--set-default and --clear-default cannot be combined', EXIT.usage);
      }
      const discovery = await discoverInstances({ runtimeRoot, cleanupStale: true });
      let config = await readUserConfig(configOptions);
      if (options.setDefault) {
        const match = discovery.online.find((item) => item.entry.cliInstanceId === options.setDefault);
        if (!match) throw codedError('instance_offline', 'Default instance must be online', EXIT.instance);
        config = await setPreferredInstance(options.setDefault, configOptions);
      } else if (options.clearDefault) {
        config = await clearPreferredInstance(configOptions);
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
      assertAllowedOptions(options, new Set(['instance', 'human']));
      if (options.positionals.length)
        throw codedError('usage_error', 'status does not accept positional arguments', EXIT.usage);
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
      assertAllowedOptions(options, new Set(['instance', 'human']));
      if (options.positionals.length)
        throw codedError('usage_error', 'revision does not accept positional arguments', EXIT.usage);
      const { selected, config } = await selectedInstance(options, context);
      const revision = await requestSelected(selected, 'revision.get');
      writeResult(
        stdout,
        envelopeOk({ instance: publicInstance(selected, config.preferredCliInstanceId), revision }),
        options.human,
      );
      return EXIT.success;
    }

    if (options.command === 'list') {
      assertAllowedOptions(options, new Set(['instance', 'human', 'sourceKey', 'siteKey', 'limit', 'cursor']));
      if (options.positionals.length)
        throw codedError('usage_error', 'list does not accept positional arguments', EXIT.usage);
      const { selected } = await selectedInstance(options, context);
      const limit = options.limit == null ? undefined : parsePositiveInteger(options.limit, 'limit', { max: 200 });
      const cursor = options.cursor == null ? null : parseConversationCursorToken(options.cursor);
      const page = await requestSelected(selected, 'conversation.list', {
        sourceKey: options.sourceKey || 'all',
        siteKey: options.siteKey || 'all',
        limit,
        cursor,
      });
      writeResult(
        stdout,
        envelopeOk({
          ...page,
          cursor: formatConversationCursorToken(page?.cursor),
        }),
        options.human,
      );
      return EXIT.success;
    }

    if (options.command === 'get') {
      assertAllowedOptions(options, new Set(['instance', 'human']));
      if (options.positionals.length !== 1) {
        throw codedError('usage_error', 'get requires exactly one conversation id', EXIT.usage);
      }
      const conversationId = parsePositiveInteger(options.positionals[0], 'conversation id');
      const { selected } = await selectedInstance(options, context);
      const detail = await requestSelected(selected, 'conversation.get', { conversationId });
      writeResult(stdout, envelopeOk(detail), options.human);
      return EXIT.success;
    }

    if (options.command === 'search') {
      assertAllowedOptions(options, new Set(['instance', 'human', 'sourceKey', 'siteKey', 'limit', 'after', 'before']));
      const query = options.positionals.join(' ').trim();
      if (!query) throw codedError('usage_error', 'search requires a non-empty query', EXIT.usage);
      const limit = options.limit == null ? 20 : parsePositiveInteger(options.limit, 'limit', { max: 100 });
      const after = parseIsoTimestamp(options.after, 'after');
      const before = parseIsoTimestamp(options.before, 'before');
      if (after != null && before != null && after >= before) {
        throw codedError('usage_error', 'after must be earlier than before', EXIT.usage);
      }
      const { selected } = await selectedInstance(options, context);
      const results = await requestSelected(selected, 'conversation.search', {
        query,
        sourceKey: options.sourceKey || 'all',
        siteKey: options.siteKey || 'all',
        after,
        before,
        limit,
      });
      writeResult(stdout, envelopeOk(results), options.human);
      return EXIT.success;
    }

    if (options.command === 'conversation') {
      const action = String(options.positionals[0] || '');
      if (action === 'update-url') {
        assertAllowedOptions(options, new Set(['instance', 'human', 'mergeExisting']));
        if (options.positionals.length !== 3) {
          throw codedError('usage_error', 'conversation update-url requires a conversation id and URL', EXIT.usage);
        }
        const conversationId = parsePositiveInteger(options.positionals[1], 'conversation id');
        const url = String(options.positionals[2] || '').trim();
        if (!url) throw codedError('usage_error', 'conversation update-url requires a URL', EXIT.usage);
        const { selected } = await selectedInstance(options, context);
        const result = await requestSelected(selected, 'conversation.update-url', {
          conversationId,
          url,
          mergeExisting: options.mergeExisting === true,
        });
        writeResult(stdout, envelopeOk(result), options.human);
        return EXIT.success;
      }

      if (action === 'merge') {
        assertAllowedOptions(options, new Set(['instance', 'human', 'keep', 'remove']));
        if (options.positionals.length !== 1 || options.keep == null || options.remove == null) {
          throw codedError('usage_error', 'conversation merge requires --keep and --remove', EXIT.usage);
        }
        const keepConversationId = parsePositiveInteger(options.keep, 'keep id');
        const removeConversationId = parsePositiveInteger(options.remove, 'remove id');
        const { selected } = await selectedInstance(options, context);
        const result = await requestSelected(selected, 'conversation.merge', {
          keepConversationId,
          removeConversationId,
        });
        writeResult(stdout, envelopeOk(result), options.human);
        return EXIT.success;
      }

      if (action === 'delete') {
        assertAllowedOptions(options, new Set(['instance', 'human']));
        if (options.positionals.length < 2)
          throw codedError('usage_error', 'conversation delete requires at least one conversation id', EXIT.usage);
        const conversationIds = options.positionals
          .slice(1)
          .map((value) => parsePositiveInteger(value, 'conversation id'));
        const { selected } = await selectedInstance(options, context);
        const result = await requestSelected(selected, 'conversation.delete', { conversationIds });
        writeResult(stdout, envelopeOk(result), options.human);
        return EXIT.success;
      }

      if (action === 'backfill-images') {
        assertAllowedOptions(options, new Set(['instance', 'human']));
        if (options.positionals.length !== 2)
          throw codedError('usage_error', 'conversation backfill-images requires one conversation id', EXIT.usage);
        const conversationId = parsePositiveInteger(options.positionals[1], 'conversation id');
        const { selected } = await selectedInstance(options, context);
        const detail = await requestSelected(selected, 'conversation.get', { conversationId });
        const result = await requestSelected(selected, 'conversation.images.backfill', {
          conversationId,
          conversationUrl: String(detail?.conversation?.url || ''),
        });
        writeResult(stdout, envelopeOk(result), options.human);
        return EXIT.success;
      }

      throw codedError(
        'usage_error',
        'conversation action must be update-url, merge, delete, or backfill-images',
        EXIT.usage,
      );
    }

    if (options.command === 'capture') {
      assertAllowedOptions(options, new Set(['instance', 'human']));
      if (options.positionals.length)
        throw codedError('usage_error', 'capture does not accept positional arguments', EXIT.usage);
      const { selected } = await selectedInstance(options, context);
      const result = await requestSelected(selected, 'capture.current-page');
      writeResult(stdout, envelopeOk(result), options.human);
      return EXIT.success;
    }

    if (options.command === 'comments') {
      const action = String(options.positionals[0] || '');
      if (action === 'list') {
        assertAllowedOptions(options, new Set(['instance', 'human']));
        if (options.positionals.length !== 2)
          throw codedError('usage_error', 'comments list requires one conversation id', EXIT.usage);
        const conversationId = parsePositiveInteger(options.positionals[1], 'conversation id');
        const { selected } = await selectedInstance(options, context);
        const result = await requestSelected(selected, 'comments.list', { conversationId });
        writeResult(stdout, envelopeOk(result), options.human);
        return EXIT.success;
      }
      if (action === 'add') {
        assertAllowedOptions(options, new Set(['instance', 'human', 'text']));
        if (options.positionals.length !== 2)
          throw codedError('usage_error', 'comments add requires one conversation id and --text', EXIT.usage);
        const conversationId = parsePositiveInteger(options.positionals[1], 'conversation id');
        const text = String(options.text || '').trim();
        if (!text) throw codedError('usage_error', 'comment text is required', EXIT.usage);
        const { selected } = await selectedInstance(options, context);
        const result = await requestSelected(selected, 'comments.add', { conversationId, text });
        writeResult(stdout, envelopeOk(result), options.human);
        return EXIT.success;
      }
      if (action === 'reply') {
        assertAllowedOptions(options, new Set(['instance', 'human', 'text']));
        if (options.positionals.length !== 3) {
          throw codedError('usage_error', 'comments reply requires conversation id, parent id, and --text', EXIT.usage);
        }
        const conversationId = parsePositiveInteger(options.positionals[1], 'conversation id');
        const parentId = parsePositiveInteger(options.positionals[2], 'parent comment id');
        const text = String(options.text || '').trim();
        if (!text) throw codedError('usage_error', 'reply text is required', EXIT.usage);
        const { selected } = await selectedInstance(options, context);
        const result = await requestSelected(selected, 'comments.reply', { conversationId, parentId, text });
        writeResult(stdout, envelopeOk(result), options.human);
        return EXIT.success;
      }
      if (action === 'delete') {
        assertAllowedOptions(options, new Set(['instance', 'human']));
        if (options.positionals.length !== 2) {
          throw codedError('usage_error', 'comments delete requires one comment id', EXIT.usage);
        }
        const commentId = parsePositiveInteger(options.positionals[1], 'comment id');
        const { selected } = await selectedInstance(options, context);
        const result = await requestSelected(selected, 'comments.delete', { commentId });
        writeResult(stdout, envelopeOk(result), options.human);
        return EXIT.success;
      }
      throw codedError('usage_error', 'comments action must be list, add, reply, or delete', EXIT.usage);
    }

    if (options.command === 'mention') {
      const action = String(options.positionals[0] || '');
      if (action === 'search') {
        assertAllowedOptions(options, new Set(['instance', 'human', 'limit']));
        const query = options.positionals.slice(1).join(' ').trim();
        const limit = options.limit == null ? undefined : parsePositiveInteger(options.limit, 'limit', { max: 50 });
        const { selected } = await selectedInstance(options, context);
        const result = await requestSelected(selected, 'mention.search', { query, limit });
        writeResult(stdout, envelopeOk(result), options.human);
        return EXIT.success;
      }
      if (action === 'build') {
        assertAllowedOptions(options, new Set(['instance', 'human']));
        if (options.positionals.length !== 2)
          throw codedError('usage_error', 'mention build requires one conversation id', EXIT.usage);
        const conversationId = parsePositiveInteger(options.positionals[1], 'conversation id');
        const { selected } = await selectedInstance(options, context);
        const result = await requestSelected(selected, 'mention.build-insert-text', { conversationId });
        writeResult(stdout, envelopeOk(result), options.human);
        return EXIT.success;
      }
      throw codedError('usage_error', 'mention action must be search or build', EXIT.usage);
    }

    if (options.command === 'open') {
      assertAllowedOptions(options, new Set(['instance', 'human', 'target', 'launch']));
      if (options.positionals.length !== 1) {
        throw codedError('usage_error', 'open requires exactly one conversation id', EXIT.usage);
      }
      const conversationId = parsePositiveInteger(options.positionals[0], 'conversation id');
      const target = options.target == null ? null : parseOpenTarget(options.target);
      if (options.launch && !target) {
        throw codedError('usage_error', 'open --launch requires --target', EXIT.usage);
      }
      const { selected } = await selectedInstance(options, context);
      const result = await requestSelected(selected, options.launch ? 'open.launch' : 'open.resolve', {
        conversationId,
        ...(target ? { target } : null),
      });
      writeResult(stdout, envelopeOk(result), options.human);
      return EXIT.success;
    }

    if (options.command === 'settings') {
      assertAllowedOptions(options, new Set(['instance', 'human']));
      const action = String(options.positionals[0] || '');
      if (action === 'schema') {
        if (options.positionals.length !== 1) {
          throw codedError('usage_error', 'settings schema accepts no key', EXIT.usage);
        }
        const { selected } = await selectedInstance(options, context);
        const schema = await requestSelected(selected, 'settings.schema');
        writeResult(stdout, envelopeOk(schema), options.human);
        return EXIT.success;
      }
      if (action === 'get') {
        if (options.positionals.length > 2) {
          throw codedError('usage_error', 'settings get accepts at most one key', EXIT.usage);
        }
        const { selected } = await selectedInstance(options, context);
        const key = String(options.positionals[1] || '').trim();
        const value = await requestSelected(selected, 'settings.get', key ? { key } : {});
        writeResult(stdout, envelopeOk(value), options.human);
        return EXIT.success;
      }
      if (action === 'set') {
        if (options.positionals.length < 3) {
          throw codedError('usage_error', 'settings set requires a public key and value', EXIT.usage);
        }
        const key = String(options.positionals[1] || '').trim();
        const raw = options.positionals.slice(2).join(' ');
        const { selected } = await selectedInstance(options, context);
        const schema = await requestSelected(selected, 'settings.schema');
        const entry = Array.isArray(schema) ? schema.find((item) => String(item?.key || '') === key) : null;
        if (!entry) throw codedError('settings_unknown_key', `Unknown public setting: ${key}`, EXIT.business);
        let value = raw;
        if (entry.type === 'boolean') {
          if (raw !== 'true' && raw !== 'false') {
            throw codedError('usage_error', `${key} requires true or false`, EXIT.usage);
          }
          value = raw === 'true';
        } else if (entry.type === 'object') {
          try {
            value = JSON.parse(raw);
          } catch {
            throw codedError('usage_error', `${key} requires valid JSON`, EXIT.usage);
          }
        }
        const result = await requestSelected(selected, 'settings.set', { key, value });
        writeResult(stdout, envelopeOk(result), options.human);
        return EXIT.success;
      }
      throw codedError('usage_error', 'settings action must be schema, get, or set', EXIT.usage);
    }

    if (options.command === 'export') {
      assertAllowedOptions(options, new Set(['instance', 'human', 'output', 'force']));
      const format = String(options.positionals[0] || '')
        .trim()
        .toLowerCase();
      if (format !== 'markdown' && format !== 'json') {
        throw codedError('usage_error', 'export format must be markdown or json', EXIT.usage);
      }
      if (options.positionals.length < 2) {
        throw codedError('usage_error', `export ${format} requires at least one conversation id`, EXIT.usage);
      }
      if (!options.output) throw codedError('usage_error', 'export requires --output <path>', EXIT.usage);
      const conversationIds = options.positionals
        .slice(1)
        .map((value) => parsePositiveInteger(value, 'conversation id'));
      const { selected } = await selectedInstance(options, context);
      const result = await requestSelected(selected, `export.${format}`, {
        conversationIds,
        outputPath: resolvePath(options.output),
        force: options.force === true,
      });
      writeResult(stdout, envelopeOk(result), options.human);
      return EXIT.success;
    }

    if (options.command === 'backup') {
      const action = String(options.positionals[0] || '')
        .trim()
        .toLowerCase();
      if (action === 'export') {
        assertAllowedOptions(options, new Set(['instance', 'human', 'output', 'force']));
        if (options.positionals.length !== 1) {
          throw codedError('usage_error', 'backup export accepts no positional path', EXIT.usage);
        }
        if (!options.output) throw codedError('usage_error', 'backup export requires --output <path>', EXIT.usage);
        const { selected } = await selectedInstance(options, context);
        const result = await requestSelected(selected, 'backup.export', {
          outputPath: resolvePath(options.output),
          force: options.force === true,
        });
        writeResult(stdout, envelopeOk(result), options.human);
        return EXIT.success;
      }
      if (action === 'import') {
        assertAllowedOptions(options, new Set(['instance', 'human']));
        if (options.positionals.length !== 2) {
          throw codedError('usage_error', 'backup import requires exactly one input path', EXIT.usage);
        }
        const { selected } = await selectedInstance(options, context);
        const result = await requestSelected(selected, 'backup.import', {
          inputPath: resolvePath(options.positionals[1]),
        });
        writeResult(stdout, envelopeOk(result), options.human);
        return EXIT.success;
      }
      throw codedError('usage_error', 'backup action must be export or import', EXIT.usage);
    }

    if (
      options.command === 'notion' ||
      options.command === 'feishu' ||
      options.command === 'obsidian' ||
      options.command === 'github'
    ) {
      const provider = options.command;
      assertAllowedOptions(options, new Set(['instance', 'human']));
      const section = String(options.positionals[0] || '');
      const action = String(options.positionals[1] || '');
      let selectedPromise = null;
      const requestProvider = async (method, params = {}) => {
        selectedPromise ||= selectedInstance(options, context);
        const { selected } = await selectedPromise;
        return await requestSelected(selected, method, params);
      };

      if ((provider === 'notion' || provider === 'feishu' || provider === 'github') && section === 'auth') {
        const allowedActions =
          provider === 'github'
            ? new Set(['status', 'start', 'poll', 'cancel', 'disconnect'])
            : new Set(['status', 'start', 'disconnect']);
        if (options.positionals.length !== 2 || !allowedActions.has(action)) {
          throw codedError('usage_error', `invalid ${provider} auth action`, EXIT.usage);
        }
        const result = await requestProvider(`${provider}.auth.${action}`);
        writeResult(stdout, envelopeOk(result), options.human);
        return EXIT.success;
      }

      if (provider === 'notion' && section === 'pages' && action === 'list' && options.positionals.length === 2) {
        const result = await requestProvider('notion.pages.list');
        writeResult(stdout, envelopeOk(result), options.human);
        return EXIT.success;
      }

      if (provider === 'github' && section === 'repos' && action === 'list' && options.positionals.length === 2) {
        const result = await requestProvider('github.repos.list');
        writeResult(stdout, envelopeOk(result), options.human);
        return EXIT.success;
      }

      if (section === 'config') {
        if (action === 'get' && options.positionals.length === 2) {
          const result = await requestProvider(`${provider}.config.get`);
          writeResult(stdout, envelopeOk(result), options.human);
          return EXIT.success;
        }
        if (action === 'set' && options.positionals.length === 4) {
          const patch = providerConfigPatch(provider, options.positionals[2], options.positionals[3]);
          const result = await requestProvider(`${provider}.config.set`, patch);
          writeResult(stdout, envelopeOk(result), options.human);
          return EXIT.success;
        }
        if (
          provider === 'notion' &&
          action === 'reset-database' &&
          options.positionals.length === 3 &&
          ['chat', 'article', 'video'].includes(String(options.positionals[2] || ''))
        ) {
          const result = await requestProvider('notion.config.reset-database', { kindId: options.positionals[2] });
          writeResult(stdout, envelopeOk(result), options.human);
          return EXIT.success;
        }
        throw codedError('usage_error', `invalid ${provider} config action`, EXIT.usage);
      }

      if (provider === 'obsidian' && section === 'test' && options.positionals.length === 1) {
        const result = await requestProvider('obsidian.test');
        writeResult(stdout, envelopeOk(result), options.human);
        return EXIT.success;
      }

      if (provider === 'github' && (section === 'test' || section === 'init') && options.positionals.length === 1) {
        const result = await requestProvider(`github.${section}`);
        writeResult(stdout, envelopeOk(result), options.human);
        return EXIT.success;
      }

      throw codedError('usage_error', `invalid ${provider} command`, EXIT.usage);
    }

    if (options.command === 'sync') {
      if (String(options.positionals[0] || '') === 'status') {
        assertAllowedOptions(options, new Set(['instance', 'human', 'provider']));
        if (options.positionals.length !== 1 || !options.provider) {
          throw codedError('usage_error', 'sync status requires --provider', EXIT.usage);
        }
        const provider = parseSyncProvider(options.provider);
        const { selected } = await selectedInstance(options, context);
        const result = await requestSelected(selected, 'sync.status', { provider });
        writeResult(stdout, envelopeOk(result), options.human);
        return EXIT.success;
      }

      assertAllowedOptions(options, new Set(['instance', 'human', 'to', 'noWait', 'timeout']));
      if (!options.to || !options.positionals.length) {
        throw codedError('usage_error', 'sync requires conversation ids and --to', EXIT.usage);
      }
      const provider = parseSyncProvider(options.to, 'to');
      const conversationIds = options.positionals.map((value) => parsePositiveInteger(value, 'conversation id'));
      const timeoutSeconds =
        options.timeout == null ? 600 : parsePositiveInteger(options.timeout, 'timeout', { max: 86_400 });
      const { selected } = await selectedInstance(options, context);
      const accepted = await requestSelected(selected, 'sync.start', { provider, conversationIds });
      const jobId = String(accepted?.jobId || '').trim();
      if (accepted?.started !== true || !jobId) {
        throw codedError('sync_start_failed', 'Sync start did not return an accepted job id', EXIT.business, {
          provider,
          accepted,
        });
      }
      if (options.noWait) {
        writeResult(stdout, envelopeOk({ started: true, provider, jobId }), options.human);
        return EXIT.success;
      }
      const status = await waitForSyncJob(selected, provider, jobId, timeoutSeconds);
      writeResult(stdout, envelopeOk({ provider, jobId, ...status }), options.human);
      return EXIT.success;
    }

    if (options.command === 'stats') {
      assertAllowedOptions(options, new Set(['instance', 'human']));
      if (options.positionals.length)
        throw codedError('usage_error', 'stats does not accept positional arguments', EXIT.usage);
      const { selected } = await selectedInstance(options, context);
      const stats = await requestSelected(selected, 'conversation.stats');
      writeResult(stdout, envelopeOk(stats), options.human);
      return EXIT.success;
    }

    if (options.command === 'doctor') {
      assertAllowedOptions(options, new Set(['human']));
      if (options.positionals.length)
        throw codedError('usage_error', 'doctor does not accept positional arguments', EXIT.usage);
      const [discovery, config, installation] = await Promise.all([
        discoverInstances({ runtimeRoot, cleanupStale: false }),
        readUserConfig(configOptions),
        inspectCliInstallation({
          homeDir,
          localAppDataDir,
          xdgDataHome,
          env,
          platform,
          nodePath,
          registryRunner,
          browserPathExists,
          ...(nativeHostPath ? { nativeHostPath } : null),
        }),
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
      const diagnosis = diagnoseDoctorState({ installation, discovery, selection, selectionError });
      const installationHealthy =
        installation.platformSupported &&
        installation.package.packagePresent &&
        installation.package.nodeExecutable &&
        installation.package.nativeHostPresent &&
        installation.launcher.matchesCurrentPackage &&
        installation.launcher.executable &&
        installation.launcher.modeValid &&
        installation.registrations.some((item) => item.present && item.valid);
      writeResult(
        stdout,
        envelopeOk({
          healthy: diagnosis.code === 'ok',
          diagnosis,
          installationHealthy,
          installation,
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

function isMainModule(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return pathToFileURL(process.argv[1]).href === metaUrl;
  }
}

if (isMainModule(import.meta.url)) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}

export { EXIT };
