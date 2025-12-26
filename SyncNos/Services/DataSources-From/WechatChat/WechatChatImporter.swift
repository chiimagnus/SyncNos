import Foundation

// MARK: - Import Result

/// 导入结果
struct WechatImportResult {
    let contactName: String
    let messages: [WechatMessage]
    let format: WechatExportFormat
}

// MARK: - Import Error

/// 导入错误
enum WechatImportError: LocalizedError {
    case invalidFormat
    case jsonParseError(String)
    case markdownParseError(String)
    case unsupportedVersion(Int)
    case fileReadError(String)
    case emptyContent
    
    var errorDescription: String? {
        switch self {
        case .invalidFormat:
            return String(localized: "Unsupported file format", comment: "Import error")
        case .jsonParseError(let detail):
            return String(localized: "JSON parse error: \(detail)", comment: "Import error")
        case .markdownParseError(let detail):
            return String(localized: "Markdown parse error: \(detail)", comment: "Import error")
        case .unsupportedVersion(let version):
            return String(localized: "Unsupported version: \(version). Please update the app.", comment: "Import error")
        case .fileReadError(let detail):
            return String(localized: "File read error: \(detail)", comment: "Import error")
        case .emptyContent:
            return String(localized: "No messages found in the file", comment: "Import error")
        }
    }
}

// MARK: - Importer

/// 微信聊天记录导入工具
enum WechatChatImporter {
    
    // MARK: - Public Methods
    
    /// 从文件 URL 自动检测格式并导入
    /// - Parameter url: 文件 URL
    /// - Returns: 导入结果
    static func importFromFile(url: URL) throws -> WechatImportResult {
        let fileExtension = url.pathExtension.lowercased()
        
        guard let content = try? String(contentsOf: url, encoding: .utf8) else {
            throw WechatImportError.fileReadError(url.lastPathComponent)
        }
        
        switch fileExtension {
        case "json":
            return try importFromJSON(content)
        case "md", "markdown":
            return try importFromMarkdown(content)
        default:
            throw WechatImportError.invalidFormat
        }
    }
    
    /// 从 JSON 字符串导入
    /// - Parameter jsonString: JSON 字符串
    /// - Returns: 导入结果
    static func importFromJSON(_ jsonString: String) throws -> WechatImportResult {
        guard let data = jsonString.data(using: .utf8) else {
            throw WechatImportError.jsonParseError("Invalid UTF-8 encoding")
        }
        
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        
        do {
            let exportData = try decoder.decode(WechatExportJSON.self, from: data)
            
            // 版本检查
            if exportData.version > WechatExportJSON.currentVersion {
                throw WechatImportError.unsupportedVersion(exportData.version)
            }
            
            let messages = exportData.conversation.messages.enumerated().map { index, msg in
                WechatMessage(
                    id: UUID(),
                    content: msg.content,
                    isFromMe: msg.isFromMe,
                    senderName: msg.senderName,
                    kind: WechatMessageKind(rawValue: msg.kind) ?? .text,
                    bbox: nil,
                    order: msg.order >= 0 ? msg.order : index
                )
            }
            
            if messages.isEmpty {
                throw WechatImportError.emptyContent
            }
            
            return WechatImportResult(
                contactName: exportData.conversation.contactName,
                messages: messages,
                format: .json
            )
        } catch let error as WechatImportError {
            throw error
        } catch {
            throw WechatImportError.jsonParseError(error.localizedDescription)
        }
    }
    
    /// 从 Markdown 字符串导入
    /// - Parameter markdownString: Markdown 字符串
    /// - Returns: 导入结果
    static func importFromMarkdown(_ markdownString: String) throws -> WechatImportResult {
        let lines = markdownString.components(separatedBy: .newlines)
        
        var contactName: String?
        var messages: [WechatMessage] = []
        var currentSender: String?
        var currentIsFromMe = false
        var pendingContent: [String] = []
        var messageOrder = 0
        var isAfterSeparator = false
        
        // 正则表达式
        let titlePattern = try? NSRegularExpression(pattern: "^#\\s+(.+)$", options: [])
        
        // 辅助函数：保存当前待处理的消息
        func flushPendingMessage() {
            guard let sender = currentSender, !pendingContent.isEmpty else { return }
            
            let content = pendingContent.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !content.isEmpty else {
                pendingContent.removeAll()
                return
            }
            
            // 检测消息类型
            var kind: WechatMessageKind
            var finalContent: String
            
            // 检查是否是系统消息（发送者为 "System"）
            if sender.lowercased() == "system" {
                kind = .system
                finalContent = content
            } else if content.contains("📷") && content.contains("[Image]") {
                kind = .image
                finalContent = ""
            } else if content.contains("📷") && content.contains("[图片]") {
                kind = .image
                finalContent = ""
            } else if content.contains("🎤") && content.contains("[Voice]") {
                kind = .voice
                finalContent = ""
            } else if content.contains("🎤") && content.contains("[语音]") {
                kind = .voice
                finalContent = ""
            } else if content.contains("📋") && content.contains("[Card]") {
                kind = .card
                finalContent = content.replacingOccurrences(of: "📋 [Card]", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
            } else if content.contains("📋") && content.contains("[卡片]") {
                kind = .card
                finalContent = content.replacingOccurrences(of: "📋 *[卡片]*", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
            } else {
                kind = .text
                finalContent = content
            }
            
            let message = WechatMessage(
                id: UUID(),
                content: finalContent,
                isFromMe: currentIsFromMe,
                senderName: (currentIsFromMe || kind == .system) ? nil : sender,
                kind: kind,
                bbox: nil,
                order: messageOrder
            )
            messages.append(message)
            messageOrder += 1
            pendingContent.removeAll()
        }
        
        for line in lines {
            let trimmedLine = line.trimmingCharacters(in: .whitespaces)
            
            // 跳过空行
            if trimmedLine.isEmpty {
                continue
            }
            
            // 检测分隔符
            if trimmedLine == "---" {
                isAfterSeparator = true
                continue
            }
            
            // 检测标题行 (# xxx)
            if let titlePattern,
               let match = titlePattern.firstMatch(in: trimmedLine, options: [], range: NSRange(trimmedLine.startIndex..., in: trimmedLine)),
               let range = Range(match.range(at: 1), in: trimmedLine) {
                
                let title = String(trimmedLine[range])
                
                if !isAfterSeparator {
                    // 分隔符前的标题是联系人名称
                    if contactName == nil {
                        contactName = title
                    }
                } else {
                    // 分隔符后的标题是发送者
                    flushPendingMessage()
                    currentSender = title
                    // 支持中英文 "我" / "Me"，以及系统消息 "System"
                    let lowerTitle = title.lowercased()
                    if lowerTitle == "system" {
                        // 系统消息特殊处理
                        currentSender = "System"
                        currentIsFromMe = false
                    } else {
                        currentIsFromMe = (title == "我" || lowerTitle == "me")
                    }
                }
                continue
            }
            
            // 跳过元信息行（分隔符前）
            if !isAfterSeparator {
                continue
            }
            
            // 普通消息内容（包括 System 发送者的系统消息）
            if currentSender != nil {
                pendingContent.append(trimmedLine)
            }
        }
        
        // 处理最后一条消息
        flushPendingMessage()
        
        // 验证结果
        guard let name = contactName, !name.isEmpty else {
            throw WechatImportError.markdownParseError("Contact name not found (expected # Title at the beginning)")
        }
        
        if messages.isEmpty {
            throw WechatImportError.emptyContent
        }
        
        return WechatImportResult(
            contactName: name,
            messages: messages,
            format: .markdown
        )
    }
}

