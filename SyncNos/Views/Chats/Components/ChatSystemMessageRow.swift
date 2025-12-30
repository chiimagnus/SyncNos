import SwiftUI

struct ChatSystemMessageRow: View {
    let message: ChatMessage
    let isSelected: Bool
    let onTap: (_ event: NSEvent?) -> Void  // 传递事件以检测修饰键
    let onClassify: (_ isFromMe: Bool, _ kind: ChatMessageKind) -> Void
    let onSetSenderName: () -> Void
    let onClearSenderName: () -> Void
    let onDelete: () -> Void

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
            .simultaneousGesture(
                TapGesture().modifiers([])
                    .onEnded { _ in
                        onTap(NSApp.currentEvent)
                    }
            )
            .contextMenu {
                ChatMessageContextMenu(
                    text: message.content,
                    isFromMe: message.isFromMe,
                    kind: message.kind,
                    senderName: message.senderName,
                    onSelect: { onTap(nil) },  // 右键菜单不需要修饰键
                    onClassify: onClassify,
                    onSetSenderName: onSetSenderName,
                    onClearSenderName: onClearSenderName,
                    onDelete: onDelete
                )
            }
    }
}


