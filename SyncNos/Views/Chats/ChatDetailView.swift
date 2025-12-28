import SwiftUI
import UniformTypeIdentifiers

// MARK: - Chat Detail View (V2)

/// Chat detail view (right panel)
/// V2：展示气泡消息（我/对方）+ 居中系统/时间戳文本（不做关键词识别）
struct ChatDetailView: View {
    @ObservedObject var listViewModel: ChatViewModel
    @Binding var selectedContactId: String?
    /// 由外部（MainListView）注入：解析当前 Detail 的 NSScrollView，供键盘滚动使用
    var onScrollViewResolved: (NSScrollView) -> Void

    @State private var showOCRPayloadSheet = false
    @State private var showImporter = false
    @State private var importerMode: ImporterMode?
    @State private var importerAllowedContentTypes: [UTType] = []
    @State private var importerAllowsMultipleSelection = false
    @State private var pendingImportContactId: UUID?
    @State private var showExportSavePanel = false
    @State private var exportDocument: ChatExportDocument?
    @State private var exportFileName: String = ""
    @State private var selectedMessageId: UUID?
    @State private var scrollProxy: ScrollViewProxy?
    @State private var isDragTargeted = false
    @Environment(\.fontScale) private var fontScale
    @ObservedObject private var ocrConfigStore = OCRConfigStore.shared

    private var selectedContact: ChatBookListItem? {
        guard let id = selectedContactId else { return nil }
        return listViewModel.contacts.first { $0.id == id }
    }

    /// 使用分页加载的消息（已按 order 排序）
    private var messages: [ChatMessage] {
        guard let contact = selectedContact else { return [] }
        return listViewModel.getLoadedMessages(for: contact.contactId)
    }
    
    /// 是否可以加载更多（用于显示顶部加载指示器）
    private var canLoadMore: Bool {
        guard let contact = selectedContact else { return false }
        return listViewModel.canLoadMore(for: contact.contactId)
    }
    
    /// 是否正在加载更多
    private var isLoadingMore: Bool {
        guard let contact = selectedContact else { return false }
        return listViewModel.isLoadingMore(for: contact.contactId)
    }
    
    /// 是否已完成首次加载
    private var hasInitiallyLoaded: Bool {
        guard let contact = selectedContact else { return false }
        return listViewModel.hasInitiallyLoaded(for: contact.contactId)
    }
    
    private var markdownUTType: UTType {
        UTType(filenameExtension: "md") ?? .plainText
    }
    
    private enum ImporterMode {
        case images
        case conversationFile
    }

