# 微信聊天截图 OCR 解析技术文档（SyncNos）

> **状态**：✅ V2 核心功能已实现
> **OCR 引擎**：Apple Vision（原生，离线）

本文档描述 SyncNos 中"微信聊天截图 OCR"从 Apple Vision OCR 到结构化消息的完整技术链路，目标是让后续迭代（算法升级/回归测试/排障）都具备可追踪、可复放（replayable）的基础。

## 1. 目标与范围

### 1.1 本轮目标（V2）

- 从**微信聊天截图**中解析出"气泡消息"的结构化结果：
  - `content`：消息文本（合并后的完整内容）
  - `isFromMe`：我/对方（左右气泡）
  - `senderName`：✅ **用户手动设置**（2025-12-28 实现，见 `Chats-群聊昵称功能实现计划.md`）
  - `kind`：当前统一按 `text` 展示（后续再增强 image/voice/card）
- **不做**系统消息关键词识别（撤回/红包/加入群聊等）
- **不做**时间戳/系统行的"识别与美化展示"（当前允许它们以普通文本出现，优先保证不漏）

### 1.2 关键设计约束

- 解析器内部**不包含业务字符串硬编码**（尤其是系统消息关键词表）
- 解析主要依赖 **几何/布局特征（bbox）**，避免文本内容规则导致脆弱性
- 结果需要**可回放**：存储 raw OCR JSON + normalized blocks，支持离线重解析

## 2. 输入与输出

### 2.1 输入

- `NSImage`：来自用户导入的微信聊天截图（私聊/群聊均可）
- OCR 引擎：**Apple Vision**（内置，无需配置，离线可用）
  - 支持两种语言模式（可在 Settings → OCR Settings 配置）：
    - **自动检测模式**（默认）：Vision 自动检测图像中的语言
    - **手动选择模式**：用户手动选择目标语言，支持 25+ 种语言
  - 默认语言优先级：中文简体、中文繁体、英文

### 2.2 输出（结构化消息）

- `ChatMessage`（或 V2 DTO）数组，按视觉阅读顺序排列：
  - 仅包含"气泡消息"
  - 不包含 timestamp/system

## 3. Apple Vision OCR 输出结构

Apple Vision 使用 `VNRecognizeTextRequest` 进行文本识别，返回 `[VNRecognizedTextObservation]`。

### 3.1 原始输出

每个 `VNRecognizedTextObservation` 包含：

- `boundingBox: CGRect`（归一化坐标，原点左下角，Y 轴向上）
- `topCandidates(maxCount: Int) -> [VNRecognizedText]`
  - `string: String`（识别文本）
  - `confidence: Float`（置信度 0.0~1.0）

### 3.2 转换后的统一模型

在代码里会映射为：

- `OCRBlock(text, label, bbox: CGRect)`
  - `label` 统一为 `"text"`（Vision 不区分 table/formula 等）
  - `bbox` 为**像素坐标**（已转换为原点左上角，Y 轴向下）
- `OCRResult(blocks: [OCRBlock], markdownText, rawText, processedAt, coordinateSize)`

## 4. 坐标系与 bbox 约定

### 4.1 Vision 原始坐标系

- Vision 返回的 `boundingBox` 为**归一化坐标**（0.0~1.0）
- 原点在**左下角**，Y 轴向上（与标准图像坐标系相反）

### 4.2 坐标转换流程

1. 使用 `VNImageRectForNormalizedRect()` 将归一化坐标转为像素坐标
2. **手动翻转 Y 轴**：`flippedY = imageHeight - (pixelRect.origin.y + pixelRect.height)`
3. 最终得到标准图像坐标系：原点左上角，Y 轴向下

### 4.3 代码示例

```swift
let pixelRect = VNImageRectForNormalizedRect(
    observation.boundingBox,
    Int(imageSize.width),
    Int(imageSize.height)
)
// 手动翻转 Y 轴以匹配标准图像坐标系（原点左上角，Y 轴向下）
let flippedY = imageSize.height - (pixelRect.origin.y + pixelRect.height)
let finalPixelRect = CGRect(x: pixelRect.origin.x, y: flippedY, width: pixelRect.width, height: pixelRect.height)
```

