# Apple Vision OCR 技术文档

## 1. 概述

本文档详细介绍 Apple Vision 框架的文本识别（OCR）功能，包括 API 结构、返回数据格式、bounding box 信息等技术细节，以帮助评估其是否满足 SyncNos 的聊天截图 OCR 需求。

## 2. Vision 框架简介

Vision 是 Apple 提供的原生计算机视觉框架，从 macOS 10.13 / iOS 11 开始支持。文本识别功能在 macOS 10.15 / iOS 13 中引入，经过多次迭代已相当成熟。

### 2.1 平台支持

| 平台 | 最低版本 | 推荐版本 |
|-----|---------|---------|
| macOS | 10.15+ | 14.0+（Sonoma）|
| iOS | 13.0+ | 17.0+ |
| iPadOS | 13.0+ | 17.0+ |
| visionOS | 1.0+ | 2.0+ |

### 2.2 SyncNos 兼容性

SyncNos 目标平台为 **macOS 14.0+**，完全支持 Vision 框架的所有 OCR 功能，包括最新的 Swift API（`RecognizeTextRequest`）。

---

## 3. API 架构

### 3.1 两种 API 风格

Vision 框架提供两种 API 风格：

#### 传统 Objective-C 风格（macOS 10.15+）

```swift
// 使用 VNRecognizeTextRequest
let request = VNRecognizeTextRequest { request, error in
    guard let observations = request.results as? [VNRecognizedTextObservation] else { return }
    // 处理结果
}
```

#### 现代 Swift 风格（macOS 15.0+ / iOS 18.0+）

```swift
// 使用 RecognizeTextRequest（Swift 原生）
let request = RecognizeTextRequest()
let results = try await request.perform(on: cgImage)
```

**建议**：SyncNos 目标为 macOS 14.0+，应使用 **传统 Objective-C 风格 API**（`VNRecognizeTextRequest`）以保持兼容性。

### 3.2 识别流程

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

## 4. 返回数据结构详解

### 4.1 VNRecognizedTextObservation

每个识别到的文本区域都会返回一个 `VNRecognizedTextObservation` 对象。

#### 4.1.1 继承层级

```
VNObservation
    └── VNDetectedObjectObservation
            └── VNRectangleObservation
                    └── VNRecognizedTextObservation
```

#### 4.1.2 主要属性

| 属性 | 类型 | 描述 |
|-----|------|------|
| `boundingBox` | `CGRect` | 文本区域的边界框（**归一化坐标 0~1**） |
| `topLeft` | `CGPoint` | 左上角坐标（归一化） |
| `topRight` | `CGPoint` | 右上角坐标（归一化） |
| `bottomLeft` | `CGPoint` | 左下角坐标（归一化） |
| `bottomRight` | `CGPoint` | 右下角坐标（归一化） |
| `confidence` | `VNConfidence` | 检测置信度（0~1） |
| `uuid` | `UUID` | 唯一标识符 |

#### 4.1.3 方法

| 方法 | 返回类型 | 描述 |
|-----|---------|------|
| `topCandidates(_ maxCandidates: Int)` | `[VNRecognizedText]` | 返回排名靠前的识别候选 |

### 4.2 VNRecognizedText

每个识别候选包含具体的文本内容。

#### 4.2.1 属性

| 属性 | 类型 | 描述 |
|-----|------|------|
| `string` | `String` | 识别出的文本内容 |
| `confidence` | `VNConfidence` | 识别置信度（0~1） |

#### 4.2.2 方法

| 方法 | 返回类型 | 描述 |
|-----|---------|------|
| `boundingBox(for: Range<String.Index>)` | `VNRectangleObservation?` | 获取文本子串的边界框 |

### 4.3 坐标系统

**重要**：Vision 框架使用 **归一化坐标系**，与 UIKit/AppKit 坐标系不同：

