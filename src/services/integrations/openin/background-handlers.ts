import { OPEN_TARGET_MESSAGE_TYPES } from '@services/protocols/message-contracts';
import {
  OpenTargetError,
  launchOpenTargetByConversationId,
  resolveOpenTargetsByConversationId,
} from '@services/integrations/openin/openin-targets';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

function errorResponse(router: AnyRouter, error: unknown) {
  if (error instanceof OpenTargetError) {
    return router.err(error.message, { code: error.code, ...(error.extra ? { details: error.extra } : null) });
  }
  return router.err(String((error as any)?.message || error || 'open target request failed'));
}

export function registerOpenTargetHandlers(router: AnyRouter): void {
  router.register(OPEN_TARGET_MESSAGE_TYPES.RESOLVE, async (msg) => {
    try {
      const targets = await resolveOpenTargetsByConversationId({
        conversationId: msg?.conversationId,
        target: msg?.target,
      });
      return router.ok({ targets });
    } catch (error) {
      return errorResponse(router, error);
    }
  });

  router.register(OPEN_TARGET_MESSAGE_TYPES.LAUNCH, async (msg) => {
    try {
      const result = await launchOpenTargetByConversationId({
        conversationId: msg?.conversationId,
        target: msg?.target,
      });
      if (!result.ok) {
        return router.err(result.error.message, { code: result.error.code, target: result.target });
      }
      return router.ok({ launched: true, target: result.target });
    } catch (error) {
      return errorResponse(router, error);
    }
  });
}
