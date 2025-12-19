import Foundation
import AppKit

// MARK: - OCR API Service Protocol

protocol OCRAPIServiceProtocol {
    /// 识别图片中的文字
    /// - Parameters:
    ///   - image: 要识别的图片
    ///   - prompt: 识别提示语（可选）
    /// - Returns: OCR 识别结果
    func recognizeImage(_ image: NSImage, prompt: String?) async throws -> String
    
    /// 识别图片中的文字（带 bbox）
    /// 使用 DeepSeek-OCR 原生的 grounding 功能，返回每个文本块的位置信息
    /// - Parameter image: 要识别的图片
    /// - Returns: 带 bbox 的 OCR 识别结果
    func recognizeImageWithBBox(_ image: NSImage) async throws -> OCRResultWithBBox
    
    /// 识别微信聊天截图
    /// - Parameter image: 微信聊天截图
    /// - Returns: 解析后的聊天消息列表
    func recognizeWechatChat(_ image: NSImage) async throws -> WechatOCRResult
    
    /// 测试 API 连接
    /// - Returns: 是否连接成功
    func testConnection() async throws -> Bool
}

// MARK: - OCR API Service

/// DeepSeek-OCR API 服务实现（硅基流动）
final class OCRAPIService: OCRAPIServiceProtocol {
    
    private let configStore: OCRConfigStoreProtocol
    private let logger: LoggerServiceProtocol
    private let session: URLSession
    
    // MARK: - Constants
    
    private enum Constants {
        static let timeout: TimeInterval = 120
        static let maxTokens = 4096
        static let temperature = 0.0
    }
    
    // MARK: - Default Prompts
    
    private enum Prompts {
        /// 微信聊天截图识别 prompt
        static let wechatChat = """
        请仔细识别这张微信聊天截图中的所有内容。

        输出格式要求（JSON）:
        ```json
        {
          "messages": [
            {
              "sender": "发送者昵称",
              "content": "消息内容",
              "time": "时间（如果有）",
              "isFromMe": false
            }
          ]
        }
        ```

        注意事项:
        1. 按照对话顺序从上到下列出所有消息
        2. "isFromMe" 为 true 表示右侧消息（自己发送），为 false 表示左侧消息（对方发送）
        3. 如果有时间戳，请提取出来
        4. 如果消息是图片/表情/语音/视频，请在 content 中标注类型，如 "[图片]"、"[表情]"、"[语音]"
        5. 请确保 JSON 格式正确，可以直接解析
        """
        
        /// 通用 OCR（无 bbox）
        static let generalOCR = """
        请识别这张图片中的所有文字内容。
        直接输出识别到的文字，保持原有的排版格式。
        """
        
        /// DeepSeek-OCR 原生 grounding OCR（带 bbox）
        /// 输出格式: <|ref|>文字<|/ref|><|det|>[[x1,y1,x2,y2]]<|/det|>
        static let groundingOCR = "<|grounding|>OCR this image."
        
        /// DeepSeek-OCR 文档转 Markdown（带 bbox）
        static let groundingDocument = "<|grounding|>Convert the document to markdown."
    }
    
    // MARK: - Init
    
    init(
        configStore: OCRConfigStoreProtocol = OCRConfigStore.shared,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.configStore = configStore
        self.logger = logger
        
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = Constants.timeout
        config.timeoutIntervalForResource = Constants.timeout
        self.session = URLSession(configuration: config)
    }
    
    // MARK: - Public Methods
    
    func recognizeImage(_ image: NSImage, prompt: String? = nil) async throws -> String {
        guard configStore.isConfigured else {
            throw OCRServiceError.apiKeyNotConfigured
        }
        
        // 将图片转换为 base64
        let base64Image = try encodeImageToBase64(image)
        
        // 构建请求
        let finalPrompt = prompt ?? Prompts.generalOCR
        let response = try await sendOCRRequest(imageBase64: base64Image, prompt: finalPrompt)
        
        guard let content = response.choices?.first?.message?.content else {
            if let error = response.error {
                throw OCRServiceError.apiError(error.message ?? "Unknown API error")
            }
            throw OCRServiceError.unknown("No response content")
        }
        
        return content
    }
    
    func recognizeImageWithBBox(_ image: NSImage) async throws -> OCRResultWithBBox {
        guard configStore.isConfigured else {
            throw OCRServiceError.apiKeyNotConfigured
        }
        
        logger.info("[OCR] Starting recognition with bbox (grounding mode)...")
        
        // 将图片转换为 base64
        let base64Image = try encodeImageToBase64(image)
        
        // 使用 DeepSeek-OCR 原生 grounding prompt
        let response = try await sendOCRRequest(imageBase64: base64Image, prompt: Prompts.groundingOCR)
        
        guard let rawText = response.choices?.first?.message?.content else {
            if let error = response.error {
                throw OCRServiceError.apiError(error.message ?? "Unknown API error")
            }
            throw OCRServiceError.unknown("No response content")
        }
        
        logger.debug("[OCR] Raw grounding response: \(rawText.prefix(500))...")
        
        // 解析 bbox 输出
        let textBlocks = parseBBoxOutput(from: rawText)
        
        logger.info("[OCR] Parsed \(textBlocks.count) text blocks with bbox")
        
        return OCRResultWithBBox(
            rawText: rawText,
            textBlocks: textBlocks,
            processedAt: Date(),
            sourceImage: image,
            tokenUsage: response.usage
        )
    }
    
