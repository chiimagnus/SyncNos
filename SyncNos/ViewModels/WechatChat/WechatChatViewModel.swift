import Foundation
import AppKit
import Combine

// MARK: - Pagination Config

enum WechatChatPaginationConfig {
    static let pageSize = 50                    // 每页消息数
    static let preloadThreshold = 10            // 距离顶部多少条时预加载
    static let initialLoadSize = 50             // 首次加载数量
}

// MARK: - Pagination State

struct WechatChatPaginationState {
    var loadedMessages: [WechatMessage] = []
    var currentOffset: Int = 0
    var totalCount: Int = 0
    var isLoadingMore: Bool = false
    var hasInitiallyLoaded: Bool = false
    
    var canLoadMore: Bool {
        loadedMessages.count < totalCount
    }
    
    var hasLoadedAll: Bool {
        !canLoadMore
    }
}

// MARK: - Wechat Chat View Model (V2)

@MainActor
final class WechatChatViewModel: ObservableObject {

    // MARK: - Published Properties

    /// 联系人/对话列表（左侧列表）
    @Published var contacts: [WechatBookListItem] = []

    /// 内存态对话（用于导出/详情展示）
    @Published private(set) var conversations: [UUID: WechatConversation] = [:]
    
    /// 分页状态（每个对话独立管理）
    @Published private(set) var paginationStates: [UUID: WechatChatPaginationState] = [:]

    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var processingScreenshotIds: Set<UUID> = []

    // MARK: - Display Books (for MainListView compatibility)

    var displayBooks: [WechatBookListItem] { contacts }

    // MARK: - Dependencies

    private let ocrService: OCRAPIServiceProtocol
    private let cacheService: WechatChatCacheServiceProtocol
    private let parser: WechatOCRParser
    private let logger: LoggerServiceProtocol

    // MARK: - Computed

    var isConfigured: Bool { OCRConfigStore.shared.isConfigured }

    // MARK: - Init

    init(
        ocrService: OCRAPIServiceProtocol = DIContainer.shared.ocrAPIService,
        cacheService: WechatChatCacheServiceProtocol = DIContainer.shared.wechatChatCacheService,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.ocrService = ocrService
        self.cacheService = cacheService
        self.parser = WechatOCRParser(config: .default)
        self.logger = logger
    }

    // MARK: - Public

    /// 从本地缓存加载对话列表（不加载消息，消息在选中对话时分页加载）
    func loadFromCache() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let cachedContacts = try await cacheService.fetchAllConversations()
            contacts = cachedContacts

            var dict: [UUID: WechatConversation] = [:]
            var states: [UUID: WechatChatPaginationState] = [:]
            dict.reserveCapacity(cachedContacts.count)
            states.reserveCapacity(cachedContacts.count)

            for item in cachedContacts {
                // 只创建对话结构，不加载消息（消息在选中时分页加载）
                let contact = WechatContact(
                    id: item.contactId,
                    name: item.name,
                    lastMessage: item.lastMessage,
                    lastMessageTime: item.lastMessageTime,
                    messageCount: item.messageCount
                )
                dict[item.contactId] = WechatConversation(contact: contact, messages: [])
                
                // 初始化分页状态，设置总数
                var state = WechatChatPaginationState()
                state.totalCount = item.messageCount
                states[item.contactId] = state
            }