### 4.4 解析算法依赖

解析算法只依赖（当前私聊最小闭环）：

- `minX/maxX/width`
- `minY/maxY/height`
- 相对位置（例如 `minX / imageWidth`）

因此不需要转换到 SwiftUI 坐标系即可完成"方向判定/分组"。

## 5. 解析总体流程（V2 推荐 Pipeline）

### Step 0：OCR 请求（本地处理）

1. `NSImage` → `CGImage`
2. 创建 `VNImageRequestHandler`
3. 执行 `VNRecognizeTextRequest`（`.accurate` 级别）
4. 获取：
   - `rawResponseData`：序列化的 observations JSON（用于持久化/回放/排障）
   - `OCRResult.blocks`：结构化 blocks（用于解析）

### Step 1：Blocks 归一化（Normalization）

目的：让后续解析尽可能"只处理干净数据"。

典型动作：

- `text` 去首尾空白
- 过滤空字符串
- 过滤极小 bbox（噪声点，由 `minimumTextHeight` 控制）
- 按 `label` 过滤（例如只保留 `text`；由 config 控制）

### Step 2：噪声区域过滤（当前禁用）

为保证"**不漏任何一句文本**"，当前实现**不做 top/bottom 噪声过滤**，允许会话标题/时间戳/输入栏等以普通文本进入消息列表。待私聊方向与完整性稳定后，再把过滤作为可开关能力引入。

### Step 3：稳定排序（Stable Ordering）

仅按 `minY` 排序在"同一行多个块"场景会不稳定。

推荐排序键：

1. `bbox.minY`（主序）
2. `bbox.minX`（次序）
3. `bbox.width`（可选：让较小块先出现，利于昵称绑定）

### Step 4：候选消息分组（Message Grouping / Merge）

目的：把同一条气泡消息被 OCR 切出来的多块合并为一个候选。

候选结构（示意）：

- `MessageCandidate`
  - `blocks: [OCRBlock]`
  - `unionBBox`
  - `textLines: [String]`（保留行信息，最终再 join）

合并的几何判据（可配置）：

- **垂直邻近**：下一个 block 与当前候选的垂直间距在阈值内
- **水平一致性**：`minX`/`maxX` 与候选的"水平范围"重叠或接近
- **方向一致性（弱约束）**：在方向判定前，先以"左/右可能性"粗分也可（可选）

最终 `content`：

- 同一候选的 blocks 按行顺序拼接：
  - 行内：空格连接
  - 换行：`\n`

### Step 5：方向判定（基于分布：1D 聚类）

我们不再依赖固定阈值，而是使用候选消息在 X 轴的**分布**来判断"我/对方"。

对每个候选消息的 bbox 计算：

- \(leftDistance = minX / width\)
- \(rightDistance = 1 - maxX / width\)
- \(bias = leftDistance - rightDistance = (minX + maxX) / width - 1\)

直觉：

- `bias` 越大，气泡越靠右（更可能是"我"）
- `bias` 越小，气泡越靠左（更可能是"对方"）

判定算法（私聊）：

- 对 `bias` 做 1D k-means（k=2）聚类
- 均值更大的簇视为"我"，另一簇视为"对方"

> 该方法同时利用 `minX` 与 `maxX(x+width)`，对"宽消息"更鲁棒，并能随截图分辨率/缩放自适应。

### Step 5.5：居中系统/时间戳（X 轴中间）的处理（几何 + 分布）

在私聊中，时间戳与系统提示通常位于 X 轴中间（居中灰字）。我们可以在不使用关键词的前提下进行处理，并避免误把"短气泡"当成系统行：

- 为每个候选消息计算：
  - \(leftDistance = minX/width\)
  - \(rightDistance = 1 - maxX/width\)
  - \(minEdgeDistance = min(leftDistance, rightDistance)\)
- **第一步**：对 `minEdgeDistance` 做 1D k-means（k=2）聚类：
  - `minEdgeDistance` 更大的簇，更可能是"居中系统/时间戳"（离两侧边界都更远）