    func recognizeWechatChat(_ image: NSImage) async throws -> WechatOCRResult {
        guard configStore.isConfigured else {
            throw OCRServiceError.apiKeyNotConfigured
        }
        
        logger.info("[OCR] Starting Wechat chat recognition...")
        
        // 将图片转换为 base64
        let base64Image = try encodeImageToBase64(image)
        
        // 发送 OCR 请求
        let response = try await sendOCRRequest(imageBase64: base64Image, prompt: Prompts.wechatChat)
        
        guard let rawText = response.choices?.first?.message?.content else {
            if let error = response.error {
                throw OCRServiceError.apiError(error.message ?? "Unknown API error")
            }
            throw OCRServiceError.unknown("No response content")
        }
        
        logger.debug("[OCR] Raw response: \(rawText.prefix(500))...")
        
        // 解析聊天消息
        let messages = parseWechatMessages(from: rawText)
        
        logger.info("[OCR] Parsed \(messages.count) messages from screenshot")
        
        return WechatOCRResult(
            rawText: rawText,
            messages: messages,
            processedAt: Date(),
            sourceImage: image,
            tokenUsage: response.usage
        )
    }
    
    func testConnection() async throws -> Bool {
        guard configStore.isConfigured else {
            throw OCRServiceError.apiKeyNotConfigured
        }
        
        // 创建一个简单的 100x100 像素图片用于测试
        let testImage = createTestImage()
        
        do {
            let base64Image = try encodeImageToBase64(testImage)
            let response = try await sendOCRRequest(imageBase64: base64Image, prompt: "Say 'OK' if you can see this image.")
            
            if let error = response.error {
                logger.error("[OCR] Connection test failed: \(error.message ?? "Unknown")")
                return false
            }
            
            logger.info("[OCR] Connection test successful")
            return response.choices != nil && !response.choices!.isEmpty
        } catch {
            logger.error("[OCR] Connection test error: \(error.localizedDescription)")
            throw error
        }
    }
    
    // MARK: - Private Methods
    
