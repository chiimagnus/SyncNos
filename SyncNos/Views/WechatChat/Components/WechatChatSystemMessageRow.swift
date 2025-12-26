import SwiftUI

struct WechatChatSystemMessageRow: View {
    let message: WechatMessage
    let isSelected: Bool
    let onTap: () -> Void
    let onClassify: (_ isFromMe: Bool, _ kind: WechatMessageKind) -> Void

    private let selectedBorderColor = Color.accentColor

    var body: some View {
        WechatChatSelectableTextView(
            text: message.content,
            isFromMe: message.isFromMe,
            kind: message.kind,
            style: .system(),
            onSelect: onTap,
            onClassify: onClassify
        )
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
    }
}


