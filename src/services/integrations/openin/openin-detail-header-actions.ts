import type { Conversation } from '@services/conversations/domain/models';
import { t } from '@i18n';
import type { DetailHeaderAction, DetailHeaderActionPort } from '@services/integrations/detail-header-action-types';
import { getSyncMappingByConversation } from '@services/conversations/data/storage-idb';
import { isSyncProviderEnabled } from '@services/sync/sync-provider-gate';
import { buildFeishuOpenInAction } from '@services/integrations/openin/feishu-openin';
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
  obsidianApiNotConnected: t('detailHeaderObsidianApiNotConnected'),
} as const;

export { buildNotionPageUrl, normalizeNotionPageId };

function safeString(value: unknown): string {
  return String(value || '').trim();
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
  const hydratedValue = (mappingRes: any, field: string) =>
    safeString(mappingRes?.mapping?.[field]) || safeString(mappingRes?.conversation?.[field]);

  const [notionEnabled, obsidianEnabled, feishuEnabled] = await Promise.all([
    isSyncProviderEnabled('notion').catch(() => true),
    isSyncProviderEnabled('obsidian').catch(() => true),
    isSyncProviderEnabled('feishu').catch(() => true),
  ]);

  if (notionEnabled) {
    let convo = conversation;
    if (
      convo &&
      (!safeString((convo as any).notionPageId) ||
        !safeString((convo as any).notionPageUrl) ||
        !safeString((convo as any).notionWorkspaceSlug))
    ) {
      const mappingRes = await resolveSyncMapping();
      const currentPageId = safeString((convo as any).notionPageId);
      const hydratedPageId = hydratedValue(mappingRes, 'notionPageId');
      const sameTarget =
        !currentPageId ||
        !hydratedPageId ||
        normalizeNotionPageId(currentPageId) === normalizeNotionPageId(hydratedPageId);
      const pageId = currentPageId || hydratedPageId;
      const pageUrl =
        safeString((convo as any).notionPageUrl) || (sameTarget ? hydratedValue(mappingRes, 'notionPageUrl') : '');
      const workspaceSlug =
        safeString((convo as any).notionWorkspaceSlug) ||
        (sameTarget ? hydratedValue(mappingRes, 'notionWorkspaceSlug') : '');
      if (pageId || pageUrl || workspaceSlug) {
        convo = {
          ...(convo as any),
          ...(pageId ? { notionPageId: pageId } : null),
          ...(pageUrl ? { notionPageUrl: pageUrl } : null),
          ...(workspaceSlug ? { notionWorkspaceSlug: workspaceSlug } : null),
        } as any;
      }
    }
    const notionAction = buildNotionOpenInAction({ conversation: convo, port, labels: DETAIL_HEADER_ACTION_LABELS });
    if (notionAction) actions.push(notionAction);
  }

  if (feishuEnabled) {
    let convo = conversation;
    if (convo && !safeString((convo as any).feishuDocId)) {
      const mappingRes = await resolveSyncMapping();
      const docId = hydratedValue(mappingRes, 'feishuDocId');
      if (docId) convo = { ...(convo as any), feishuDocId: docId } as any;
    }
    const feishuAction = buildFeishuOpenInAction({ conversation: convo, port, labels: DETAIL_HEADER_ACTION_LABELS });
    if (feishuAction) actions.push(feishuAction);
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