    private func sendOCRRequest(imageBase64: String, prompt: String) async throws -> OCRResponse {
        guard let url = URL(string: "\(OCRConfigStore.baseURL)/chat/completions") else {
            throw OCRServiceError.unknown("Invalid API URL")
        }
        
        guard let apiKey = configStore.apiKey else {
            throw OCRServiceError.apiKeyNotConfigured
        }
        
        // 构建请求体
        let request = OCRRequest(
            model: OCRConfigStore.model,
            messages: [
                OCRRequestMessage(
                    role: "user",
                    content: [
                        .text(prompt),
                        .imageURL(url: "data:image/jpeg;base64,\(imageBase64)")
                    ]
                )
            ],
            maxTokens: Constants.maxTokens,
            temperature: Constants.temperature
        )
        
        // 创建 HTTP 请求
        var httpRequest = URLRequest(url: url)
        httpRequest.httpMethod = "POST"
        httpRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        httpRequest.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        
        let encoder = JSONEncoder()
        httpRequest.httpBody = try encoder.encode(request)
        
        logger.debug("[OCR] Sending request to SiliconFlow...")
        logger.debug("[OCR] Model: \(OCRConfigStore.model)")
        
        // 发送请求
        let (data, httpResponse) = try await session.data(for: httpRequest)
        
        guard let response = httpResponse as? HTTPURLResponse else {
            throw OCRServiceError.networkError(NSError(domain: "OCR", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid response"]))
        }
        
        logger.debug("[OCR] Response status: \(response.statusCode)")
        
        // 检查状态码
        if response.statusCode == 429 {
            throw OCRServiceError.rateLimitExceeded
        }
        
        if response.statusCode >= 400 {
            // 尝试解析错误信息
            if let errorResponse = try? JSONDecoder().decode(OCRResponse.self, from: data),
               let error = errorResponse.error {
                throw OCRServiceError.apiError(error.message ?? "HTTP \(response.statusCode)")
            }
            throw OCRServiceError.apiError("HTTP \(response.statusCode)")
        }
        
        // 解析响应
        let decoder = JSONDecoder()
        do {
            let ocrResponse = try decoder.decode(OCRResponse.self, from: data)
            return ocrResponse
        } catch {
            logger.error("[OCR] Failed to decode response: \(error)")
            if let responseString = String(data: data, encoding: .utf8) {
                logger.debug("[OCR] Raw response: \(responseString.prefix(1000))")
            }
            throw OCRServiceError.decodingError(error)
        }
    }
    
    private func encodeImageToBase64(_ image: NSImage) throws -> String {
        // 获取 CGImage
        guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            throw OCRServiceError.invalidImageData
        }
        
        // 创建 NSBitmapImageRep
        let bitmapRep = NSBitmapImageRep(cgImage: cgImage)
        
        // 转换为 JPEG 数据（压缩质量 0.8）
        guard let jpegData = bitmapRep.representation(using: .jpeg, properties: [.compressionFactor: 0.8]) else {
            throw OCRServiceError.invalidImageData
        }
        
        return jpegData.base64EncodedString()
    }
    
    private func createTestImage() -> NSImage {
        // 创建一个 100x100 的白色图片用于测试
        let size = NSSize(width: 100, height: 100)
        let image = NSImage(size: size)
        
        image.lockFocus()
        NSColor.white.setFill()
        NSRect(origin: .zero, size: size).fill()
        image.unlockFocus()
        
        return image
    }
    
    // MARK: - Message Parsing
    
    private func parseWechatMessages(from rawText: String) -> [WechatChatMessage] {
        // 尝试解析 JSON 格式
        if let messages = parseJSONMessages(from: rawText) {
            return messages
        }
        
        // 如果 JSON 解析失败，尝试简单的文本解析
        return parseTextMessages(from: rawText)
    }
    
    private func parseJSONMessages(from text: String) -> [WechatChatMessage]? {
        // 提取 JSON 部分（可能被 markdown 代码块包裹）
        let jsonPattern = #"```json\s*\n?([\s\S]*?)\n?```"#
        let plainPattern = #"\{[\s\S]*"messages"[\s\S]*\}"#
        
        var jsonString: String?
        
        // 尝试从 markdown 代码块提取
        if let regex = try? NSRegularExpression(pattern: jsonPattern, options: []),
           let match = regex.firstMatch(in: text, options: [], range: NSRange(text.startIndex..., in: text)),
           let range = Range(match.range(at: 1), in: text) {
            jsonString = String(text[range])
        }
        
        // 如果没有代码块，尝试直接提取 JSON
        if jsonString == nil,
           let regex = try? NSRegularExpression(pattern: plainPattern, options: []),
           let match = regex.firstMatch(in: text, options: [], range: NSRange(text.startIndex..., in: text)),
           let range = Range(match.range, in: text) {
            jsonString = String(text[range])
        }
        
        guard let json = jsonString,
              let data = json.data(using: .utf8) else {
            return nil
        }
        
        // 定义解析结构
        struct ParsedResult: Decodable {
            struct ParsedMessage: Decodable {
                let sender: String?
                let content: String?
                let time: String?
                let isFromMe: Bool?
            }
            let messages: [ParsedMessage]?
        }
        
        do {
            let decoded = try JSONDecoder().decode(ParsedResult.self, from: data)
            return decoded.messages?.map { msg in
                WechatChatMessage(
                    sender: msg.sender ?? "未知",
                    content: msg.content ?? "",
                    timestamp: parseTimeString(msg.time),
                    isFromMe: msg.isFromMe ?? false,
                    messageType: detectMessageType(msg.content ?? "")
                )
            }
        } catch {
            logger.warning("[OCR] JSON parsing failed: \(error)")
            return nil
        }
    }
    
    private func parseTextMessages(from text: String) -> [WechatChatMessage] {
        // 简单的文本解析回退方案
        // 按行分割，尝试识别发送者和内容
        var messages: [WechatChatMessage] = []
        
        let lines = text.components(separatedBy: .newlines)
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { continue }
            
            // 尝试匹配 "发送者: 内容" 格式
            if let colonRange = trimmed.range(of: ":") ?? trimmed.range(of: "：") {
                let sender = String(trimmed[..<colonRange.lowerBound]).trimmingCharacters(in: .whitespaces)
                let content = String(trimmed[colonRange.upperBound...]).trimmingCharacters(in: .whitespaces)
                
                if !sender.isEmpty && !content.isEmpty {
                    messages.append(WechatChatMessage(
                        sender: sender,
                        content: content,
                        messageType: detectMessageType(content)
                    ))
                }
            }
        }
        
        return messages
    }
    
    private func parseTimeString(_ timeString: String?) -> Date? {
        guard let timeStr = timeString, !timeStr.isEmpty else { return nil }
        
        let formatters: [DateFormatter] = {
            let formats = ["HH:mm", "HH:mm:ss", "yyyy-MM-dd HH:mm", "MM-dd HH:mm"]
            return formats.map { format in
                let formatter = DateFormatter()
                formatter.dateFormat = format
                formatter.locale = Locale(identifier: "zh_CN")
                return formatter
            }
        }()
        
        for formatter in formatters {
            if let date = formatter.date(from: timeStr) {
                return date
            }
        }
        
        return nil
    }
    
