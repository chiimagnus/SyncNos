import SwiftUI

struct WechatChatSystemMessageRow: View {
    let message: WechatMessage
    let isSelected: Bool
    let onTap: () -> Void
    let onClassify: (_ isFromMe: Bool, _ kind: WechatMessageKind) -> Void

    private let selectedBorderColor = Color.accentColor

    var body: some View {
        Text(message.content)
            .font(.caption)
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.secondary.opacity(0.10))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(selectedBorderColor, lineWidth: 2)
                    .opacity(isSelected ? 1 : 0)
            )
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
            .onTapGesture { onTap() }
            .contextMenu {
                WechatChatClassificationMenu(
                    isFromMe: message.isFromMe,
                    kind: message.kind,
                    onClassify: onClassify
                )
            }
    }
}


