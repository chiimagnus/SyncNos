import Foundation
import UniformTypeIdentifiers

// MARK: - Export Format

/// Chat records export format
enum ChatExportFormat: String, CaseIterable, Identifiable {
    case json = "JSON"
    case markdown = "Markdown"
    
    var id: String { rawValue }
    
    var fileExtension: String {
        switch self {
        case .json: return "json"
        case .markdown: return "md"
        }
    }
    
    var displayName: String {
        switch self {
        case .json:
            return String(localized: "JSON Format", table: "Chats", comment: "Export format: JSON")
        case .markdown:
            return String(localized: "Markdown Format", table: "Chats", comment: "Export format: Markdown")
        }
    }
    
    var utType: UTType {
        switch self {
        case .json: return .json
        case .markdown: return UTType(filenameExtension: "md") ?? .plainText
        }
    }
}

// MARK: - JSON Export Model

/// JSON 导出模型（带版本号，便于后续兼容性处理）
struct ChatExportJSON: Codable {
    let version: Int
    let exportedAt: Date
    let conversation: ChatExportConversation
    
    static let currentVersion = 1
}

struct ChatExportConversation: Codable {
    let contactName: String
    let messageCount: Int
    let messages: [ChatExportMessage]
}

struct ChatExportMessage: Codable {
    let content: String
    let isFromMe: Bool
    let kind: String
    let senderName: String?
    let order: Int
}

// MARK: - Exporter

/// Chat records exporter
enum ChatExporter {
    
    // MARK: - Public Methods
    
    /// 导出对话为指定格式
    /// - Parameters:
    ///   - conversation: 对话数据
    ///   - format: 导出格式
    /// - Returns: 导出的字符串内容
    static func export(_ conversation: ChatConversation, format: ChatExportFormat) -> String {
        switch format {
        case .json:
            return exportAsJSON(conversation)
        case .markdown:
            return exportAsMarkdown(conversation)
        }
    }
    
    /// 从消息数组导出（用于分页加载场景）
    /// - Parameters:
    ///   - messages: 消息数组
    ///   - contactName: 联系人名称
    ///   - format: 导出格式
    /// - Returns: 导出的字符串内容
    static func export(messages: [ChatMessage], contactName: String, format: ChatExportFormat) -> String {
        let contact = ChatContact(name: contactName)
        let conversation = ChatConversation(contact: contact, messages: messages)
        return export(conversation, format: format)
    }
    
    /// 生成导出文件名
    /// - Parameters:
    ///   - contactName: 联系人名称
    ///   - format: 导出格式
    /// - Returns: 文件名（含扩展名）
    /// - Note: 格式为 `SyncNos_<chatName>_<timestamp>.<ext>`
    static func generateFileName(contactName: String, format: ChatExportFormat) -> String {
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyyMMdd_HHmmss"
        let timestamp = dateFormatter.string(from: Date())
        
        // 清理文件名中的非法字符
        let sanitizedName = contactName
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "\\", with: "_")
            .replacingOccurrences(of: ":", with: "_")
            .replacingOccurrences(of: "*", with: "_")
            .replacingOccurrences(of: "?", with: "_")
            .replacingOccurrences(of: "\"", with: "_")
            .replacingOccurrences(of: "<", with: "_")
            .replacingOccurrences(of: ">", with: "_")
            .replacingOccurrences(of: "|", with: "_")
        
        return "SyncNos_\(sanitizedName)_\(timestamp).\(format.fileExtension)"
    }
    
    // MARK: - JSON Export
    
    private static func exportAsJSON(_ conversation: ChatConversation) -> String {
        let messages = conversation.messages
            .sorted(by: { $0.order < $1.order })
            .map { msg in
                ChatExportMessage(
                    content: msg.content,
                    isFromMe: msg.isFromMe,
                    kind: msg.kind.rawValue,
                    senderName: msg.senderName,
                    order: msg.order
                )
            }
        
        let exportData = ChatExportJSON(
            version: ChatExportJSON.currentVersion,
            exportedAt: Date(),
            conversation: ChatExportConversation(
                contactName: conversation.contact.name,
                messageCount: messages.count,
                messages: messages
            )
        )
        
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        
        do {
            let data = try encoder.encode(exportData)
            return String(data: data, encoding: .utf8) ?? "{}"
        } catch {
            return "{ \"error\": \"Export failed: \(error.localizedDescription)\" }"
        }
    }
    
    // MARK: - Markdown Export
    
    private static func exportAsMarkdown(_ conversation: ChatConversation) -> String {
        var lines: [String] = []
        
        // 标题（对话联系人名称）
        lines.append("# \(conversation.contact.name)")
        lines.append("")
        
        // 元信息
        let dateFormatter = DateFormatter()
        dateFormatter.dateStyle = .long
        dateFormatter.timeStyle = .short
        lines.append("> Exported: \(dateFormatter.string(from: Date()))")
        lines.append("> Messages: \(conversation.messages.count)")
        lines.append("")
        lines.append("---")
        lines.append("")
        
        // 消息内容
        var lastSender: String?
        
        for message in conversation.messages.sorted(by: { $0.order < $1.order }) {
            switch message.kind {
            case .system:
                // 系统消息：使用 # System 标题
                if lastSender != "System" {
                    lines.append("# System")
                    lastSender = "System"
                }
                lines.append(message.content)
                lines.append("")
                
            case .image:
                let sender = formatSender(message, defaultName: conversation.contact.name)
                if lastSender != sender {
                    lines.append("# \(sender)")
                    lastSender = sender
                }
                lines.append("📷 [Image]")
                lines.append("")
                
            case .voice:
                let sender = formatSender(message, defaultName: conversation.contact.name)
                if lastSender != sender {
                    lines.append("# \(sender)")
                    lastSender = sender
                }
                lines.append("🎤 [Voice]")
                lines.append("")
                
            case .card:
                let sender = formatSender(message, defaultName: conversation.contact.name)
                if lastSender != sender {
                    lines.append("# \(sender)")
                    lastSender = sender
                }
                lines.append("📋 [Card]")
                if !message.content.isEmpty {
                    lines.append(message.content)
                }
                lines.append("")
                
            case .text:
                let sender = formatSender(message, defaultName: conversation.contact.name)
                if lastSender != sender {
                    lines.append("# \(sender)")
                    lastSender = sender
                }
                lines.append(message.content)
                lines.append("")
            }
        }
        
        return lines.joined(separator: "\n")
    }
    
    // MARK: - Helper
    
    private static func formatSender(_ message: ChatMessage, defaultName: String) -> String {
        if message.isFromMe {
            return "Me"
        } else if let senderName = message.senderName, !senderName.isEmpty {
            return senderName
        } else {
            return defaultName
        }
    }
}

