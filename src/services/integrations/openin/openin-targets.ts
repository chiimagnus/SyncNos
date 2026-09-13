import { getConversationById, getSyncMappingByConversation } from '@services/conversations/data/storage-idb';
import type { Conversation } from '@services/conversations/domain/models';
import { openExternalUrl } from '@services/integrations/open-external-url';
import { buildFeishuDocUrl } from '@services/integrations/openin/feishu-openin';
import { buildGithubSyncedMarkdownUrl } from '@services/integrations/openin/github-openin';
import { buildNotionPageUrl, normalizeNotionPageId } from '@services/integrations/openin/notion-openin';
import {
  defaultObsidianDetailHeaderServices,
  defaultObsidianTargetActionPort,
  openObsidianTarget,
  resolveObsidianOpenTarget,
  type ObsidianDetailHeaderServices,
  type ObsidianTargetActionPort,
} from '@services/integrations/openin/obsidian-open-target';
import { isSyncProviderEnabled } from '@services/sync/sync-provider-gate';
import { sanitizeHttpUrl } from '@services/url-cleaning/http-url';

export const OPEN_TARGET_PROVIDERS = ['source', 'notion', 'obsidian', 'feishu', 'github'] as const;
export type OpenTargetProvider = (typeof OPEN_TARGET_PROVIDERS)[number];
export type OpenTargetKind = 'external-url' | 'obsidian-note';
export type OpenTargetAvailabilityState =
  | 'ready'
  | 'invalid_source'
  | 'provider_disabled'
  | 'not_synced'
  | 'api_unavailable';

export type OpenTargetDto = {
  provider: OpenTargetProvider;
  available: boolean;
  kind: OpenTargetKind;
  target?: string;
  availabilityState: OpenTargetAvailabilityState;
  error?: { code: string; message: string };
};

export class OpenTargetError extends Error {
  code: string;
  extra: Record<string, unknown> | null;

  constructor(code: string, message: string, extra: Record<string, unknown> | null = null) {
    super(message);
    this.name = 'OpenTargetError';
    this.code = code;
    this.extra = extra;
  }
}

type SyncMappingResult = Awaited<ReturnType<typeof getSyncMappingByConversation>>;

type OpenTargetServices = {
  getConversationById: typeof getConversationById;
  getSyncMappingByConversation: typeof getSyncMappingByConversation;
  isSyncProviderEnabled: typeof isSyncProviderEnabled;
  resolveObsidianOpenTarget: typeof resolveObsidianOpenTarget;
  openObsidianTarget: typeof openObsidianTarget;
  obsidianServices: ObsidianDetailHeaderServices;
  openExternalUrl: typeof openExternalUrl;
};

export type OpenTargetLaunchPort = {
  openExternalUrl: (url: string) => Promise<boolean>;
  obsidian: ObsidianTargetActionPort;
};

export const defaultOpenTargetServices: OpenTargetServices = {
  getConversationById,
  getSyncMappingByConversation,
  isSyncProviderEnabled,
  resolveObsidianOpenTarget,
  openObsidianTarget,
  obsidianServices: defaultObsidianDetailHeaderServices,
  openExternalUrl,
};

function safeString(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

function hasOwnProperty(record: unknown, field: string): boolean {
  return !!record && typeof record === 'object' && Object.prototype.hasOwnProperty.call(record, field);
}

function externalTarget(provider: OpenTargetProvider, target: string, unavailableCode: string): OpenTargetDto {
  if (target) {
    return { provider, available: true, kind: 'external-url', target, availabilityState: 'ready' };
  }
  return {
    provider,
    available: false,
    kind: 'external-url',
    availabilityState: provider === 'source' ? 'invalid_source' : 'not_synced',
    error: {
      code: unavailableCode,
      message: provider === 'source' ? 'Source URL is unavailable.' : `${provider} target is unavailable.`,
    },
  };
}

function disabledTarget(provider: Exclude<OpenTargetProvider, 'source'>): OpenTargetDto {
  return {
    provider,
    available: false,
    kind: provider === 'obsidian' ? 'obsidian-note' : 'external-url',
    availabilityState: 'provider_disabled',
    error: { code: 'provider_disabled', message: `${provider} sync provider is disabled.` },
  };
}

function toObsidianTargetDto(resolved: Awaited<ReturnType<typeof resolveObsidianOpenTarget>>): OpenTargetDto {
  if (resolved.available && resolved.trigger) {
    return {
      provider: 'obsidian',
      available: true,
      kind: 'obsidian-note',
      target: safeString(resolved.trigger.resolvedNotePath),
      availabilityState: 'ready',
    };
  }
  return {
    provider: 'obsidian',
    available: false,
    kind: 'obsidian-note',
    availabilityState: resolved.availabilityState === 'api-unavailable' ? 'api_unavailable' : 'not_synced',
    ...(resolved.error
      ? { error: { code: safeString(resolved.error.code), message: safeString(resolved.error.message) } }
      : null),
  };
}

function sanitizeSourceUrl(value: unknown): string {
  const candidate = sanitizeHttpUrl(value);
  if (!candidate) return '';
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? candidate : '';
  } catch {
    return '';
  }
}

