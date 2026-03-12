import { ConversationsScene, type PopupHeaderState } from '../../conversations/ConversationsScene';

export default function ChatsTab(props: {
  onPopupHeaderStateChange?: (state: PopupHeaderState) => void;
  onPopupNotionSyncStarted?: () => void;
  onOpenInsightsSection?: () => void;
}) {
  const { onPopupHeaderStateChange, onPopupNotionSyncStarted, onOpenInsightsSection } = props;

  return (
    <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-1 tw-flex-col">
      <ConversationsScene
        onPopupHeaderStateChange={onPopupHeaderStateChange}
        onPopupNotionSyncStarted={onPopupNotionSyncStarted}
        onOpenInsightsSection={onOpenInsightsSection}
      />
    </div>
  );
}
