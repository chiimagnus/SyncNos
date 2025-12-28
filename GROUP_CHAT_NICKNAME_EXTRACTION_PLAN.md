# 群聊昵称提取实现方案

## 背景与挑战

### 当前状态
- ✅ 数据模型完整支持 `senderName` 字段
- ✅ UI 完整支持昵称显示（气泡上方蓝色小字）
- ✅ 加密存储支持 `senderNameEncrypted`
- ❌ OCR 解析器未实现昵称提取逻辑

### 核心挑战
**问题**：群聊中的昵称文本和消息内容非常相似，难以区分。

**微信群聊截图的典型特征**：
```
┌─────────────────────────────────┐
│  [群名称]                         │
├─────────────────────────────────┤
│                                 │
│  张三                            │  ← 昵称（小字、蓝色、左对齐）
│  ┌─────────────┐                │
│  │ 你好，大家  │                │  ← 消息气泡（白色、左对齐）
│  └─────────────┘                │
│                                 │
│                  ┌─────────────┐│
│                  │ 收到，谢谢  ││  ← 我的消息（绿色、右对齐）
│                  └─────────────┘│
│                                 │
│  李四                            │  ← 昵称
│  ┌─────────────┐                │
│  │ 明天见      │                │  ← 消息气泡
│  └─────────────┘                │
│                                 │
└─────────────────────────────────┘
```

**区分难点**：
1. **OCR 无法区分字体大小**：PaddleOCR 只返回 `text` 和 `bbox`，不提供字号信息
2. **位置关系复杂**：昵称通常在气泡上方，但纵向间距很小（可能只有几个像素）
3. **内容相似性高**：昵称也是文本，可能包含任何字符（emoji、英文、数字）
4. **多行消息**：消息内容可能多行，昵称总是单行
5. **边界模糊**：昵称和第一行消息的 Y 坐标可能很接近

---

## 解决方案架构

### 核心思路：**几何特征 + 上下文关联**

**关键观察**：
1. **昵称总是在气泡上方**：Y 坐标小于气泡第一行
2. **昵称与气泡 X 轴对齐**：左对齐（对方消息）或右对齐（我的消息，但微信不显示"我"的昵称）
3. **昵称单行短文本**：高度较小，宽度适中
4. **昵称纵向间距小**：与下方气泡的间距通常 < 10px
5. **昵称不跨列**：左侧昵称只对应左侧气泡，右侧同理

---

## 实现方案（分优先级）

### **P0：核心算法设计（必须实现）**

#### **阶段 1：数据结构扩展**

**文件**：`ChatOCRParser.swift`

**新增内部模型**：
```swift
// 在现有 DirectedCandidate 基础上扩展
private struct MessageCandidateWithNickname {
    var text: String
    var bbox: CGRect
    var isFromMe: Bool
    var senderName: String?  // 新增字段
}
```

**修改点**：
- 现有 `DirectedCandidate` → `MessageCandidateWithNickname`
- 或在 `DirectedCandidate` 中添加 `senderName` 字段

---

#### **阶段 2：昵称候选提取（Nickname Candidate Detection）**

**插入位置**：在 `classifyDirection()` 之后，构建最终消息之前

**新增方法**：
```swift
private extension ChatOCRParser {
    /// 从原始 blocks 中提取可能的昵称候选
    /// - Parameters:
    ///   - blocks: 归一化后的所有 blocks
    ///   - bubbleCandidates: 已识别的气泡消息候选
    /// - Returns: 昵称候选列表（带 bbox）
    func extractNicknameCandidates(
        from blocks: [NormalizedBlock],
        bubbles: [MessageCandidate]
    ) -> [NormalizedBlock] {
        // 过滤条件：
        // 1. 单个 block（不是合并后的 line）
        // 2. 高度较小（< 平均气泡高度的 0.4）
        // 3. 宽度适中（> 20px, < 150px）
        // 4. 不在系统消息区域（centerX 不接近 0.5）
        // 5. Y 坐标在某个气泡上方
    }
}
```

