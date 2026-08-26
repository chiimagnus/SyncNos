import type { Conversation, ConversationDetail } from '@services/conversations/domain/models';
import { t } from '@i18n';
import { writeTextToClipboard } from '@services/shared/clipboard';
import { launchObsidianApp } from '@services/sync/obsidian/obsidian-app-launch';
import type { DetailHeaderAction, DetailHeaderActionPort } from '@services/integrations/detail-header-action-types';
import { openExternalUrl } from '@services/integrations/open-external-url';
import { reportObsidianOpenError, waitForDelay } from '@services/integrations/openin/obsidian-open-target';
import { resolveOpenInDetailHeaderActions } from '@services/integrations/openin/openin-detail-header-actions';
import { normalizeHttpUrl } from '@services/url-cleaning/http-url';

export { DETAIL_HEADER_ACTION_LABELS } from '@services/integrations/openin/openin-detail-header-actions';
export type { DetailHeaderAction, DetailHeaderActionPort } from '@services/integrations/detail-header-action-types';

export type ResolveDetailHeaderActionsInput = {
  conversation: Conversation | null | undefined;
  detail?: ConversationDetail | null | undefined;
  port?: DetailHeaderActionPort;
};

export async function openDetailHeaderProtocolUrl(url: string): Promise<boolean> {
  const safeUrl = String(url || '').trim();
  if (!safeUrl) return false;

  return launchObsidianApp(safeUrl);
}

export const defaultDetailHeaderActionPort: DetailHeaderActionPort = {
  openExternalUrl,
  launchProtocolUrl: openDetailHeaderProtocolUrl,
  wait: waitForDelay,
  reportError: reportObsidianOpenError,
};

function buildCopyLinkActions(openActions: DetailHeaderAction[]): DetailHeaderAction[] {
  const copyTargets = {
    notion: { id: 'copy-notion-link', label: t('detailHeaderCopyNotionLink') },
    feishu: { id: 'copy-feishu-link', label: t('detailHeaderCopyFeishuLink') },
  } as const;
  const actions: DetailHeaderAction[] = [];

  for (const openAction of openActions) {
    if (openAction.disabled) continue;
    const target = copyTargets[openAction.provider as keyof typeof copyTargets];
    if (!target) continue;
    const href = String(openAction.href || '').trim();
    if (!href || !normalizeHttpUrl(href)) continue;

    actions.push({
      id: target.id,
      label: target.label,
      kind: 'copy-text',
      provider: openAction.provider,
      slot: 'copy',
      href,
      afterTriggerLabel: t('copied'),
      onTrigger: async () => {
        const copied = await writeTextToClipboard(href);
        if (!copied) throw new Error(t('copyFailed'));
      },
    });
  }

  return actions;
}

export async function resolveDetailHeaderActions({
  conversation,
  detail: _detail,
  port = defaultDetailHeaderActionPort,
}: ResolveDetailHeaderActionsInput): Promise<DetailHeaderAction[]> {
  const openActions = await resolveOpenInDetailHeaderActions({ conversation, port });
  return [...openActions, ...buildCopyLinkActions(openActions)];
}
