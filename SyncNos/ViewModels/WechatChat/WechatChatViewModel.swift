import Foundation
import AppKit
import Combine

// MARK: - Wechat Chat View Model

@MainActor
final class WechatChatViewModel: ObservableObject {
    
    // MARK: - Published Properties
    
    @Published var screenshots: [WechatScreenshot] = []
    @Published var selectedScreenshotId: UUID?
    @Published var isImporting = false
    @Published var error: String?
    
    // MARK: - Dependencies
    
    private let ocrService: OCRAPIServiceProtocol
    private let parser: WechatOCRParser
    private let logger: LoggerServiceProtocol
    
    // MARK: - Computed Properties
    
    var selectedScreenshot: WechatScreenshot? {
        guard let id = selectedScreenshotId else {
            return screenshots.first
        }
        return screenshots.first { $0.id == id }
    }
    
    var allMessages: [WechatMessage] {
        screenshots.flatMap { $0.messages }
    }
    
    var isConfigured: Bool {
        OCRConfigStore.shared.isConfigured
    }
    
    var hasScreenshots: Bool {
        !screenshots.isEmpty
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
    
    /// 导入截图
    func importScreenshots(urls: [URL]) async {
        isImporting = true
        error = nil
        
        for url in urls {
            await importSingleScreenshot(url: url)
        }
        
        isImporting = false
    }
    
    /// 导入单张截图
    private func importSingleScreenshot(url: URL) async {
        guard url.startAccessingSecurityScopedResource() else {
            error = "无法访问文件: \(url.lastPathComponent)"
            return
        }
        defer { url.stopAccessingSecurityScopedResource() }
        
        guard let image = NSImage(contentsOf: url) else {
            error = "无法加载图片: \(url.lastPathComponent)"
            return
        }
        
        // 添加截图（处理中状态）
        let screenshot = WechatScreenshot(image: image, isProcessing: true)
        screenshots.append(screenshot)
        let screenshotId = screenshot.id
        
        // 选中新添加的截图
        selectedScreenshotId = screenshotId
        
        // OCR 识别
        do {
            logger.info("[WechatChat] Processing screenshot: \(url.lastPathComponent)")
            
            let ocrResult = try await ocrService.recognize(image)
            let messages = parser.parse(ocrResult: ocrResult, imageSize: image.size)
            
            // 更新截图
            if let index = screenshots.firstIndex(where: { $0.id == screenshotId }) {
                screenshots[index].messages = messages
                screenshots[index].isProcessing = false
                logger.info("[WechatChat] Parsed \(messages.count) messages")
            }
            
        } catch {
            logger.error("[WechatChat] OCR failed: \(error)")
            
            if let index = screenshots.firstIndex(where: { $0.id == screenshotId }) {
                screenshots[index].isProcessing = false
                screenshots[index].error = error.localizedDescription
            }
        }
    }
    
    /// 删除截图
    func deleteScreenshot(_ screenshot: WechatScreenshot) {
        screenshots.removeAll { $0.id == screenshot.id }
        
        if selectedScreenshotId == screenshot.id {
            selectedScreenshotId = screenshots.first?.id
        }
    }
    
    /// 清除所有截图
    func clearAll() {
        screenshots.removeAll()
        selectedScreenshotId = nil
    }
    
    /// 导出为纯文本
    func exportAsText() -> String {
        let conversation = WechatConversation(screenshots: screenshots)
        return conversation.exportAsText()
    }
    
    /// 复制到剪贴板
    func copyToClipboard() {
        let text = exportAsText()
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}