**实现细节**：
```swift
func extractNicknameCandidates(
    from blocks: [NormalizedBlock],
    bubbles: [MessageCandidate]
) -> [NormalizedBlock] {
    guard !bubbles.isEmpty else { return [] }
    
    // 计算气泡平均高度
    let avgBubbleHeight = bubbles.map { $0.bbox.height }.reduce(0, +) / Double(bubbles.count)
    let maxNicknameHeight = avgBubbleHeight * 0.4
    
    // 过滤出单行短文本 block
    let candidates = blocks.filter { block in
        // 高度约束
        guard block.bbox.height < maxNicknameHeight else { return false }
        
        // 宽度约束（排除系统消息和时间戳）
        guard block.bbox.width > 20, block.bbox.width < 150 else { return false }
        
        // 排除居中文本（系统消息）
        let centerX = (block.bbox.minX + block.bbox.maxX) / 2.0
        let normalizedCenterX = centerX / imageWidth
        guard abs(normalizedCenterX - 0.5) > 0.15 else { return false }
        
        // 必须在某个气泡上方
        let isAboveBubble = bubbles.contains { bubble in
            let gap = bubble.bbox.minY - block.bbox.maxY
            return gap > -5 && gap < 15  // 允许少量重叠或间距
        }
        
        return isAboveBubble
    }
    
    return candidates
}
```

---

#### **阶段 3：昵称与气泡匹配（Nickname-Bubble Binding）**

**新增方法**：
```swift
private extension ChatOCRParser {
    /// 将昵称候选与气泡进行匹配
    /// - Parameters:
    ///   - nicknames: 昵称候选列表
    ///   - bubbles: 已分类方向的气泡消息
    ///   - imageWidth: 图像宽度（用于对齐判断）
    /// - Returns: 带昵称的气泡消息列表
    func bindNicknamesToBubbles(
        nicknames: [NormalizedBlock],
        bubbles: [DirectedCandidate],
        imageWidth: CGFloat
    ) -> [MessageCandidateWithNickname] {
        var result: [MessageCandidateWithNickname] = []
        result.reserveCapacity(bubbles.count)
        
        for bubble in bubbles {
            var matchedNickname: String? = nil
            
            // 只为"对方消息"（左侧）匹配昵称
            // 微信不显示"我"的昵称
            if !bubble.isFromMe {
                matchedNickname = findMatchingNickname(
                    for: bubble,
                    in: nicknames,
                    imageWidth: imageWidth
                )
            }
            
            result.append(MessageCandidateWithNickname(
                text: bubble.text,
                bbox: bubble.bbox,
                isFromMe: bubble.isFromMe,
                senderName: matchedNickname
            ))
        }
        
        return result
    }
    
    /// 为单个气泡查找最佳匹配的昵称
    private func findMatchingNickname(
        for bubble: DirectedCandidate,
        in nicknames: [NormalizedBlock],
        imageWidth: CGFloat
    ) -> String? {
        var bestMatch: (nickname: String, score: Double)? = nil
        
        for nickname in nicknames {
            // 1. 纵向位置：昵称必须在气泡上方
            let verticalGap = bubble.bbox.minY - nickname.bbox.maxY
            guard verticalGap >= -5, verticalGap <= 15 else { continue }
            
            // 2. 横向对齐：X 坐标接近
            let xAlign = abs(nickname.bbox.minX - bubble.bbox.minX)
            guard xAlign <= 20 else { continue }  // 20px 对齐容差
            
            // 3. 左右归属一致：都在左侧或都在右侧
            let nicknameBias = (nickname.bbox.minX + nickname.bbox.maxX) / imageWidth - 1.0
            let bubbleBias = (bubble.bbox.minX + bubble.bbox.maxX) / imageWidth - 1.0
            let sameSide = (nicknameBias < 0 && bubbleBias < 0) || (nicknameBias > 0 && bubbleBias > 0)
            guard sameSide else { continue }
            
            // 4. 评分：纵向距离越小越好，横向对齐越好越好
            let score = verticalGap + xAlign * 0.5
            
            if bestMatch == nil || score < bestMatch!.score {
                bestMatch = (nickname.text, score)
            }
        }
        
        return bestMatch?.nickname
    }
}
```

