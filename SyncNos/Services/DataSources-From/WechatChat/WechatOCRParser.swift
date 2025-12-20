import Foundation
import AppKit

// MARK: - Wechat OCR Parser

/// 微信聊天截图 OCR 解析器
/// 统一处理私聊和群聊场景
final class WechatOCRParser {
    
    // MARK: - Constants
    
    /// 左侧消息阈值：消息起始 x < 15% 图片宽度 → 对方消息（头像约50px，图片宽度约500-1000px）
    private let leftMinXThreshold: CGFloat = 0.15
    
    /// 右侧消息阈值：消息起始 x > 50% 图片宽度 且 结束 x > 85% → 我的消息
    private let rightMinXThreshold: CGFloat = 0.50
    private let rightMaxXThreshold: CGFloat = 0.85
    
    /// 发送者昵称与消息的最大间距（像素）
    private let senderNameMaxGap: CGFloat = 60
    
    // MARK: - Public Methods
    
    /// 解析 OCR 结果为微信消息
    /// - Parameters:
    ///   - ocrResult: PaddleOCR 返回的识别结果
    ///   - imageSize: 图片尺寸
    /// - Returns: 解析后的消息列表
    func parse(ocrResult: OCRResult, imageSize: CGSize) -> [WechatMessage] {
        guard imageSize.width > 0 else { return [] }
        
        // Step 1: 按 y 坐标排序（从上到下）
        let sortedBlocks = ocrResult.blocks.sorted { $0.bbox.minY < $1.bbox.minY }
        
        // Step 2: 预处理 - 分类每个 block
        var classifiedBlocks: [ClassifiedBlock] = []
        
        for (index, block) in sortedBlocks.enumerated() {
            let text = block.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { continue }
            
            let classification = classifyBlock(
                text: text,
                block: block,
                imageWidth: imageSize.width
            )
            
            classifiedBlocks.append(ClassifiedBlock(
                originalIndex: index,
                block: block,
                text: text,
                classification: classification
            ))
        }
        
        // Step 3: 处理发送者昵称 - 将昵称关联到下一条消息
        var messages: [WechatMessage] = []
        var i = 0
        
        while i < classifiedBlocks.count {
            let current = classifiedBlocks[i]
            
            switch current.classification {
            case .timestamp:
                messages.append(WechatMessage(
                    content: current.text,
                    isFromMe: false,
                    type: .timestamp,
                    bbox: current.block.bbox,
                    blockOrder: current.originalIndex
                ))
                
            case .system:
                messages.append(WechatMessage(
                    content: current.text,
                    isFromMe: false,
                    type: .system,
                    bbox: current.block.bbox,
                    blockOrder: current.originalIndex
                ))
                
            case .senderName:
                // 检查下一个 block 是否是消息
                if i + 1 < classifiedBlocks.count {
                    let next = classifiedBlocks[i + 1]
                    if case .message(let isFromMe) = next.classification {
                        // 昵称和消息在一起处理
                        let gap = next.block.bbox.minY - current.block.bbox.maxY
                        if gap < senderNameMaxGap && gap > 0 {
                            messages.append(WechatMessage(
                                content: next.text,
                                isFromMe: isFromMe,
                                senderName: current.text,
                                type: determineMessageType(text: next.text),
                                bbox: next.block.bbox,
                                blockOrder: next.originalIndex
                            ))
                            i += 2  // 跳过昵称和消息
                            continue
                        }
                    }
                }
                // 如果没有匹配的消息，当作普通消息处理
                messages.append(WechatMessage(
                    content: current.text,
                    isFromMe: false,
                    type: .text,
                    bbox: current.block.bbox,
                    blockOrder: current.originalIndex
                ))
                
            case .message(let isFromMe):
                messages.append(WechatMessage(
                    content: current.text,
                    isFromMe: isFromMe,
                    type: determineMessageType(text: current.text),
                    bbox: current.block.bbox,
                    blockOrder: current.originalIndex
                ))
            }
            
            i += 1
        }
        
        return messages
    }
    
    // MARK: - Private Types
    
    /// Block 分类
    private enum BlockClassification {
        case timestamp                    // 时间戳
        case system                       // 系统消息
        case senderName                   // 发送者昵称（群聊）
        case message(isFromMe: Bool)      // 普通消息
    }
    
    /// 带分类的 Block
    private struct ClassifiedBlock {
        let originalIndex: Int
        let block: OCRBlock
        let text: String
        let classification: BlockClassification
    }
    
    // MARK: - Private Methods
    
