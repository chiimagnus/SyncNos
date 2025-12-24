import SwiftUI
import UniformTypeIdentifiers

// MARK: - Wechat Chat Detail View (V2)

/// 微信聊天记录详情视图（右侧栏）
/// V2：展示气泡消息（我/对方）+ 居中系统/时间戳文本（不做关键词识别）
struct WechatChatDetailView: View {
    @ObservedObject var listViewModel: WechatChatViewModel
    @Binding var selectedContactId: String?

    @State private var showFilePicker = false
    @State private var showOCRPayloadSheet = false
    @EnvironmentObject private var fontScaleManager: FontScaleManager
    @ObservedObject private var ocrConfigStore = OCRConfigStore.shared

    private var selectedContact: WechatBookListItem? {
        guard let id = selectedContactId else { return nil }
        return listViewModel.contacts.first { $0.id == id }
    }

    private var messages: [WechatMessage] {
        guard let contact = selectedContact else { return [] }
        return listViewModel.getMessages(for: contact.contactId)
            .sorted(by: { $0.order < $1.order })
    }

    var body: some View {
        if let contact = selectedContact {
            contentView(for: contact)
                .navigationTitle(contact.name)
                .navigationSubtitle("\(contact.messageCount) 条消息")
                .toolbar {
                    ToolbarItemGroup {
                        if listViewModel.isLoading {
                            ProgressView()
                                .scaleEffect(0.7)
                        }

                        Button {
                            showFilePicker = true
                        } label: {
                            Label("导入截图", systemImage: "photo.badge.plus")
                        }
                        .disabled(!ocrConfigStore.isConfigured || listViewModel.isLoading)
                        .help("追加聊天截图")

                        Button {
                            listViewModel.copyToClipboard(for: contact.contactId)
                        } label: {
                            Label("复制", systemImage: "doc.on.doc")
                        }
                        .disabled(contact.messageCount == 0)
                        .help("复制全部聊天记录")
                        
#if DEBUG
                        Button {
                            showOCRPayloadSheet = true
                        } label: {
                            Label("OCR JSON", systemImage: "doc.text.magnifyingglass")
                        }
                        .disabled(contact.messageCount == 0)
                        .help("查看 OCR 原始数据")
#endif
                    }
                }
#if DEBUG
                .sheet(isPresented: $showOCRPayloadSheet) {
                    WechatChatOCRPayloadSheet(conversationId: contact.id, conversationName: contact.name)
                }
#endif
                .fileImporter(
                    isPresented: $showFilePicker,
                    allowedContentTypes: [.image],
                    allowsMultipleSelection: true
                ) { result in
                    switch result {
                    case .success(let urls):
                        Task { await listViewModel.addScreenshots(to: contact.contactId, urls: urls) }
                    case .failure(let error):
                        listViewModel.errorMessage = error.localizedDescription
                    }
                }
        } else {
            emptySelectionView
        }
    }

    // MARK: - Content

    @ViewBuilder
    private func contentView(for contact: WechatBookListItem) -> some View {
        if messages.isEmpty {
            emptyMessagesView(contact: contact)
        } else {
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(messages) { message in
                        switch message.kind {
                        case .system:
                            SystemMessageRow(text: message.content)
                        default:
                            MessageBubble(message: message)
                        }
                    }
                }
                .padding()
            }
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
                if let name = message.senderName, !message.isFromMe {
                    Text(name)
                        .font(.caption2)
                        .foregroundColor(Color(red: 0.34, green: 0.42, blue: 0.58)) // #576B95 微信蓝
                }

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

// MARK: - System Message Row

private struct SystemMessageRow: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption)
            .foregroundColor(.secondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.secondary.opacity(0.10))
            .cornerRadius(6)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.vertical, 6)
    }
}

#Preview {
    WechatChatDetailView(
        listViewModel: WechatChatViewModel(),
        selectedContactId: .constant(nil)
    )
    .environmentObject(FontScaleManager.shared)
    .frame(width: 500, height: 600)
}

// MARK: - OCR Payload Sheet (Debug Only)

#if DEBUG

/// 查看当前对话的 OCR Normalized Blocks 数据
private struct WechatChatOCRPayloadSheet: View {
    let conversationId: String
    let conversationName: String
    
    @StateObject private var viewModel = OCRPayloadSheetViewModel()
    @State private var selectedIndex: Int = 0
    
