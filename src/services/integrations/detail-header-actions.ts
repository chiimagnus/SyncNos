import type { Conversation, ConversationDetail } from '@services/conversations/domain/models';
import { t } from '@i18n';
import { writeTextToClipboard } from '@services/shared/clipboard';
import { formatConversationMarkdownForExternalOutput } from '@services/conversations/external-markdown';
import {
  DETAIL_HEADER_COPY_LINK_ACTION_STORAGE_KEY,
  prioritizeDetailHeaderCopyLinkActions,
  readLastDetailHeaderCopyLinkActionId,
  rememberDetailHeaderCopyLinkAction,
} from '@services/integrations/detail-header-copy-link-preference';
import { getSyncProviderEnabledStorageKeys } from '@services/sync/sync-provider-gate';
import { launchObsidianApp } from '@services/sync/obsidian/obsidian-app-launch';
import { OBSIDIAN_STORAGE_KEYS } from '@services/sync/obsidian/settings-store';
import type { DetailHeaderAction, DetailHeaderActionPort } from '@services/integrations/detail-header-action-types';
import { openExternalUrl } from '@services/integrations/open-external-url';
import { reportObsidianOpenError, waitForDelay } from '@services/integrations/openin/obsidian-open-target';
import { resolveOpenInDetailHeaderActions } from '@services/integrations/openin/openin-detail-header-actions';
import { normalizeHttpUrl, sanitizeHttpUrl } from '@services/url-cleaning/http-url';

export { DETAIL_HEADER_ACTION_LABELS } from '@services/integrations/openin/openin-detail-header-actions';
export type { DetailHeaderAction, DetailHeaderActionPort } from '@services/integrations/detail-header-action-types';

export type ResolveDetailHeaderActionsInput = {
  conversation: Conversation | null | undefined;
  detail?: ConversationDetail | null | undefined;
  port?: DetailHeaderActionPort;
};

export function getDetailHeaderActionStorageDependencyKeys(): string[] {
  return Array.from(
    new Set([
      ...getSyncProviderEnabledStorageKeys(),
      ...Object.values(OBSIDIAN_STORAGE_KEYS),
      DETAIL_HEADER_COPY_LINK_ACTION_STORAGE_KEY,
    ]),
  );
}

export function hasDetailHeaderActionStorageDependencyChange(changes: unknown, areaName: string): boolean {
  if (areaName !== 'local' || !changes || typeof changes !== 'object') return false;
  return getDetailHeaderActionStorageDependencyKeys().some((key) => Object.prototype.hasOwnProperty.call(changes, key));
}

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

function buildDetailUtilityActions({
  conversation,
  detail,
  port,
}: {
  conversation: Conversation | null | undefined;
  detail: ConversationDetail | null | undefined;
  port: DetailHeaderActionPort;
}): DetailHeaderAction[] {
  const matchingDetail =
    conversation && detail && Number(detail.conversationId) === Number(conversation.id) ? detail : null;
  const safeOriginalUrl = sanitizeHttpUrl(conversation?.url);

  return [
    {
      id: 'copy-full-markdown',
      label: t('copyFullMarkdown'),
      kind: 'copy-text',
      provider: 'local',
      slot: 'tools',
      disabled: !matchingDetail,
      onTrigger: async () => {
        if (!conversation || !matchingDetail) throw new Error(t('copyFailed'));
        const markdown = await formatConversationMarkdownForExternalOutput(conversation, matchingDetail);
        const copied = await writeTextToClipboard(markdown);
        if (!copied) throw new Error(t('copyFailed'));
      },
    },
    {
      id: 'open-original',
      label: t('openOriginalChat'),
      kind: 'external-link',
      provider: 'source',
      slot: 'tools',
      disabled: !safeOriginalUrl,
      ...(safeOriginalUrl ? { href: safeOriginalUrl } : null),
      onTrigger: async () => {
        if (!safeOriginalUrl) throw new Error(t('actionFailedFallback'));
        const opened = await port.openExternalUrl(safeOriginalUrl);
        if (!opened) throw new Error(t('actionFailedFallback'));
      },
    },
  ];
}

async function buildCopyLinkActions(openActions: DetailHeaderAction[]): Promise<DetailHeaderAction[]> {
  const copyTargets = {
    notion: { id: 'copy-notion-link', label: t('detailHeaderCopyNotionLink') },
    feishu: { id: 'copy-feishu-link', label: t('detailHeaderCopyFeishuLink') },
    github: { id: 'copy-github-link', label: t('detailHeaderCopyGithubLink') },
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

  const preferredActionId = await readLastDetailHeaderCopyLinkActionId();
  return prioritizeDetailHeaderCopyLinkActions(actions, preferredActionId).map((action) => ({
    ...action,
    onTrigger: async () => {
      await rememberDetailHeaderCopyLinkAction(action.id);
      await action.onTrigger();
    },
  }));
}

export async function resolveDetailHeaderActions({
  conversation,
  detail,
  port = defaultDetailHeaderActionPort,
}: ResolveDetailHeaderActionsInput): Promise<DetailHeaderAction[]> {
  const openActions = await resolveOpenInDetailHeaderActions({ conversation, port });
  const copyActions = await buildCopyLinkActions(openActions);
  return [...openActions, ...copyActions, ...buildDetailUtilityActions({ conversation, detail, port })];
}
