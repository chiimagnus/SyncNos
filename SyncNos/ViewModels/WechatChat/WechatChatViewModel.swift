import Foundation
import AppKit
import Combine

// MARK: - Wechat Chat View Model (V2)

@MainActor
final class WechatChatViewModel: ObservableObject {

    // MARK: - Published Properties

    /// 联系人/对话列表（左侧列表）
    @Published var contacts: [WechatBookListItem] = []

    /// 内存态对话（用于导出/详情展示）
    @Published private(set) var conversations: [UUID: WechatConversation] = [:]

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

    /// 从本地缓存加载对话列表与消息
    func loadFromCache() async {
        isLoading = true
        defer { isLoading = false }

        do {
            let cachedContacts = try await cacheService.fetchAllConversations()
            contacts = cachedContacts

            var dict: [UUID: WechatConversation] = [:]
            dict.reserveCapacity(cachedContacts.count)

            for item in cachedContacts {
                let messages = try await cacheService.fetchMessages(conversationId: item.id)
                let contact = WechatContact(
                    id: item.contactId,
                    name: item.name,
                    lastMessage: item.lastMessage,
                    lastMessageTime: item.lastMessageTime,
                    messageCount: item.messageCount
                )
                dict[item.contactId] = WechatConversation(contact: contact, messages: messages)
            }

            conversations = dict
            logger.info("[WechatChatV2] Loaded \(cachedContacts.count) conversations from cache")
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

    func deleteContact(_ contact: WechatBookListItem) {
        contacts.removeAll { $0.id == contact.id }
        conversations.removeValue(forKey: contact.contactId)

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

        Task {
            do {
                try await cacheService.clearAllData()
                logger.info("[WechatChatV2] Cleared all data")
            } catch {
                logger.error("[WechatChatV2] Failed to clear cache: \(error)")
            }
        }
    }

    func exportAsText(for contactId: UUID) -> String? {
        conversations[contactId]?.exportAsText()
    }

    func copyToClipboard(for contactId: UUID) {
        guard let text = exportAsText(for: contactId) else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
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

    // MARK: - Private

    private func importScreenshotToConversation(contactId: UUID, url: URL) async {
        guard url.startAccessingSecurityScopedResource() else {
            errorMessage = "无法访问文件: \(url.lastPathComponent)"
            return
        }
        defer { url.stopAccessingSecurityScopedResource() }

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
            let (ocrResult, rawResponse, requestJSON) = try await ocrService.recognizeWithRaw(image, config: .wechatChat)

            let normalizedBlocksJSON = try encodeNormalizedBlocks(ocrResult.blocks)
            let parsedMessages = parser.parse(ocrResult: ocrResult, imageSize: pixelSize)

            // 内存更新：调整 order 连续
            let adjusted = adjustOrders(parsedMessages, for: contactId)

            if var conversation = conversations[contactId] {
                conversation.messages.append(contentsOf: adjusted)
                conversations[contactId] = conversation
                updateContactsList()
            }

            // 落库：截图 raw + blocks + parsed messages
            try await cacheService.appendScreenshot(
                conversationId: contactId.uuidString,
                screenshotId: screenshotId.uuidString,
                importedAt: screenshot.importedAt,
                imageSize: pixelSize,
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