    var body: some View {
        VStack(spacing: 0) {
            // 标题栏
            HStack {
                Text("OCR Blocks: \(conversationName)")
                    .font(.headline)
                
                Spacer()
                
                // 多截图时显示切换器
                if viewModel.payloads.count > 1 {
                    HStack(spacing: 8) {
                        Button {
                            if selectedIndex > 0 {
                                selectedIndex -= 1
                                loadCurrentDetail()
                            }
                        } label: {
                            Image(systemName: "chevron.left")
                        }
                        .disabled(selectedIndex == 0)
                        
                        Text("\(selectedIndex + 1) / \(viewModel.payloads.count)")
                            .font(.caption)
                            .monospacedDigit()
                        
                        Button {
                            if selectedIndex < viewModel.payloads.count - 1 {
                                selectedIndex += 1
                                loadCurrentDetail()
                            }
                        } label: {
                            Image(systemName: "chevron.right")
                        }
                        .disabled(selectedIndex >= viewModel.payloads.count - 1)
                    }
                }
                
                Button {
                    if let detail = viewModel.detail {
                        copyToClipboard(formattedBlocks(detail: detail))
                    }
                } label: {
                    Label("复制", systemImage: "doc.on.doc")
                }
                .controlSize(.small)
                .disabled(viewModel.detail == nil)
            }
            .padding()
            .background(Color(nsColor: .windowBackgroundColor))
            
            Divider()
            
            // 内容区域
            contentView
        }
        .frame(minWidth: 600, minHeight: 400)
        .task {
            await viewModel.reload(conversationId: conversationId)
            loadCurrentDetail()
        }
    }
    
    @ViewBuilder
    private var contentView: some View {
        if let detail = viewModel.detail {
            VStack(spacing: 8) {
                // 元数据
                HStack {
                    Text("导入: \(detail.importedAt.formatted(date: .abbreviated, time: .shortened))")
                    Text("·")
                    Text("解析: \(detail.parsedAt.formatted(date: .abbreviated, time: .shortened))")
                    Spacer()
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
                .padding(.top, 8)
                
                // JSON 内容
                ScrollView {
                    Text(formattedBlocks(detail: detail))
                        .font(.system(size: 11, design: .monospaced))
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(8)
                }
                .background(Color(nsColor: .textBackgroundColor))
                .cornerRadius(6)
                .padding([.horizontal, .bottom], 12)
            }
        } else if viewModel.isLoading {
            ProgressView("加载中...")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = viewModel.errorMessage {
            Text(error)
                .foregroundStyle(.red)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if viewModel.payloads.isEmpty {
            Text("该对话暂无 OCR 数据")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            Text("加载中...")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
    
    private func loadCurrentDetail() {
        guard selectedIndex >= 0, selectedIndex < viewModel.payloads.count else { return }
        let screenshotId = viewModel.payloads[selectedIndex].screenshotId
        Task { await viewModel.loadDetail(screenshotId: screenshotId) }
    }
    
    /// 美化显示 Normalized Blocks JSON
    private func formattedBlocks(detail: WechatOcrPayloadDetail) -> String {
        let raw = detail.normalizedBlocksJSON
        guard let data = raw.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data),
              let pretty = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys]),
              let str = String(data: pretty, encoding: .utf8) else {
            return raw
        }
        return str
    }
    
    private func copyToClipboard(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}

// MARK: - OCR Payload Sheet ViewModel

@MainActor
private final class OCRPayloadSheetViewModel: ObservableObject {
    @Published var payloads: [WechatOcrPayloadSummary] = []
    @Published var detail: WechatOcrPayloadDetail?
    @Published var isLoading = false
    @Published var errorMessage: String?
    
    private let cacheService: WechatChatCacheServiceProtocol = DIContainer.shared.wechatChatCacheService
    
    func reload(conversationId: String) async {
        isLoading = true
        defer { isLoading = false }
        
        do {
            // 获取所有截图，然后过滤当前对话
            let allPayloads = try await cacheService.fetchRecentOcrPayloads(limit: 100)
            payloads = allPayloads.filter { $0.conversationId == conversationId }
            errorMessage = nil
        } catch {
            errorMessage = "加载失败: \(error.localizedDescription)"
        }
    }
    
    func loadDetail(screenshotId: String) async {
        do {
            detail = try await cacheService.fetchOcrPayload(screenshotId: screenshotId)
            errorMessage = nil
        } catch {
            errorMessage = "读取失败: \(error.localizedDescription)"
        }
    }
}

#endif


