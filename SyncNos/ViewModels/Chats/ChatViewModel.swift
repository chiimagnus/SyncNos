import Foundation
import AppKit
import Combine

// MARK: - Pagination Config

enum ChatPaginationConfig {
    static let pageSize = 100                   // 每页消息数
    static let preloadThreshold = 10            // 距离顶部多少条时预加载
    static let initialLoadSize = 100            // 首次加载数量
}

// MARK: - Pagination State

struct ChatPaginationState {
    var loadedMessages: [ChatMessage] = []
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

// MARK: - Chat View Model (V2)

@MainActor
final class ChatViewModel: ObservableObject {

    // MARK: - Published Properties

    /// 联系人/对话列表（左侧列表）
    @Published var contacts: [ChatBookListItem] = []

    /// 内存态对话（用于导出/详情展示）
    @Published private(set) var conversations: [UUID: ChatConversation] = [:]
    
    /// 分页状态（每个对话独立管理）
    @Published private(set) var paginationStates: [UUID: ChatPaginationState] = [:]

    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var processingScreenshotIds: Set<UUID> = []

    // MARK: - Display Books (for MainListView compatibility)

    var displayBooks: [ChatBookListItem] { contacts }

    // MARK: - Dependencies

    private let cacheService: ChatCacheServiceProtocol
    private let parser: ChatOCRParser
    private let logger: LoggerServiceProtocol

    // MARK: - Computed

    /// Vision OCR 始终可用
    var isConfigured: Bool { true }

    // MARK: - Init

    init(
        cacheService: ChatCacheServiceProtocol = DIContainer.shared.chatsCacheService,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.cacheService = cacheService
        self.parser = ChatOCRParser(config: .default)
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

            var dict: [UUID: ChatConversation] = [:]
            var states: [UUID: ChatPaginationState] = [:]
            dict.reserveCapacity(cachedContacts.count)
            states.reserveCapacity(cachedContacts.count)

            for item in cachedContacts {
                // 只创建对话结构，不加载消息（消息在选中时分页加载）
                let contact = ChatContact(
                    id: item.contactId,
                    name: item.name,
                    lastMessage: item.lastMessage,
                    lastMessageTime: item.lastMessageTime,
                    messageCount: item.messageCount
                )
                dict[item.contactId] = ChatConversation(contact: contact, messages: [])
                
                // 初始化分页状态，设置总数
                var state = ChatPaginationState()
                state.totalCount = item.messageCount
                states[item.contactId] = state
            }

            conversations = dict
            paginationStates = states
            logger.info("[ChatsV2] Loaded \(cachedContacts.count) conversations from cache (messages lazy-loaded)")
        } catch {
            logger.error("[ChatsV2] Failed to load from cache: \(error)")
            errorMessage = "加载缓存失败: \(error.localizedDescription)"
        }
    }

