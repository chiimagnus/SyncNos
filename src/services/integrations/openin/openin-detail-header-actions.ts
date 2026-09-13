import type { Conversation } from '@services/conversations/domain/models';
import { t } from '@i18n';
import type { DetailHeaderAction, DetailHeaderActionPort } from '@services/integrations/detail-header-action-types';
import { buildNotionPageUrl, normalizeNotionPageId } from '@services/integrations/openin/notion-openin';
import {
  launchOpenTargetByConversationId,
  resolveOpenTargets,
  type OpenTargetDto,
  type OpenTargetProvider,
} from '@services/integrations/openin/openin-targets';

export const DETAIL_HEADER_ACTION_LABELS = {
  openInNotion: t('detailHeaderOpenInNotion'),
  openInObsidian: t('detailHeaderOpenInObsidian'),
  openInFeishu: t('detailHeaderOpenInFeishu'),
  openInGithub: t('detailHeaderOpenInGithub'),
  obsidianApiNotConnected: t('detailHeaderObsidianApiNotConnected'),
} as const;

export { buildNotionPageUrl, normalizeNotionPageId };

const OPEN_ACTIONS: Record<Exclude<OpenTargetProvider, 'source'>, { id: string; label: string }> = {
  notion: { id: 'open-in-notion', label: DETAIL_HEADER_ACTION_LABELS.openInNotion },
  obsidian: { id: 'open-in-obsidian', label: DETAIL_HEADER_ACTION_LABELS.openInObsidian },
  feishu: { id: 'open-in-feishu', label: DETAIL_HEADER_ACTION_LABELS.openInFeishu },
  github: { id: 'open-in-github', label: DETAIL_HEADER_ACTION_LABELS.openInGithub },
};

function launchPort(port: DetailHeaderActionPort) {
  return {
    openExternalUrl: port.openExternalUrl,
    obsidian: {
      launchProtocolUrl: port.launchProtocolUrl,
      wait: port.wait,
      reportError: port.reportError,
    },
  };
}

function buildAction({
  conversation,
  target,
  port,
}: {
  conversation: Conversation;
  target: OpenTargetDto;
  port: DetailHeaderActionPort;
}): DetailHeaderAction | null {
  if (target.provider === 'source') return null;
  if (target.provider === 'obsidian' && target.availabilityState === 'api_unavailable') {
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
  if (!target.available || !target.target) return null;

  const definition = OPEN_ACTIONS[target.provider];
  return {
    id: definition.id,
    label: definition.label,
    kind: target.provider === 'obsidian' ? 'open-target' : 'external-link',
    provider: target.provider,
    slot: 'open',
    ...(target.kind === 'external-url' ? { href: target.target } : null),
    onTrigger: async () => {
      const conversationId = Number(conversation.id);
      if (!Number.isSafeInteger(conversationId) || conversationId <= 0) {
        throw new Error('Invalid conversation id');
      }
      const result = await launchOpenTargetByConversationId({
        conversationId,
        target: target.provider,
        port: launchPort(port),
      });
      if (!result.ok) throw new Error(result.error.message);
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
  if (!conversation) return [];
  const targets = await resolveOpenTargets({
    conversation,
    targets: ['notion', 'feishu', 'github', 'obsidian'],
  });
  return targets.flatMap((target) => {
    const action = buildAction({ conversation, target, port });
    return action ? [action] : [];
  });
}
