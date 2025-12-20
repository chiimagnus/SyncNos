import Foundation
import AppKit

// MARK: - Wechat OCR Parser

/// 微信聊天截图 OCR 解析器
/// 专为两人聊天设计，根据消息气泡的 x 坐标位置判断消息方向
final class WechatOCRParser {
    
    // MARK: - Constants
    
    /// 左侧阈值：消息气泡起始 x 坐标 < 图片宽度的 40% 为对方消息
    private let leftThreshold: CGFloat = 0.40
    
    /// 右侧阈值：消息气泡结束 x 坐标 > 图片宽度的 60% 为我的消息
    private let rightThreshold: CGFloat = 0.60
    
    // MARK: - Public Methods
    
    /// 解析 OCR 结果为微信消息（两人聊天）
    func parse(ocrResult: OCRResult, imageSize: CGSize) -> [WechatMessage] {
        guard imageSize.width > 0 else { return [] }
        
        var messages: [WechatMessage] = []
        
        // 按 y 坐标排序（从上到下）
        let sortedBlocks = ocrResult.blocks.sorted { $0.bbox.minY < $1.bbox.minY }
        
        for (index, block) in sortedBlocks.enumerated() {
            let text = block.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { continue }
            
            // 判断消息类型和方向
            let direction = determineDirection(block: block, imageWidth: imageSize.width)
            let messageType = determineMessageType(text: text, direction: direction)
            
            let message = WechatMessage(
                content: text,
                isFromMe: direction == .right,
                type: messageType,
                bbox: block.bbox,
                blockOrder: index
            )
            
            messages.append(message)
        }
        
        return messages
    }
    
    // MARK: - Private Methods
    
    /// 判断消息方向
    /// 基于消息气泡的 x 坐标位置判断
    private func determineDirection(block: OCRBlock, imageWidth: CGFloat) -> MessageDirection {
        // 使用气泡的起始 x 坐标和结束 x 坐标
        let startX = block.bbox.minX
        let endX = block.bbox.maxX
        
        // 相对位置
        let relativeStartX = startX / imageWidth
        let relativeEndX = endX / imageWidth
        
        // 如果气泡起始位置在左侧（< 40%），是对方消息
        if relativeStartX < leftThreshold && relativeEndX < 0.7 {
            return .left
        }
        
        // 如果气泡结束位置在右侧（> 60%），是我的消息
        if relativeEndX > rightThreshold && relativeStartX > 0.3 {
            return .right
        }
        
        // 其他情况（如时间戳、系统消息）通常在中间
        return .center
    }
    
    /// 判断消息类型
    private func determineMessageType(text: String, direction: MessageDirection) -> WechatMessage.MessageType {
        // 时间戳检测
        if isTimestamp(text) {
            return .timestamp
        }
        
        // 系统消息检测（通常在中间）
        if isSystemMessage(text) {
            return .system
        }
        
        // 中间位置且不是时间戳，可能是系统消息
        if direction == .center && !isTimestamp(text) {
            return .system
        }
        
        // 特殊内容检测
        if text.contains("[图片]") || text.contains("[照片]") {
            return .image
        }
        if text.contains("[语音]") || text.range(of: #"^\d+['\"]$"#, options: .regularExpression) != nil {
            return .voice
        }
        
        return .text
    }
    
    /// 检测是否为时间戳
    private func isTimestamp(_ text: String) -> Bool {
        let patterns = [
            #"^\d{1,2}:\d{2}$"#,                      // 12:34
            #"^(上午|下午)\s*\d{1,2}:\d{2}$"#,         // 上午 12:34
            #"^昨天\s*\d{1,2}:\d{2}$"#,               // 昨天 12:34
            #"^\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2}$"#, // 7月29日 03:11
            #"^\d{1,2}月\d{1,2}日\s*\d{2}:\d{2}$"#,   // 7月29日 08:03
            #"^星期[一二三四五六日]\s*\d{1,2}:\d{2}$"#   // 星期六 12:34
        ]
        
        for pattern in patterns {
            if text.range(of: pattern, options: .regularExpression) != nil {
                return true
            }
        }
        return false
    }
    
    /// 检测是否为系统消息
    private func isSystemMessage(_ text: String) -> Bool {
        let keywords = [
            "撤回了一条消息",
            "加入了群聊",
            "退出了群聊",
            "修改群名",
            "你已添加了",
            "以上是打招呼的内容",
            "拍了拍",
            "邀请你加入",
            "与群里其他人都不是朋友关系",
            "小程序"
        ]
        
        return keywords.contains { text.contains($0) }
    }
}

// MARK: - Message Direction

private enum MessageDirection {
    case left   // 对方消息
    case right  // 我的消息
    case center // 时间戳/系统消息
}