export function isOpenTargetProvider(value: unknown): value is OpenTargetProvider {
  return (OPEN_TARGET_PROVIDERS as readonly string[]).includes(safeString(value));
}

export function resolveSourceOpenTarget(conversation: Conversation | null | undefined): OpenTargetDto {
  return externalTarget('source', sanitizeSourceUrl(conversation?.url), 'source_url_unavailable');
}

function resolveFreshProviderField(conversation: Conversation, mappingRes: SyncMappingResult, field: string): string {
  if (!mappingRes) return safeString((conversation as any)[field]);
  return hasOwnProperty(mappingRes.mapping, field)
    ? safeString((mappingRes.mapping as any)?.[field])
    : safeString((mappingRes.conversation as any)?.[field]);
}

function resolveFreshNotionConversation(conversation: Conversation, mappingRes: SyncMappingResult): Conversation {
  if (!mappingRes) return conversation;
  const pageId = normalizeNotionPageId(
    hasOwnProperty(mappingRes.mapping, 'notionPageId')
      ? safeString((mappingRes.mapping as any)?.notionPageId)
      : safeString((mappingRes.conversation as any)?.notionPageId),
  );
  const freshPageId = normalizeNotionPageId(safeString((mappingRes.conversation as any)?.notionPageId));
  const usesFreshTargetMetadata = !!pageId && freshPageId === pageId;
  return {
    ...(conversation as any),
    notionPageId: pageId,
    notionPageUrl: usesFreshTargetMetadata ? safeString((mappingRes.conversation as any)?.notionPageUrl) : '',
    notionWorkspaceSlug: usesFreshTargetMetadata
      ? safeString((mappingRes.conversation as any)?.notionWorkspaceSlug)
      : '',
  } as Conversation;
}

async function resolveRequestedTargets({
  conversation,
  targets,
  services,
}: {
  conversation: Conversation;
  targets: readonly OpenTargetProvider[];
  services: OpenTargetServices;
}): Promise<OpenTargetDto[]> {
  let mappingPromise: Promise<SyncMappingResult> | null = null;
  const mapping = () => {
    if (!mappingPromise) {
      const id = Number(conversation.id);
      mappingPromise =
        Number.isSafeInteger(id) && id > 0
          ? services.getSyncMappingByConversation(id).catch(() => null)
          : Promise.resolve(null);
    }
    return mappingPromise;
  };

  const results: OpenTargetDto[] = [];
  for (const provider of targets) {
    if (provider === 'source') {
      results.push(resolveSourceOpenTarget(conversation));
      continue;
    }

    const enabled = await services.isSyncProviderEnabled(provider).catch(() => true);
    if (!enabled) {
      results.push(disabledTarget(provider));
      continue;
    }

    if (provider === 'notion') {
      const fresh = resolveFreshNotionConversation(conversation, await mapping());
      results.push(
        externalTarget(
          provider,
          buildNotionPageUrl((fresh as any).notionPageId, {
            workspaceSlug: (fresh as any).notionWorkspaceSlug,
            pageUrl: (fresh as any).notionPageUrl,
          }),
          'not_synced',
        ),
      );
      continue;
    }

    if (provider === 'feishu') {
      results.push(
        externalTarget(
          provider,
          buildFeishuDocUrl(resolveFreshProviderField(conversation, await mapping(), 'feishuDocId')),
          'not_synced',
        ),
      );
      continue;
    }

    if (provider === 'github') {
      const mappingRes = await mapping();
      const freshConversation = (mappingRes?.conversation as Conversation | null | undefined) ?? conversation;
      results.push(
        externalTarget(
          provider,
          buildGithubSyncedMarkdownUrl({ conversation: freshConversation, mapping: mappingRes?.mapping ?? null }),
          'not_synced',
        ),
      );
      continue;
    }

    try {
      const resolved = await services.resolveObsidianOpenTarget({
        conversation,
        services: services.obsidianServices,
      });
      results.push(toObsidianTargetDto(resolved));
    } catch {
      results.push({
        provider,
        available: false,
        kind: 'obsidian-note',
        availabilityState: 'api_unavailable',
        error: { code: 'obsidian_probe_failed', message: 'Obsidian target is unavailable.' },
      });
    }
  }
  return results;
}

export async function resolveOpenTargets({
  conversation,
  targets = OPEN_TARGET_PROVIDERS,
  services = defaultOpenTargetServices,
}: {
  conversation: Conversation | null | undefined;
  targets?: readonly OpenTargetProvider[];
  services?: OpenTargetServices;
}): Promise<OpenTargetDto[]> {
  if (!conversation) throw new OpenTargetError('conversation_not_found', 'Conversation not found');
  const normalizedTargets = Array.from(new Set(targets));
  if (!normalizedTargets.length || normalizedTargets.some((provider) => !isOpenTargetProvider(provider))) {
    throw new OpenTargetError('open_target_invalid_provider', 'Invalid open target provider');
  }
  return await resolveRequestedTargets({ conversation, targets: normalizedTargets, services });
}

