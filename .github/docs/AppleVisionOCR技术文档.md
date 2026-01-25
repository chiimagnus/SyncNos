# Apple Vision OCR 技术文档

## 概述

SyncNos 使用 Apple Vision 框架进行文本识别（OCR），用于微信聊天截图的消息提取。Vision 是 Apple 提供的原生计算机视觉框架，完全离线运行，保护用户隐私。

### 平台支持

| 平台 | 最低版本 | 推荐版本 |
|-----|---------|---------|
| macOS | 10.15+ | 14.0+（Sonoma）|

SyncNos 目标平台为 **macOS 14.0+**，完全支持 Vision 框架的所有 OCR 功能。

---

## API 架构

### 识别流程

```
┌─────────────┐     ┌─────────────────────┐     ┌──────────────────────┐
│   CGImage   │ ──► │ VNImageRequestHandler │ ──► │ VNRecognizeTextRequest │
└─────────────┘     └─────────────────────┘     └──────────────────────┘
                                                          │
                                                          ▼
                                               ┌──────────────────────┐
                                               │ [VNRecognizedText-   │
                                               │  Observation]        │
                                               └──────────────────────┘
                                                          │
                                                          ▼
                                               ┌──────────────────────┐
                                               │ - boundingBox: CGRect │
                                               │ - topCandidates(N)    │
                                               │ - confidence: Float   │
                                               └──────────────────────┘
```

---

## 坐标系统

**重要**：Vision 框架使用 **归一化坐标系**，与标准图像坐标系不同：

```
Vision 坐标系:                 标准图像坐标系:
(0,1) ─────── (1,1)           (0,0) ─────── (w,0)
  │             │               │             │
  │             │               │             │
(0,0) ─────── (1,0)           (0,h) ─────── (w,h)
  原点在左下角                   原点在左上角
```

### 坐标转换

`VNImageRectForNormalizedRect` **不会翻转 Y 轴**！必须手动转换：

```swift
/// 将 Vision 归一化坐标转换为图像像素坐标（原点左上角）
func convertToImageCoordinates(
    _ normalizedBox: CGRect,
    imageSize: CGSize
) -> CGRect {
    let x = normalizedBox.origin.x * imageSize.width
    let y = imageSize.height * (1 - normalizedBox.origin.y - normalizedBox.height)
    let width = normalizedBox.width * imageSize.width
    let height = normalizedBox.height * imageSize.height
    
    return CGRect(x: x, y: y, width: width, height: height)
}
```

---

## 配置选项

### 识别级别 (recognitionLevel)

| 级别 | 速度 | 准确度 | 适用场景 |
|-----|------|--------|---------|
| `.fast` | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | 实时相机、视频流 |
| `.accurate` | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 静态图片、高精度需求 |

**SyncNos 使用 `.accurate`**（处理静态截图）。

### 语言配置

支持 30 种语言（macOS 14 / iOS 17，Accurate 模式）：

| 语言分类 | 语言 |
|---------|-----|
| **东亚语言** | 简体中文 `zh-Hans`、繁体中文 `zh-Hant`、粤语、日语 `ja-JP`、韩语 `ko-KR` |
| **西欧语言** | 英语 `en-US`、法语、德语、西班牙语、意大利语、葡萄牙语、荷兰语 |
| **东欧语言** | 俄语、乌克兰语、波兰语、捷克语、罗马尼亚语 |
| **北欧语言** | 瑞典语、丹麦语、挪威语 |
| **东南亚语言** | 泰语、越南语、印尼语、马来语 |
| **中东语言** | 阿拉伯语、土耳其语 |

**注意**：⚠️ **中文与日语不能混合使用**

### SyncNos 语言配置

用户可在 Settings → OCR Settings 中配置语言：

```swift
// 自动检测模式（默认）
request.automaticallyDetectsLanguage = true
request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]

// 手动选择语言
request.automaticallyDetectsLanguage = false
request.recognitionLanguages = configStore.selectedLanguageCodes
```

---

## 长图片分片处理

Vision OCR 在处理超长图片时可能返回空结果。SyncNos 实现了自动分片处理：

| 参数 | 值 | 说明 |
|-----|-----|------|
| `sliceThresholdHeight` | 16000px | 超过此高度才启用分片 |
| `sliceMaxHeight` | 8000px | 每个分片的最大高度 |
| `sliceOverlap` | 200px | 分片重叠区域（约 4-5 行文字） |

### 处理流程

1. 检测图像高度是否超过阈值 (16000px)
2. 计算分片区域（带 200px 重叠）
3. 对每个分片进行独立 OCR
4. 调整 bbox 的 Y 坐标（加上分片偏移）
5. 去重：移除重叠区域产生的重复文本块
6. 合并所有分片的结果

---

## 相关文件

| 文件 | 描述 |
|-----|------|
| `VisionOCRService.swift` | Vision OCR 服务实现（含详细识别日志） |
| `OCRConfigStore.swift` | 语言配置存储（`OCRLanguage`、30 种语言） |
| `OCRModels.swift` | 数据模型（`OCRResult`、`OCRBlock`）和协议定义 |

---

## 日志输出

`VisionOCRService` 输出详细的日志信息：

```
[VisionOCR] Starting recognition, image size: 1080x1920
[VisionOCR] Language config: Auto (using defaults: zh-Hans, zh-Hant, en-US)
[VisionOCR] ✅ Recognition completed: 25 blocks (from 25 observations)
[VisionOCR] 📊 Confidence: avg=0.95, min=0.82, max=0.99
[VisionOCR] 🌐 Detected scripts: CJK (Chinese/Japanese Kanji), Latin (English/European)
```

---

## 聊天截图场景适用性

| 需求 | Apple Vision 支持 |
|-----|-----------------|
| 识别中文聊天内容 | ✅ 完全支持 |
| 识别英文混合内容 | ✅ 完全支持 |
| 返回 BBox | ✅ 完全支持（归一化坐标） |
| 区分气泡方向 | ✅ 通过 BBox 位置判断 |
| 系统消息检测 | ✅ 通过 BBox 居中判断 |
| 时间戳检测 | ✅ 通过 BBox 位置判断 |

---

## ChatOCRParser 集成

`ChatOCRParser` 使用 OCR 结果进行消息解析：

1. **k-means 聚类**：根据 X 坐标判断消息方向（我/对方）
2. **两阶段系统/时间戳检测**：纯几何规则
3. **`ChatParseStatistics`**：记录解析统计

---

## 已知限制

1. **中文与日语不能混合**：如需同时识别，需分两次请求
2. **无版面分析**：不支持表格、公式等结构化内容
3. **手写体**：中文手写识别效果一般
4. **倾斜文本**：严重倾斜的文本可能识别失败
5. **Emoji**：Vision OCR 无法识别 emoji 图形

---

## 参考资料

### Apple 官方文档

- [Vision Framework](https://developer.apple.com/documentation/vision/)
- [VNRecognizeTextRequest](https://developer.apple.com/documentation/vision/vnrecognizetextrequest/)
- [Recognizing Text in Images](https://developer.apple.com/documentation/vision/recognizing-text-in-images/)

### WWDC 视频

- WWDC 2019: [Vision Framework: Understanding Images](https://developer.apple.com/videos/play/wwdc2019/222/)
- WWDC 2021: [Extract document data using Vision](https://developer.apple.com/videos/play/wwdc2021/10041/)
- WWDC 2024: [Discover Swift enhancements in the Vision framework](https://developer.apple.com/videos/play/wwdc2024/10163/)
