import SwiftUI

// MARK: - Wechat Chat Detail View

/// 微信聊天记录详情视图（右侧栏）
struct WechatChatDetailView: View {
    @ObservedObject var listViewModel: WechatChatViewModel
    @Binding var selectedContactId: String?
    
    @EnvironmentObject private var fontScaleManager: FontScaleManager
    
    private var selectedContact: WechatBookListItem? {
        guard let id = selectedContactId else { return nil }
        return listViewModel.contacts.first { $0.id == id }
    }
    
    private var messages: [WechatMessage] {
        guard let contact = selectedContact else { return [] }
        return listViewModel.getMessages(for: contact.contactId)
    }
    
    var body: some View {
        if let contact = selectedContact {
            VStack(spacing: 0) {
                // 标题栏
                headerView(contact: contact)
                
                Divider()
                
                // 消息列表
                if messages.isEmpty {
                    emptyMessagesView
                } else {
                    messageListView
                }
            }
        } else {
            emptySelectionView
        }
    }
    
    // MARK: - Header
    
    private func headerView(contact: WechatBookListItem) -> some View {
        HStack {
            // 头像
            Circle()
                .fill(Color(contact.avatarColor))
                .frame(width: 32, height: 32)
                .overlay {
                    Text(contact.name.prefix(1))
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.white)
                }
            
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(contact.name)
                        .font(.headline)
                    
                    if contact.isGroup {
                        Image(systemName: "person.2.fill")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
                
                Text("\(contact.messageCount) 条消息")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            Spacer()
            
            // 复制按钮
            Button {
                listViewModel.copyToClipboard(for: contact.contactId)
            } label: {
                Label("复制", systemImage: "doc.on.doc")
            }
            .buttonStyle(.borderless)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color(NSColor.controlBackgroundColor))
    }
    
    // MARK: - Message List
    
    private var messageListView: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                ForEach(messages) { message in
                    MessageRow(message: message)
                }
            }
            .padding()
        }
        .background(Color(NSColor.textBackgroundColor).opacity(0.5))
    }
    
    // MARK: - Empty States
    
    private var emptyMessagesView: some View {
        VStack(spacing: 12) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.system(size: 40))
                .foregroundColor(.secondary)
            Text("暂无消息")
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    
    private var emptySelectionView: some View {
        VStack(spacing: 16) {
            Image(systemName: "message.fill")
                .font(.system(size: 48))
                .foregroundColor(.secondary)
            Text("选择一个对话")
                .scaledFont(.title3)
                .foregroundColor(.secondary)
            Text("从左侧列表选择联系人查看聊天记录")
                .scaledFont(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Message Row

private struct MessageRow: View {
    let message: WechatMessage
    
    var body: some View {
        switch message.type {
        case .timestamp:
            TimestampRow(text: message.content)
        case .system:
            SystemMessageRow(text: message.content)
        case .text, .image, .voice:
            MessageBubble(message: message)
        }
    }
}

// MARK: - Timestamp Row

private struct TimestampRow: View {
    let text: String
    
    var body: some View {
        HStack {
            Rectangle()
                .fill(Color.secondary.opacity(0.3))
                .frame(height: 1)
            
            Text(text)
                .font(.caption)
                .foregroundColor(.secondary)
                .padding(.horizontal, 8)
            
            Rectangle()
                .fill(Color.secondary.opacity(0.3))
                .frame(height: 1)
        }
        .padding(.vertical, 8)
    }
}

// MARK: - System Message Row

private struct SystemMessageRow: View {
    let text: String
    
    var body: some View {
        Text(text)
            .font(.caption)
            .foregroundColor(.secondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.secondary.opacity(0.1))
            .cornerRadius(4)
    }
}

// MARK: - Message Bubble

private struct MessageBubble: View {
    let message: WechatMessage
    
    private let myBubbleColor = Color(red: 0.58, green: 0.92, blue: 0.41) // #95EC69 微信绿
    private let otherBubbleColor = Color.white
    
    var body: some View {
        HStack {
            if message.isFromMe {
                Spacer(minLength: 60)
            }
            
            VStack(alignment: message.isFromMe ? .trailing : .leading, spacing: 4) {
                // 发送者昵称（群聊）
                if let name = message.senderName, !message.isFromMe {
                    Text(name)
                        .font(.caption2)
                        .foregroundColor(Color(red: 0.34, green: 0.42, blue: 0.58)) // #576B95 微信蓝
                }
                
                // 消息内容
                Text(messageContent)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(message.isFromMe ? myBubbleColor : otherBubbleColor)
                    .foregroundColor(.black)
                    .cornerRadius(8)
                    .shadow(color: .black.opacity(0.05), radius: 1, x: 0, y: 1)
            }
            
            if !message.isFromMe {
                Spacer(minLength: 60)
            }
        }
    }
    
    private var messageContent: String {
        switch message.type {
        case .image:
            return "[图片]"
        case .voice:
            return "[语音]"
        default:
            return message.content
        }
    }
}

// MARK: - Preview

#Preview {
    WechatChatDetailView(
        listViewModel: WechatChatViewModel(),
        selectedContactId: .constant(nil)
    )
    .environmentObject(FontScaleManager.shared)
    .frame(width: 500, height: 600)
}

