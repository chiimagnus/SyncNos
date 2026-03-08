import type { Conversation } from '../../conversations/domain/models';
import { tabsCreate } from '../../platform/webext/tabs';
import {
  getObsidianConnectionConfig as getDefaultObsidianConnectionConfig,
  getObsidianPathConfig as getDefaultObsidianPathConfig,
} from '../../sync/obsidian/settings-store';
import {
  NOTE_JSON_ACCEPT,
  createClient as createDefaultObsidianClient,
} from '../../sync/obsidian/obsidian-local-rest-client';
import {
  buildStableNotePath as buildDefaultStableNotePath,
  resolveExistingNotePath as resolveDefaultExistingNotePath,
} from '../../sync/obsidian/obsidian-note-path';
import { readSyncnosObject as readDefaultSyncnosObject } from '../../sync/obsidian/obsidian-sync-metadata';

export const OBSIDIAN_APP_LAUNCH_URL = 'obsidian://open';
export const DEFAULT_OBSIDIAN_OPEN_RETRY_POLICY = Object.freeze({
  maxAttempts: 3,
  launchDelayMs: 1200,
  retryDelayMs: 750,
});

export type ObsidianOpenRetryPolicy = {
  maxAttempts: number;
  launchDelayMs: number;
  retryDelayMs: number;
};

export type ObsidianOpenTriggerPayload = {
  provider: 'obsidian';
  openMode: 'rest-api';
  conversation: Conversation;
  resolvedNotePath: string;
  launchBeforeRetry: boolean;
  retryPolicy: ObsidianOpenRetryPolicy;
};

export type ObsidianTargetResolution = {
  available: boolean;
  label: 'Open in Obsidian';
  trigger?: ObsidianOpenTriggerPayload;
  error?: {
    code: string;
    message: string;
  };
};

export type ObsidianDetailHeaderServices = {
  settingsStore: {
    getConnectionConfig: typeof getDefaultObsidianConnectionConfig;
    getPathConfig: typeof getDefaultObsidianPathConfig;
  };
  localRestClient: {
    NOTE_JSON_ACCEPT?: string;
    createClient: typeof createDefaultObsidianClient;
  };
  notePath: {
    buildStableNotePath: typeof buildDefaultStableNotePath;
    resolveExistingNotePath: typeof resolveDefaultExistingNotePath;
  };
  metadata: {
    readSyncnosObject: typeof readDefaultSyncnosObject;
  };
};

export type ObsidianTargetActionPort = {
  launchProtocolUrl: (url: string) => Promise<boolean>;
  wait: (ms: number) => Promise<void>;
  reportError: (message: string) => void;
};

const DEFAULT_LABEL = 'Open in Obsidian' as const;

function safeString(value: unknown) {
  return String(value == null ? '' : value).trim();
}

function buildFolderByKindId(pathConfig: Awaited<ReturnType<typeof getDefaultObsidianPathConfig>> | null | undefined) {
  if (!pathConfig) return undefined;
  return {
    chat: safeString(pathConfig.chatFolder),
    article: safeString(pathConfig.articleFolder),
  };
}

function isLocalObsidianApiBaseUrl(apiBaseUrl?: string) {
  const value = safeString(apiBaseUrl).toLowerCase();
  return value.startsWith('http://127.0.0.1:') || value.startsWith('http://localhost:');
}

function shouldLaunchObsidianApp(error: { code?: string; message?: string } | null | undefined, connectionConfig?: { apiBaseUrl?: string }) {
  return safeString(error?.code) === 'network_error' && isLocalObsidianApiBaseUrl(connectionConfig?.apiBaseUrl);
}

export async function launchObsidianApp(url: string): Promise<boolean> {
  const safeUrl = safeString(url);
  if (!safeUrl) return false;

  try {
    await tabsCreate({ url: safeUrl, active: true });
    return true;
  } catch (_error) {
    // Fall through to browser APIs when tabs.create is unavailable.
  }

  try {
    globalThis.window?.open(safeUrl, '_blank', 'noopener,noreferrer');
    return true;
  } catch (_error) {
    return false;
  }
}

