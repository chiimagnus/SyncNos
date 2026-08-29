import type { Conversation } from '@services/conversations/domain/models';
import { t } from '@i18n';
import type { DetailHeaderAction, DetailHeaderActionPort } from '@services/integrations/detail-header-action-types';
import { getSyncMappingByConversation } from '@services/conversations/data/storage-idb';
import { isSyncProviderEnabled } from '@services/sync/sync-provider-gate';
import { buildFeishuOpenInAction } from '@services/integrations/openin/feishu-openin';
import { buildGithubOpenInAction } from '@services/integrations/openin/github-openin';
import {
  buildNotionOpenInAction,
  buildNotionPageUrl,
  normalizeNotionPageId,
} from '@services/integrations/openin/notion-openin';
import { openObsidianTarget, resolveObsidianOpenTarget } from '@services/integrations/openin/obsidian-open-target';

export const DETAIL_HEADER_ACTION_LABELS = {
  openInNotion: t('detailHeaderOpenInNotion'),
  openInObsidian: t('detailHeaderOpenInObsidian'),
  openInFeishu: t('detailHeaderOpenInFeishu'),
  openInGithub: t('detailHeaderOpenInGithub'),
  obsidianApiNotConnected: t('detailHeaderObsidianApiNotConnected'),
} as const;

export { buildNotionPageUrl, normalizeNotionPageId };

function safeString(value: unknown): string {
  return String(value || '').trim();
}

function hasOwnProperty(record: unknown, field: string): boolean {
  return !!record && typeof record === 'object' && Object.prototype.hasOwnProperty.call(record, field);
}

function resolveFreshProviderConversation(
  conversation: Conversation | null | undefined,
  mappingRes: any,
  field: string,
): Conversation | null | undefined {
  if (!conversation || !mappingRes) return conversation;

  const target = hasOwnProperty(mappingRes.mapping, field)
    ? safeString(mappingRes.mapping?.[field])
    : safeString(mappingRes.conversation?.[field]);
  return { ...(conversation as any), [field]: target } as Conversation;
}

function resolveFreshNotionConversation(
  conversation: Conversation | null | undefined,
  mappingRes: any,
): Conversation | null | undefined {
  if (!conversation || !mappingRes) return conversation;

  const pageId = normalizeNotionPageId(
    hasOwnProperty(mappingRes.mapping, 'notionPageId')
      ? safeString(mappingRes.mapping?.notionPageId)
      : safeString(mappingRes.conversation?.notionPageId),
  );
  const freshPageId = normalizeNotionPageId(safeString(mappingRes.conversation?.notionPageId));
  const usesFreshTargetMetadata = !!pageId && freshPageId === pageId;

  return {
    ...(conversation as any),
    notionPageId: pageId,
    notionPageUrl: usesFreshTargetMetadata ? safeString(mappingRes.conversation?.notionPageUrl) : '',
    notionWorkspaceSlug: usesFreshTargetMetadata ? safeString(mappingRes.conversation?.notionWorkspaceSlug) : '',
  } as Conversation;
}

async function buildObsidianOpenInAction({
  conversation,
  port,
}: {
  conversation: Conversation | null | undefined;
  port: DetailHeaderActionPort;
}): Promise<DetailHeaderAction | null> {
  const obsidianTarget = await resolveObsidianOpenTarget({ conversation });
  if (obsidianTarget.availabilityState === 'api-unavailable') {
    return {
      id: 'open-in-obsidian-unavailable',
      label: DETAIL_HEADER_ACTION_LABELS.obsidianApiNotConnected,
      kind: 'open-target',
      provider: 'obsidian',
      slot: 'open',
      disabled: true,
      onTrigger: async () => {},
    };
  }

  if (!obsidianTarget.available || !obsidianTarget.trigger) return null;

  return {
    id: 'open-in-obsidian',
    label: DETAIL_HEADER_ACTION_LABELS.openInObsidian,
    kind: 'open-target',
    provider: 'obsidian',
    slot: 'open',
    onTrigger: async () => {
      await openObsidianTarget({
        trigger: obsidianTarget.trigger!,
        port: {
          launchProtocolUrl: port.launchProtocolUrl,
          wait: port.wait,
          reportError: port.reportError,
        },
      });
    },
  };
}

export async function resolveOpenInDetailHeaderActions({
  conversation,
  port,
}: {
  conversation: Conversation | null | undefined;
  port: DetailHeaderActionPort;
}): Promise<DetailHeaderAction[]> {
  const actions: DetailHeaderAction[] = [];
  let mappingPromise: ReturnType<typeof getSyncMappingByConversation> | null = null;
  const resolveSyncMapping = () => {
    const conversationId = Number((conversation as any)?.id);
    if (!Number.isFinite(conversationId) || conversationId <= 0) return Promise.resolve(null);
    if (!mappingPromise) mappingPromise = getSyncMappingByConversation(conversationId).catch(() => null);
    return mappingPromise;
  };
  const [notionEnabled, obsidianEnabled, feishuEnabled, githubEnabled] = await Promise.all([
    isSyncProviderEnabled('notion').catch(() => true),
    isSyncProviderEnabled('obsidian').catch(() => true),
    isSyncProviderEnabled('feishu').catch(() => true),
    isSyncProviderEnabled('github').catch(() => true),
  ]);

  if (notionEnabled) {
    const convo = resolveFreshNotionConversation(conversation, await resolveSyncMapping());
    const notionAction = buildNotionOpenInAction({ conversation: convo, port, labels: DETAIL_HEADER_ACTION_LABELS });
    if (notionAction) actions.push(notionAction);
  }

  if (feishuEnabled) {
    const convo = resolveFreshProviderConversation(conversation, await resolveSyncMapping(), 'feishuDocId');
    const feishuAction = buildFeishuOpenInAction({ conversation: convo, port, labels: DETAIL_HEADER_ACTION_LABELS });
    if (feishuAction) actions.push(feishuAction);
  }

  if (githubEnabled) {
    const mappingRes = await resolveSyncMapping();
    const githubAction = buildGithubOpenInAction({
      conversation,
      mapping: mappingRes?.mapping,
      port,
      labels: DETAIL_HEADER_ACTION_LABELS,
    });
    if (githubAction) actions.push(githubAction);
  }

  try {
    if (obsidianEnabled) {
      const obsidianAction = await buildObsidianOpenInAction({ conversation, port });
      if (obsidianAction) actions.push(obsidianAction);
    }
  } catch (_error) {
    // Preserve already-resolved actions such as Notion even if the Obsidian capability probe fails.
  }

  return actions;
}