```
Vision 坐标系:                 AppKit/UIKit 坐标系:
(0,1) ─────── (1,1)           (0,0) ─────── (w,0)
  │             │               │             │
  │             │               │             │
(0,0) ─────── (1,0)           (0,h) ─────── (w,h)
  原点在左下角                   原点在左上角
```

#### 4.3.1 坐标转换

> ⚠️ **重要警告**：`VNImageRectForNormalizedRect` **不会翻转 Y 轴**！
> 
> 该函数只做简单的缩放，返回的坐标仍然是原点在左下角的坐标系。
> 如果需要与图像坐标系（原点左上角）匹配，必须手动翻转 Y 轴。

**正确的手动转换方式：**

```swift
/// 将 Vision 归一化坐标转换为图像像素坐标（原点左上角）
func convertToImageCoordinates(
    _ normalizedBox: CGRect,
    imageSize: CGSize
) -> CGRect {
    // Vision 坐标系原点在左下角，需要手动翻转 Y 轴
    let x = normalizedBox.origin.x * imageSize.width
    let y = imageSize.height * (1 - normalizedBox.origin.y - normalizedBox.height)
    let width = normalizedBox.width * imageSize.width
    let height = normalizedBox.height * imageSize.height
    
    return CGRect(x: x, y: y, width: width, height: height)
}
```

**VNImageRectForNormalizedRect 的实际行为（仅缩放，不翻转）：**

```swift
// ⚠️ 注意：此函数不翻转 Y 轴！
let pixelRect = VNImageRectForNormalizedRect(boundingBox, Int(width), Int(height))
// 结果：pixelRect.origin.y = boundingBox.origin.y * height
// 这意味着 Y 值越大 = 距离图像底部越近（与标准图像坐标系相反）
```

**关键区别：**

| 坐标系 | Y 值含义 | 原点位置 |
|-------|---------|---------|
| Vision 归一化坐标 | Y=0 在底部，Y=1 在顶部 | 左下角 |
| VNImageRectForNormalizedRect 输出 | Y=0 在底部，Y=height 在顶部 | 左下角 |
| 标准图像坐标（UIKit/AppKit） | Y=0 在顶部，Y=height 在底部 | 左上角 |

**在 SyncNos 中的实现：**

`VisionOCRService.swift` 使用手动坐标转换以保证与 `ChatOCRParser` 的排序逻辑兼容：

```swift
let x = normalizedBox.origin.x * imageSize.width
let y = imageSize.height * (1 - normalizedBox.origin.y - normalizedBox.height)
let width = normalizedBox.width * imageSize.width
let height = normalizedBox.height * imageSize.height
let pixelRect = CGRect(x: x, y: y, width: width, height: height)
```

---

## 5. 完整示例代码

### 5.1 基础实现

