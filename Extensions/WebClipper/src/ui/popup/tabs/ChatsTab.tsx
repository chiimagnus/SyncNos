import { ConversationsProvider } from '../../conversations/conversations-context';
import { ConversationsScene } from '../../conversations/ConversationsScene';

export default function ChatsTab() {
  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-1 tw-flex-col">
      <ConversationsProvider>
        <ConversationsScene />
      </ConversationsProvider>
    </div>
  );
}