export async function resolveOpenTargetsByConversationId({
  conversationId,
  target,
  services = defaultOpenTargetServices,
}: {
  conversationId: unknown;
  target?: unknown;
  services?: OpenTargetServices;
}): Promise<OpenTargetDto[]> {
  const id = Number(conversationId);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new OpenTargetError('invalid_conversation_id', 'Invalid conversation id');
  const targets = target == null || safeString(target) === '' ? OPEN_TARGET_PROVIDERS : [safeString(target)];
  if (targets.some((provider) => !isOpenTargetProvider(provider))) {
    throw new OpenTargetError('open_target_invalid_provider', 'Invalid open target provider');
  }
  const conversation = await services.getConversationById(id);
  if (!conversation)
    throw new OpenTargetError('conversation_not_found', 'Conversation not found', { conversationId: id });
  return await resolveRequestedTargets({ conversation, targets: targets as OpenTargetProvider[], services });
}

export async function launchOpenTarget({
  conversation,
  target,
  services = defaultOpenTargetServices,
  port,
}: {
  conversation: Conversation | null | undefined;
  target: OpenTargetProvider;
  services?: OpenTargetServices;
  port?: OpenTargetLaunchPort;
}): Promise<
  { ok: true; target: OpenTargetDto } | { ok: false; target: OpenTargetDto; error: { code: string; message: string } }
> {
  if (!conversation) throw new OpenTargetError('conversation_not_found', 'Conversation not found');
  if (!isOpenTargetProvider(target))
    throw new OpenTargetError('open_target_invalid_provider', 'Invalid open target provider');

  if (target === 'obsidian') {
    const enabled = await services.isSyncProviderEnabled('obsidian').catch(() => true);
    if (!enabled) {
      const unavailable = disabledTarget('obsidian');
      return {
        ok: false,
        target: unavailable,
        error: unavailable.error ?? { code: 'provider_disabled', message: 'obsidian sync provider is disabled.' },
      };
    }
    let resolved: Awaited<ReturnType<typeof resolveObsidianOpenTarget>>;
    try {
      resolved = await services.resolveObsidianOpenTarget({ conversation, services: services.obsidianServices });
    } catch {
      const unavailable: OpenTargetDto = {
        provider: 'obsidian',
        available: false,
        kind: 'obsidian-note',
        availabilityState: 'api_unavailable',
        error: { code: 'obsidian_probe_failed', message: 'Obsidian target is unavailable.' },
      };
      return { ok: false, target: unavailable, error: unavailable.error! };
    }
    const dto = toObsidianTargetDto(resolved);
    if (!resolved.available || !resolved.trigger || !dto.available) {
      return {
        ok: false,
        target: dto,
        error: dto.error ?? { code: dto.availabilityState, message: 'Obsidian target is unavailable.' },
      };
    }
    const opened = await services.openObsidianTarget({
      trigger: resolved.trigger,
      services: services.obsidianServices,
      port: port?.obsidian ?? defaultObsidianTargetActionPort,
    });
    if (!opened.ok) {
      return {
        ok: false,
        target: dto,
        error: {
          code: safeString(opened.error?.code) || 'open_failed',
          message: safeString(opened.error?.message) || 'Failed to open Obsidian target.',
        },
      };
    }
    return { ok: true, target: dto };
  }

  const [dto] = await resolveRequestedTargets({ conversation, targets: [target], services });
  if (!dto?.available || !dto.target) {
    return {
      ok: false,
      target: dto!,
      error: dto?.error ?? { code: dto?.availabilityState || 'not_synced', message: 'Open target is unavailable.' },
    };
  }
  const opened = await (port?.openExternalUrl ?? services.openExternalUrl)(dto.target);
  if (!opened) return { ok: false, target: dto, error: { code: 'open_failed', message: 'Failed to open target.' } };
  return { ok: true, target: dto };
}

export async function launchOpenTargetByConversationId({
  conversationId,
  target,
  services = defaultOpenTargetServices,
}: {
  conversationId: unknown;
  target: unknown;
  services?: OpenTargetServices;
}) {
  const id = Number(conversationId);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new OpenTargetError('invalid_conversation_id', 'Invalid conversation id');
  if (!isOpenTargetProvider(target))
    throw new OpenTargetError('open_target_invalid_provider', 'Invalid open target provider');
  const conversation = await services.getConversationById(id);
  if (!conversation)
    throw new OpenTargetError('conversation_not_found', 'Conversation not found', { conversationId: id });
  return await launchOpenTarget({ conversation, target, services });
}