    /// 创建新对话（用户输入名称）
    @discardableResult
    func createConversation(name: String) -> UUID {
        let contact = ChatContact(name: name)
        let conversation = ChatConversation(contact: contact, messages: [])
        conversations[contact.id] = conversation
        
        // 初始化分页状态
        var state = ChatPaginationState()
        state.hasInitiallyLoaded = true  // 新对话无消息，标记为已加载
        state.totalCount = 0
        paginationStates[contact.id] = state
        
        updateContactsList()

        Task {
            do {
                try await cacheService.saveConversation(contact)
                logger.info("[ChatsV2] Created and saved new conversation: \(name)")
            } catch {
                logger.error("[ChatsV2] Failed to save conversation: \(error)")
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

    /// 向指定对话追加截图（来自拖拽/剪贴板等“内存数据”，无需落盘）
    func addScreenshotData(to contactId: UUID, imageDatas: [Data]) async {
        guard conversations[contactId] != nil else {
            errorMessage = "对话不存在"
            return
        }

        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        for data in imageDatas {
            await importScreenshotToConversation(contactId: contactId, imageData: data)
        }
    }

    func getConversation(for contactId: UUID) -> ChatConversation? {
        conversations[contactId]
    }

    func getMessages(for contactId: UUID) -> [ChatMessage] {
        conversations[contactId]?.messages ?? []
    }
    
    // MARK: - Pagination (分页加载)
    
    /// 获取已分页加载的消息（供 DetailView 使用）
    func getLoadedMessages(for contactId: UUID) -> [ChatMessage] {
        paginationStates[contactId]?.loadedMessages ?? []
    }
    
    /// 获取对话中已使用的发送者昵称列表（去重，按出现顺序）
    func getUsedSenderNames(for contactId: UUID) -> [String] {
        let allMessages = conversations[contactId]?.messages ?? []
        var seen = Set<String>()
        var result: [String] = []
        
        for message in allMessages {
            if let name = message.senderName, !name.isEmpty, !seen.contains(name) {
                seen.insert(name)
                result.append(name)
            }
        }
        
        return result
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
        var state = paginationStates[contactId] ?? ChatPaginationState()
        
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
            let limit = ChatPaginationConfig.pageSize
            
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
            
            logger.info("[ChatsV2] Loaded \(newMessages.count) messages (total: \(state.loadedMessages.count)/\(state.totalCount)) for \(contactId)")
        } catch {
            logger.error("[ChatsV2] Failed to load messages page: \(error)")
            state.isLoadingMore = false
            paginationStates[contactId] = state
            errorMessage = "加载消息失败: \(error.localizedDescription)"
        }
    }
    
    /// 重置分页状态（用于新消息导入后刷新）
    func resetPaginationState(for contactId: UUID) {
        paginationStates[contactId] = nil
    }

    func deleteContact(_ contact: ChatBookListItem) {
        contacts.removeAll { $0.id == contact.id }
        conversations.removeValue(forKey: contact.contactId)
        paginationStates.removeValue(forKey: contact.contactId)

        Task {
            do {
                try await cacheService.deleteConversation(id: contact.id)
                logger.info("[ChatsV2] Deleted conversation: \(contact.name)")
            } catch {
                logger.error("[ChatsV2] Failed to delete conversation: \(error)")
            }
        }
    }

    // MARK: - Export (导出)
    
    /// 导出对话为指定格式
    /// - Parameters:
    ///   - contactId: 对话 ID
    ///   - format: 导出格式
    /// - Returns: 导出的字符串内容
    func exportConversation(_ contactId: UUID, format: ChatExportFormat) -> String? {
        // 优先使用分页加载的消息（用户当前看到的数据）
        let messages = paginationStates[contactId]?.loadedMessages ?? conversations[contactId]?.messages ?? []
        guard !messages.isEmpty else { return nil }
        
        let contactName = conversations[contactId]?.contact.name ?? "Unknown"
        return ChatExporter.export(messages: messages, contactName: contactName, format: format)
    }
    
    /// 导出所有消息（需要先加载全部消息）
    func exportAllMessages(_ contactId: UUID, format: ChatExportFormat) async -> String? {
        // 加载全部消息
        do {
            let allMessages = try await cacheService.fetchAllMessages(conversationId: contactId.uuidString)
            let contactName = conversations[contactId]?.contact.name ?? "Unknown"
            return ChatExporter.export(messages: allMessages, contactName: contactName, format: format)
        } catch {
            logger.error("[ChatsV2] Failed to fetch all messages for export: \(error)")
            errorMessage = "Export failed: \(error.localizedDescription)"
            return nil
        }
    }
    
    /// 生成导出文件名
    func generateExportFileName(for contactId: UUID, format: ChatExportFormat) -> String {
        let contactName = conversations[contactId]?.contact.name ?? "Chat"
        return ChatExporter.generateFileName(contactName: contactName, format: format)
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
        
        let result = try ChatImporter.importFromFile(url: url)
        
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
            
            logger.info("[ChatsV2] Imported \(adjustedMessages.count) messages to existing conversation")
        } else {
            // 创建新对话
            let contact = ChatContact(name: result.contactName)
            let conversation = ChatConversation(contact: contact, messages: result.messages)
            conversations[contact.id] = conversation
            contactId = contact.id
            
            // 初始化分页状态
            var state = ChatPaginationState()
            state.loadedMessages = result.messages
            state.totalCount = result.messages.count
            state.hasInitiallyLoaded = true
            paginationStates[contact.id] = state
            
            // 保存对话和消息
            try await cacheService.saveConversation(contact)
            try await saveImportedMessages(result.messages, to: contact.id)
            
            updateContactsList()
            
            logger.info("[ChatsV2] Imported new conversation '\(result.contactName)' with \(result.messages.count) messages")
        }
        
        return contactId
    }
    
    /// 保存导入的消息到缓存
    private func saveImportedMessages(_ messages: [ChatMessage], to contactId: UUID) async throws {
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
        contact = ChatContact(
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
                logger.info("[ChatsV2] Renamed conversation to: \(newName)")
            } catch {
                logger.error("[ChatsV2] Failed to rename conversation: \(error)")
            }
        }
    }
    