**匹配规则**：
1. **纵向间距**：昵称在气泡上方 5-15px 内
2. **横向对齐**：X 坐标差 < 20px
3. **左右一致**：昵称和气泡在同一侧（左/右）
4. **最近原则**：选择评分最高的昵称

---

#### **阶段 4：主流程集成**

**修改 `parseWithStatistics()` 方法**：

```swift
func parseWithStatistics(ocrResult: OCRResult, imageSize: CGSize) -> (messages: [ChatMessage], statistics: ChatParseStatistics) {
    // ... 现有代码 ...
    
    let directedBubbles = classifyDirection(bubbleCandidates, imageWidth: imageSize.width)
    
    // ===== 新增：昵称提取与绑定 =====
    let nicknameCandidates = extractNicknameCandidates(
        from: blocks,  // 原始归一化 blocks
        bubbles: candidates
    )
    
    let bubblesWithNicknames = bindNicknamesToBubbles(
        nicknames: nicknameCandidates,
        bubbles: directedBubbles,
        imageWidth: imageSize.width
    )
    // ===== 结束 =====
    
    // 构建最终消息
    var bubbleIndex = 0
    var messages: [ChatMessage] = []
    
    for (idx, cand) in candidates.enumerated() {
        if systemFlags[idx] {
            messages.append(ChatMessage(
                content: cand.text,
                isFromMe: false,
                senderName: nil,
                kind: .system,
                bbox: cand.bbox,
                order: messages.count
            ))
        } else {
            let bubble = bubblesWithNicknames[bubbleIndex]  // 使用带昵称的版本
            bubbleIndex += 1
            messages.append(ChatMessage(
                content: bubble.text,
                isFromMe: bubble.isFromMe,
                senderName: bubble.senderName,  // 填充昵称
                kind: .text,
                bbox: bubble.bbox,
                order: messages.count
            ))
        }
    }
    
    // ... 现有代码 ...
}
```

---

#### **阶段 5：统计信息扩展**

**修改 `ChatParseStatistics`**：
```swift
struct ChatParseStatistics {
    let inputBlockCount: Int
    let normalizedBlockCount: Int
    let lineCount: Int
    let candidateCount: Int
    let systemMessageCount: Int
    let leftBubbleCount: Int
    let rightBubbleCount: Int
    let nicknameCandidateCount: Int      // 新增
    let nicknamesMatchedCount: Int       // 新增
    
    var description: String {
        "[OCR Parse] input=\(inputBlockCount) → normalized=\(normalizedBlockCount) → lines=\(lineCount) → candidates=\(candidateCount) | system=\(systemMessageCount) left=\(leftBubbleCount) right=\(rightBubbleCount) | nicknames=\(nicknamesMatchedCount)/\(nicknameCandidateCount)"
    }
}
```

---

### **P1：参数调优与配置（重要）**

#### **扩展 `ChatParseConfig`**

**文件**：`ChatModels.swift`

