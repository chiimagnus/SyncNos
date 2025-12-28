import SwiftUI
import UniformTypeIdentifiers

// MARK: - Chat List View

/// 联系人列表视图（左侧栏）
/// 注意：「新建对话」功能在底部 filterMenu 中（MainListView 传入）
struct ChatListView: View {
    @ObservedObject var viewModel: ChatViewModel
    @Binding var selectionIds: Set<String>
    
    /// 用于接收焦点的 FocusState
    @FocusState private var isListFocused: Bool
    
    @ObservedObject private var ocrConfigStore = OCRConfigStore.shared
    @Environment(\.fontScale) private var fontScale
    
    var body: some View {
        VStack(spacing: 0) {
            // 联系人列表
            if viewModel.contacts.isEmpty && !viewModel.isLoading {
                emptyStateView
            } else if viewModel.isLoading && viewModel.contacts.isEmpty {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                contactList
            }
        }
        .alert("Error", isPresented: .constant(viewModel.errorMessage != nil)) {
            Button("OK") {
                viewModel.errorMessage = nil
            }
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
        .task {
            // 视图首次出现时从缓存加载
            if viewModel.contacts.isEmpty {
                await viewModel.loadFromCache()
            }
        }
    }
    
    // MARK: - Empty State
    
    private var emptyStateView: some View {
        VStack(spacing: 16) {
            if !ocrConfigStore.isConfigured {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 40 * fontScale))
                    .foregroundColor(.orange)
                Text("Please configure PaddleOCR API first")
                    .scaledFont(.headline)
                Text("Go to Settings → OCR Settings")
                    .scaledFont(.caption)
                    .foregroundColor(.secondary)
            } else {
                Image(systemName: "message.badge.filled.fill")
                    .font(.system(size: 40 * fontScale))
                    .foregroundColor(.secondary)
                Text("No Chats")
                    .scaledFont(.headline)
                Text("Click \"+\" at the bottom right to create a new chat")
                    .scaledFont(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    
    // MARK: - Contact List
    
    private var contactList: some View {
        List(selection: $selectionIds) {
            ForEach(viewModel.contacts) { contact in
                ContactRow(contact: contact)
                    .tag(contact.id)
                    .contextMenu {
                        Button(role: .destructive) {
                            viewModel.deleteContact(contact)
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
            }
        }
        .listStyle(.sidebar)
        .focused($isListFocused)
        .onAppear {
            // 延迟获取焦点，确保视图已完全加载
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                isListFocused = true
            }
        }
        // 监听数据源切换通知，切换到此视图时获取焦点
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("DataSourceSwitchedToChats")).receive(on: DispatchQueue.main)) { _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                isListFocused = true
            }
        }
        // 监听焦点状态更新通知（鼠标点击 DetailView 时同步焦点状态）
        .onReceive(NotificationCenter.default.publisher(for: .listViewShouldUpdateFocus).receive(on: DispatchQueue.main)) { notification in
            // 只处理发给当前数据源的通知
            guard let source = notification.userInfo?["source"] as? String,
                  source == ContentSource.chats.rawValue else { return }
            
            if let focused = notification.userInfo?["focused"] as? Bool {
                isListFocused = focused
            }
        }
    }
}

// MARK: - Contact Row

private struct ContactRow: View {
    let contact: ChatBookListItem
    @Environment(\.fontScale) private var fontScale
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                // Contact name
                Text(contact.name)
                    .scaledFont(.subheadline, weight: .medium)
                    .lineLimit(1)
                
                Spacer()
                
                // Time
                if let time = contact.lastMessageTime {
                    Text(time)
                        .scaledFont(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            
            HStack {
                // Last message preview
                if let lastMessage = contact.lastMessage {
                    Text(lastMessage)
                        .scaledFont(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                } else if contact.messageCount == 0 {
                    Text("No messages")
                        .scaledFont(.caption)
                        .foregroundColor(.secondary.opacity(0.6))
                        .italic()
                }
                
                Spacer()
                
                // Message count
                if contact.messageCount > 0 {
                    Text("\(contact.messageCount)")
                        .scaledFont(.caption2)
                        .foregroundColor(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.green)
                        .clipShape(Capsule())
                }
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Preview

#Preview {
    ChatListView(
        viewModel: ChatViewModel(),
        selectionIds: .constant([])
    )
    .applyFontScale()
    .frame(width: 300, height: 500)
}
