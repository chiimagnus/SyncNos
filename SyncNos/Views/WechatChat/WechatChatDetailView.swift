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
    @State private var selectedMessageId: UUID?
    @FocusState private var isFocused: Bool
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
                    ToolbarItem(placement: .automatic) {
                        Spacer()
                    }

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
            ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(messages) { message in
                        switch message.kind {
                        case .system:
                            SystemMessageRow(
                                message: message,
                                    isSelected: selectedMessageId == message.id,
                                    onTap: { selectedMessageId = message.id },
                                onClassify: { msg, isFromMe, kind in
                                    handleClassification(msg, isFromMe: isFromMe, kind: kind, for: contact)
                                }
                            )
                                .id(compositeId(for: message))
                        default:
                            MessageBubble(
                                message: message,
                                    isSelected: selectedMessageId == message.id,
                                    onTap: { selectedMessageId = message.id },
                                onClassify: { msg, isFromMe, kind in
                                    handleClassification(msg, isFromMe: isFromMe, kind: kind, for: contact)
                                }
                            )
                                .id(compositeId(for: message))
                            }
                        }
                    }
                    .padding()
                }
                .focusable()
                .focused($isFocused)
                .onKeyPress(keys: [.upArrow, .downArrow, .leftArrow, .rightArrow], phases: .down) { keyPress in
                    guard keyPress.modifiers.contains(.option) else { return .ignored }
                    
                    switch keyPress.key {
                    case .upArrow:
                        navigateMessage(direction: .up, proxy: proxy)
                        return .handled
                    case .downArrow:
                        navigateMessage(direction: .down, proxy: proxy)
                        return .handled
                    case .leftArrow:
                        cycleClassification(direction: .left, for: contact)
                        return .handled
                    case .rightArrow:
                        cycleClassification(direction: .right, for: contact)
                        return .handled
                    default:
                        return .ignored
                    }
                }
                .onAppear { isFocused = true }
                .onChange(of: selectedContactId) { _, _ in
                    selectedMessageId = nil
                    isFocused = true
                }
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
    private func compositeId(for message: WechatMessage) -> String {
        "\(message.id.uuidString)-\(message.kind.rawValue)"
    }
    
    /// 消息分类状态（用于循环切换）
    private enum MessageClassification {
        case other   // 对方消息：isFromMe = false, kind != .system
        case system  // 系统消息：kind == .system
        case me      // 我的消息：isFromMe = true, kind != .system
        
        init(from message: WechatMessage) {
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
        
        var kind: WechatMessageKind {
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
                newIndex = currentIndex > 0 ? currentIndex - 1 : messages.count - 1
            case .down:
                newIndex = currentIndex < messages.count - 1 ? currentIndex + 1 : 0
            }
            let newMessage = messages[newIndex]
            selectedMessageId = newMessage.id
            withAnimation(.easeInOut(duration: 0.2)) {
                proxy.scrollTo(compositeId(for: newMessage), anchor: .center)
            }
        } else {
            // 无选中时，选中第一条（向下）或最后一条（向上）
            let message = direction == .down ? messages.first : messages.last
            selectedMessageId = message?.id
            if let message = message {
                withAnimation(.easeInOut(duration: 0.2)) {
                    proxy.scrollTo(compositeId(for: message), anchor: .center)
                }
            }
        }
    }
    
    private func cycleClassification(direction: ClassificationDirection, for contact: WechatBookListItem) {
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
        let horizontalPadding: CGFloat
        let verticalPadding: CGFloat
        
        static func bubble() -> Style {
            Style(
                font: NSFont.systemFont(ofSize: NSFont.systemFontSize),
                textColor: .black,
                horizontalPadding: 12,
                verticalPadding: 8
            )
        }
        
        static func system() -> Style {
            Style(
                font: NSFont.preferredFont(forTextStyle: .caption1),
                textColor: .secondaryLabelColor,
                horizontalPadding: 12,
                verticalPadding: 6
            )
        }
    }
    
    let text: String
    let isFromMe: Bool
    let kind: WechatMessageKind
    let style: Style
    let onSelect: () -> Void
    let onClassify: (Bool, WechatMessageKind) -> Void
    
    func makeCoordinator() -> Coordinator {
        Coordinator(onSelect: onSelect, onClassify: onClassify)
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
        textView.isHorizontallyResizable = false
        textView.isVerticallyResizable = true
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.minSize = .zero
        
        if let textContainer = textView.textContainer {
            textContainer.lineFragmentPadding = 0
            textContainer.lineBreakMode = .byWordWrapping
            textContainer.widthTracksTextView = false
            textContainer.heightTracksTextView = false
        }
        
        // 渲染与布局
        applyContent(to: textView, coordinator: context.coordinator)
        
        // 条件菜单 + 选中回调
        textView.menuProvider = { [weak coordinator = context.coordinator] in
            // 右键菜单弹出时触发选中
            coordinator?.onSelect()
            return coordinator?.makeMenu()
        }
        
        // 左键点击时触发选中
        textView.onMouseDown = { [weak coordinator = context.coordinator] in
            coordinator?.onSelect()
        }
        
        return textView
    }
    
    func updateNSView(_ nsView: MenuAwareTextView, context: Context) {
        context.coordinator.isFromMe = isFromMe
        context.coordinator.kind = kind
        context.coordinator.onSelect = onSelect
        context.coordinator.onClassify = onClassify
        
        applyContent(to: nsView, coordinator: context.coordinator)
    }
    
    func sizeThatFits(_ proposal: ProposedViewSize, nsView: MenuAwareTextView, context: Context) -> CGSize? {
        guard let textContainer = nsView.textContainer,
              let layoutManager = nsView.layoutManager else {
            return nil
        }
        
        // SwiftUI 在某些布局情况下可能会传入无限宽度，这里做一次兜底，避免视图被错误拉伸
        let maxWidth: CGFloat = {
            guard let proposed = proposal.width,
                  proposed.isFinite,
                  proposed > 0 else {
                return 520
            }
            return proposed
        }()
        let horizontalPadding = style.horizontalPadding
        let verticalPadding = style.verticalPadding
        
        // 两段测量：
        // 1) 用一个很大的容器测出“单行理想宽度”
        // 2) 再按 maxWidth 折行测出实际高度（保证短文本不会被拉满整行）
        let unconstrainedWidth: CGFloat = 10_000
        textContainer.containerSize = CGSize(width: unconstrainedWidth, height: CGFloat.greatestFiniteMagnitude)
        layoutManager.ensureLayout(for: textContainer)
        
        let idealGlyphRange = layoutManager.glyphRange(for: textContainer)
        let idealUsedWidth = maxLineFragmentUsedWidth(
            layoutManager: layoutManager,
            glyphRange: idealGlyphRange
        )
        let idealWidth = ceil(idealUsedWidth) + horizontalPadding * 2
        let targetWidth = min(idealWidth, maxWidth)
        
        let wrapContainerWidth = max(0, targetWidth - horizontalPadding * 2)
        textContainer.containerSize = CGSize(width: wrapContainerWidth, height: CGFloat.greatestFiniteMagnitude)
        layoutManager.ensureLayout(for: textContainer)
        
        // 高度用 usedRect 更稳定；宽度我们取 targetWidth（避免被撑满）
        let wrappedUsed = layoutManager.usedRect(for: textContainer)
        let width = targetWidth
        let height = ceil(wrappedUsed.height) + verticalPadding * 2
        return CGSize(width: width, height: height)
    }
    
    /// 获取每行实际使用宽度的最大值（比 usedRect / boundingRect 更能避免“整行宽被撑满”的情况）
    private func maxLineFragmentUsedWidth(
        layoutManager: NSLayoutManager,
        glyphRange: NSRange
    ) -> CGFloat {
        var maxWidth: CGFloat = 0
        layoutManager.enumerateLineFragments(forGlyphRange: glyphRange) { _, usedRect, _, _, _ in
            maxWidth = max(maxWidth, usedRect.width)
        }
        return maxWidth
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
    
    // MARK: - Coordinator
    
    final class Coordinator: NSObject {
        var isFromMe: Bool = false
        var kind: WechatMessageKind = .text
        var onSelect: () -> Void
        var onClassify: (Bool, WechatMessageKind) -> Void
        
        init(onSelect: @escaping () -> Void, onClassify: @escaping (Bool, WechatMessageKind) -> Void) {
            self.onSelect = onSelect
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
        var onMouseDown: (() -> Void)?
        
        override func mouseDown(with event: NSEvent) {
            onMouseDown?()
            super.mouseDown(with: event)
        }
        
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
    let isSelected: Bool
    let onTap: () -> Void
    let onClassify: (WechatMessage, Bool, WechatMessageKind) -> Void

    private let myBubbleColor = Color(red: 0.58, green: 0.92, blue: 0.41) // #95EC69 微信绿
    private let otherBubbleColor = Color.white
    private let selectedBorderColor = Color.accentColor

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
                    style: .bubble(),
                    onSelect: onTap,
                    onClassify: { isFromMe, kind in
                        onClassify(message, isFromMe, kind)
                    }
                )
                    .background(message.isFromMe ? myBubbleColor : otherBubbleColor)
                    .cornerRadius(8)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(selectedBorderColor, lineWidth: 2)
                            .opacity(isSelected ? 1 : 0)
                    )
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
    let message: WechatMessage
    let isSelected: Bool
    let onTap: () -> Void
    let onClassify: (WechatMessage, Bool, WechatMessageKind) -> Void

    private let selectedBorderColor = Color.accentColor

    var body: some View {
        WechatChatSelectableText(
            text: message.content,
            isFromMe: message.isFromMe,
            kind: message.kind,
            style: .system(),
            onSelect: onTap,
            onClassify: { isFromMe, kind in
                onClassify(message, isFromMe, kind)
            }
        )
            .background(Color.secondary.opacity(0.10))
            .cornerRadius(6)
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(selectedBorderColor, lineWidth: 2)
                    .opacity(isSelected ? 1 : 0)
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


