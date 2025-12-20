import SwiftUI
import UniformTypeIdentifiers

// MARK: - Wechat Chat Detail View

/// 微信聊天记录详情视图（右侧栏）
struct WechatChatDetailView: View {
    @ObservedObject var listViewModel: WechatChatViewModel
    @Binding var selectedContactId: String?
    
    @State private var showFilePicker = false
    @EnvironmentObject private var fontScaleManager: FontScaleManager
    @ObservedObject private var ocrConfigStore = OCRConfigStore.shared
    
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
            contentView(for: contact)
                .navigationTitle(contact.name)
                .navigationSubtitle("\(contact.messageCount) 条消息")
                .toolbar {
                    ToolbarItemGroup{
                        // 加载指示器
                        if listViewModel.isLoading {
                            ProgressView()
                                .scaleEffect(0.7)
                        }
                        
                        // 导入截图按钮
                        Button {
                            showFilePicker = true
                        } label: {
                            Label("导入截图", systemImage: "photo.badge.plus")
                        }
                        .disabled(!ocrConfigStore.isConfigured || listViewModel.isLoading)
                        .help("追加聊天截图")
                        
                        // 复制按钮
                        Button {
                            listViewModel.copyToClipboard(for: contact.contactId)
                        } label: {
                            Label("复制", systemImage: "doc.on.doc")
                        }
                        .disabled(contact.messageCount == 0)
                        .help("复制全部聊天记录")
                    }
                }
                .fileImporter(
                    isPresented: $showFilePicker,
                    allowedContentTypes: [.image],
                    allowsMultipleSelection: true
                ) { result in
                    switch result {
                    case .success(let urls):
                        Task {
                            await listViewModel.addScreenshots(to: contact.contactId, urls: urls)
                        }
                    case .failure(let error):
                        listViewModel.errorMessage = error.localizedDescription
                    }
                }
        } else {
            emptySelectionView
        }
    }
    
    // MARK: - Content View
    
    @ViewBuilder
    private func contentView(for contact: WechatBookListItem) -> some View {
        if messages.isEmpty {
            emptyMessagesView(contact: contact)
        } else {
            messageListView
        }
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
    }
    
    // MARK: - Empty States
    
    private func emptyMessagesView(contact: WechatBookListItem) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "photo.on.rectangle.angled")
                .font(.system(size: 40))
                .foregroundColor(.secondary)
            
            Text("暂无消息")
                .font(.headline)
                .foregroundColor(.secondary)
            
            Text("点击上方「导入截图」添加聊天记录")
                .font(.caption)
                .foregroundColor(.secondary)
            
            Button {
                showFilePicker = true
            } label: {
                Label("导入截图", systemImage: "photo.badge.plus")
            }
            .buttonStyle(.borderedProminent)
            .tint(.green)
            .disabled(!ocrConfigStore.isConfigured)
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
                    .textSelection(.enabled)
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