            conversations = dict
            paginationStates = states
            logger.info("[WechatChatV2] Loaded \(cachedContacts.count) conversations from cache (messages lazy-loaded)")
        } catch {
            logger.error("[WechatChatV2] Failed to load from cache: \(error)")
            errorMessage = "加载缓存失败: \(error.localizedDescription)"
        }
    }

    /// 创建新对话（用户输入名称）
    @discardableResult
    func createConversation(name: String) -> UUID {
        let contact = WechatContact(name: name)
        let conversation = WechatConversation(contact: contact, messages: [])
        conversations[contact.id] = conversation
        
        // 初始化分页状态
        var state = WechatChatPaginationState()
        state.hasInitiallyLoaded = true  // 新对话无消息，标记为已加载
        state.totalCount = 0
        paginationStates[contact.id] = state
        
        updateContactsList()

        Task {
            do {
                try await cacheService.saveConversation(contact)
                logger.info("[WechatChatV2] Created and saved new conversation: \(name)")
            } catch {
                logger.error("[WechatChatV2] Failed to save conversation: \(error)")
            }
        }

        return contact.id
    }

    /// 向指定对话追加截图
    func addScreenshots(to contactId: UUID, urls: [URL]) async {
        guard conversations[contactId] != nil else {
            errorMessage = "对话不存在"
            return
        }

        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        for url in urls {
            await importScreenshotToConversation(contactId: contactId, url: url)
        }
    }

    func getConversation(for contactId: UUID) -> WechatConversation? {
        conversations[contactId]
    }

    func getMessages(for contactId: UUID) -> [WechatMessage] {
        conversations[contactId]?.messages ?? []
    }
    
    // MARK: - Pagination (分页加载)
    
    /// 获取已分页加载的消息（供 DetailView 使用）
    func getLoadedMessages(for contactId: UUID) -> [WechatMessage] {
        paginationStates[contactId]?.loadedMessages ?? []
    }
    
    /// 是否可以加载更多
    func canLoadMore(for contactId: UUID) -> Bool {
        paginationStates[contactId]?.canLoadMore ?? false
    }
    
    /// 是否正在加载更多
    func isLoadingMore(for contactId: UUID) -> Bool {
        paginationStates[contactId]?.isLoadingMore ?? false
    }
    
    /// 是否已完成首次加载
    func hasInitiallyLoaded(for contactId: UUID) -> Bool {
        paginationStates[contactId]?.hasInitiallyLoaded ?? false
    }
    
    /// 加载对话的初始消息（最新的一页）
    func loadInitialMessages(for contactId: UUID) async {
        // 如果已经加载过，直接返回
        if paginationStates[contactId]?.hasInitiallyLoaded == true {
            return
        }
        
        await loadMessages(for: contactId, reset: true)
    }
    
    /// 加载更早的消息（向上滚动时触发）
    func loadMoreMessages(for contactId: UUID) async {
        guard let state = paginationStates[contactId] else { return }
        
        // 防止重复加载
        if state.isLoadingMore || !state.canLoadMore {
            return
        }
        
        await loadMessages(for: contactId, reset: false)
    }
    
    /// 核心分页加载逻辑
    private func loadMessages(for contactId: UUID, reset: Bool) async {
        // 初始化或获取当前状态
        var state = paginationStates[contactId] ?? WechatChatPaginationState()
        
        // 防止重复加载
        if state.isLoadingMore { return }
        
        state.isLoadingMore = true
        paginationStates[contactId] = state
        
        do {
            // 获取总数（首次加载时）
            if reset || state.totalCount == 0 {
                let totalCount = try await cacheService.fetchMessageCount(conversationId: contactId.uuidString)
                state.totalCount = totalCount
            }
            
            // 计算偏移量
            let offset = reset ? 0 : state.loadedMessages.count
            let limit = WechatChatPaginationConfig.pageSize
            
            // 分页查询
            let newMessages = try await cacheService.fetchMessagesPage(
                conversationId: contactId.uuidString,
                limit: limit,
                offset: offset
            )
            
            if reset {
                // 重置：用新消息替换
                state.loadedMessages = newMessages
            } else {
                // 追加：新消息插入到头部（因为是加载更早的消息）
                state.loadedMessages = newMessages + state.loadedMessages
            }
            
            state.currentOffset = state.loadedMessages.count
            state.hasInitiallyLoaded = true
            state.isLoadingMore = false
            
            paginationStates[contactId] = state
            
            // 同步更新 conversations（供导出等功能使用）
            if var conversation = conversations[contactId] {
                conversation.messages = state.loadedMessages
                conversations[contactId] = conversation
            }
            
            logger.info("[WechatChatV2] Loaded \(newMessages.count) messages (total: \(state.loadedMessages.count)/\(state.totalCount)) for \(contactId)")
        } catch {
            logger.error("[WechatChatV2] Failed to load messages page: \(error)")
            state.isLoadingMore = false
            paginationStates[contactId] = state
            errorMessage = "加载消息失败: \(error.localizedDescription)"
        }
    }
    
    /// 重置分页状态（用于新消息导入后刷新）
    func resetPaginationState(for contactId: UUID) {
        paginationStates[contactId] = nil
    }

    func deleteContact(_ contact: WechatBookListItem) {
        contacts.removeAll { $0.id == contact.id }
        conversations.removeValue(forKey: contact.contactId)
        paginationStates.removeValue(forKey: contact.contactId)

        Task {
            do {
                try await cacheService.deleteConversation(id: contact.id)
                logger.info("[WechatChatV2] Deleted conversation: \(contact.name)")
            } catch {
                logger.error("[WechatChatV2] Failed to delete conversation: \(error)")
            }
        }
    }

    func clearAll() {
        contacts.removeAll()
        conversations.removeAll()
        paginationStates.removeAll()

        Task {
            do {
                try await cacheService.clearAllData()
                logger.info("[WechatChatV2] Cleared all data")
            } catch {
                logger.error("[WechatChatV2] Failed to clear cache: \(error)")
            }
        }
    }

    // MARK: - Export (导出)
    
    /// 导出对话为指定格式
    /// - Parameters:
    ///   - contactId: 对话 ID
    ///   - format: 导出格式
    /// - Returns: 导出的字符串内容
    func exportConversation(_ contactId: UUID, format: WechatExportFormat) -> String? {
        // 优先使用分页加载的消息（用户当前看到的数据）
        let messages = paginationStates[contactId]?.loadedMessages ?? conversations[contactId]?.messages ?? []
        guard !messages.isEmpty else { return nil }
        
        let contactName = conversations[contactId]?.contact.name ?? "Unknown"
        return WechatChatExporter.export(messages: messages, contactName: contactName, format: format)
    }
    
    /// 导出所有消息（需要先加载全部消息）
    func exportAllMessages(_ contactId: UUID, format: WechatExportFormat) async -> String? {
        // 加载全部消息
        do {
            let allMessages = try await cacheService.fetchAllMessages(conversationId: contactId.uuidString)
            let contactName = conversations[contactId]?.contact.name ?? "Unknown"
            return WechatChatExporter.export(messages: allMessages, contactName: contactName, format: format)
        } catch {
            logger.error("[WechatChatV2] Failed to fetch all messages for export: \(error)")
            errorMessage = "导出失败: \(error.localizedDescription)"
            return nil
        }
    }
    
    /// 生成导出文件名
    func generateExportFileName(for contactId: UUID, format: WechatExportFormat) -> String {
        let contactName = conversations[contactId]?.contact.name ?? "Chat"
        return WechatChatExporter.generateFileName(contactName: contactName, format: format)
    }
    
    // MARK: - Import (导入)
    
    /// 从文件导入对话
    /// - Parameters:
    ///   - url: 文件 URL
    ///   - appendTo: 如果提供，则追加到现有对话；否则创建新对话
    /// - Returns: 导入的对话 ID
    @discardableResult
    func importConversation(from url: URL, appendTo existingContactId: UUID? = nil) async throws -> UUID {
        // 尝试获取安全作用域访问权限（对于 fileImporter 选择的文件需要）
        // 对于拖拽的文件会返回 false，但这不影响访问
        let hasSecurityAccess = url.startAccessingSecurityScopedResource()
        defer {
            if hasSecurityAccess {
                url.stopAccessingSecurityScopedResource()
            }
        }
        
        let result = try WechatChatImporter.importFromFile(url: url)
        
        let contactId: UUID
        
        if let existingId = existingContactId, conversations[existingId] != nil {
            // 追加到现有对话
            contactId = existingId
            
            // 调整 order
            let adjustedMessages = adjustOrders(result.messages, for: existingId)
            
            // 更新内存
            if var conversation = conversations[existingId] {
                conversation.messages.append(contentsOf: adjustedMessages)
                conversations[existingId] = conversation
            }
            
            // 更新分页状态
            if var state = paginationStates[existingId] {
                state.loadedMessages.append(contentsOf: adjustedMessages)
                state.totalCount += adjustedMessages.count
                paginationStates[existingId] = state
            }
            
            // 保存到缓存
            try await saveImportedMessages(adjustedMessages, to: existingId)
            
            updateContactsList()
            
            logger.info("[WechatChatV2] Imported \(adjustedMessages.count) messages to existing conversation")
        } else {
            // 创建新对话
            let contact = WechatContact(name: result.contactName)
            let conversation = WechatConversation(contact: contact, messages: result.messages)
            conversations[contact.id] = conversation
            contactId = contact.id
            
            // 初始化分页状态
            var state = WechatChatPaginationState()
            state.loadedMessages = result.messages
            state.totalCount = result.messages.count
            state.hasInitiallyLoaded = true
            paginationStates[contact.id] = state
            
            // 保存对话和消息
            try await cacheService.saveConversation(contact)
            try await saveImportedMessages(result.messages, to: contact.id)
            
            updateContactsList()
            
            logger.info("[WechatChatV2] Imported new conversation '\(result.contactName)' with \(result.messages.count) messages")
        }
        
        return contactId
    }
    
    /// 保存导入的消息到缓存
    private func saveImportedMessages(_ messages: [WechatMessage], to contactId: UUID) async throws {
        // 使用虚拟截图 ID 保存导入的消息
        let screenshotId = UUID()
        
        try await cacheService.appendScreenshot(
            conversationId: contactId.uuidString,
            screenshotId: screenshotId.uuidString,
            importedAt: Date(),
            imageSize: .zero,  // 导入的消息无原始图片
            ocrEngine: "Import",
            ocrRequestJSON: nil,
            ocrResponseJSON: Data("{}".utf8),
            normalizedBlocksJSON: Data("[]".utf8),
            parsedAt: Date(),
            messages: messages
        )
    }

    func renameConversation(_ contactId: UUID, newName: String) {
        guard var conversation = conversations[contactId] else { return }

        var contact = conversation.contact
        contact = WechatContact(
            id: contact.id,
            name: newName,
            lastMessage: contact.lastMessage,
            lastMessageTime: contact.lastMessageTime,
            messageCount: contact.messageCount
        )

        conversation.contact = contact
        conversations[contactId] = conversation
        updateContactsList()

        Task {
            do {
                try await cacheService.renameConversation(id: contactId.uuidString, newName: newName)
                logger.info("[WechatChatV2] Renamed conversation to: \(newName)")
            } catch {
                logger.error("[WechatChatV2] Failed to rename conversation: \(error)")
            }
        }
    }
    
    /// 更新消息分类（isFromMe / kind）
    func updateMessageClassification(
        messageId: UUID,
        isFromMe: Bool,
        kind: WechatMessageKind,
        for contactId: UUID
    ) {
        // 创建更新后的消息
        func createUpdatedMessage(from oldMessage: WechatMessage) -> WechatMessage {
            WechatMessage(
                id: oldMessage.id,
                content: oldMessage.content,
                isFromMe: isFromMe,
                senderName: oldMessage.senderName,
                kind: kind,
                bbox: oldMessage.bbox,
                order: oldMessage.order
            )
        }
        
        // 1. 更新 conversations 内存
        if var conversation = conversations[contactId],
           let index = conversation.messages.firstIndex(where: { $0.id == messageId }) {
            conversation.messages[index] = createUpdatedMessage(from: conversation.messages[index])
            conversations[contactId] = conversation
        }
        
        // 2. 更新 paginationStates 内存
        if var state = paginationStates[contactId],
           let index = state.loadedMessages.firstIndex(where: { $0.id == messageId }) {
            state.loadedMessages[index] = createUpdatedMessage(from: state.loadedMessages[index])
            paginationStates[contactId] = state
        }
        
        // 3. 持久化
        Task {
            do {
                try await cacheService.updateMessageClassification(
                    messageId: messageId.uuidString,
                    isFromMe: isFromMe,
                    kind: kind
                )
                logger.info("[WechatChatV2] Updated message classification: \(messageId)")
            } catch {
                logger.error("[WechatChatV2] Failed to update message classification: \(error)")
            }
        }
    }

    // MARK: - Private

    private func importScreenshotToConversation(contactId: UUID, url: URL) async {
        // 尝试获取安全作用域访问权限（对于 fileImporter 选择的文件需要）
        // 对于临时目录中的文件会返回 false，但这不影响访问
        let hasSecurityAccess = url.startAccessingSecurityScopedResource()
        defer {
            if hasSecurityAccess {
                url.stopAccessingSecurityScopedResource()
            }
        }

        guard let image = NSImage(contentsOf: url) else {
            errorMessage = "无法加载图片: \(url.lastPathComponent)"
            return
        }

        let screenshot = WechatScreenshot(image: image, isProcessing: true)
        let screenshotId = screenshot.id
        processingScreenshotIds.insert(screenshotId)
        defer { processingScreenshotIds.remove(screenshotId) }

        do {
            logger.info("[WechatChatV2] Processing screenshot: \(url.lastPathComponent)")

            let pixelSize = try imagePixelSize(image)
            // 简化：回到默认 OCR 请求配置（不做场景化调参），先把私聊展示完整做稳
            let (ocrResult, rawResponse, requestJSON) = try await ocrService.recognizeWithRaw(image, config: .default)

            let normalizedBlocksJSON = try encodeNormalizedBlocks(ocrResult.blocks)
            let ocrCoordinateSize = ocrResult.coordinateSize
                ?? estimateCoordinateSize(from: ocrResult.blocks)
                ?? pixelSize
            let parsedMessages = parser.parse(ocrResult: ocrResult, imageSize: ocrCoordinateSize)

            // 内存更新：调整 order 连续
            let adjusted = adjustOrders(parsedMessages, for: contactId)

            if var conversation = conversations[contactId] {
                conversation.messages.append(contentsOf: adjusted)
                conversations[contactId] = conversation
                updateContactsList()
            }
            
            // 更新分页状态：将新消息追加到已加载列表末尾
            if var state = paginationStates[contactId] {
                state.loadedMessages.append(contentsOf: adjusted)
                state.totalCount += adjusted.count
                paginationStates[contactId] = state
            }

            // 落库：截图 raw + blocks + parsed messages
            try await cacheService.appendScreenshot(
                conversationId: contactId.uuidString,
                screenshotId: screenshotId.uuidString,
                importedAt: screenshot.importedAt,
                imageSize: ocrCoordinateSize,
                ocrEngine: "PaddleOCR-VL",
                ocrRequestJSON: requestJSON,
                ocrResponseJSON: rawResponse,
                normalizedBlocksJSON: normalizedBlocksJSON,
                parsedAt: Date(),
                messages: adjusted
            )

            logger.info("[WechatChatV2] Imported screenshot -> \(adjusted.count) messages")
        } catch {
            logger.error("[WechatChatV2] OCR/parse failed: \(error)")
            errorMessage = error.localizedDescription
        }
    }

    private func encodeNormalizedBlocks(_ blocks: [OCRBlock]) throws -> Data {
        let snapshots: [WechatOCRBlockSnapshot] = blocks.compactMap { block in
            let text = block.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            return WechatOCRBlockSnapshot(
                text: text,
                label: block.label,
                bbox: WechatRectSnapshot(
                    x: Double(block.bbox.origin.x),
                    y: Double(block.bbox.origin.y),
                    width: Double(block.bbox.size.width),
                    height: Double(block.bbox.size.height)
                )
            )
        }
        return try JSONEncoder().encode(snapshots)
    }

    /// 当 Paddle `dataInfo.width/height` 缺失时，用 bbox 的最大边界估算 OCR 坐标系尺寸，避免相对坐标失真导致方向误判
    private func estimateCoordinateSize(from blocks: [OCRBlock]) -> CGSize? {
        var maxX: CGFloat = 0
        var maxY: CGFloat = 0
        for block in blocks {
            maxX = max(maxX, block.bbox.maxX)
            maxY = max(maxY, block.bbox.maxY)
        }
        guard maxX > 0, maxY > 0 else { return nil }
        return CGSize(width: maxX, height: maxY)
    }

    private func imagePixelSize(_ image: NSImage) throws -> CGSize {
        guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            throw OCRServiceError.invalidImage
        }
        return CGSize(width: cgImage.width, height: cgImage.height)
    }

    private func adjustOrders(_ messages: [WechatMessage], for contactId: UUID) -> [WechatMessage] {
        let existingMax = conversations[contactId]?.messages.map(\.order).max() ?? -1
        let start = existingMax + 1
        return messages.enumerated().map { idx, msg in
            WechatMessage(
                id: msg.id,
                content: msg.content,
                isFromMe: msg.isFromMe,
                senderName: msg.senderName,
                kind: msg.kind,
                bbox: msg.bbox,
                order: start + idx
            )
        }
    }

    private func updateContactsList() {
        contacts = conversations.values.map { conversation in
            var contact = conversation.contact
            contact.messageCount = conversation.messages.count
            contact.lastMessage = conversation.messages.sorted(by: { $0.order < $1.order }).last?.content
            contact.lastMessageTime = nil
            return WechatBookListItem(from: contact)
        }
        .sorted { $0.name < $1.name }
    }
}


