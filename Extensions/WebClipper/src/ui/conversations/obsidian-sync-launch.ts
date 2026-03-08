import {
  getObsidianConnectionConfig as getDefaultObsidianConnectionConfig,
} from '../../sync/obsidian/settings-store';
import {
  createClient as createDefaultObsidianClient,
} from '../../sync/obsidian/obsidian-local-rest-client';
import {
  launchObsidianApp,
  OBSIDIAN_APP_LAUNCH_URL,
  isLocalObsidianApiBaseUrl,
} from '../../sync/obsidian/obsidian-app-launch';
import { DEFAULT_OBSIDIAN_OPEN_RETRY_POLICY, waitForDelay } from './detail-header-obsidian-target';

type ObsidianSyncLaunchServices = {
  settingsStore: {
    getConnectionConfig: typeof getDefaultObsidianConnectionConfig;
  };
  localRestClient: {
    createClient: typeof createDefaultObsidianClient;
  };
};

type ObsidianSyncLaunchPort = {
  launchProtocolUrl: (url: string) => Promise<boolean>;
  wait: (ms: number) => Promise<void>;
};

export type PrimeObsidianAppForSyncResult = {
  launched: boolean;
  waited: boolean;
  reason:
    | 'skipped'
    | 'already_reachable'
    | 'launch_and_wait'
    | 'launch_failed'
    | 'probe_failed_without_launch';
};

const defaultServices: ObsidianSyncLaunchServices = {
  settingsStore: {
    getConnectionConfig: getDefaultObsidianConnectionConfig,
  },
  localRestClient: {
    createClient: createDefaultObsidianClient,
  },
};

const defaultPort: ObsidianSyncLaunchPort = {
  launchProtocolUrl: launchObsidianApp,
  wait: waitForDelay,
};

function safeString(value: unknown) {
  return String(value == null ? '' : value).trim();
}

export async function primeObsidianAppForSync({
  services = defaultServices,
  port = defaultPort,
}: {
  services?: ObsidianSyncLaunchServices;
  port?: ObsidianSyncLaunchPort;
} = {}): Promise<PrimeObsidianAppForSyncResult> {
  const connectionConfig = await services.settingsStore.getConnectionConfig();
  if (!safeString(connectionConfig?.apiKey) || !isLocalObsidianApiBaseUrl(connectionConfig?.apiBaseUrl)) {
    return { launched: false, waited: false, reason: 'skipped' };
  }

  // We cannot synchronously probe a local REST server and still preserve the click gesture.
  // Prime the app launch immediately, then decide whether a startup wait is actually needed.
  const launchPromise = Promise.resolve(port.launchProtocolUrl(OBSIDIAN_APP_LAUNCH_URL)).catch(() => false);

  const client = services.localRestClient.createClient(connectionConfig);
  if (!client || client.ok === false || typeof client.getServerStatus !== 'function') {
    const launched = await launchPromise;
    if (!launched) return { launched: false, waited: false, reason: 'launch_failed' };
    await port.wait(DEFAULT_OBSIDIAN_OPEN_RETRY_POLICY.launchDelayMs);
    return { launched: true, waited: true, reason: 'launch_and_wait' };
  }

  const status = await client.getServerStatus().catch((error: unknown) => ({
    ok: false,
    error: {
      code: 'network_error',
      message: error instanceof Error ? error.message : String(error || 'connection failed'),
    },
  }));
  if (status?.ok) {
    return { launched: false, waited: false, reason: 'already_reachable' };
  }

  if (safeString(status?.error?.code) !== 'network_error') {
    return { launched: false, waited: false, reason: 'probe_failed_without_launch' };
  }

  const launched = await launchPromise;
  if (!launched) return { launched: false, waited: false, reason: 'launch_failed' };

  await port.wait(DEFAULT_OBSIDIAN_OPEN_RETRY_POLICY.launchDelayMs);
  return { launched: true, waited: true, reason: 'launch_and_wait' };
}
