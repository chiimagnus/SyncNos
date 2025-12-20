import SwiftUI
import UniformTypeIdentifiers

// MARK: - Wechat Chat List View

/// 微信联系人列表视图（左侧栏）
struct WechatChatListView: View {
    @ObservedObject var viewModel: WechatChatViewModel
    @Binding var selectionIds: Set<String>
    
    @State private var showFilePicker = false
    @EnvironmentObject private var fontScaleManager: FontScaleManager
    @ObservedObject private var ocrConfigStore = OCRConfigStore.shared
    
    var body: some View {
        VStack(spacing: 0) {
            // 工具栏
            toolbar
            
            Divider()
            
            // 联系人列表
            if viewModel.contacts.isEmpty {
                emptyStateView
            } else {
                contactList
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
                    await viewModel.importScreenshots(urls: urls)
                }
            case .failure(let error):
                viewModel.errorMessage = error.localizedDescription
            }
        }
        .alert("错误", isPresented: .constant(viewModel.errorMessage != nil)) {
            Button("确定") {
                viewModel.errorMessage = nil
            }
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
    }
    
    // MARK: - Toolbar
    
    private var toolbar: some View {
        HStack {
            Button {
                showFilePicker = true
            } label: {
                Label("导入截图", systemImage: "photo.badge.plus")
            }
            .buttonStyle(.borderless)
            .disabled(!ocrConfigStore.isConfigured || viewModel.isLoading)
            
            Spacer()
            
            if viewModel.isLoading {
                ProgressView()
                    .scaleEffect(0.7)
            }
            
            if !viewModel.contacts.isEmpty {
                Text("\(viewModel.contacts.count) 个对话")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color(NSColor.controlBackgroundColor))
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
                Text("点击「导入截图」添加微信聊天截图")
                    .scaledFont(.caption)
                    .foregroundColor(.secondary)
                
                Button {
                    showFilePicker = true
                } label: {
                    Label("导入截图", systemImage: "photo.badge.plus")
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
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
                        Button {
                            viewModel.copyToClipboard(for: contact.contactId)
                        } label: {
                            Label("复制聊天记录", systemImage: "doc.on.doc")
                        }
                        
                        Divider()
                        
                        Button(role: .destructive) {
                            viewModel.deleteContact(contact)
                        } label: {
                            Label("删除", systemImage: "trash")
                        }
                    }
            }
        }
        .listStyle(.sidebar)
    }
}

// MARK: - Contact Row

private struct ContactRow: View {
    let contact: WechatBookListItem
    
    var body: some View {
        HStack(spacing: 12) {
            // 头像
            Circle()
                .fill(Color(contact.avatarColor))
                .frame(width: 40, height: 40)
                .overlay {
                    Text(contact.name.prefix(1))
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.white)
                }
            
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    // 联系人名称
                    Text(contact.name)
                        .font(.system(size: 14, weight: .medium))
                        .lineLimit(1)
                    
                    if contact.isGroup {
                        Image(systemName: "person.2.fill")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    
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

