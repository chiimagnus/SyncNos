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
    
    /// 导入截图并识别
    func importScreenshots(urls: [URL]) async {
        isLoading = true
        errorMessage = nil
        
        for url in urls {
            await importSingleScreenshot(url: url)
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
    
    // MARK: - Private Methods
    
    private func importSingleScreenshot(url: URL) async {
        guard url.startAccessingSecurityScopedResource() else {
            errorMessage = "无法访问文件: \(url.lastPathComponent)"
            return
        }
        defer { url.stopAccessingSecurityScopedResource() }
        
        guard let image = NSImage(contentsOf: url) else {
            errorMessage = "无法加载图片: \(url.lastPathComponent)"
            return
        }
        
        // 创建截图记录
        var screenshot = WechatScreenshot(image: image, isProcessing: true)
        let screenshotId = screenshot.id
        processingScreenshotIds.insert(screenshotId)
        
        do {
            logger.info("[WechatChat] Processing screenshot: \(url.lastPathComponent)")
            
            // OCR 识别
            let ocrResult = try await ocrService.recognize(image)
            let messages = parser.parse(ocrResult: ocrResult, imageSize: image.size)
            
            screenshot.messages = messages
            screenshot.isProcessing = false
            
            // 从 OCR 结果或文件名提取联系人名称
            let contactName = extractContactName(from: ocrResult, fileName: url.lastPathComponent)
            screenshot.contactName = contactName
            
            // 查找或创建联系人
            let contact = findOrCreateContact(name: contactName, isGroup: detectIsGroup(messages: messages))
            
            // 更新对话
            if var conversation = conversations[contact.id] {
                conversation.screenshots.append(screenshot)
                conversations[contact.id] = conversation
            } else {
                let newConversation = WechatConversation(contact: contact, screenshots: [screenshot])
                conversations[contact.id] = newConversation
            }
            
            // 更新联系人列表
            updateContactsList()
            
            logger.info("[WechatChat] Parsed \(messages.count) messages for \(contactName)")
            
        } catch {
            logger.error("[WechatChat] OCR failed: \(error)")
            errorMessage = error.localizedDescription
        }
        
        processingScreenshotIds.remove(screenshotId)
    }
    
    /// 从 OCR 结果提取联系人名称
    private func extractContactName(from ocrResult: OCRResult, fileName: String) -> String {
        // 尝试从第一个 block 提取（通常是标题栏）
        if let firstBlock = ocrResult.blocks.first {
            let text = firstBlock.text.trimmingCharacters(in: .whitespacesAndNewlines)
            // 排除时间戳
            if !text.isEmpty && !parser.isLikelyTimestamp(text) && text.count < 30 {
                return text
            }
        }
        
        // 使用文件名作为备选
        let name = fileName.replacingOccurrences(of: "\\.[^.]+$", with: "", options: .regularExpression)
        return name.isEmpty ? "未知联系人" : name
    }
    
    /// 查找或创建联系人
    private func findOrCreateContact(name: String, isGroup: Bool) -> WechatContact {
        // 查找现有联系人
        if let existingItem = contacts.first(where: { $0.name == name }) {
            return WechatContact(
                id: existingItem.contactId,
                name: existingItem.name,
                isGroup: existingItem.isGroup
            )
        }
        
        // 创建新联系人
        return WechatContact(name: name, isGroup: isGroup)
    }
    
    /// 检测是否是群聊（通过消息中是否有多个不同的发送者名称）
    private func detectIsGroup(messages: [WechatMessage]) -> Bool {
        let senderNames = Set(messages.compactMap { $0.senderName })
        return senderNames.count > 1
    }
    
    /// 更新联系人列表
    private func updateContactsList() {
        contacts = conversations.values.map { conversation in
            var contact = conversation.contact
            
            // 更新最后消息和消息数量
            let allMessages = conversation.allMessages.filter { $0.type == .text || $0.type == .image || $0.type == .voice }
            contact.messageCount = allMessages.count
            
            if let lastMessage = allMessages.last {
                contact.lastMessage = lastMessage.content
                // 查找最近的时间戳
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
    /// 检测是否像时间戳
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
