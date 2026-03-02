import '../../../export/notion/notion-sync-orchestrator.js';
import runtimeContext from '../../../runtime-context.ts';

type LegacyNotionSyncOrchestrator = {
  syncConversations: (input: {
    conversationIds?: unknown[];
    instanceId: string;
  }) => Promise<unknown>;
  getSyncJobStatus: (input: { instanceId: string }) => Promise<unknown>;
};

function getLegacyNotionSyncOrchestrator(): LegacyNotionSyncOrchestrator {
  const orchestrator = runtimeContext.notionSyncOrchestrator;
  if (!orchestrator || typeof orchestrator.syncConversations !== 'function') {
    throw new Error('notion sync orchestrator missing');
  }
  if (typeof orchestrator.getSyncJobStatus !== 'function') {
    throw new Error('notion sync orchestrator missing');
  }
  return orchestrator as LegacyNotionSyncOrchestrator;
}

export async function notionSyncConversations(input: {
  conversationIds?: unknown[];
  instanceId: string;
}) {
  return getLegacyNotionSyncOrchestrator().syncConversations(input);
}

export async function getNotionSyncStatus(input: { instanceId: string }) {
  return getLegacyNotionSyncOrchestrator().getSyncJobStatus(input);
}
