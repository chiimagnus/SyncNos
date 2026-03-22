import type { Conversation } from '@services/conversations/domain/models';
import { t } from '@i18n';
import type { DetailHeaderAction, DetailHeaderActionPort } from '@services/integrations/detail-header-action-types';
import { isSyncProviderEnabled } from '@services/sync/sync-provider-gate';
import {
  buildNotionOpenInAction,
  buildNotionPageUrl,
  normalizeNotionPageId,
} from '@services/integrations/openin/notion-openin';
import {
  openObsidianTarget,
  resolveObsidianOpenTarget,
} from '@services/integrations/openin/obsidian-open-target';

export const DETAIL_HEADER_ACTION_LABELS = {
  openInNotion: t('detailHeaderOpenInNotion'),
  openInObsidian: t('detailHeaderOpenInObsidian'),
  obsidianApiNotConnected: t('detailHeaderObsidianApiNotConnected'),
} as const;

export { buildNotionPageUrl, normalizeNotionPageId };

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
    triggerPayload: obsidianTarget.trigger as unknown as Record<string, unknown>,
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

  const [notionEnabled, obsidianEnabled] = await Promise.all([
    isSyncProviderEnabled('notion').catch(() => true),
    isSyncProviderEnabled('obsidian').catch(() => true),
  ]);

  if (notionEnabled) {
    const notionAction = buildNotionOpenInAction({ conversation, port, labels: DETAIL_HEADER_ACTION_LABELS });
    if (notionAction) actions.push(notionAction);
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