- **第二步**：在第一步的候选集合里，再对 `abs(bias)` 做 1D k-means（k=2）聚类：
  - 取 `abs(bias)` 更小的一簇，保证系统/时间戳是"左右留白更均衡"的居中文本
- 最后叠加 `centerX` 接近 0.5 的约束，最终标记为 `.system`

UI 上建议将 `.system` 以居中灰底的样式展示（类似微信），同时不影响左右气泡消息的方向判定。

### Step 6：群聊昵称绑定（✅ 2025-12-28 已实现）

> **更新**：群聊昵称功能已实现，采用**用户手动设置**方案，放弃 OCR 自动识别。
> 详见：`.cursor/plans/Chats-群聊昵称功能实现计划.md`

**实现方案**：
- 用户右键消息 → "Set Sender Name..." → Popover 选择/输入昵称
- 昵称显示在消息气泡上方（我的消息和对方消息均显示）
- 系统消息隐藏昵称设置菜单（数据保留，便于恢复）
- 昵称加密存储（AES-256-GCM）

## 6. 持久化与回放（Replay）

### 6.1 为什么要持久化 raw OCR JSON？

- 解析算法迭代时可以**离线重解析**，无需再次调用 OCR（节省时间）
- 方便排查 OCR 输出变化导致的解析回归（可对比 raw JSON）

### 6.2 建议持久化的字段

每张截图一条记录（`CachedChatScreenshotV2`）：

- `ocrResponseJSON: Data`（必存）
- `normalizedBlocksJSON: Data`（必存）
- `ocrRequestJSON: Data`（可选，用于复现当时的 OCR options）
- `imageWidth/imageHeight/importedAt/parsedAt`
- `ocrEngine: String`（记录使用的 OCR 引擎，如 "Apple Vision"）

> 图片本体暂不存（体积大 + 隐私），仅保存元数据。

### 6.3 回放流程（概念）

1. 从 store 读出 `normalizedBlocksJSON`
2. 反序列化为 blocks
3. 用当前版本 `ChatOCRParser` 重新 parse
4. 覆盖/重写该截图对应的消息集合

## 7. 调试与可观测性

### 7.1 OCR Debug 测试功能 ✅（2025-12-29 已实现）

在 Settings → OCR Settings → Test OCR Recognition 中提供 Debug 测试功能：

- **图片导入**：点击按钮选择图片，或拖放图片到窗口
- **实时识别**：导入后自动执行 OCR 识别
- **结果展示**：
  - **Statistics**：块数量、处理时间、语言模式、检测到的书写系统
  - **Block Details**：每个识别块的文本和 bbox 坐标

### 7.2 VisionOCRService 识别日志 ✅（2025-12-29 已实现）

`VisionOCRService` 输出详细的日志信息：

```
[VisionOCR] Starting recognition, image size: 1080x1920
[VisionOCR] Language mode: automatic, languages: zh-Hans, zh-Hant, en-US
[VisionOCR] ✅ Recognition completed: 25 blocks (from 25 observations)
[VisionOCR] 📊 Confidence: avg=0.95, min=0.82, max=0.99
[VisionOCR] 🌐 Detected scripts: CJK (Chinese/Japanese Kanji), Latin (English/European)
[VisionOCR] 📝 First 5 blocks:
[VisionOCR]   [1] "你好，今天天气真好" (conf: 0.98)
[VisionOCR]   [2] "是啊，适合出去走走" (conf: 0.95)
```

日志内容包括：
- 语言模式（automatic/manual）
- 使用的语言列表
- 识别统计（块数量、置信度分布）
- 检测到的书写系统
- 前 5 个识别结果预览

### 7.3 解析日志 ✅（2025-12-28 已实现）

- 每张截图输出：输入 blocks 数、过滤后 blocks 数、候选消息数、左/右消息数
- 使用 `LoggerService` 输出调试日志（可在 LoggerView 查看）
- `ChatParseStatistics` 结构体记录所有统计指标
- `parseWithStatistics()` 方法输出详细日志

### 7.4 Debug overlay（未实现）

- 在 UI 里叠加 bbox（候选消息 unionBBox + 原始 blocks bbox）
- 展示方向判定结果（左/右簇中心、阈值）

