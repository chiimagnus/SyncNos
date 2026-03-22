import type { Conversation, ConversationDetail } from '@services/conversations/domain/models';
import { launchObsidianApp } from '../../sync/obsidian/obsidian-app-launch';
import type { DetailHeaderAction, DetailHeaderActionPort } from './detail-header-action-types';
import { openExternalUrl } from './open-external-url';
import { reportObsidianOpenError, waitForDelay } from './openin/obsidian-open-target';
import { resolveOpenInDetailHeaderActions } from './openin/openin-detail-header-actions';
import { resolveChatWithDetailHeaderActions } from './chatwith/chatwith-detail-header-actions';

export { DETAIL_HEADER_ACTION_LABELS } from './openin/openin-detail-header-actions';
export type { DetailHeaderAction, DetailHeaderActionPort } from './detail-header-action-types';

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

export async function resolveDetailHeaderActions({
  conversation,
  detail,
  port = defaultDetailHeaderActionPort,
}: ResolveDetailHeaderActionsInput): Promise<DetailHeaderAction[]> {
  const actions: DetailHeaderAction[] = await resolveOpenInDetailHeaderActions({ conversation, port });

  actions.push(...(await resolveChatWithDetailHeaderActions({ conversation, detail: detail ?? null, port })));

  return actions;
}