```swift
import Vision
import AppKit

/// Vision OCR 服务（遵循 SyncNos 的 OCRAPIServiceProtocol）
final class VisionOCRService: OCRAPIServiceProtocol {
    
    private let logger: LoggerServiceProtocol
    
    init(logger: LoggerServiceProtocol = DIContainer.shared.loggerService) {
        self.logger = logger
    }
    
    // MARK: - OCRAPIServiceProtocol
    
    func recognize(_ image: NSImage) async throws -> OCRResult {
        let (result, _, _) = try await recognizeWithRaw(image, config: .default)
        return result
    }
    
    func recognizeWithRaw(
        _ image: NSImage,
        config: OCRRequestConfig
    ) async throws -> (result: OCRResult, rawResponse: Data, requestJSON: Data) {
        guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            throw OCRServiceError.invalidImage
        }
        
        let imageSize = CGSize(
            width: CGFloat(cgImage.width),
            height: CGFloat(cgImage.height)
        )
        
        logger.info("[VisionOCR] Starting recognition, image size: \(imageSize)")
        
        // 创建文本识别请求
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
        request.revision = VNRecognizeTextRequestRevision3
        
        // 执行请求
        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        
        return try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    try handler.perform([request])
                    
                    guard let observations = request.results else {
                        continuation.resume(throwing: OCRServiceError.noResult)
                        return
                    }
                    
                    let blocks = self.convertToOCRBlocks(
                        observations: observations,
                        imageSize: imageSize
                    )
                    
                    let result = OCRResult(
                        rawText: blocks.map(\.text).joined(separator: "\n"),
                        markdownText: nil,
                        blocks: blocks,
                        processedAt: Date(),
                        coordinateSize: imageSize
                    )
                    
                    // 构造 raw response（用于调试）
                    let rawDict = self.observationsToDict(observations, imageSize: imageSize)
                    let rawData = try? JSONSerialization.data(withJSONObject: rawDict)
                    
                    self.logger.info("[VisionOCR] Recognition completed: \(blocks.count) blocks")
                    
                    continuation.resume(returning: (
                        result: result,
                        rawResponse: rawData ?? Data(),
                        requestJSON: Data()
                    ))
                    
                } catch {
                    self.logger.error("[VisionOCR] Recognition failed: \(error)")
                    continuation.resume(throwing: error)
                }
            }
        }
    }
    
    func testConnection() async throws -> Bool {
        // Vision 框架无需连接测试，始终可用
        return true
    }
    
    // MARK: - Private Methods
    
    private func convertToOCRBlocks(
        observations: [VNRecognizedTextObservation],
        imageSize: CGSize
    ) -> [OCRBlock] {
        return observations.compactMap { observation in
            guard let topCandidate = observation.topCandidates(1).first else {
                return nil
            }
            
            // 转换坐标
            let pixelRect = VNImageRectForNormalizedRect(
                observation.boundingBox,
                Int(imageSize.width),
                Int(imageSize.height)
            )
            
            return OCRBlock(
                text: topCandidate.string,
                label: "text",
                bbox: pixelRect
            )
        }
    }
    
    private func observationsToDict(
        _ observations: [VNRecognizedTextObservation],
        imageSize: CGSize
    ) -> [[String: Any]] {
        return observations.compactMap { obs in
            guard let text = obs.topCandidates(1).first else { return nil }
            
            let pixelRect = VNImageRectForNormalizedRect(
                obs.boundingBox,
                Int(imageSize.width),
                Int(imageSize.height)
            )
            
            return [
                "text": text.string,
                "confidence": text.confidence,
                "boundingBox": [
                    "x": pixelRect.origin.x,
                    "y": pixelRect.origin.y,
                    "width": pixelRect.width,
                    "height": pixelRect.height
                ],
                "normalizedBoundingBox": [
                    "x": obs.boundingBox.origin.x,
                    "y": obs.boundingBox.origin.y,
                    "width": obs.boundingBox.width,
                    "height": obs.boundingBox.height
                ]
            ]
        }
    }
}
```

### 5.2 获取字符级边界框

```swift
/// 获取单个字符的边界框
func getCharacterBoundingBoxes(
    observation: VNRecognizedTextObservation,
    imageSize: CGSize
) -> [(character: Character, bbox: CGRect)] {
    guard let recognizedText = observation.topCandidates(1).first else {
        return []
    }
    
    let string = recognizedText.string
    var results: [(Character, CGRect)] = []
    
    for (index, character) in string.enumerated() {
        let startIndex = string.index(string.startIndex, offsetBy: index)
        let endIndex = string.index(startIndex, offsetBy: 1)
        let range = startIndex..<endIndex
        
        if let charObservation = try? recognizedText.boundingBox(for: range) {
            let pixelRect = VNImageRectForNormalizedRect(
                charObservation.boundingBox,
                Int(imageSize.width),
                Int(imageSize.height)
            )
            results.append((character, pixelRect))
        }
    }
    
    return results
}
```

### 5.3 实时相机识别

```swift
import AVFoundation

/// 处理相机帧的 OCR
func processVideoFrame(_ sampleBuffer: CMSampleBuffer) {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    
    let request = VNRecognizeTextRequest { request, error in
        // 处理结果
    }
    request.recognitionLevel = .fast  // 实时场景使用 fast 模式
    
    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])
    try? handler.perform([request])
}
```