    /// 分类单个 block
    private func classifyBlock(text: String, block: OCRBlock, imageWidth: CGFloat) -> BlockClassification {
        // 1. 时间戳检测（优先级最高）
        if isTimestamp(text) {
            return .timestamp
        }
        
        // 2. 系统消息检测
        if isSystemMessage(text) {
            return .system
        }
        
        // 3. 计算相对位置
        let relativeMinX = block.bbox.minX / imageWidth
        let relativeMaxX = block.bbox.maxX / imageWidth
        
        // 4. 可能是发送者昵称的特征：
        //    - 短文本（< 20 字符）
        //    - 在左侧（minX < 15%）
        //    - 不是时间戳/系统消息
        if text.count < 20 && relativeMinX < leftMinXThreshold {
            if isLikelySenderName(text) {
                return .senderName
            }
        }
        
        // 5. 判断消息方向 - 核心逻辑
        //    微信布局特点：
        //    - 对方消息：头像在左侧，气泡紧挨头像 → minX 很小（< 15%）
        //    - 我的消息：头像在右侧，气泡紧挨头像 → minX 很大（> 50%）且 maxX 接近右边（> 85%）
        //    - 长消息：即使对方发的长消息，maxX 可能很大，但 minX 仍然很小
        
        // 如果 minX 很小，说明气泡从左侧开始 → 对方消息
        if relativeMinX < leftMinXThreshold {
            return .message(isFromMe: false)
        }
        
        // 如果 minX 很大（>50%）且 maxX 接近右边界（>85%）→ 我的消息
        if relativeMinX > rightMinXThreshold && relativeMaxX > rightMaxXThreshold {
            return .message(isFromMe: true)
        }
        
        // 6. 中间地带（可能是居中的消息卡片、链接等）
        //    使用 minX 作为主要判断依据：minX < 30% 视为对方，否则视为我的
        return .message(isFromMe: relativeMinX > 0.30)
    }
    
    /// 判断是否可能是发送者昵称
    private func isLikelySenderName(_ text: String) -> Bool {
        // 昵称特征：
        // 1. 长度 2-15 字符
        // 2. 不包含常见标点（消息通常有标点）
        // 3. 不是纯数字
        // 4. 不包含"["或"]"（特殊消息标记）
        
        guard text.count >= 2 && text.count <= 15 else { return false }
        
        // 常见标点符号
        let punctuation = CharacterSet.punctuationCharacters
        if text.unicodeScalars.contains(where: { punctuation.contains($0) }) {
            return false
        }
        
        if text.allSatisfy({ $0.isNumber }) {
            return false
        }
        
        if text.contains("[") || text.contains("]") {
            return false
        }
        
        return true
    }
    
    /// 判断消息类型
    private func determineMessageType(text: String) -> WechatMessage.MessageType {
        if text.contains("[图片]") || text.contains("[照片]") || text.contains("[Image]") {
            return .image
        }
        if text.contains("[语音]") || text.contains("[Voice]") {
            return .voice
        }
        if text.range(of: #"^\d+['\"″]$"#, options: .regularExpression) != nil {
            return .voice  // 语音时长，如 "5""
        }
        return .text
    }
    
    /// 检测是否为时间戳
    private func isTimestamp(_ text: String) -> Bool {
        let patterns = [
            #"^\d{1,2}:\d{2}$"#,                        // 10:30
            #"^(上午|下午)\s*\d{1,2}:\d{2}$"#,           // 上午 12:34
            #"^(昨天|前天|今天)\s*\d{1,2}:\d{2}$"#,       // 昨天 12:34
            #"^\d{1,2}月\d{1,2}日\s*\d{1,2}:\d{2}$"#,   // 7月29日 03:11
            #"^星期[一二三四五六日天]\s*\d{1,2}:\d{2}$"#,  // 星期六 12:34
            #"^\d{4}年\d{1,2}月\d{1,2}日"#,             // 2024年12月20日
            #"^\d{1,2}/\d{1,2}/\d{2,4}"#,              // 12/20/24
            #"^\d{4}-\d{1,2}-\d{1,2}"#                 // 2024-12-20
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
            "发起了群聊",
            "开启了公告",
            "发起了视频通话",
            "发起了语音通话",
            "发送了一个红包",
            "领取了你的红包",
            "已过期",
            "已被领完"
        ]
        
        return keywords.contains { text.contains($0) }
    }
}

// MARK: - Parser Helper Extension (for ViewModel)

extension WechatOCRParser {
    /// 用于 ViewModel 调用的辅助方法
    func isLikelyTimestamp(_ text: String) -> Bool {
        isTimestamp(text)
    }
}