    private func detectMessageType(_ content: String) -> WechatChatMessage.MessageType {
        let lowerContent = content.lowercased()
        
        if lowerContent.contains("[图片]") || lowerContent.contains("[image]") {
            return .image
        }
        if lowerContent.contains("[表情]") || lowerContent.contains("[emoji]") {
            return .emoji
        }
        if lowerContent.contains("[语音]") || lowerContent.contains("[voice]") {
            return .voice
        }
        if lowerContent.contains("[视频]") || lowerContent.contains("[video]") {
            return .video
        }
        if lowerContent.contains("[链接]") || lowerContent.contains("[link]") || lowerContent.contains("http") {
            return .link
        }
        if lowerContent.contains("[文件]") || lowerContent.contains("[file]") {
            return .file
        }
        
        return .text
    }
    
    // MARK: - BBox Parsing
    
    /// 解析 DeepSeek-OCR grounding 输出
    /// 格式: <|ref|>文字内容<|/ref|><|det|>[[x1,y1,x2,y2]]<|/det|>
    private func parseBBoxOutput(from text: String) -> [OCRTextBlock] {
        var textBlocks: [OCRTextBlock] = []
        
        // 正则匹配 <|ref|>...<|/ref|><|det|>...<|/det|> 格式
        let pattern = #"<\|ref\|>(.*?)<\|/ref\|><\|det\|>(.*?)<\|/det\|>"#
        
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.dotMatchesLineSeparators]) else {
            logger.warning("[OCR] Failed to create bbox regex")
            return textBlocks
        }
        
        let nsText = text as NSString
        let matches = regex.matches(in: text, options: [], range: NSRange(location: 0, length: nsText.length))
        
        for match in matches {
            guard match.numberOfRanges >= 3 else { continue }
            
            // 提取文字内容
            let textRange = match.range(at: 1)
            let textContent = nsText.substring(with: textRange)
            
            // 提取坐标
            let coordRange = match.range(at: 2)
            let coordString = nsText.substring(with: coordRange)
            
            // 解析坐标数组 [[x1,y1,x2,y2], ...]
            let coords = parseCoordinates(from: coordString)
            
            // 确定块类型
            let blockType = detectBlockType(text: textContent)
            
            // 为每个坐标创建一个 TextBlock
            for coord in coords {
                if coord.count >= 4 {
                    let block = OCRTextBlock(
                        text: textContent,
                        rawBbox: coord,
                        blockType: blockType
                    )
                    textBlocks.append(block)
                }
            }
        }
        
        logger.debug("[OCR] Parsed \(textBlocks.count) text blocks from grounding output")
        return textBlocks
    }
    
    /// 解析坐标字符串 [[x1,y1,x2,y2], [x1,y1,x2,y2], ...]
    private func parseCoordinates(from coordString: String) -> [[Int]] {
        var results: [[Int]] = []
        
        // 移除空格和换行
        let cleaned = coordString.replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "\n", with: "")
        
        // 匹配单个坐标数组 [x1,y1,x2,y2]
        let pattern = #"\[(\d+),(\d+),(\d+),(\d+)\]"#
        
        guard let regex = try? NSRegularExpression(pattern: pattern, options: []) else {
            return results
        }
        
        let nsString = cleaned as NSString
        let matches = regex.matches(in: cleaned, options: [], range: NSRange(location: 0, length: nsString.length))
        
        for match in matches {
            if match.numberOfRanges >= 5 {
                let x1 = Int(nsString.substring(with: match.range(at: 1))) ?? 0
                let y1 = Int(nsString.substring(with: match.range(at: 2))) ?? 0
                let x2 = Int(nsString.substring(with: match.range(at: 3))) ?? 0
                let y2 = Int(nsString.substring(with: match.range(at: 4))) ?? 0
                results.append([x1, y1, x2, y2])
            }
        }
        
        return results
    }
    
    /// 检测文本块类型
    private func detectBlockType(text: String) -> OCRTextBlock.BlockType {
        let lowerText = text.lowercased()
        
        // 检测图片标记
        if lowerText == "image" || lowerText.contains("[图片]") {
            return .image
        }
        
        // 检测标题（简单启发式：全大写或很短的文本）
        if text.count < 50 && text.uppercased() == text {
            return .title
        }
        
        // 检测表格
        if text.contains("<table>") || text.contains("<td>") {
            return .table
        }
        
        // 检测公式
        if text.contains("$") || text.contains("\\frac") || text.contains("\\sum") {
            return .formula
        }
        
        return .text
    }
}