---

## 6. 配置选项详解

### 6.1 识别级别 (recognitionLevel)

```swift
request.recognitionLevel = .accurate  // 或 .fast
```

| 级别 | 速度 | 准确度 | 适用场景 |
|-----|------|--------|---------|
| `.fast` | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | 实时相机、视频流 |
| `.accurate` | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 静态图片、高精度需求 |

**建议**：SyncNos 处理静态截图，应使用 `.accurate`。

### 6.2 语言校正 (usesLanguageCorrection)

```swift
request.usesLanguageCorrection = true
```

- `true`：启用基于自然语言处理的校正，减少误识别
- `false`：禁用校正，适合非标准文本（代码、特殊符号）

### 6.3 自动语言检测 (automaticallyDetectsLanguage)

```swift
// macOS 13+ / iOS 16+ 支持自动语言检测
request.automaticallyDetectsLanguage = true
```

启用后，Vision 会自动检测图片中的语言，无需手动指定。**SyncNos 默认启用此功能。**

### 6.4 识别语言 (recognitionLanguages)

```swift
// 作为自动检测的优先级提示和 fallback
request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
```

**支持的语言**（macOS 14 / iOS 17，Accurate 模式，共 30 种）：

> 以下列表来自 `VNRecognizeTextRequest.supportedRecognitionLanguages()` 运行时查询结果

| 语言分类 | 语言 | 代码 |
|---------|-----|------|
| **东亚语言** | 简体中文 | `zh-Hans` |
|  | 繁体中文 | `zh-Hant` |
|  | 粤语（简体） | `yue-Hans` |
|  | 粤语（繁体） | `yue-Hant` |
|  | 日语 | `ja-JP` |
|  | 韩语 | `ko-KR` |
| **西欧语言** | 英语 | `en-US` |
|  | 法语 | `fr-FR` |
|  | 德语 | `de-DE` |
|  | 西班牙语 | `es-ES` |
|  | 意大利语 | `it-IT` |
|  | 葡萄牙语（巴西） | `pt-BR` |
|  | 荷兰语 | `nl-NL` |
| **东欧语言** | 俄语 | `ru-RU` |
|  | 乌克兰语 | `uk-UA` |
|  | 波兰语 | `pl-PL` |
|  | 捷克语 | `cs-CZ` |
|  | 罗马尼亚语 | `ro-RO` |
| **北欧语言** | 瑞典语 | `sv-SE` |
|  | 丹麦语 | `da-DK` |
|  | 挪威语 | `no-NO` |
|  | 书面挪威语 | `nb-NO` |
|  | 新挪威语 | `nn-NO` |
| **东南亚语言** | 泰语 | `th-TH` |
|  | 越南语 | `vi-VT` |
|  | 印尼语 | `id-ID` |
|  | 马来语 | `ms-MY` |
| **中东语言** | 阿拉伯语 | `ar-SA` |
|  | 阿拉伯语（纳吉迪） | `ars-SA` |
|  | 土耳其语 | `tr-TR` |

**Fast 模式只支持 6 种语言**：`en-US`, `fr-FR`, `it-IT`, `de-DE`, `es-ES`, `pt-BR`

**查询支持的语言**：

```swift
let supportedLanguages = try? VNRecognizeTextRequest.supportedRecognitionLanguages(
    for: .accurate,
    revision: VNRecognizeTextRequestRevision3
)
print(supportedLanguages ?? [])
// 输出: ["en-US", "fr-FR", "it-IT", "de-DE", "es-ES", "pt-BR", "zh-Hans", "zh-Hant", "yue-Hans", "yue-Hant", "ko-KR", "ja-JP", ...]
```

**注意事项**：
- ⚠️ **中文与日语不能混合使用**：如果需要同时识别中日文内容，需要分两次请求
- 中文（简体/繁体）可以与英语混合使用
- 启用 `automaticallyDetectsLanguage` 后，系统会智能选择最佳语言模型