    var body: some View {
        if let contact = selectedContact {
            // 使用 ZStack 包裹 contentView，确保修饰符在视图切换时不会丢失
            ZStack {
                contentView(for: contact)
            }
            .navigationTitle(contact.name)
            .navigationSubtitle("\(contact.messageCount) messages")
            .toolbar {
                    ToolbarItem(placement: .automatic) {
                        Spacer()
                    }

                    ToolbarItemGroup {
                        if listViewModel.isLoading {
                            ProgressView()
                                .scaleEffect(0.7)
                        }

                        // 统一的导入/导出菜单
                        Menu {
                            // 导入部分
                            Button {
                                DIContainer.shared.loggerService.debug("[Chats] Import Screenshot button clicked, isConfigured: \(ocrConfigStore.isConfigured), isLoading: \(listViewModel.isLoading)")
                                guard ocrConfigStore.isConfigured else {
                                    listViewModel.errorMessage = "Please configure OCR service first"
                                    return
                                }
                                guard !listViewModel.isLoading else {
                                    return
                                }
                                pendingImportContactId = contact.contactId
                                importerMode = .images
                                importerAllowedContentTypes = [.image]
                                importerAllowsMultipleSelection = true
                                showImporter = true
                            } label: {
                                Label("Import Screenshot (OCR)", systemImage: "photo.badge.plus")
                            }
                            
                            Button {
                                guard !listViewModel.isLoading else { return }
                                pendingImportContactId = contact.contactId
                                importerMode = .conversationFile
                                importerAllowedContentTypes = [.json, markdownUTType]
                                importerAllowsMultipleSelection = false
                                showImporter = true
                            } label: {
                                Label("Import from JSON/Markdown", systemImage: "square.and.arrow.down")
                            }
                            
                            Divider()
                            
                            // 导出部分
                            Button {
                                if contact.messageCount > 0 {
                                    prepareExport(for: contact, format: .json)
                                }
                            } label: {
                                Label("Export as JSON", systemImage: "doc.text")
                            }
                            
                            Button {
                                if contact.messageCount > 0 {
                                    prepareExport(for: contact, format: .markdown)
                                }
                            } label: {
                                Label("Export as Markdown", systemImage: "doc.richtext")
                            }
                        } label: {
                            Label("Import/Export", systemImage: "arrow.up.arrow.down.circle")
                        }
                        .help("Import or export chat records")
                        
#if DEBUG
                        Button {
                            showOCRPayloadSheet = true
                        } label: {
                            Label("OCR JSON", systemImage: "doc.text.magnifyingglass")
                        }
                        .disabled(contact.messageCount == 0)
                        .help("View OCR raw data")
#endif
                    }
                }
#if DEBUG
                .sheet(isPresented: $showOCRPayloadSheet) {
                    ChatOCRPayloadSheet(conversationId: contact.id, conversationName: contact.name)
                }
#endif
            // 导出文件保存器
            .fileExporter(
                isPresented: $showExportSavePanel,
                document: exportDocument,
                contentType: exportDocument?.format.utType ?? .json,
                defaultFilename: exportFileName
            ) { result in
                switch result {
                case .success(let url):
                    DIContainer.shared.loggerService.info("[Chats] Exported to: \(url.path)")
                case .failure(let error):
                    listViewModel.errorMessage = "Export failed: \(error.localizedDescription)"
                }
                exportDocument = nil
            }
            // 导入（统一入口）：避免多个 `.fileImporter` 修饰符互相覆盖导致“某个 importer 不弹”的问题
            .fileImporter(
                isPresented: $showImporter,
                allowedContentTypes: importerAllowedContentTypes,
                allowsMultipleSelection: importerAllowsMultipleSelection
            ) { result in
                guard let mode = importerMode,
                      let contactId = pendingImportContactId else {
                    importerMode = nil
                    pendingImportContactId = nil
                    return
                }

                // 立刻清空上下文，避免重复触发
                importerMode = nil
                pendingImportContactId = nil

                let isUserCancelled: (Error) -> Bool = { error in
                    let nsError = error as NSError
                    return nsError.domain == NSCocoaErrorDomain && nsError.code == NSUserCancelledError
                }

                switch mode {
                case .images:
                    switch result {
                    case .success(let urls):
                        guard !urls.isEmpty else { return }
                        Task { @MainActor in
                            await listViewModel.addScreenshots(to: contactId, urls: urls)
                        }
                    case .failure(let error):
                        guard !isUserCancelled(error) else { return }
                        listViewModel.errorMessage = "Import failed: \(error.localizedDescription)"
                    }

                case .conversationFile:
                    switch result {
                    case .success(let urls):
                        guard let url = urls.first else { return }
                        Task { @MainActor in
                            do {
                                try await listViewModel.importConversation(from: url, appendTo: contactId)
                            } catch {
                                listViewModel.errorMessage = error.localizedDescription
                            }
                        }
                    case .failure(let error):
                        guard !isUserCancelled(error) else { return }
                        listViewModel.errorMessage = error.localizedDescription
                    }
                }
            }
            // 拖拽功能
            .onDrop(of: [.fileURL, .image], isTargeted: $isDragTargeted) { providers in
                handleDrop(providers, for: contact)
                return true
            }
            .overlay {
                if isDragTargeted {
                    dropTargetOverlay
                }
            }
        } else {
            emptySelectionView
        }
    }

    // MARK: - Content

