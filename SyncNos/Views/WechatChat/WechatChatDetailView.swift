import SwiftUI
import UniformTypeIdentifiers
import AppKit

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
                            SystemMessageRow(
                                message: message,
                                onClassify: { msg, isFromMe, kind in
                                    handleClassification(msg, isFromMe: isFromMe, kind: kind, for: contact)
                                }
                            )
                        default:
                            MessageBubble(
                                message: message,
                                onClassify: { msg, isFromMe, kind in
                                    handleClassification(msg, isFromMe: isFromMe, kind: kind, for: contact)
                                }
                            )
                        }
                    }
                }
                .padding()
            }
        }
    }
    
    private func handleClassification(
        _ message: WechatMessage,
        isFromMe: Bool,
        kind: WechatMessageKind,
        for contact: WechatBookListItem
    ) {
        listViewModel.updateMessageClassification(
            messageId: message.id,
            isFromMe: isFromMe,
            kind: kind,
            for: contact.contactId
        )
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

// MARK: - Selectable Text (AppKit) + Conditional Context Menu

/// 在 macOS 上复刻 iMessage 交互：
/// - 无选区：右键显示自定义“消息分类”菜单
/// - 有选区：右键显示系统文本菜单（拷贝/查询/翻译等）
private struct WechatChatSelectableText: NSViewRepresentable {
    struct Style {
        let font: NSFont
        let textColor: NSColor
        let backgroundColor: NSColor
        let cornerRadius: CGFloat
        let shadowColor: NSColor?
        let shadowOpacity: Float
        let shadowRadius: CGFloat
        let shadowOffset: CGSize
        let horizontalPadding: CGFloat
        let verticalPadding: CGFloat
        
        static func bubble(isFromMe: Bool) -> Style {
            Style(
                font: NSFont.systemFont(ofSize: NSFont.systemFontSize),
                textColor: .black,
                backgroundColor: isFromMe
                    ? NSColor(calibratedRed: 0.58, green: 0.92, blue: 0.41, alpha: 1.0) // #95EC69 微信绿
                    : .white,
                cornerRadius: 8,
                shadowColor: .black,
                shadowOpacity: 0.05,
                shadowRadius: 1,
                shadowOffset: CGSize(width: 0, height: -1),
                horizontalPadding: 12,
                verticalPadding: 8
            )
        }
        
        static func system() -> Style {
            Style(
                font: NSFont.preferredFont(forTextStyle: .caption1),
                textColor: .secondaryLabelColor,
                backgroundColor: NSColor.secondaryLabelColor.withAlphaComponent(0.10),
                cornerRadius: 6,
                shadowColor: nil,
                shadowOpacity: 0,
                shadowRadius: 0,
                shadowOffset: .zero,
                horizontalPadding: 12,
                verticalPadding: 6
            )
        }
    }
    
    let text: String
    let isFromMe: Bool
    let kind: WechatMessageKind
    let style: Style
    let onClassify: (Bool, WechatMessageKind) -> Void
    
    func makeCoordinator() -> Coordinator {
        Coordinator(onClassify: onClassify)
    }
    
    func makeNSView(context: Context) -> MenuAwareTextView {
        let textStorage = NSTextStorage()
        let layoutManager = NSLayoutManager()
        let textContainer = NSTextContainer()
        layoutManager.addTextContainer(textContainer)
        textStorage.addLayoutManager(layoutManager)
        
        let textView = MenuAwareTextView(frame: .zero, textContainer: textContainer)
        textView.isEditable = false
        textView.isSelectable = true
        textView.isRichText = false
        textView.importsGraphics = false
        textView.allowsUndo = false
        textView.drawsBackground = false
        textView.backgroundColor = .clear
        textView.textContainer?.lineFragmentPadding = 0
        
        // 渲染与布局
        applyStyle(to: textView)
        applyContent(to: textView, coordinator: context.coordinator)
        
        // 条件菜单
        textView.menuProvider = { [weak coordinator = context.coordinator] in
            coordinator?.makeMenu()
        }
        
        return textView
    }
    
    func updateNSView(_ nsView: MenuAwareTextView, context: Context) {
        context.coordinator.isFromMe = isFromMe
        context.coordinator.kind = kind
        context.coordinator.onClassify = onClassify
        
        applyStyle(to: nsView)
        applyContent(to: nsView, coordinator: context.coordinator)
    }
    
    func sizeThatFits(_ proposal: ProposedViewSize, nsView: MenuAwareTextView, context: Context) -> CGSize? {
        guard let textContainer = nsView.textContainer,
              let layoutManager = nsView.layoutManager else {
            return nil
        }
        
        let maxWidth = proposal.width ?? 520
        let horizontalPadding = style.horizontalPadding
        let verticalPadding = style.verticalPadding
        
        let containerWidth = max(0, maxWidth - horizontalPadding * 2)
        textContainer.containerSize = CGSize(width: containerWidth, height: .greatestFiniteMagnitude)
        layoutManager.ensureLayout(for: textContainer)
        
        let used = layoutManager.usedRect(for: textContainer)
        let width = min(ceil(used.width) + horizontalPadding * 2, maxWidth)
        let height = ceil(used.height) + verticalPadding * 2
        return CGSize(width: width, height: height)
    }
    
    private func applyContent(to textView: MenuAwareTextView, coordinator: Coordinator) {
        if textView.string != text {
            textView.string = text
        }
        textView.font = style.font
        textView.textColor = style.textColor
        textView.textContainerInset = NSSize(width: style.horizontalPadding, height: style.verticalPadding)
        
        coordinator.isFromMe = isFromMe
        coordinator.kind = kind
    }
    
    private func applyStyle(to textView: MenuAwareTextView) {
        textView.wantsLayer = true
        if let layer = textView.layer {
            layer.backgroundColor = style.backgroundColor.cgColor
            layer.cornerRadius = style.cornerRadius
            layer.masksToBounds = false
            
            if let shadowColor = style.shadowColor {
                layer.shadowColor = shadowColor.cgColor
                layer.shadowOpacity = style.shadowOpacity
                layer.shadowRadius = style.shadowRadius
                layer.shadowOffset = style.shadowOffset
            } else {
                layer.shadowOpacity = 0
            }
        }
    }
    
    // MARK: - Coordinator
    
    final class Coordinator: NSObject {
        var isFromMe: Bool = false
        var kind: WechatMessageKind = .text
        var onClassify: (Bool, WechatMessageKind) -> Void
        
        init(onClassify: @escaping (Bool, WechatMessageKind) -> Void) {
            self.onClassify = onClassify
        }
        
        func makeMenu() -> NSMenu {
            let menu = NSMenu()
            
            let otherItem = NSMenuItem(title: "对方消息", action: #selector(classifyOther), keyEquivalent: "")
            otherItem.target = self
            otherItem.state = (!isFromMe && kind != .system) ? .on : .off
            menu.addItem(otherItem)
            
            let meItem = NSMenuItem(title: "我的消息", action: #selector(classifyMe), keyEquivalent: "")
            meItem.target = self
            meItem.state = (isFromMe && kind != .system) ? .on : .off
            menu.addItem(meItem)
            
            menu.addItem(.separator())
            
            let systemItem = NSMenuItem(title: "系统消息", action: #selector(classifySystem), keyEquivalent: "")
            systemItem.target = self
            systemItem.state = (kind == .system) ? .on : .off
            menu.addItem(systemItem)
            
            return menu
        }
        
        @objc private func classifyOther() {
            onClassify(false, .text)
        }
        
        @objc private func classifyMe() {
            onClassify(true, .text)
        }
        
        @objc private func classifySystem() {
            onClassify(false, .system)
        }
    }
    
    // MARK: - NSTextView subclass
    
    final class MenuAwareTextView: NSTextView {
        var menuProvider: (() -> NSMenu?)?
        
        override func menu(for event: NSEvent) -> NSMenu? {
            if selectedRange.length > 0 {
                return super.menu(for: event)
            }
            return menuProvider?() ?? super.menu(for: event)
        }
    }
}

// MARK: - Message Bubble

private struct MessageBubble: View {
    let message: WechatMessage
    let onClassify: (WechatMessage, Bool, WechatMessageKind) -> Void

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
                
                WechatChatSelectableText(
                    text: messageContent,
                    isFromMe: message.isFromMe,
                    kind: message.kind,
                    style: .bubble(isFromMe: message.isFromMe),
                    onClassify: { isFromMe, kind in
                        onClassify(message, isFromMe, kind)
                    }
                )
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
    let message: WechatMessage
    let onClassify: (WechatMessage, Bool, WechatMessageKind) -> Void

    var body: some View {
        WechatChatSelectableText(
            text: message.content,
            isFromMe: message.isFromMe,
            kind: message.kind,
            style: .system(),
            onClassify: { isFromMe, kind in
                onClassify(message, isFromMe, kind)
            }
        )
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


