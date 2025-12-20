import Foundation
import AppKit
import Combine

// MARK: - Wechat Chat View Model

@MainActor
final class WechatChatViewModel: ObservableObject {
    
    // MARK: - Published Properties
    
    /// 联系人/对话列表（用于左侧列表显示）
    @Published var contacts: [WechatBookListItem] = []
    
    /// 所有对话数据
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
    private let parser: WechatOCRParser
    private let logger: LoggerServiceProtocol
    
    // MARK: - Computed Properties
    
    var isConfigured: Bool {
        OCRConfigStore.shared.isConfigured
    }
    
    // MARK: - Init
    
    init(
        ocrService: OCRAPIServiceProtocol = DIContainer.shared.ocrAPIService,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.ocrService = ocrService
        self.parser = WechatOCRParser()
        self.logger = logger
    }
    
    // MARK: - Public Methods
    
    /// 创建新对话（用户手动输入名称）
    /// - Parameter name: 联系人/群聊名称
    /// - Returns: 新创建的联系人 ID
    @discardableResult
    func createConversation(name: String, isGroup: Bool = false) -> UUID {
        let contact = WechatContact(name: name, isGroup: isGroup)
        let conversation = WechatConversation(contact: contact, screenshots: [])
        conversations[contact.id] = conversation
        updateContactsList()
        logger.info("[WechatChat] Created new conversation: \(name)")
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
    }
    
    /// 清除所有数据
    func clearAll() {
        contacts.removeAll()
        conversations.removeAll()
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
            
            // 追加到现有对话
            if var conversation = conversations[contactId] {
                conversation.screenshots.append(screenshot)
                conversations[contactId] = conversation
                updateContactsList()
            }
            
            logger.info("[WechatChat] Added \(messages.count) messages to conversation")
            
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

// MARK: - Parser Helper Extension

extension WechatOCRParser {
    func isLikelyTimestamp(_ text: String) -> Bool {
        let patterns = [
            #"^\d{1,2}:\d{2}$"#,
            #"^\d{1,2}月\d{1,2}日"#
        ]
        for pattern in patterns {
            if text.range(of: pattern, options: .regularExpression) != nil {
                return true
            }
        }
        return false
    }
}
