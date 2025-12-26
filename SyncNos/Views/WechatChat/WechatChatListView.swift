import SwiftUI
import UniformTypeIdentifiers

// MARK: - Wechat Chat List View

/// 微信联系人列表视图（左侧栏）
/// 注意：「新建对话」功能在底部 filterMenu 中（MainListView 传入）
struct WechatChatListView: View {
    @ObservedObject var viewModel: WechatChatViewModel
    @Binding var selectionIds: Set<String>
    
    /// 用于接收焦点的 FocusState
    @FocusState private var isListFocused: Bool
    
    @EnvironmentObject private var fontScaleManager: FontScaleManager
    @ObservedObject private var ocrConfigStore = OCRConfigStore.shared
    
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
        .alert("错误", isPresented: .constant(viewModel.errorMessage != nil)) {
            Button("确定") {
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
                    .font(.system(size: 40))
                    .foregroundColor(.orange)
                Text("请先配置 PaddleOCR API")
                    .scaledFont(.headline)
                Text("前往 设置 → OCR 设置")
                    .scaledFont(.caption)
                    .foregroundColor(.secondary)
            } else {
                Image(systemName: "message.badge.filled.fill")
                    .font(.system(size: 40))
                    .foregroundColor(.secondary)
                Text("暂无对话")
                    .scaledFont(.headline)
                Text("点击右下角「+」新建对话")
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
                            Label("删除", systemImage: "trash")
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
        .onReceive(NotificationCenter.default.publisher(for: Notification.Name("DataSourceSwitchedToWechatChat")).receive(on: DispatchQueue.main)) { _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                isListFocused = true
            }
        }
    }
}

// MARK: - Contact Row

private struct ContactRow: View {
    let contact: WechatBookListItem
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                // 联系人名称
                Text(contact.name)
                    .font(.system(size: 14, weight: .medium))
                    .lineLimit(1)
                
                Spacer()
                
                // 时间
                if let time = contact.lastMessageTime {
                    Text(time)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            
            HStack {
                // 最后消息预览
                if let lastMessage = contact.lastMessage {
                    Text(lastMessage)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                } else if contact.messageCount == 0 {
                    Text("暂无消息")
                        .font(.caption)
                        .foregroundColor(.secondary.opacity(0.6))
                        .italic()
                }
                
                Spacer()
                
                // 消息数量
                if contact.messageCount > 0 {
                    Text("\(contact.messageCount)")
                        .font(.caption2)
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
    WechatChatListView(
        viewModel: WechatChatViewModel(),
        selectionIds: .constant([])
    )
    .environmentObject(FontScaleManager.shared)
    .frame(width: 300, height: 500)
}
