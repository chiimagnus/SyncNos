import Foundation
import AppKit

// MARK: - Wechat OCR Parser

/// 微信聊天截图 OCR 解析器
/// 根据 PaddleOCR 返回的 block_bbox 位置判断消息方向
final class WechatOCRParser {
    
    // MARK: - Constants
    
    /// 左侧阈值（相对 x 坐标 < 35% 为对方消息）
    private let leftThreshold: CGFloat = 0.35
    
    /// 右侧阈值（相对 x 坐标 > 65% 为我的消息）
    private let rightThreshold: CGFloat = 0.65
    
    /// 垂直合并阈值（y 坐标差距小于此值认为是同一消息）
    private let verticalMergeThreshold: CGFloat = 30
    
    // MARK: - Public Methods
    
    /// 解析 OCR 结果为微信消息
    func parse(ocrResult: OCRResult, imageSize: CGSize) -> [WechatMessage] {
        guard imageSize.width > 0 else { return [] }
        
        var messages: [WechatMessage] = []
        
        // 按 y 坐标排序
        let sortedBlocks = ocrResult.blocks.sorted { $0.bbox.minY < $1.bbox.minY }
        
        for (index, block) in sortedBlocks.enumerated() {
            let direction = determineDirection(block: block, imageWidth: imageSize.width)
            let messageType = determineMessageType(text: block.text, direction: direction)
            
            let message = WechatMessage(
                content: block.text.trimmingCharacters(in: .whitespacesAndNewlines),
                isFromMe: direction == .right,
                type: messageType,
                bbox: block.bbox,
                blockOrder: index
            )
            
            messages.append(message)
        }
        
        // 合并相邻的同方向消息
        return mergeAdjacentMessages(messages)
    }
    
    // MARK: - Private Methods
    
    /// 判断消息方向
    private func determineDirection(block: OCRBlock, imageWidth: CGFloat) -> MessageDirection {
        let centerX = block.bbox.midX
        let relativeX = centerX / imageWidth
        
        if relativeX < leftThreshold {
            return .left
        } else if relativeX > rightThreshold {
            return .right
        } else {
            return .center
        }
    }
    
    /// 判断消息类型
    private func determineMessageType(text: String, direction: MessageDirection) -> WechatMessage.MessageType {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        
        // 时间戳检测
        if isTimestamp(trimmed) {
            return .timestamp
        }
        
        // 系统消息检测
        if isSystemMessage(trimmed) || direction == .center {
            // 中间位置且不是时间戳，可能是系统消息
            if !isTimestamp(trimmed) && direction == .center {
                return .system
            }
        }
        
        // 特殊内容检测
        if trimmed.contains("[图片]") || trimmed.contains("[照片]") {
            return .image
        }
        if trimmed.contains("[语音]") || trimmed.range(of: #"^\d+['\"]$"#, options: .regularExpression) != nil {
            return .voice
        }
        
        return .text
    }
    
    /// 检测是否为时间戳
    private func isTimestamp(_ text: String) -> Bool {
        let patterns = [
            #"^\d{1,2}:\d{2}$"#,                     // 12:34
            #"^(上午|下午)\s*\d{1,2}:\d{2}$"#,        // 上午 12:34
            #"^昨天\s*\d{1,2}:\d{2}$"#,              // 昨天 12:34
            #"^\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2}$"#, // 12月20日 12:34
            #"^星期[一二三四五六日]\s*\d{1,2}:\d{2}$"#  // 星期六 12:34
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
            "与群里其他人都不是朋友关系"
        ]
        
        return keywords.contains { text.contains($0) }
    }
    
    /// 合并相邻的同方向消息
    private func mergeAdjacentMessages(_ messages: [WechatMessage]) -> [WechatMessage] {
        guard !messages.isEmpty else { return [] }
        
        var result: [WechatMessage] = []
        var current = messages[0]
        
        for i in 1..<messages.count {
            let next = messages[i]
            
            // 如果方向相同、类型都是 text、且垂直距离接近，则合并
            let shouldMerge = current.isFromMe == next.isFromMe
                && current.type == .text
                && next.type == .text
                && abs(next.bbox.minY - current.bbox.maxY) < verticalMergeThreshold
            
            if shouldMerge {
                // 合并消息
                let mergedContent = current.content + "\n" + next.content
                let mergedBbox = current.bbox.union(next.bbox)
                
                current = WechatMessage(
                    id: current.id,
                    content: mergedContent,
                    isFromMe: current.isFromMe,
                    senderName: current.senderName,
                    type: .text,
                    bbox: mergedBbox,
                    blockOrder: current.blockOrder
                )
            } else {
                result.append(current)
                current = next
            }
        }
        
        result.append(current)
        return result
    }
}

// MARK: - Message Direction

private enum MessageDirection {
    case left   // 对方消息
    case right  // 我的消息
    case center // 时间戳/系统消息
}

