import { DATA_REVISION_MESSAGE_TYPES } from '@services/protocols/message-contracts';
import { readDataRevisionSnapshot } from '@services/data-revisions/storage-idb';

type AnyRouter = {
  ok: (data: unknown) => any;
  register: (type: string, handler: (msg: any) => Promise<any> | any) => void;
};

type DataRevisionHandlersDeps = {
  readSnapshot: typeof readDataRevisionSnapshot;
};

const DEFAULT_DEPS: DataRevisionHandlersDeps = {
  readSnapshot: readDataRevisionSnapshot,
};

export function registerDataRevisionHandlers(
  router: AnyRouter,
  deps: DataRevisionHandlersDeps = DEFAULT_DEPS,
): void {
  router.register(DATA_REVISION_MESSAGE_TYPES.GET_SNAPSHOT, async () => router.ok(await deps.readSnapshot()));
}
