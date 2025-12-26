import SwiftUI

struct WechatChatMessageBubble: View {
    let message: WechatMessage
    let isSelected: Bool
    let onTap: () -> Void
    let onClassify: (_ isFromMe: Bool, _ kind: WechatMessageKind) -> Void

    private let myBubbleColor = Color(red: 0.58, green: 0.92, blue: 0.41) // #95EC69 微信绿
    private let otherBubbleColor = Color.white
    private let selectedBorderColor = Color.accentColor
    private let maxBubbleWidth: CGFloat = 520

    var body: some View {
        HStack {
            if message.isFromMe {
                Spacer(minLength: 60)
            }

            VStack(alignment: message.isFromMe ? .trailing : .leading, spacing: 4) {
                if let name = message.senderName, !message.isFromMe {
                    Text(name)
                        .font(.caption2)
                        .foregroundColor(Color(red: 0.34, green: 0.42, blue: 0.58)) // #576B95 微信蓝
                }

                bubbleBody
            }

            if !message.isFromMe {
                Spacer(minLength: 60)
            }
        }
    }

    private var bubbleBody: some View {
        WechatChatSelectableTextView(
            text: messageContent,
            isFromMe: message.isFromMe,
            kind: message.kind,
            style: .bubble(),
            onSelect: onTap,
            onClassify: onClassify
        )
            .background(message.isFromMe ? myBubbleColor : otherBubbleColor)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(selectedBorderColor, lineWidth: 2)
                    .opacity(isSelected ? 1 : 0)
                    .allowsHitTesting(false)
            )
            .shadow(color: .black.opacity(0.05), radius: 1, x: 0, y: 1)
            .frame(maxWidth: maxBubbleWidth, alignment: message.isFromMe ? .trailing : .leading)
    }

    private var messageContent: String {
        switch message.kind {
        case .system:
            return message.content
        case .image:
            return "[图片]"
        case .voice:
            return "[语音]"
        case .card:
            return message.content.isEmpty ? "[卡片]" : message.content
        case .text:
            return message.content
        }
    }
}


