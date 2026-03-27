import { ITEM_MENTION_MESSAGE_TYPES } from '@platform/messaging/message-contracts';

type AnyRouter = {
  ok: (data: unknown) => any;
  err: (message: string, extra?: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

export function registerItemMentionHandlers(router: AnyRouter) {
  router.register(ITEM_MENTION_MESSAGE_TYPES.SEARCH_MENTION_CANDIDATES, async (_msg) => {
    return router.err('item mention search not implemented');
  });

  router.register(ITEM_MENTION_MESSAGE_TYPES.BUILD_MENTION_INSERT_TEXT, async (_msg) => {
    return router.err('item mention insert not implemented');
  });
}

