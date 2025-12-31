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
            Image(systemName: "message.badge.filled.fill")
                .font(.system(size: 40 * fontScale))
                .foregroundColor(.secondary)
            Text("No Chats")
                .scaledFont(.headline)
            Text("Click \"+\" at the bottom right to create a new chat")
                .scaledFont(.caption)
                .foregroundColor(.secondary)
            
            // Screenshot tip
            HStack(spacing: 6) {
                Image(systemName: "lightbulb.fill")
                    .foregroundColor(.yellow)
                Text("Tip: For best OCR results, expand the chat area to fill your screen before taking a screenshot.")
                    .scaledFont(.caption)
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    
    // MARK: - Contact List
    
    private var contactList: some View {
        List(selection: $selectionIds) {
            ForEach(viewModel.contacts) { contact in
                ContactRow(
                    contact: contact,
                    isSyncing: viewModel.syncingContactIds.contains(contact.id)
                )
                    .tag(contact.id)
                    .contextMenu {
                        Button {
                            viewModel.batchSync(contactIds: selectionIds, concurrency: NotionSyncConfig.batchConcurrency)
                        } label: {
                            Label("Sync Selected to Notion", systemImage: "arrow.triangle.2.circlepath.circle")
                        }
                        
                        Divider()
                        
                        Button(role: .destructive) {
                            // 如果删除的是当前选中的，先清除选择
                            selectionIds.remove(contact.id)
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
            // 获取焦点（避免额外延迟引入的竞态）
            DispatchQueue.main.async {
                isListFocused = true
            }
        }
        // 监听 List 焦点请求通知，切换到此视图时获取焦点
        .onReceive(NotificationCenter.default.publisher(for: ContentSource.chats.listFocusRequestedNotification).receive(on: DispatchQueue.main)) { _ in
            DispatchQueue.main.async {
                isListFocused = true
            }
        }
    }
}

// MARK: - Contact Row

private struct ContactRow: View {
    let contact: ChatBookListItem
    let isSyncing: Bool
    @Environment(\.fontScale) private var fontScale
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                // Contact name
                Text(contact.name)
                    .scaledFont(.subheadline, weight: .medium)
                    .lineLimit(1)
                
                Spacer()
                
                // Syncing indicator
                if isSyncing {
                    Image(systemName: "arrow.triangle.2.circlepath.circle.fill")
                        .foregroundColor(.yellow)
                        .help("Syncing...")
                }
                
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
