import { assertKindDef } from './conversation-kind-contract';
import { conversationKinds } from './conversation-kinds';
import { messageContracts } from './message-contracts';

const namespace: any = (globalThis as any).WebClipper || ((globalThis as any).WebClipper = {});

namespace.messageContracts = messageContracts;
namespace.conversationKindContract = { assertKindDef };
namespace.conversationKinds = conversationKinds;
