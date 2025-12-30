import SwiftUI

struct ChatSystemMessageRow: View {
    let message: ChatMessage
    let isSelected: Bool
    let onTap: () -> Void
    let onClassify: (_ isFromMe: Bool, _ kind: ChatMessageKind) -> Void
    let onSetSenderName: () -> Void
    let onClearSenderName: () -> Void

    private let selectedBorderColor = Color.accentColor

    var body: some View {
        Text(message.content)
            .scaledFont(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.secondary.opacity(0.10))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(selectedBorderColor, lineWidth: 2)
                    .opacity(isSelected ? 1 : 0)
                    .allowsHitTesting(false)
            )
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
            .onTapGesture { onTap() }
            .contextMenu {
                ChatMessageContextMenu(
                    text: message.content,
                    isFromMe: message.isFromMe,
                    kind: message.kind,
                    senderName: message.senderName,
                    onSelect: onTap,
                    onClassify: onClassify,
                    onSetSenderName: onSetSenderName,
                    onClearSenderName: onClearSenderName
                )
            }
    }
}


