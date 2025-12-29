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

```swift
/// 将 Vision 归一化坐标转换为图像像素坐标
func convertToImageCoordinates(
    _ boundingBox: CGRect,
    imageSize: CGSize
) -> CGRect {
    // Vision 坐标系原点在左下角，需要翻转 Y 轴
    let x = boundingBox.origin.x * imageSize.width
    let y = (1 - boundingBox.origin.y - boundingBox.height) * imageSize.height
    let width = boundingBox.width * imageSize.width
    let height = boundingBox.height * imageSize.height
    
    return CGRect(x: x, y: y, width: width, height: height)
}

/// 使用 Apple 提供的便捷函数
import Vision

let imageRect = VNImageRectForNormalizedRect(
    boundingBox,
    Int(imageSize.width),
    Int(imageSize.height)
)
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

### 6.3 识别语言 (recognitionLanguages)

```swift
request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
```

**支持的语言**（macOS 14 / iOS 17）：

| 语言 | 代码 | 备注 |
|-----|------|------|
| 简体中文 | `zh-Hans` | 支持 |
| 繁体中文 | `zh-Hant` | 支持 |
| 英语 | `en-US` | 支持 |
| 日语 | `ja-JP` | 支持 |
| 韩语 | `ko-KR` | 支持 |
| 法语 | `fr-FR` | 支持 |
| 德语 | `de-DE` | 支持 |
| 西班牙语 | `es-ES` | 支持 |

**查询支持的语言**：

```swift
let supportedLanguages = try? VNRecognizeTextRequest.supportedRecognitionLanguages(
    for: .accurate,
    revision: VNRecognizeTextRequestRevision3
)
```

**重要限制**：
- 中文（简体/繁体）只能与英语混合使用
- 不能同时使用中文和日语

### 6.4 自定义词汇 (customWords)

```swift
request.customWords = ["微信", "WeChat", "SyncNos"]
```

添加领域特定词汇，提高识别准确率。仅在 `usesLanguageCorrection = true` 时生效。

### 6.5 最小文字高度 (minimumTextHeight)

```swift
request.minimumTextHeight = 0.02  // 相对于图像高度的比例
```

过滤过小的文字，减少噪声。

### 6.6 版本控制 (revision)

```swift
request.revision = VNRecognizeTextRequestRevision3
```

| 版本 | 引入系统 | 特点 |
|-----|---------|------|
| `Revision1` | macOS 10.15 | 基础版本 |
| `Revision2` | macOS 11.0 | 改进中文支持 |
| `Revision3` | macOS 14.0 | 最新，最佳性能 |

---

## 7. 与 PaddleOCR 对比

### 7.1 功能对比

| 功能 | Apple Vision | PaddleOCR |
|-----|-------------|-----------|
| 中文识别 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 英文识别 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 手写识别 | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| 表格识别 | ❌ | ⭐⭐⭐⭐ |
| 版面分析 | ❌ | ⭐⭐⭐⭐⭐ |
| 公式识别 | ❌ | ⭐⭐⭐⭐ |
| BBox 精度 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 速度 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| 离线可用 | ✅ | ✅（需部署） |
| 隐私保护 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |

### 7.2 性能对比（Apple Silicon M1）

| 指标 | Apple Vision | PaddleOCR (云端) |
|-----|-------------|-----------------|
| 1080p 图片 | ~200-500ms | ~1-3s |
| 4K 图片 | ~500-1000ms | ~2-5s |
| 内存占用 | ~50MB | N/A |

### 7.3 聊天截图场景适用性

对于 SyncNos 的聊天截图 OCR 场景：

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

### 8.2 与现有 PaddleOCR 响应对比

**PaddleOCR 响应格式**：

```json
{
  "result": {
    "layoutParsingResults": [{
      "prunedResult": {
        "parsing_res_list": [{
          "block_bbox": [54, 873, 432, 906],
          "block_content": "你好，今天天气真好",
          "block_label": "text",
          "block_id": 0
        }]
      }
    }]
  }
}
```

**Vision 框架等效输出**：

```json
{
  "blocks": [{
    "text": "你好，今天天气真好",
    "label": "text",
    "bbox": { "x": 54, "y": 873, "width": 378, "height": 33 }
  }]
}
```

**结论**：Vision 框架返回的数据可以直接映射到现有的 `OCRBlock` 结构，无需修改 `ChatOCRParser`。

---

## 9. 迁移到 Vision 框架

### 9.1 代码变更点

| 文件 | 变更类型 | 描述 |
|-----|---------|------|
| 新增 `VisionOCRService.swift` | 新增 | Vision OCR 实现 |
| `DIContainer.swift` | 修改 | 添加 Vision 服务注册 |
| `OCRConfigStore.swift` | 修改 | 添加引擎选择配置 |
| `ChatViewModel.swift` | 最小改动 | 切换 OCR 服务提供者 |

### 9.2 兼容性保证

现有的 `OCRAPIServiceProtocol` 协议：

```swift
protocol OCRAPIServiceProtocol {
    func recognize(_ image: NSImage) async throws -> OCRResult
    func recognizeWithRaw(_ image: NSImage, config: OCRRequestConfig) async throws -> (result: OCRResult, rawResponse: Data, requestJSON: Data)
    func testConnection() async throws -> Bool
}
```

Vision 实现完全遵循此协议，无需修改上层代码。

### 9.3 配置切换

```swift
// OCRConfigStore.swift 添加
enum OCREngine: String, Codable {
    case vision = "vision"
    case paddleOCR = "paddleocr"
}

@AppStorage("ocr.engine") var engine: OCREngine = .vision
```

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

**保留 PaddleOCR 云端 API 作为可选高级功能**，供需要更高精度或复杂版面分析的用户使用。

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