```swift
struct ChatParseConfig: Sendable {
    // MARK: 现有参数
    var maxLineHorizontalGapPx: Double
    var minLineVerticalOverlapRatio: Double
    var maxMessageLineGapPx: Double
    var maxMessageXAlignDeltaPx: Double
    
    // MARK: 新增：昵称提取参数
    var nicknameMaxHeightRatio: Double       // 昵称最大高度占气泡平均高度的比例
    var nicknameMinWidthPx: Double           // 昵称最小宽度（排除短文本）
    var nicknameMaxWidthPx: Double           // 昵称最大宽度（排除长文本）
    var nicknameVerticalGapMinPx: Double     // 昵称与气泡最小间距
    var nicknameVerticalGapMaxPx: Double     // 昵称与气泡最大间距
    var nicknameHorizontalAlignPx: Double    // 昵称与气泡 X 对齐容差
    
    static let `default` = ChatParseConfig(
        maxLineHorizontalGapPx: 18,
        minLineVerticalOverlapRatio: 0.30,
        maxMessageLineGapPx: 26,
        maxMessageXAlignDeltaPx: 28,
        // 昵称参数默认值
        nicknameMaxHeightRatio: 0.4,
        nicknameMinWidthPx: 20,
        nicknameMaxWidthPx: 150,
        nicknameVerticalGapMinPx: -5,   // 允许轻微重叠
        nicknameVerticalGapMaxPx: 15,
        nicknameHorizontalAlignPx: 20
    )
}
```

**使用场景**：
- 初始默认值基于微信 iOS 截图
- 后续可根据实际测试调整
- 未来可扩展为"配置文件"或"AI 参数调优"

---

### **P2：边界情况处理（推荐实现）**

#### **问题 1：昵称被误识别为消息内容**

**症状**：昵称和第一行消息被合并成一个 `Line` 或 `Candidate`

**解决方案**：在 `groupBlocksIntoLines()` 中添加特殊逻辑

```swift
func bestLineIndex(for block: NormalizedBlock, in lines: [Line]) -> Int? {
    var best: (index: Int, score: Double)?
    
    for (i, line) in lines.enumerated() {
        // ... 现有逻辑 ...
        
        // 新增：如果 block 高度明显小于 line，不合并
        // 避免昵称被误合并到消息第一行
        let heightRatio = block.bbox.height / line.bbox.height
        if heightRatio < 0.5 || heightRatio > 2.0 {
            continue  // 高度差异过大，跳过
        }
        
        // ... 现有逻辑 ...
    }
    
    return best?.index
}
```

**权衡**：可能导致正常多行消息被拆分，需要在参数中平衡

---

#### **问题 2：多人连续发言的昵称匹配**

**症状**：连续出现多个昵称时，匹配错乱

**解决方案**：使用"贪心匹配"，已匹配的昵称不再参与后续匹配

```swift
func bindNicknamesToBubbles(...) -> [MessageCandidateWithNickname] {
    var result: [MessageCandidateWithNickname] = []
    var usedNicknameIndices: Set<Int> = []  // 已使用的昵称索引
    
    for bubble in bubbles {
        var matchedNickname: String? = nil
        
        if !bubble.isFromMe {
            // 查找未使用的最佳匹配昵称
            if let (index, nickname) = findMatchingNicknameWithIndex(
                for: bubble,
                in: nicknames,
                excluding: usedNicknameIndices,
                imageWidth: imageWidth
            ) {
                matchedNickname = nickname
                usedNicknameIndices.insert(index)  // 标记为已使用
            }
        }
        
        result.append(...)
    }
    
    return result
}
```

---

#### **问题 3：昵称重复（同一人连续发言）**

**症状**：同一人连续发多条消息，只有第一条有昵称

**解决方案**：
- **选项 A（推荐）**：只为第一条消息匹配昵称，后续消息 `senderName = nil`
- **选项 B**：使用"昵称传播"，将昵称复制给下方相邻的气泡

**选项 A 实现**（无需代码改动，现有逻辑已满足）

**选项 B 实现**（可选）：
```swift
func propagateNicknames(messages: [MessageCandidateWithNickname]) -> [MessageCandidateWithNickname] {
    var result = messages
    var lastLeftNickname: String? = nil
    
    for i in result.indices {
        if result[i].isFromMe {
            continue  // 跳过我的消息
        }
        
        if let nickname = result[i].senderName {
            lastLeftNickname = nickname  // 更新当前昵称
        } else if let lastNickname = lastLeftNickname {
            // 如果当前消息无昵称，但上方有昵称，且位置接近
            if i > 0, result[i].bbox.minY - result[i-1].bbox.maxY < 30 {
                result[i].senderName = lastNickname  // 传播昵称
            }
        }
    }
    
    return result
}
```