### 6.5 SyncNos 语言配置功能

SyncNos 在 Settings → OCR Settings 中提供语言配置功能：

#### 自动检测模式（默认）

当用户未选择任何语言时，Vision 框架自动检测图像中的语言，使用默认优先语言（中文简体、繁体、英文）作为提示。

```swift
// selectedLanguageCodes 为空时启用自动检测
request.automaticallyDetectsLanguage = true
request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
```

#### 手动选择语言

用户可以在 Settings → Chats → OCR Languages 中选择目标语言，适用于特定语言场景（如日语、韩语等）。

```swift
// selectedLanguageCodes 非空时使用用户选择的语言
request.automaticallyDetectsLanguage = false
request.recognitionLanguages = configStore.selectedLanguageCodes  // 用户选择的语言
```

#### 相关代码文件

| 文件 | 描述 |
|-----|------|
| `OCRConfigStore.swift` | 语言配置存储（`OCRLanguage`，30 种语言） |
| `VisionOCRService.swift` | 根据 `OCRConfigStore` 动态设置语言参数，输出详细日志 |
| `OCRSettingsView.swift` | 简洁的语言选择 UI（语言选择 Sheet + Debug 测试） |

#### OCR 识别日志

`VisionOCRService` 会输出详细的日志信息，帮助调试和验证识别结果：

```
[VisionOCR] Starting recognition, image size: 1080x1920
[VisionOCR] Language config: Auto (using defaults: zh-Hans, zh-Hant, en-US)
[VisionOCR] ✅ Recognition completed: 25 blocks (from 25 observations)
[VisionOCR] 📊 Confidence: avg=0.95, min=0.82, max=0.99
[VisionOCR] 🌐 Detected scripts: CJK (Chinese/Japanese Kanji), Latin (English/European)
[VisionOCR] 📝 First 5 blocks:
[VisionOCR]   [1] "你好，今天天气真好" (conf: 0.98)
[VisionOCR]   [2] "是啊，适合出去走走" (conf: 0.95)
...
```

日志内容包括：
- **语言配置**：自动检测（Auto）或用户选择的语言列表
- **使用的语言列表**：实际传递给 Vision 的语言代码
- **识别统计**：块数量、置信度分布（平均/最小/最大）
- **检测到的书写系统**：CJK、Hiragana、Katakana、Hangul、Arabic、Cyrillic、Thai、Latin
- **前 5 个识别结果预览**：文本内容和置信度

#### Debug 测试功能

在 Settings → OCR Settings 中提供 Debug 测试功能（"Test OCR Recognition"），支持：

1. **导入图片**：点击按钮选择图片，或拖放图片到窗口
2. **实时识别**：导入后自动执行 OCR 识别
3. **结果展示**：
   - 统计信息：块数量、处理时间、语言模式、检测到的书写系统
   - 识别文本：完整的识别文本内容
   - 块详情：每个识别块的文本和 bbox 坐标

### 6.5 自定义词汇 (customWords)

```swift
request.customWords = ["微信", "WeChat", "SyncNos"]
```

添加领域特定词汇，提高识别准确率。仅在 `usesLanguageCorrection = true` 时生效。

### 6.6 最小文字高度 (minimumTextHeight)

```swift
request.minimumTextHeight = 0.02  // 相对于图像高度的比例
```

过滤过小的文字，减少噪声。

### 6.7 版本控制 (revision)

```swift
request.revision = VNRecognizeTextRequestRevision3
```

| 版本 | 引入系统 | 特点 |
|-----|---------|------|
| `Revision1` | macOS 10.15 | 基础版本 |
| `Revision2` | macOS 11.0 | 改进中文支持 |
| `Revision3` | macOS 14.0 | 最新，最佳性能 |

---

## 7. 功能概览

### 7.1 Apple Vision OCR 功能

