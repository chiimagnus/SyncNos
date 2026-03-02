import '../../../export/obsidian/obsidian-sync-orchestrator.js';

type LegacyObsidianSyncOrchestrator = {
  getSyncStatus: (input: { instanceId: string }) => Promise<unknown>;
  syncConversations: (input: {
    conversationIds?: unknown[];
    forceFullConversationIds?: unknown[];
    instanceId: string;
  }) => Promise<unknown>;
  testConnection: (input: { instanceId: string }) => Promise<unknown>;
};

function getLegacyObsidianSyncOrchestrator(): LegacyObsidianSyncOrchestrator {
  const namespace: any = (globalThis as any).WebClipper || {};
  const orchestrator = namespace.obsidianSyncOrchestrator;
  if (!orchestrator || typeof orchestrator.getSyncStatus !== 'function') {
    throw new Error('obsidian sync orchestrator missing');
  }
  if (typeof orchestrator.syncConversations !== 'function') {
    throw new Error('obsidian sync orchestrator missing');
  }
  if (typeof orchestrator.testConnection !== 'function') {
    throw new Error('obsidian sync orchestrator missing');
  }
  return orchestrator as LegacyObsidianSyncOrchestrator;
}

export async function getObsidianSyncStatus(input: { instanceId: string }) {
  return getLegacyObsidianSyncOrchestrator().getSyncStatus(input);
}

export async function obsidianSyncConversations(input: {
  conversationIds?: unknown[];
  forceFullConversationIds?: unknown[];
  instanceId: string;
}) {
  return getLegacyObsidianSyncOrchestrator().syncConversations(input);
}

export async function testObsidianConnection(input: { instanceId: string }) {
  return getLegacyObsidianSyncOrchestrator().testConnection(input);
}
