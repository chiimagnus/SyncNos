import { assertKindDef } from './conversation-kind-contract.ts';
import { conversationKinds } from './conversation-kinds.ts';
import { messageContracts } from './message-contracts.ts';

const namespace: any = (globalThis as any).WebClipper || ((globalThis as any).WebClipper = {});

namespace.messageContracts = messageContracts;
namespace.conversationKindContract = { assertKindDef };
namespace.conversationKinds = conversationKinds;
