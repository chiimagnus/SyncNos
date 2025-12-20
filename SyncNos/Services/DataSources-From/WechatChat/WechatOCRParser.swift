import Foundation
import AppKit

// MARK: - Wechat OCR Parser

/// 微信聊天截图 OCR 解析器
/// 支持两人聊天和群聊场景
final class WechatOCRParser {
    
    // MARK: - Constants
    
    /// 左侧阈值：消息气泡起始 x 坐标 < 图片宽度的 20% 为对方消息
    /// 微信布局：对方消息左边有头像（约 50px），气泡紧挨着头像
    private let leftThreshold: CGFloat = 0.20
    
    /// 右侧阈值：消息气泡结束 x 坐标 > 图片宽度的 80% 为我的消息
    /// 微信布局：我的消息右边有头像（约 50px），气泡紧挨着头像
    private let rightThreshold: CGFloat = 0.80
    
    /// 时间戳 y 位置容差（用于判断某个文本是否紧挨着下一条消息）
    private let senderNameYThreshold: CGFloat = 50
    
    // MARK: - Public Methods
    
    /// 解析 OCR 结果为微信消息
    func parse(ocrResult: OCRResult, imageSize: CGSize) -> [WechatMessage] {
        guard imageSize.width > 0 else { return [] }
        
        // 按 y 坐标排序（从上到下）
        let sortedBlocks = ocrResult.blocks.sorted { $0.bbox.minY < $1.bbox.minY }
        
        var messages: [WechatMessage] = []
        var pendingSenderName: String? = nil
        var pendingSenderBbox: CGRect? = nil
        
        for (index, block) in sortedBlocks.enumerated() {
            let text = block.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { continue }
            
            // 判断是否是时间戳（居中显示）
            if isTimestamp(text) {
                let message = WechatMessage(
                    content: text,
                    isFromMe: false,
                    type: .timestamp,
                    bbox: block.bbox,
                    blockOrder: index
                )
                messages.append(message)
                pendingSenderName = nil
                pendingSenderBbox = nil
                continue
            }
            
            // 判断是否是系统消息
            if isSystemMessage(text) {
                let message = WechatMessage(
                    content: text,
                    isFromMe: false,
                    type: .system,
                    bbox: block.bbox,
                    blockOrder: index
                )
                messages.append(message)
                pendingSenderName = nil
                pendingSenderBbox = nil
                continue
            }
            
            // 判断消息方向
            let isFromMe = isRightSide(block: block, imageWidth: imageSize.width)
            
            // 检查是否是发送者昵称（群聊场景）
            // 发送者昵称特征：短文本、在左侧、下一个 block 是消息
            if !isFromMe && isSenderName(text: text, block: block, nextBlock: sortedBlocks.indices.contains(index + 1) ? sortedBlocks[index + 1] : nil) {
                pendingSenderName = text
                pendingSenderBbox = block.bbox
                continue
            }
            
            // 检查 pendingSenderName 是否适用于当前消息
            var senderName: String? = nil
            if let pending = pendingSenderName, let pendingBbox = pendingSenderBbox {
                // 如果 pending 昵称在当前消息上方且距离很近，则应用
                if pendingBbox.maxY < block.bbox.minY && block.bbox.minY - pendingBbox.maxY < senderNameYThreshold {
                    senderName = pending
                }
            }
            
            // 确定消息类型
            let messageType = determineMessageType(text: text)
            
            let message = WechatMessage(
                content: text,
                isFromMe: isFromMe,
                senderName: senderName,
                type: messageType,
                bbox: block.bbox,
                blockOrder: index
            )
            
            messages.append(message)
            pendingSenderName = nil
            pendingSenderBbox = nil
        }
        
        return messages
    }
    
    // MARK: - Private Methods
    
    /// 判断是否是右侧消息（我发送的）
    /// 
    /// 微信布局特点：
    /// - 对方消息：左侧有头像（约 50px 宽），消息气泡紧挨着头像
    ///   → 气泡的 minX 很小（< 20% 图片宽度）
    /// - 我的消息：右侧有头像（约 50px 宽），消息气泡紧挨着头像
    ///   → 气泡的 maxX 很大（> 80% 图片宽度）
    /// - 时间戳/系统消息：居中显示
    ///   → minX 和 maxX 都在中间区域
    private func isRightSide(block: OCRBlock, imageWidth: CGFloat) -> Bool {
        let relativeMinX = block.bbox.minX / imageWidth
        let relativeMaxX = block.bbox.maxX / imageWidth
        
        // 优先判断：如果消息起始位置在左侧（靠近左边头像），是对方消息
        if relativeMinX < leftThreshold {
            return false
        }
        
        // 如果消息结束位置在右侧（靠近右边头像），是我的消息
        if relativeMaxX > rightThreshold {
            return true
        }
        
        // 中间地带：使用中心点判断
        // 但对于时间戳/系统消息，这个判断不会被调用（因为已经在前面处理了）
        let centerX = block.bbox.midX / imageWidth
        return centerX > 0.6  // 偏右 60% 以上视为我的消息
    }
    
    /// 判断消息类型
    private func determineMessageType(text: String) -> WechatMessage.MessageType {
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
            #"^\d{1,2}:\d{2}$"#,                      // 10:30
            #"^(上午|下午)\s*\d{1,2}:\d{2}$"#,         // 上午 12:34
            #"^昨天\s*\d{1,2}:\d{2}$"#,               // 昨天 12:34
            #"^\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2}$"#, // 7月29日 03:11
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
    
    /// 判断是否是发送者昵称（群聊场景）
    private func isSenderName(text: String, block: OCRBlock, nextBlock: OCRBlock?) -> Bool {
        // 昵称特征：
        // 1. 文本较短（一般 < 15 字符）
        // 2. 在左侧
        // 3. 下一个 block 存在且在它下方
        
        guard text.count < 15 else { return false }
        guard let next = nextBlock else { return false }
        
        // 下一个 block 应该在当前 block 下方
        let isNextBelow = next.bbox.minY > block.bbox.maxY
        
        // 昵称和消息的间距应该很小
        let gap = next.bbox.minY - block.bbox.maxY
        let isCloseEnough = gap < senderNameYThreshold && gap > 0
        
        // 排除时间戳和系统消息
        if isTimestamp(text) || isSystemMessage(text) {
            return false
        }
        
        return isNextBelow && isCloseEnough
    }
}