| 功能 | 支持情况 |
|-----|---------|
| 中文识别（简体/繁体） | ✅ 完全支持 |
| 英文识别 | ✅ 完全支持 |
| 手写识别 | ⭐⭐⭐ 基础支持 |
| BBox 精度 | ⭐⭐⭐⭐ 良好 |
| 速度（Apple Silicon） | ⭐⭐⭐⭐⭐ 极快 |
| 离线可用 | ✅ 完全离线 |
| 隐私保护 | ⭐⭐⭐⭐⭐ 本地处理 |

### 7.2 性能参考（Apple Silicon M1）

| 图片尺寸 | 处理时间 |
|---------|---------|
| 1080p | ~200-500ms |
| 4K | ~500-1000ms |

### 7.3 SyncNos 聊天截图场景适用性

| 需求 | Apple Vision 支持 |
|-----|-----------------|
| 识别中文聊天内容 | ✅ 完全支持 |
| 识别英文混合内容 | ✅ 完全支持 |
| 返回 BBox | ✅ 完全支持（归一化坐标） |
| 区分气泡方向 | ✅ 通过 BBox 位置判断 |
| 系统消息检测 | ✅ 通过 BBox 居中判断 |
| 时间戳检测 | ✅ 通过 BBox 位置判断 |

---

## 8. JSON 原始数据示例

### 8.1 识别结果结构

```json
{
  "observations": [
    {
      "text": "你好，今天天气真好",
      "confidence": 0.98,
      "normalizedBoundingBox": {
        "x": 0.05,
        "y": 0.15,
        "width": 0.35,
        "height": 0.03
      },
      "pixelBoundingBox": {
        "x": 54,
        "y": 873,
        "width": 378,
        "height": 33
      },
      "quadrilateral": {
        "topLeft": { "x": 0.05, "y": 0.18 },
        "topRight": { "x": 0.40, "y": 0.18 },
        "bottomLeft": { "x": 0.05, "y": 0.15 },
        "bottomRight": { "x": 0.40, "y": 0.15 }
      }
    },
    {
      "text": "是啊，适合出去走走",
      "confidence": 0.95,
      "normalizedBoundingBox": {
        "x": 0.55,
        "y": 0.25,
        "width": 0.40,
        "height": 0.03
      },
      "pixelBoundingBox": {
        "x": 594,
        "y": 765,
        "width": 432,
        "height": 33
      }
    }
  ],
  "imageSize": {
    "width": 1080,
    "height": 1920
  }
}
```

### 8.2 OCRBlock 结构

Vision 框架返回的数据映射到 `OCRBlock` 结构：

```json
{
  "blocks": [{
    "text": "你好，今天天气真好",
    "label": "text",
    "bbox": { "x": 54, "y": 150, "width": 378, "height": 33 }
  }]
}
```

---

## 9. SyncNos 实现

### 9.1 相关文件

| 文件 | 描述 |
|-----|------|
| `VisionOCRService.swift` | Vision OCR 服务实现（含详细识别日志） |
| `OCRConfigStore.swift` | 语言配置存储（`OCRLanguage`、30 种语言、`selectedLanguageCodes`） |
| `OCRModels.swift` | 数据模型（`OCRResult`、`OCRBlock`）和协议定义 |
| `OCRSettingsView.swift` | 设置界面（语言选择、Debug 测试），位于 Settings → Chats |
| `DIContainer.swift` | 服务注册 |

### 9.2 OCRAPIServiceProtocol 协议

```swift
protocol OCRAPIServiceProtocol {
    func recognize(_ image: NSImage) async throws -> OCRResult
    func recognizeWithRaw(_ image: NSImage, config: OCRRequestConfig) async throws -> (result: OCRResult, rawResponse: Data, requestJSON: Data)
    func testConnection() async throws -> Bool
}
```

`VisionOCRService` 完全遵循此协议。

---

## 10. 限制与注意事项

### 10.1 已知限制

1. **中文与日语不能混合**：如果需要同时识别中日文，需要分两次请求
2. **无版面分析**：不支持表格、公式等结构化内容识别
3. **手写体**：中文手写识别效果一般
4. **倾斜文本**：严重倾斜的文本可能识别失败