    @ViewBuilder
    private func contentView(for contact: ChatBookListItem) -> some View {
        // 情况1：首次加载尚未完成 → 显示加载中（并触发加载）
        if !hasInitiallyLoaded {
            ZStack {
                // 重要：与其它数据源保持一致——即使是“加载中/空状态”，也保证 Detail 有一个可解析的 ScrollView，
                // 这样 MainListView 的 ←/→ 键盘焦点切换就不会因为 currentDetailScrollView 为 nil 而失效。
                ScrollView {
                    Color.clear
                        .frame(height: 0)
                        .id("chatsDetailTop")
                        .background(
                            EnclosingScrollViewReader { scrollView in
                                onScrollViewResolved(scrollView)
                            }
                        )
                }
                .id(contact.contactId)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                
                VStack {
                    ProgressView()
                    Text("Loading...")
                        .scaledFont(.caption)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .task(id: contact.contactId) {
                await listViewModel.loadInitialMessages(for: contact.contactId)
            }
        // 情况2：首次加载完成 + 无消息 → 显示空状态
        } else if messages.isEmpty {
            ZStack {
                // 同“加载中”分支：空状态也提供一个 ScrollView 以支持键盘焦点切换。
                ScrollView {
                    Color.clear
                        .frame(height: 0)
                        .id("chatsDetailTop")
                        .background(
                            EnclosingScrollViewReader { scrollView in
                                onScrollViewResolved(scrollView)
                            }
                        )
                }
                .id(contact.contactId)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                
                emptyMessagesView(contact: contact)
            }
        // 情况3：有消息 → 显示消息列表
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 8) {
                        // 顶部锚点，用于解析 NSScrollView
                        Color.clear
                            .frame(height: 0)
                            .id("chatsDetailTop")
                            .background(
                                EnclosingScrollViewReader { scrollView in
                                    onScrollViewResolved(scrollView)
                                }
                            )
                        
                        // 顶部加载更多指示器
                        if canLoadMore {
                            HStack(spacing: 8) {
                                if isLoadingMore {
                                    ProgressView()
                                        .scaleEffect(0.7)
                                    Text("Loading more...")
                                        .scaledFont(.caption)
                                        .foregroundColor(.secondary)
                                } else {
                                    Button {
                                        loadMoreAndPreservePosition(for: contact, proxy: proxy)
                                    } label: {
                                        Text("Load earlier messages")
                                            .scaledFont(.caption)
                                            .foregroundColor(.accentColor)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .id("loadMoreIndicator")
                            // 当用户滚动到顶部加载条可见时，自动加载上一页（仅触发一次；加载完成后会被 scrollTo 锚回，避免连锁加载）
                            .onAppear {
                                guard !isLoadingMore else { return }
                                loadMoreAndPreservePosition(for: contact, proxy: proxy)
                            }
                        }
                        
                        ForEach(messages, id: \.id) { message in
                            Group {
                                switch message.kind {
                                case .system:
                                    ChatSystemMessageRow(
                                        message: message,
                                        isSelected: selectedMessageId == message.id,
                                        onTap: { selectedMessageId = message.id },
                                        onClassify: { isFromMe, kind in
                                            handleClassification(message, isFromMe: isFromMe, kind: kind, for: contact)
                                        }
                                    )
                                default:
                                    ChatMessageBubble(
                                        message: message,
                                        isSelected: selectedMessageId == message.id,
                                        onTap: { selectedMessageId = message.id },
                                        onClassify: { isFromMe, kind in
                                            handleClassification(message, isFromMe: isFromMe, kind: kind, for: contact)
                                        }
                                    )
                                }
                            }
                            .id(compositeId(for: message))
                        }
                    }
                    .padding()
                }
                .id(contact.contactId) // 为不同对话创建独立的 ScrollView 实例，避免滚动状态在对话间串联
                .defaultScrollAnchor(.bottom) // 默认显示底部（最新消息）
                .onAppear {
                    scrollProxy = proxy
                }
                .onChange(of: selectedContactId) { _, _ in
                    selectedMessageId = nil
                }
                // 监听来自 MainListView 的消息导航通知
                .onReceive(NotificationCenter.default.publisher(for: .chatsNavigateMessage).receive(on: DispatchQueue.main)) { notification in
                    guard let userInfo = notification.userInfo,
                          let direction = userInfo["direction"] as? String else { return }
                    navigateMessage(direction: direction == "up" ? .up : .down, proxy: proxy)
                }
                // 监听来自 MainListView 的分类切换通知
                .onReceive(NotificationCenter.default.publisher(for: .chatsCycleClassification).receive(on: DispatchQueue.main)) { notification in
                    guard let userInfo = notification.userInfo,
                          let direction = userInfo["direction"] as? String else { return }
                    cycleClassification(direction: direction == "left" ? .left : .right, for: contact)
                }
            }
        }
    }
    
    // MARK: - Pagination Trigger (Preserve Scroll Position)
    
    /// 加载更早的消息（prepend）并保持当前视口位置，避免由于 prepend 导致的“连锁 onAppear 触发 → 自动把所有历史拉完”
    private func loadMoreAndPreservePosition(for contact: ChatBookListItem, proxy: ScrollViewProxy) {
        guard listViewModel.canLoadMore(for: contact.contactId),
              !listViewModel.isLoadingMore(for: contact.contactId) else { return }
        
        // 记录 prepend 之前的“第一条消息”，用于加载完成后把视口锚回，避免跳到最顶部从而连锁触发自动加载
        let anchorId: String? = listViewModel
            .getLoadedMessages(for: contact.contactId)
            .first
            .map { compositeId(for: $0) }
        
        Task { @MainActor in
            await listViewModel.loadMoreMessages(for: contact.contactId)
            
            // 等待一次 runloop，确保新数据已进入布局，再把视口锚回到旧的第一条消息
            guard let anchorId else { return }
            DispatchQueue.main.async {
                withAnimation(nil) { proxy.scrollTo(anchorId, anchor: .top) }
            }
        }
    }
    
    // MARK: - Keyboard Navigation
    
    private enum NavigationDirection {
        case up, down
    }
    
    private enum ClassificationDirection {
        case left, right
    }
    
    /// 生成复合 ID，用于 ScrollViewReader 导航和视图标识
    private func compositeId(for message: ChatMessage) -> String {
        "\(message.id.uuidString)-\(message.kind.rawValue)"
    }
    
    /// 消息分类状态（用于循环切换）
    private enum MessageClassification {
        case other   // 对方消息：isFromMe = false, kind != .system
        case system  // 系统消息：kind == .system
        case me      // 我的消息：isFromMe = true, kind != .system
        
        init(from message: ChatMessage) {
            if message.kind == .system {
                self = .system
            } else if message.isFromMe {
                self = .me
            } else {
                self = .other
            }
        }
        
        var isFromMe: Bool {
            switch self {
            case .me: return true
            case .other, .system: return false
            }
        }
        
        var kind: ChatMessageKind {
            switch self {
            case .system: return .system
            case .me, .other: return .text
            }
        }
        
        func next(direction: ClassificationDirection) -> MessageClassification {
            switch (direction, self) {
            case (.right, .other): return .system
            case (.right, .system): return .me
            case (.right, .me): return .other
            case (.left, .other): return .me
            case (.left, .system): return .other
            case (.left, .me): return .system
            }
        }
    }
    
    private func navigateMessage(direction: NavigationDirection, proxy: ScrollViewProxy) {
        guard !messages.isEmpty else { return }
        
        if let currentId = selectedMessageId,
           let currentIndex = messages.firstIndex(where: { $0.id == currentId }) {
            let newIndex: Int
            switch direction {
            case .up:
                // 顶部不回绕
                newIndex = max(0, currentIndex - 1)
            case .down:
                // 底部不回绕
                newIndex = min(messages.count - 1, currentIndex + 1)
            }
            // 到边界就不再滚动/跳转
            guard newIndex != currentIndex else { return }
            let newMessage = messages[newIndex]
            selectedMessageId = newMessage.id
            withAnimation(.easeInOut(duration: 0.2)) {
                proxy.scrollTo(compositeId(for: newMessage), anchor: .center)
            }
        } else {
            // 无选中时：从底部（最新消息）开始
            let message = messages.last
            selectedMessageId = message?.id
            if let message {
                withAnimation(.easeInOut(duration: 0.2)) {
                    proxy.scrollTo(compositeId(for: message), anchor: .center)
                }
            }
        }
    }
    
    private func cycleClassification(direction: ClassificationDirection, for contact: ChatBookListItem) {
        guard let messageId = selectedMessageId,
              let message = messages.first(where: { $0.id == messageId }) else { return }
        
        let current = MessageClassification(from: message)
        let next = current.next(direction: direction)
        
        // 延迟到下一个事件循环，避免在视图更新中发布变更
        Task { @MainActor in
            handleClassification(message, isFromMe: next.isFromMe, kind: next.kind, for: contact)
        }
    }
    
    private func handleClassification(
        _ message: ChatMessage,
        isFromMe: Bool,
        kind: ChatMessageKind,
        for contact: ChatBookListItem
    ) {
        listViewModel.updateMessageClassification(
            messageId: message.id,
            isFromMe: isFromMe,
            kind: kind,
            for: contact.contactId
        )
    }

    // MARK: - Export Helper
    
    private func prepareExport(for contact: ChatBookListItem, format: ChatExportFormat) {
        // 异步加载全部消息后导出
        Task { @MainActor in
            guard let content = await listViewModel.exportAllMessages(contact.contactId, format: format),
                  !content.isEmpty else {
                listViewModel.errorMessage = "Export failed: Unable to get message content"
                return
            }
            
            // 设置导出文档和文件名
            exportDocument = ChatExportDocument(content: content, format: format)
            exportFileName = ChatExporter.generateFileName(contactName: contact.name, format: format)
            showExportSavePanel = true
        }
    }
    
    // MARK: - Drag & Drop
    
    private var dropTargetOverlay: some View {
            VStack(spacing: 12) {
                Image(systemName: "arrow.down.doc.fill")
                    .font(.system(size: 48 * fontScale))
                    .foregroundColor(.white)
                
                Text("Drop files here")
                    .scaledFont(.headline)
                    .foregroundColor(.white)
                
                Text("Supported: Images (OCR), JSON, Markdown")
                    .scaledFont(.caption)
                    .foregroundColor(.white.opacity(0.8))
            }
            .padding(32)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color.accentColor.opacity(0.9))
            )
        .allowsHitTesting(false)
    }
    
