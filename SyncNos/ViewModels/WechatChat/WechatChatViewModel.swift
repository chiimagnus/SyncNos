import Foundation
import AppKit
import Combine

// MARK: - Wechat Chat View Model

@MainActor
final class WechatChatViewModel: ObservableObject {
    
    // MARK: - Published Properties
    
    /// 联系人/对话列表（用于左侧列表显示）
    @Published var contacts: [WechatBookListItem] = []
    
    /// 所有对话数据（内存缓存）
    @Published private(set) var conversations: [UUID: WechatConversation] = [:]
    
    /// 是否正在加载
    @Published var isLoading = false
    
    /// 错误信息
    @Published var errorMessage: String?
    
    /// 正在处理的截图 ID
    @Published var processingScreenshotIds: Set<UUID> = []
    
    // MARK: - Display Books (for MainListView compatibility)
    
    var displayBooks: [WechatBookListItem] { contacts }
    
    // MARK: - Dependencies
    
    private let ocrService: OCRAPIServiceProtocol
    private let cacheService: WechatChatCacheServiceProtocol
    private let parser: WechatOCRParser
    private let logger: LoggerServiceProtocol
    
    // MARK: - Computed Properties
    
    var isConfigured: Bool {
        OCRConfigStore.shared.isConfigured
    }
    
    // MARK: - Init
    
    init(
        ocrService: OCRAPIServiceProtocol = DIContainer.shared.ocrAPIService,
        cacheService: WechatChatCacheServiceProtocol = DIContainer.shared.wechatChatCacheService,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.ocrService = ocrService
        self.cacheService = cacheService
        self.parser = WechatOCRParser()
        self.logger = logger
    }
    
    // MARK: - Public Methods
    
    /// 从本地缓存加载对话列表
    func loadFromCache() async {
        isLoading = true
        do {
            let cachedContacts = try await cacheService.fetchAllConversations()
            contacts = cachedContacts
            
            // 加载每个对话的消息到内存
            for contact in cachedContacts {
                if let conversation = try await cacheService.fetchConversation(id: contact.id) {
                    conversations[contact.contactId] = conversation
                }
            }
            
            logger.info("[WechatChat] Loaded \(cachedContacts.count) conversations from cache")
        } catch {
            logger.error("[WechatChat] Failed to load from cache: \(error)")
            errorMessage = "加载缓存失败: \(error.localizedDescription)"
        }
        isLoading = false
    }
    
    /// 创建新对话（用户手动输入名称）
    /// - Parameter name: 联系人/群聊名称
    /// - Returns: 新创建的联系人 ID
    @discardableResult
    func createConversation(name: String, isGroup: Bool = false) -> UUID {
        let contact = WechatContact(name: name, isGroup: isGroup)
        let conversation = WechatConversation(contact: contact, screenshots: [])
        conversations[contact.id] = conversation
        updateContactsList()
        
        // 异步保存到缓存
        Task {
            do {
                try await cacheService.saveConversation(contact)
                logger.info("[WechatChat] Created and saved new conversation: \(name)")
            } catch {
                logger.error("[WechatChat] Failed to save conversation: \(error)")
            }
        }
        
        return contact.id
    }
    
    /// 向指定对话追加截图
    /// - Parameters:
    ///   - contactId: 联系人 ID
    ///   - urls: 截图文件 URL 列表
    func addScreenshots(to contactId: UUID, urls: [URL]) async {
        guard conversations[contactId] != nil else {
            errorMessage = "对话不存在"
            return
        }
        
        isLoading = true
        errorMessage = nil
        
        for url in urls {
            await importScreenshotToConversation(contactId: contactId, url: url)
        }
        
        isLoading = false
    }
    
    /// 获取指定联系人的对话
    func getConversation(for contactId: UUID) -> WechatConversation? {
        conversations[contactId]
    }
    
    /// 获取指定联系人的消息列表
    func getMessages(for contactId: UUID) -> [WechatMessage] {
        conversations[contactId]?.allMessages ?? []
    }
    