## 8. 隐私与安全

- OCR 处理：完全本地，无需网络，离线可用
- OCR 输出：只在本地 store 持久化，不上传第三方
- 聊天内容：加密存储（AES-256-GCM + Keychain）
- 不保存图片本体（本轮）

## 9. Apple Vision OCR 语言支持

### 9.1 支持的语言

Apple Vision（macOS 14，Accurate 模式）支持 **30 种语言**：

| 分类 | 语言 |
|-----|------|
| 东亚语言 | 中文简体、中文繁体、粤语（简/繁）、日语、韩语 |
| 西欧语言 | 英语、法语、德语、西班牙语、意大利语、葡萄牙语、荷兰语 |
| 东欧语言 | 俄语、乌克兰语、波兰语、捷克语、罗马尼亚语 |
| 北欧语言 | 瑞典语、丹麦语、挪威语（3种变体） |
| 东南亚语言 | 泰语、越南语、印尼语、马来语 |
| 中东语言 | 阿拉伯语（2种变体）、土耳其语 |

### 9.2 SyncNos 语言配置

用户可在 Settings → OCR Settings 中配置语言：

- **自动检测模式**（默认）：Vision 自动检测语言
- **手动选择模式**：用户从 30 种语言中选择目标语言

### 9.3 语言组合限制

**重要**：中文和日语不能在同一请求中同时识别。

- ❌ 中文 + 日语：不支持
- ✅ 中文 + 英语：支持
- ✅ 日语 + 英语：支持

详见：[Apple Vision OCR 技术文档](../Docs/Apple-Vision-OCR技术文档.md)

## 10. 长图片分片处理 ✅（2025-12-30 已实现）

### 10.1 问题背景

Vision OCR 在处理超长图片（如微信长截图）时可能返回空结果或识别不完整。这可能是由于 GPU 纹理尺寸限制或 Vision 框架的内部限制导致。

### 10.2 解决方案

SyncNos 在 `VisionOCRService` 中实现了自动分片处理机制：

| 参数 | 值 | 说明 |
|-----|-----|------|
| `sliceThresholdHeight` | 16000px | 超过此高度才启用分片 |
| `sliceMaxHeight` | 8000px | 每个分片的最大高度 |
| `sliceOverlap` | 200px | 分片重叠区域（约 4-5 行文字） |

### 10.3 处理流程

1. **检测**：图像高度是否超过阈值 (16000px)
2. **分片**：计算分片区域（带 200px 重叠）
3. **OCR**：对每个分片进行独立识别
4. **偏移**：调整 bbox 的 Y 坐标（加上分片偏移）
5. **去重**：移除重叠区域产生的重复文本块（通过文本内容 + 近似位置判断）
6. **合并**：合并所有分片的结果

### 10.4 日志输出

```
[VisionOCR] 🔪 Image height 20000px exceeds threshold 16000px, using slice processing
[VisionOCR] 🔪 Slicing image into 3 parts
[VisionOCR] 🔪 Processing slice 1/3: y=0, height=8000
[VisionOCR] 🔪 Processing slice 2/3: y=7800, height=8000
[VisionOCR] 🔪 Processing slice 3/3: y=15600, height=4400
[VisionOCR] 🔪 Slice processing completed: 150 blocks → 145 after deduplication
```

## 11. 多图片上传顺序 ✅（2025-12-30 已修复）

### 11.1 问题背景

用户通过拖拽上传多张截图时，原实现使用并行异步处理，导致图片处理顺序不可控。

### 11.2 解决方案

修改 `ChatDetailView.handleDrop()` 方法，改为串行处理：

1. 收集所有拖拽的图片 URL/Data（保持 providers 顺序）
2. 统一调用 `addScreenshots()` 和 `addScreenshotData()`（内部是串行 await）
3. 确保消息按照用户拖入的顺序追加

### 11.3 顺序保证

| 上传方式 | 顺序来源 | 处理方式 | 顺序可预测 |
|---------|---------|---------|-----------|
| fileImporter | 文件对话框排序 | 串行 await | ✅ |
| 拖拽（修复后） | providers 数组顺序 | 串行 await | ✅ |