    private func handleDrop(_ providers: [NSItemProvider], for contact: ChatBookListItem) {
        for provider in providers {
            // 优先处理文件 URL
            if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, error in
                    guard let data = item as? Data,
                          let url = URL(dataRepresentation: data, relativeTo: nil) else {
                        return
                    }
                    
                    Task { @MainActor in
                        await handleDroppedFileURL(url, for: contact)
                    }
                }
            }
            // 处理直接拖入的图片（非文件 URL）
            else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, error in
                    guard let data else { return }
                    Task { @MainActor in
                        await handleDroppedImageData(data, for: contact)
                    }
                }
            }
        }
    }
    
    /// 处理拖拽的文件 URL
    /// 拖拽操作授予了对文件的访问权限，可以直接读取
    private func handleDroppedFileURL(_ url: URL, for contact: ChatBookListItem) async {
        let fileExtension = url.pathExtension.lowercased()
        
        // 图片文件 → OCR 识别
        if ["png", "jpg", "jpeg", "gif", "heic", "webp", "tiff", "bmp"].contains(fileExtension) {
            guard ocrConfigStore.isConfigured else {
                listViewModel.errorMessage = "Please configure OCR service first"
                return
            }
            
            // 拖拽授予了访问权限，直接传递 URL
            await listViewModel.addScreenshots(to: contact.contactId, urls: [url])
            return
        }
        
        // JSON/MD 文件 → 导入
        if ["json", "md", "markdown"].contains(fileExtension) {
            do {
                try await listViewModel.importConversation(from: url, appendTo: contact.contactId)
            } catch {
                listViewModel.errorMessage = "Import failed: \(error.localizedDescription)"
            }
            return
        }
        
        listViewModel.errorMessage = "Unsupported file type: .\(fileExtension)"
    }
    
    private func handleDroppedImageData(_ data: Data, for contact: ChatBookListItem) async {
        guard ocrConfigStore.isConfigured else {
            listViewModel.errorMessage = "Please configure OCR service first"
            return
        }
        
        // 直接走内存数据导入路径：无需落盘临时文件
        await listViewModel.addScreenshotData(to: contact.contactId, imageDatas: [data])
    }

    // MARK: - Empty States

    private func emptyMessagesView(contact: ChatBookListItem) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "photo.on.rectangle.angled")
                .font(.system(size: 40 * fontScale))
                .foregroundColor(.secondary)

            Text("No Messages")
                .scaledFont(.headline)
                .foregroundColor(.secondary)

            Text("Click \"Import Screenshot\" above to add chat records")
                .scaledFont(.caption)
                .foregroundColor(.secondary)

            Button {
                guard ocrConfigStore.isConfigured else {
                    listViewModel.errorMessage = "Please configure OCR service first"
                    return
                }
                pendingImportContactId = contact.contactId
                importerMode = .images
                importerAllowedContentTypes = [.image]
                importerAllowsMultipleSelection = true
                showImporter = true
            } label: {
                Label("Import Screenshot", systemImage: "photo.badge.plus")
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
                .font(.system(size: 48 * fontScale))
                .foregroundColor(.secondary)
            Text("Select a conversation")
                .scaledFont(.title3)
                .foregroundColor(.secondary)
            Text("Select a contact from the left list to view chat history")
                .scaledFont(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#Preview {
    ChatDetailView(
        listViewModel: ChatViewModel(),
        selectedContactId: .constant(nil),
        onScrollViewResolved: { _ in }
    )
    .applyFontScale()
    .frame(width: 500, height: 600)
}