### 10.2 性能优化建议

1. **异步处理**：始终在后台线程执行 OCR
2. **图片预处理**：压缩过大的图片（>4K）
3. **缓存结果**：相同图片不重复识别
4. **批量处理**：使用 `perform([request1, request2, ...])` 批量处理

### 10.3 调试技巧

**使用内置 Debug 工具**

1. 打开 Settings → OCR Settings
2. 点击 "Test OCR Recognition" 按钮
3. 导入测试图片（支持拖放）
4. 查看识别结果、统计信息和块详情

**查看日志**

打开 Settings → Logs 窗口，过滤 `[VisionOCR]` 查看识别日志：

```
[VisionOCR] Starting recognition, image size: 1080x1920
[VisionOCR] Language config: Auto (using defaults: zh-Hans, zh-Hant, en-US)
[VisionOCR] ✅ Recognition completed: 25 blocks
[VisionOCR] 📊 Confidence: avg=0.95, min=0.82, max=0.99
[VisionOCR] 🌐 Detected scripts: CJK, Latin
```

**代码调试**

```swift
// 打印支持的语言
if let languages = try? VNRecognizeTextRequest.supportedRecognitionLanguages(for: .accurate, revision: VNRecognizeTextRequestRevision3) {
    print("Supported languages: \(languages)")
}

// 打印识别结果详情
for observation in observations {
    print("BBox: \(observation.boundingBox)")
    for candidate in observation.topCandidates(3) {
        print("  - \(candidate.string) (\(candidate.confidence))")
    }
}
```

---

## 11. 总结

### 11.1 Apple Vision 适用性评估

| 评估项 | 结论 |
|-------|------|
| 满足 SyncNos 核心需求 | ✅ |
| 中英文聊天识别 | ✅ 优秀 |
| BBox 数据完整性 | ✅ 完全支持 |
| 与现有代码兼容 | ✅ 无需大改 |
| Mac App Store 兼容 | ✅ 原生支持 |
| 用户体验 | ✅ 即装即用 |

### 11.2 推荐方案

**采用 Apple Vision 作为 SyncNos 默认 OCR 引擎**：

1. 零配置，用户即装即用
2. 完全离线，保护隐私
3. 利用 Apple Silicon 优化，性能优秀
4. 完全兼容 Mac App Store
5. 与现有 `ChatOCRParser` 无缝集成

SyncNos 使用 Apple Vision 作为唯一的 OCR 引擎，满足聊天截图识别的所有需求。

---

## 12. 参考资料

### 12.1 Apple 官方文档

- [VNRecognizeTextRequest](https://developer.apple.com/documentation/vision/vnrecognizetextrequest/)
- [VNRecognizedTextObservation](https://developer.apple.com/documentation/vision/vnrecognizedtextobservation)
- [Recognizing Text in Images](https://developer.apple.com/documentation/vision/recognizing-text-in-images/)
- [Locating and Displaying Recognized Text](https://developer.apple.com/documentation/vision/locating-and-displaying-recognized-text)

### 12.2 示例项目

- [Apple Sample Code: Locating and displaying recognized text](https://developer.apple.com/documentation/vision/locating-and-displaying-recognized-text)
- [Apple Sample Code: Extracting phone numbers from text in images](https://developer.apple.com/documentation/vision/extracting-phone-numbers-from-text-in-images)

### 12.3 WWDC 视频

- WWDC 2019: [Vision Framework: Understanding Images](https://developer.apple.com/videos/play/wwdc2019/222/)
- WWDC 2021: [Extract document data using Vision](https://developer.apple.com/videos/play/wwdc2021/10041/)
- WWDC 2024: [Discover Swift enhancements in the Vision framework](https://developer.apple.com/videos/play/wwdc2024/10163/)

---

*文档版本: 1.0*
*创建日期: 2025-01-29*
*适用项目: SyncNos macOS*

