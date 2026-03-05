import { ConversationsProvider } from '../../../src/ui/conversations/conversations-context';
import { ConversationsScene } from '../../../src/ui/conversations/ConversationsScene';

export default function ChatsTab() {
  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-1 tw-flex-col">
      <ConversationsProvider>
        <ConversationsScene />
      </ConversationsProvider>
    </div>
  );
}