export async function waitForDelay(ms: number): Promise<void> {
  const delayMs = Math.max(0, Number(ms) || 0);
  if (!delayMs) return;
  await new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}

export function reportObsidianOpenError(message: string) {
  const safeMessage = safeString(message) || 'Failed to open Obsidian note.';
  if (typeof globalThis.window?.alert === 'function') {
    globalThis.window.alert(safeMessage);
    return;
  }
  console.error(safeMessage);
}

export const defaultObsidianDetailHeaderServices: ObsidianDetailHeaderServices = {
  settingsStore: {
    getConnectionConfig: getDefaultObsidianConnectionConfig,
    getPathConfig: getDefaultObsidianPathConfig,
  },
  localRestClient: {
    NOTE_JSON_ACCEPT,
    createClient: createDefaultObsidianClient,
  },
  notePath: {
    buildStableNotePath: buildDefaultStableNotePath,
    resolveExistingNotePath: resolveDefaultExistingNotePath,
  },
  metadata: {
    readSyncnosObject: readDefaultSyncnosObject,
  },
};

export const defaultObsidianTargetActionPort: ObsidianTargetActionPort = {
  launchProtocolUrl: launchObsidianApp,
  wait: waitForDelay,
  reportError: reportObsidianOpenError,
};

async function buildClient(services: ObsidianDetailHeaderServices) {
  const connectionConfig = await services.settingsStore.getConnectionConfig();
  if (!safeString(connectionConfig?.apiKey)) {
    return {
      ok: false,
      connectionConfig,
      error: {
        code: 'missing_api_key',
        message: 'Obsidian API Key is required.',
      },
    } as const;
  }

  const client = services.localRestClient.createClient(connectionConfig);
  if (!client || client.ok === false) {
    return {
      ok: false,
      connectionConfig,
      error: client?.error || {
        code: 'invalid_client',
        message: 'Invalid Obsidian Local REST API client.',
      },
    } as const;
  }

  return {
    ok: true,
    client,
    connectionConfig,
    noteJsonAccept: safeString(services.localRestClient.NOTE_JSON_ACCEPT) || NOTE_JSON_ACCEPT,
  } as const;
}

async function openResolvedObsidianPath({
  resolvedNotePath,
  services,
}: {
  resolvedNotePath: string;
  services: ObsidianDetailHeaderServices;
}) {
  const clientRes = await buildClient(services);
  if (!clientRes.ok) {
    return {
      ok: false,
      error: clientRes.error,
    };
  }

  if (typeof clientRes.client.openVaultFile !== 'function') {
    return {
      ok: false,
      error: {
        code: 'unsupported_client',
        message: 'Obsidian client does not support opening files.',
      },
    };
  }

  const openRes = await clientRes.client.openVaultFile(resolvedNotePath);
  if (openRes?.ok) return { ok: true } as const;
  return {
    ok: false,
    error: openRes?.error || {
      code: 'http_error',
      message: 'Failed to open Obsidian note.',
    },
  } as const;
}

