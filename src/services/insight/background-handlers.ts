import { CORE_MESSAGE_TYPES } from '@platform/messaging/message-contracts';
import type { ConversationReadRunner } from '@services/conversations/data/storage';
import { LocalDataContractError, parseInsightStatsRequestPayload } from '@services/local-data/contracts';

type InsightRouter = Readonly<{
  err: (message: string, extra?: unknown) => unknown;
  ok: (data: unknown) => unknown;
  register: (type: string, handler: (message: any) => Promise<unknown> | unknown) => void;
}>;

function insightError(router: InsightRouter, error: unknown): unknown {
  if (error instanceof LocalDataContractError) {
    return router.err(error.message, { code: error.code, diagnostics: error.diagnostics ?? null });
  }
  return router.err(error instanceof Error ? error.message : String(error || 'Insight facts read failed'));
}

/** Owns the About You aggregate read; the injected runner owns the complete facts gate lease. */
export function registerInsightHandlers(
  router: InsightRouter,
  dependencies: Readonly<{ conversationReadRunner: ConversationReadRunner }>,
): void {
  router.register(CORE_MESSAGE_TYPES.GET_INSIGHT_STATS, async (message) => {
    let request;
    try {
      request = parseInsightStatsRequestPayload({
        timeZone: message?.timeZone,
        ...(message?.since === undefined ? {} : { since: message.since }),
        ...(message?.until === undefined ? {} : { until: message.until }),
      });
    } catch (error) {
      return insightError(router, error);
    }

    try {
      const snapshot = await dependencies.conversationReadRunner.run({
        kind: 'insight-stats',
        read: async ({ repository }) => await repository.getInsightStats(request),
      });
      return router.ok(snapshot);
    } catch (error) {
      return insightError(router, error);
    }
  });
}