    /// 删除联系人及其对话
    func deleteContact(_ contact: WechatBookListItem) {
        contacts.removeAll { $0.id == contact.id }
        conversations.removeValue(forKey: contact.contactId)
        
        // 异步从缓存删除
        Task {
            do {
                try await cacheService.deleteConversation(id: contact.id)
                logger.info("[WechatChat] Deleted conversation: \(contact.name)")
            } catch {
                logger.error("[WechatChat] Failed to delete conversation: \(error)")
            }
        }
    }
    
    /// 清除所有数据
    func clearAll() {
        contacts.removeAll()
        conversations.removeAll()
        
        // 异步清除缓存
        Task {
            do {
                try await cacheService.clearAllData()
                logger.info("[WechatChat] Cleared all data")
            } catch {
                logger.error("[WechatChat] Failed to clear cache: \(error)")
            }
        }
    }
    
    /// 导出指定联系人的聊天记录
    func exportAsText(for contactId: UUID) -> String? {
        conversations[contactId]?.exportAsText()
    }
    
    /// 复制到剪贴板
    func copyToClipboard(for contactId: UUID) {
        guard let text = exportAsText(for: contactId) else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
    
    /// 重命名对话
    func renameConversation(_ contactId: UUID, newName: String) {
        guard var conversation = conversations[contactId] else { return }
        let oldContact = conversation.contact
        let newContact = WechatContact(
            id: oldContact.id,
            name: newName,
            lastMessage: oldContact.lastMessage,
            lastMessageTime: oldContact.lastMessageTime,
            messageCount: oldContact.messageCount,
            isGroup: oldContact.isGroup
        )
        conversation = WechatConversation(contact: newContact, screenshots: conversation.screenshots)
        conversations[contactId] = conversation
        updateContactsList()
        
        // 异步更新缓存
        Task {
            do {
                try await cacheService.renameConversation(id: contactId.uuidString, newName: newName)
                logger.info("[WechatChat] Renamed conversation to: \(newName)")
            } catch {
                logger.error("[WechatChat] Failed to rename conversation: \(error)")
            }
        }
    }
    
    // MARK: - Private Methods
    
    /// 向指定对话导入单个截图
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
        
        var screenshot = WechatScreenshot(image: image, isProcessing: true)
        let screenshotId = screenshot.id
        processingScreenshotIds.insert(screenshotId)
        
        do {
            logger.info("[WechatChat] Processing screenshot for conversation: \(url.lastPathComponent)")
            
            let ocrResult = try await ocrService.recognize(image)
            let messages = parser.parse(ocrResult: ocrResult, imageSize: image.size)
            
            screenshot.messages = messages
            screenshot.isProcessing = false
            
            // 追加到现有对话（内存）
            if var conversation = conversations[contactId] {
                conversation.screenshots.append(screenshot)
                conversations[contactId] = conversation
                updateContactsList()
            }
            
            // 保存到缓存
            try await cacheService.saveScreenshotMeta(screenshot, conversationId: contactId.uuidString)
            try await cacheService.saveMessages(messages, conversationId: contactId.uuidString, screenshotId: screenshotId.uuidString)
            
            logger.info("[WechatChat] Added and saved \(messages.count) messages to conversation")
            
        } catch {
            logger.error("[WechatChat] OCR failed: \(error)")
            errorMessage = error.localizedDescription
        }
        
        processingScreenshotIds.remove(screenshotId)
    }
    
    /// 更新联系人列表
    private func updateContactsList() {
        contacts = conversations.values.map { conversation in
            var contact = conversation.contact
            
            let allMessages = conversation.allMessages.filter { $0.type == .text || $0.type == .image || $0.type == .voice }
            contact.messageCount = allMessages.count
            
            if let lastMessage = allMessages.last {
                contact.lastMessage = lastMessage.content
                if let timestamp = conversation.allMessages.last(where: { $0.type == .timestamp }) {
                    contact.lastMessageTime = timestamp.content
                }
            }
            
            return WechatBookListItem(from: contact)
        }.sorted { $0.name < $1.name }
    }
}