    /// 更新消息分类（isFromMe / kind）
    func updateMessageClassification(
        messageId: UUID,
        isFromMe: Bool,
        kind: ChatMessageKind,
        for contactId: UUID
    ) {
        // 创建更新后的消息
        func createUpdatedMessage(from oldMessage: ChatMessage) -> ChatMessage {
            ChatMessage(
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
                logger.info("[ChatsV2] Updated message classification: \(messageId)")
            } catch {
                logger.error("[ChatsV2] Failed to update message classification: \(error)")
            }
        }
    }
    
    /// 更新消息发送者昵称
    func updateMessageSenderName(
        messageId: UUID,
        senderName: String?,
        for contactId: UUID
    ) {
        // 创建更新后的消息
        func createUpdatedMessage(from oldMessage: ChatMessage) -> ChatMessage {
            ChatMessage(
                id: oldMessage.id,
                content: oldMessage.content,
                isFromMe: oldMessage.isFromMe,
                senderName: senderName,
                kind: oldMessage.kind,
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
                try await cacheService.updateMessageSenderName(
                    messageId: messageId.uuidString,
                    senderName: senderName
                )
                logger.info("[ChatsV2] Updated message sender name: \(messageId) -> \(senderName ?? "nil")")
            } catch {
                logger.error("[ChatsV2] Failed to update message sender name: \(error)")
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
        
        await importScreenshotToConversation(
            contactId: contactId,
            image: image,
            sourceName: url.lastPathComponent
        )
    }
    
    private func importScreenshotToConversation(contactId: UUID, imageData: Data) async {
        guard let image = NSImage(data: imageData) else {
            errorMessage = "无法处理拖入的图片"
            return
        }
        
        await importScreenshotToConversation(
            contactId: contactId,
            image: image,
            sourceName: "DroppedImage"
        )
    }

    private func importScreenshotToConversation(contactId: UUID, image: NSImage, sourceName: String?) async {
        let screenshot = ChatScreenshot(image: image, isProcessing: true)
        let screenshotId = screenshot.id
        processingScreenshotIds.insert(screenshotId)
        defer { processingScreenshotIds.remove(screenshotId) }

        do {
            if let sourceName {
                logger.info("[ChatsV2] Processing screenshot: \(sourceName)")
            } else {
                logger.info("[ChatsV2] Processing screenshot")
            }

            let pixelSize = try imagePixelSize(image)
            // 使用 Apple Vision OCR 进行识别
            let ocrService = DIContainer.shared.ocrAPIService
            
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
                ocrEngine: "Apple Vision",
                ocrRequestJSON: requestJSON,
                ocrResponseJSON: rawResponse,
                normalizedBlocksJSON: normalizedBlocksJSON,
                parsedAt: Date(),
                messages: adjusted
            )

            logger.info("[ChatsV2] Imported screenshot -> \(adjusted.count) messages")
        } catch {
            logger.error("[ChatsV2] OCR/parse failed: \(error)")
            errorMessage = error.localizedDescription
        }
    }

    private func encodeNormalizedBlocks(_ blocks: [OCRBlock]) throws -> Data {
        let snapshots: [ChatOCRBlockSnapshot] = blocks.compactMap { block in
            let text = block.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            return ChatOCRBlockSnapshot(
                text: text,
                label: block.label,
                bbox: ChatRectSnapshot(
                    x: Double(block.bbox.origin.x),
                    y: Double(block.bbox.origin.y),
                    width: Double(block.bbox.size.width),
                    height: Double(block.bbox.size.height)
                )
            )
        }
        return try JSONEncoder().encode(snapshots)
    }

    /// 当 OCR `coordinateSize` 缺失时，用 bbox 的最大边界估算 OCR 坐标系尺寸，避免相对坐标失真导致方向误判
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

    private func adjustOrders(_ messages: [ChatMessage], for contactId: UUID) -> [ChatMessage] {
        let existingMax = conversations[contactId]?.messages.map(\.order).max() ?? -1
        let start = existingMax + 1
        return messages.enumerated().map { idx, msg in
            ChatMessage(
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
            return ChatBookListItem(from: contact)
        }
        .sorted { $0.name < $1.name }
    }
    
    // MARK: - Encryption Diagnostics
    
    /// 检查加密密钥健康状态
    func checkEncryptionHealth() -> String {
        let service = EncryptionService.shared
        
        var report = "=== 加密服务健康检查 ===\n"
        
        // 1. 检查加密服务是否可用
        if service.isAvailable {
            report += "✅ 加密服务可用\n"
        } else {
            report += "❌ 加密服务不可用\n"
            return report
        }
        
        // 2. 获取密钥指纹
        if let fingerprint = service.getKeyFingerprint() {
            report += "🔑 密钥指纹: \(fingerprint)\n"
        } else {
            report += "⚠️ 无法获取密钥指纹\n"
        }
        
        // 3. 测试加密解密
        do {
            let testText = "测试加密_\(Date().timeIntervalSince1970)"
            let encrypted = try service.encrypt(testText)
            let decrypted = try service.decrypt(encrypted)
            
            if decrypted == testText {
                report += "✅ 加密/解密测试通过\n"
            } else {
                report += "❌ 加密/解密测试失败 - 结果不匹配\n"
            }
        } catch {
            report += "❌ 加密/解密测试失败: \(error.localizedDescription)\n"
        }
        
        // 4. 检查数据库中的解密状态
        var successCount = 0
        var failCount = 0
        
        for contact in contacts {
            if contact.name.contains("[解密失败") {
                failCount += 1
            } else {
                successCount += 1
            }
        }
        
        report += "\n=== 数据库解密状态 ===\n"
        report += "成功: \(successCount) 个对话\n"
        report += "失败: \(failCount) 个对话\n"
        
        if failCount > 0 {
            report += "\n⚠️ 检测到解密失败的数据\n"
            report += "可能原因：\n"
            report += "1. 密钥丢失或变更\n"
            report += "2. 数据损坏\n"
            report += "3. Keychain 访问权限问题\n"
        }
        
        return report
    }
    
    /// 清除所有加密数据并重置密钥（危险操作）
    func resetEncryptionAndData() async {
        logger.warning("[ChatsV2] 执行重置加密和数据操作")
        
        // 1. 删除所有聊天数据
        do {
            try await cacheService.clearAllData()
            logger.info("[ChatsV2] 已清除所有聊天数据")
        } catch {
            logger.error("[ChatsV2] 清除数据失败: \(error)")
        }
        
        // 2. 删除加密密钥
        EncryptionService.shared.deleteKey()
        logger.info("[ChatsV2] 已删除加密密钥")
        
        // 3. 重新加载
        contacts.removeAll()
        conversations.removeAll()
        paginationStates.removeAll()
        
        logger.info("[ChatsV2] 重置完成")
    }
}


