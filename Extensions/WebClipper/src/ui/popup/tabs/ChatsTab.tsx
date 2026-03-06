import { ConversationsProvider } from '../../conversations/conversations-context';
import { ConversationsScene, type PopupHeaderState } from '../../conversations/ConversationsScene';

export default function ChatsTab(props: { onPopupHeaderStateChange?: (state: PopupHeaderState) => void }) {
  const { onPopupHeaderStateChange } = props;

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-1 tw-flex-col">
      <ConversationsProvider>
        <ConversationsScene onPopupHeaderStateChange={onPopupHeaderStateChange} />
      </ConversationsProvider>
    </div>
  );
}