**权衡**：选项 B 可能导致昵称传播错误（两个人交替发言），建议先实现选项 A

---

### **P3：高级优化（可选，后期迭代）**

#### **优化 1：字体大小推断（间接方法）**

**问题**：OCR 不返回字号，但可以通过 bbox 高度推断

**方案**：
```swift
func estimateFontSizeCategory(_ block: NormalizedBlock) -> FontSizeCategory {
    let height = block.bbox.height
    if height < 15 { return .small }      // 小字（昵称候选）
    if height < 25 { return .normal }     // 正常字（消息内容）
    return .large                         // 大字（可能是群名称）
}

enum FontSizeCategory {
    case small   // < 15px
    case normal  // 15-25px
    case large   // > 25px
}
```

**应用**：
- 在 `extractNicknameCandidates()` 中优先选择 `small` 类别
- 在 `findMatchingNickname()` 中提高 `small` 类别的权重

---

#### **优化 2：基于文本长度的启发式**

**观察**：昵称通常较短（1-6 个字符），消息内容通常较长

**方案**：
```swift
func extractNicknameCandidates(...) -> [NormalizedBlock] {
    let candidates = blocks.filter { block in
        // ... 现有几何过滤 ...
        
        // 新增：文本长度过滤
        let textLength = block.text.count
        guard textLength >= 1, textLength <= 8 else { return false }
        
        return true
    }
    
    return candidates
}
```

**权衡**：emoji 可能被计为多个字符，需要考虑

---

#### **优化 3：基于颜色的增强（需要图像处理）**

**问题**：昵称在微信中是蓝色（#576B95），但 OCR 只返回文本，无颜色信息

**方案**：如果未来接入图像处理（如 Vision Framework），可以：
1. 对每个 `NormalizedBlock` 的 bbox 区域采样主色调
2. 计算颜色与微信昵称蓝色的相似度
3. 提高蓝色文本的昵称权重

**优先级**：低（需要额外依赖）

---

#### **优化 4：机器学习分类器（长期方案）**

**方案**：训练一个二分类模型（昵称 vs 消息内容）

**特征**：
- bbox 高度、宽度、纵横比
- 文本长度
- 与下方气泡的纵向间距
- X 对齐程度
- 是否在左侧/右侧

**标注数据**：
- 收集 100-500 张带标注的微信群聊截图
- 标注每个 block 的类别（昵称/消息/系统消息）

**模型**：
- 简单决策树（Core ML）
- 或轻量级神经网络（Create ML）

**优先级**：低（需要标注数据和训练流程）

---

## 测试策略

### **单元测试（P1）**

**测试文件**：`ChatOCRParserTests.swift`（新建）

**测试用例**：
1. **测试昵称候选提取**
   - 输入：带昵称的 OCR blocks
   - 预期：正确过滤出昵称候选

2. **测试昵称与气泡匹配**
   - 输入：昵称候选 + 气泡列表
   - 预期：正确匹配昵称到对应气泡

3. **测试边界情况**
   - 无昵称（私聊）→ 所有 `senderName = nil`
   - 多人连续发言 → 昵称不混淆
   - 昵称和消息重叠 → 正确分离

**示例**：
```swift
func testNicknameExtraction() {
    let blocks = [
        NormalizedBlock(text: "张三", label: "text", bbox: CGRect(x: 10, y: 10, width: 50, height: 12)),
        NormalizedBlock(text: "你好", label: "text", bbox: CGRect(x: 10, y: 25, width: 80, height: 20))
    ]
    
    let parser = ChatOCRParser()
    let candidates = parser.extractNicknameCandidates(from: blocks, bubbles: [])
    
    XCTAssertEqual(candidates.count, 1)
    XCTAssertEqual(candidates[0].text, "张三")
}
```

---

### **集成测试（P1）**