export async function resolveObsidianOpenTarget({
  conversation,
  services = defaultObsidianDetailHeaderServices,
}: {
  conversation: Conversation | null | undefined;
  services?: ObsidianDetailHeaderServices;
}): Promise<ObsidianTargetResolution> {
  if (!conversation) {
    return {
      available: false,
      label: DEFAULT_LABEL,
      error: {
        code: 'missing_conversation',
        message: 'Conversation is unavailable.',
      },
    };
  }

  const clientRes = await buildClient(services);
  const pathConfig = await services.settingsStore.getPathConfig();
  const folderByKindId = buildFolderByKindId(pathConfig);
  const desiredFilePath = services.notePath.buildStableNotePath(conversation, { folderByKindId });

  if (!clientRes.ok) {
    return {
      available: false,
      label: DEFAULT_LABEL,
      error: clientRes.error,
    };
  }

  const pathResolution = await services.notePath.resolveExistingNotePath({
    conversation,
    client: clientRes.client,
    noteJsonAccept: clientRes.noteJsonAccept,
    folderByKindId,
    readSyncnosObject: services.metadata.readSyncnosObject,
  });

  if (pathResolution.ok && pathResolution.found && safeString(pathResolution.resolvedFilePath)) {
    return {
      available: true,
      label: DEFAULT_LABEL,
      trigger: {
        provider: 'obsidian',
        openMode: 'rest-api',
        conversation,
        resolvedNotePath: safeString(pathResolution.resolvedFilePath),
        launchBeforeRetry: false,
        retryPolicy: { ...DEFAULT_OBSIDIAN_OPEN_RETRY_POLICY },
      },
    };
  }

  if (!pathResolution.ok && shouldLaunchObsidianApp(pathResolution.error, clientRes.connectionConfig)) {
    return {
      available: true,
      label: DEFAULT_LABEL,
      trigger: {
        provider: 'obsidian',
        openMode: 'rest-api',
        conversation,
        resolvedNotePath: safeString(pathResolution.desiredFilePath) || desiredFilePath,
        launchBeforeRetry: true,
        retryPolicy: { ...DEFAULT_OBSIDIAN_OPEN_RETRY_POLICY },
      },
    };
  }

  return {
    available: false,
    label: DEFAULT_LABEL,
    error: pathResolution.ok
      ? {
          code: 'note_not_found',
          message: 'This conversation has not been synced to Obsidian yet.',
        }
      : pathResolution.error,
  };
}

export async function openObsidianTarget({
  trigger,
  services = defaultObsidianDetailHeaderServices,
  port = defaultObsidianTargetActionPort,
}: {
  trigger: ObsidianOpenTriggerPayload;
  services?: ObsidianDetailHeaderServices;
  port?: ObsidianTargetActionPort;
}) {
  let effectiveTrigger = trigger;

  if (trigger.launchBeforeRetry) {
    const launched = await port.launchProtocolUrl(OBSIDIAN_APP_LAUNCH_URL);
    if (!launched) {
      const message = 'Failed to launch Obsidian app.';
      port.reportError(message);
      return { ok: false, error: { code: 'launch_failed', message } } as const;
    }

    await port.wait(trigger.retryPolicy.launchDelayMs);

    const refreshed = await resolveObsidianOpenTarget({
      conversation: trigger.conversation,
      services,
    });
    if (!refreshed.available || !refreshed.trigger) {
      const message = refreshed.error?.message || 'Failed to resolve the Obsidian note after launching the app.';
      port.reportError(message);
      return { ok: false, error: { code: refreshed.error?.code || 'unavailable_after_launch', message } } as const;
    }
    effectiveTrigger = refreshed.trigger;
  }

  const attempts = Math.max(1, Number(effectiveTrigger.retryPolicy.maxAttempts) || 1);
  for (let index = 0; index < attempts; index += 1) {
    const openRes = await openResolvedObsidianPath({
      resolvedNotePath: effectiveTrigger.resolvedNotePath,
      services,
    });
    if (openRes.ok) {
      return { ok: true } as const;
    }

    const isLastAttempt = index >= attempts - 1;
    if (isLastAttempt) {
      const message = openRes.error?.message || 'Failed to open Obsidian note.';
      port.reportError(message);
      return { ok: false, error: { code: openRes.error?.code || 'open_failed', message } } as const;
    }
    await port.wait(effectiveTrigger.retryPolicy.retryDelayMs);
  }

  const message = 'Failed to open Obsidian note.';
  port.reportError(message);
  return { ok: false, error: { code: 'open_failed', message } } as const;
}