**测试场景**：
1. **私聊截图** → 无昵称提取
2. **群聊截图（2-3 人）** → 正确提取昵称
3. **群聊截图（多人连续发言）** → 昵称不混淆
4. **复杂布局（表情、图片混排）** → 鲁棒性

**测试数据**：
- 准备 10-20 张真实微信截图
- 手动标注预期结果
- 对比实际输出

---

### **UI 测试（P2）**

**验证点**：
1. 昵称显示在气泡上方
2. 昵称颜色正确（蓝色 #576B95）
3. 昵称字号正确（caption2）
4. 导出功能包含昵称信息

---

## 风险与限制

### **已知风险**

1. **OCR 错误识别**
   - 风险：昵称被识别为错误的文本
   - 缓解：用户可手动编辑（未来功能）

2. **复杂布局失败**
   - 风险：表情、图片、卡片混排时匹配失败
   - 缓解：降级到无昵称模式（`senderName = nil`）

3. **参数敏感性**
   - 风险：不同截图尺寸/分辨率下参数需调整
   - 缓解：使用相对值（比例）而非绝对值（像素）

4. **性能影响**
   - 风险：额外的昵称匹配逻辑增加计算时间
   - 缓解：算法复杂度 O(n*m)，n=昵称候选数，m=气泡数，通常 < 100

---

### **不支持的场景**

1. **横屏截图** → 布局差异大，需要单独适配
2. **深色模式** → 颜色不同，但不影响几何算法
3. **第三方聊天应用** → 布局规则可能不同

---

## 实施时间线

| 阶段 | 任务 | 预计工时 | 优先级 |
|------|------|----------|--------|
| P0-1 | 数据结构扩展 | 1h | P0 |
| P0-2 | 昵称候选提取 | 3h | P0 |
| P0-3 | 昵称与气泡匹配 | 4h | P0 |
| P0-4 | 主流程集成 | 2h | P0 |
| P0-5 | 统计信息扩展 | 1h | P0 |
| P1-1 | 参数配置化 | 1h | P1 |
| P1-2 | 单元测试 | 3h | P1 |
| P1-3 | 集成测试 | 4h | P1 |
| P2-1 | 边界情况处理 | 4h | P2 |
| P2-2 | UI 测试 | 2h | P2 |
| P3-1 | 高级优化（可选） | 8h | P3 |

**总计**：
- **P0（核心功能）**：11h
- **P1（基础完整）**：+8h = 19h
- **P2（生产可用）**：+6h = 25h
- **P3（高级优化）**：+8h = 33h

---

## 后续迭代方向

### **短期（3-6 个月）**
1. 收集用户反馈，调优参数
2. 支持更多聊天应用（Telegram、Discord）
3. 添加手动编辑昵称功能

### **中期（6-12 个月）**
1. 基于颜色的增强识别
2. 支持横屏截图
3. 支持视频通话截图

### **长期（12+ 个月）**
1. 机器学习分类器
2. 自动参数调优（AutoML）
3. 多语言昵称支持（emoji、繁体字、日韩文）

---

## 总结

### **核心思路**
使用**几何特征 + 上下文关联**，通过纵向间距、横向对齐、高度宽度等几何特征识别昵称，避免依赖字体大小或颜色信息。

### **实施路径**
1. **P0（必须）**：实现核心算法，完成数据流
2. **P1（推荐）**：参数配置化，添加测试
3. **P2（重要）**：处理边界情况，UI 验证
4. **P3（可选）**：高级优化，长期迭代

### **预期效果**
- **准确率目标**：80%+（简单群聊场景）
- **召回率目标**：70%+（复杂布局可能漏检）
- **性能影响**：< 10% 额外耗时

### **成功指标**
- 用户导入 10 张群聊截图，至少 7 张正确提取昵称
- 无昵称场景（私聊）不受影响
- 日志中昵称匹配率 > 70%

---

**文档版本**：v1.0  
**创建日期**：2025-12-28  
**作者**：GitHub Copilot  
**状态**：待审核
