# PaddleOCR 与 macOS Swift 应用集成方案技术文档

## 1. 概述

本文档详细分析将 PaddleOCR 集成到 SyncNos macOS 应用的可行方案，目标是让用户下载应用后即可使用 OCR 功能，无需手动部署后端服务。

### 当前架构

SyncNos 现有的 OCR 架构基于 **PaddleOCR-VL 云端 API**：

```
┌─────────────────┐      HTTP       ┌─────────────────────┐
│   SyncNos App   │  ──────────►   │   百度 PaddleOCR    │
│  (OCRAPIService)│  ◄──────────   │   云端 API 服务      │
└─────────────────┘    JSON        └─────────────────────┘
```

现有代码位置：
- `Services/DataSources-From/OCR/OCRAPIService.swift` - API 客户端
- `Services/DataSources-From/OCR/OCRModels.swift` - 数据模型
- `Services/DataSources-From/Chats/ChatOCRParser.swift` - 聊天解析器

---

## 2. 集成方案对比

| 方案 | 用户体验 | 开发复杂度 | App 体积 | 性能 | Mac App Store 兼容 |
|------|---------|-----------|---------|------|-------------------|
| **A: 嵌入 Python 运行时** | ⭐⭐ | ⭐ | +500MB~1GB | ⭐⭐⭐ | ❌ 不兼容 |
| **B: 本地 HTTP 服务** | ⭐⭐ | ⭐⭐ | +500MB | ⭐⭐⭐ | ❌ 不兼容 |
| **C: CoreML 模型转换** | ⭐⭐⭐⭐ | ⭐⭐⭐ | +50~150MB | ⭐⭐⭐⭐ | ✅ 兼容 |
| **D: ONNX Runtime** | ⭐⭐⭐ | ⭐⭐⭐ | +100~200MB | ⭐⭐⭐ | ⚠️ 部分兼容 |
| **E: Apple Vision 框架** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 0 | ⭐⭐⭐⭐⭐ | ✅ 兼容 |

---

## 3. 方案 A: 嵌入 Python 运行时

### 3.1 技术原理

将 Python 解释器和 PaddleOCR 依赖打包到 App Bundle 中，通过 `Process` 调用 Python 脚本。

### 3.2 实现步骤

#### Step 1: 创建独立 Python 环境

```bash
# 使用 pyinstaller 打包 PaddleOCR
pip install pyinstaller paddleocr

# 创建打包脚本
cat > ocr_server.py << 'EOF'
import sys
import json
from paddleocr import PaddleOCR

def main():
    image_path = sys.argv[1]
    ocr = PaddleOCR(use_angle_cls=True, lang='ch')
    result = ocr.ocr(image_path, cls=True)
    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    main()
EOF

# 打包为独立可执行文件
pyinstaller --onefile --add-data "paddleocr:paddleocr" ocr_server.py
```

#### Step 2: 集成到 Xcode 项目

```swift
// EmbeddedPaddleOCRService.swift
final class EmbeddedPaddleOCRService {
    private let executablePath: URL
    
    init() {
        // 可执行文件位于 App Bundle 的 Resources 目录
        self.executablePath = Bundle.main.resourceURL!
            .appendingPathComponent("ocr_server")
    }
    
    func recognize(_ imagePath: String) async throws -> OCRResult {
        let process = Process()
        process.executableURL = executablePath
        process.arguments = [imagePath]
        
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()
        
        try process.run()
        process.waitUntilExit()
        
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        return try parseResult(data)
    }
}
```

### 3.3 优缺点

**优点：**
- 完整支持 PaddleOCR 所有功能
- 离线可用

**缺点：**
- ❌ App 体积增加 500MB~1GB
- ❌ Mac App Store 不允许嵌入 Python 运行时
- ❌ 需要处理不同 macOS 版本兼容性
- ❌ 首次启动慢（需要解压/初始化）
- ❌ 沙盒限制可能导致问题

### 3.4 结论

**不推荐** - 不兼容 Mac App Store，且用户体验差。

---

## 4. 方案 B: 本地 HTTP 服务（进程内）

### 4.1 技术原理

将 PaddleOCR 打包为独立后台服务，App 启动时自动启动该服务，通过 HTTP localhost 通信。

### 4.2 架构设计

```
┌────────────────────────────────────────────────────────┐
│                    SyncNos.app                          │
├────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────┐     localhost:5001    ┌──────────┐│
│  │   Swift App     │  ◄─────────────────►  │ OCR      ││
│  │  (Main Process) │                       │ Server   ││
│  └─────────────────┘                       │ (子进程)  ││
│                                            └──────────┘│
└────────────────────────────────────────────────────────┘
```

### 4.3 实现代码

```swift
// LocalOCRServerManager.swift
import Foundation

final class LocalOCRServerManager {
    static let shared = LocalOCRServerManager()
    
    private var serverProcess: Process?
    private let port: Int = 5001
    
    var isRunning: Bool {
        serverProcess?.isRunning ?? false
    }
    
    func startServer() throws {
        guard !isRunning else { return }
        
        let serverPath = Bundle.main.resourceURL!
            .appendingPathComponent("paddle_ocr_server")
        
        serverProcess = Process()
        serverProcess?.executableURL = serverPath
        serverProcess?.arguments = ["--port", "\(port)"]
        
        // 重定向输出到日志
        let logPipe = Pipe()
        serverProcess?.standardOutput = logPipe
        serverProcess?.standardError = logPipe
        
        try serverProcess?.run()
        
        // 等待服务就绪
        try waitForServerReady()
    }
    
    func stopServer() {
        serverProcess?.terminate()
        serverProcess = nil
    }
    
    private func waitForServerReady(timeout: TimeInterval = 10) throws {
        let startTime = Date()
        while Date().timeIntervalSince(startTime) < timeout {
            if checkServerHealth() { return }
            Thread.sleep(forTimeInterval: 0.5)
        }
        throw OCRServiceError.serverStartupTimeout
    }
    
    private func checkServerHealth() -> Bool {
        guard let url = URL(string: "http://localhost:\(port)/health") else { return false }
        var request = URLRequest(url: url)
        request.timeoutInterval = 2
        
        let semaphore = DispatchSemaphore(value: 0)
        var isHealthy = false
        
        URLSession.shared.dataTask(with: request) { _, response, _ in
            isHealthy = (response as? HTTPURLResponse)?.statusCode == 200
            semaphore.signal()
        }.resume()
        
        semaphore.wait()
        return isHealthy
    }
}
```

### 4.4 Python 服务端代码

```python
# paddle_ocr_server.py
from flask import Flask, request, jsonify
from paddleocr import PaddleOCR
import base64
import io
from PIL import Image
import argparse

app = Flask(__name__)
ocr = None

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok"})

@app.route('/ocr', methods=['POST'])
def ocr_endpoint():
    try:
        data = request.json
        image_base64 = data.get('image')
        
        # 解码 Base64 图片
        image_data = base64.b64decode(image_base64)
        image = Image.open(io.BytesIO(image_data))
        
        # 执行 OCR
        result = ocr.ocr(image, cls=True)
        
        # 格式化返回
        blocks = []
        for line in result[0]:
            bbox = line[0]
            text = line[1][0]
            confidence = line[1][1]
            blocks.append({
                "bbox": [bbox[0][0], bbox[0][1], bbox[2][0], bbox[2][1]],
                "text": text,
                "confidence": confidence
            })
        
        return jsonify({
            "errorCode": 0,
            "blocks": blocks
        })
    except Exception as e:
        return jsonify({"errorCode": 1, "errorMsg": str(e)}), 500

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=5001)
    args = parser.parse_args()
    
    ocr = PaddleOCR(use_angle_cls=True, lang='ch')
    app.run(host='127.0.0.1', port=args.port, threaded=True)
```

### 4.5 优缺点

**优点：**
- 完整支持 PaddleOCR 功能
- 离线可用
- 可复用现有的 HTTP 通信代码

**缺点：**
- ❌ Mac App Store 不允许启动子进程服务
- ❌ App 体积增加约 500MB
- ❌ 需要管理子进程生命周期
- ❌ 沙盒限制

### 4.6 结论

**不推荐用于 App Store** - 但适合 **非 App Store 分发**（如 Homebrew、直接下载）。

---

## 5. 方案 C: CoreML 模型转换

### 5.1 技术原理

将 PaddleOCR 的模型转换为 CoreML 格式，直接在 Swift 中使用 Core ML 框架推理。

### 5.2 模型转换流程

```
PaddleOCR 模型 (.pdmodel)
         ↓
    Paddle2ONNX 转换
         ↓
    ONNX 模型 (.onnx)
         ↓
    CoreMLTools 转换
         ↓
    CoreML 模型 (.mlmodel/.mlpackage)
```

### 5.3 转换步骤

#### Step 1: 导出 PaddleOCR 模型

```bash
# 安装依赖
pip install paddleocr paddle2onnx coremltools

# 下载 PaddleOCR 预训练模型
wget https://paddleocr.bj.bcebos.com/PP-OCRv4/chinese/ch_PP-OCRv4_det_infer.tar
wget https://paddleocr.bj.bcebos.com/PP-OCRv4/chinese/ch_PP-OCRv4_rec_infer.tar
wget https://paddleocr.bj.bcebos.com/dygraph_v2.0/ch/ch_ppocr_mobile_v2.0_cls_infer.tar
```

#### Step 2: 转换为 ONNX

```python
# convert_to_onnx.py
import paddle2onnx

# 检测模型
paddle2onnx.command.c2o(
    model_dir="ch_PP-OCRv4_det_infer",
    model_filename="inference.pdmodel",
    params_filename="inference.pdiparams",
    save_file="ocr_det.onnx",
    opset_version=12
)

# 识别模型
paddle2onnx.command.c2o(
    model_dir="ch_PP-OCRv4_rec_infer",
    model_filename="inference.pdmodel",
    params_filename="inference.pdiparams",
    save_file="ocr_rec.onnx",
    opset_version=12
)
```

#### Step 3: 转换为 CoreML

```python
# convert_to_coreml.py
import coremltools as ct
import onnx

# 加载 ONNX 模型
onnx_model = onnx.load("ocr_det.onnx")

# 转换为 CoreML
coreml_model = ct.convert(
    onnx_model,
    source='onnx',
    minimum_deployment_target=ct.target.macOS14,
    convert_to="mlprogram"
)

coreml_model.save("OCRDetection.mlpackage")
```

### 5.4 Swift 集成代码

```swift
// CoreMLOCRService.swift
import CoreML
import Vision
import AppKit

final class CoreMLOCRService: OCRAPIServiceProtocol {
    private let detectionModel: VNCoreMLModel
    private let recognitionModel: VNCoreMLModel
    
    init() throws {
        let detConfig = MLModelConfiguration()
        detConfig.computeUnits = .all // 使用 GPU + ANE
        
        let detModel = try OCRDetection(configuration: detConfig)
        self.detectionModel = try VNCoreMLModel(for: detModel.model)
        
        let recModel = try OCRRecognition(configuration: detConfig)
        self.recognitionModel = try VNCoreMLModel(for: recModel.model)
    }
    
    func recognize(_ image: NSImage) async throws -> OCRResult {
        guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            throw OCRServiceError.invalidImage
        }
        
        // Step 1: 文本检测
        let detections = try await detectTextRegions(cgImage)
        
        // Step 2: 文本识别
        var blocks: [OCRBlock] = []
        for detection in detections {
            let text = try await recognizeText(in: cgImage, region: detection.bbox)
            blocks.append(OCRBlock(
                text: text,
                label: "text",
                bbox: detection.bbox
            ))
        }
        
        return OCRResult(
            rawText: blocks.map(\.text).joined(separator: "\n"),
            markdownText: nil,
            blocks: blocks,
            processedAt: Date(),
            coordinateSize: CGSize(width: cgImage.width, height: cgImage.height)
        )
    }
    
    private func detectTextRegions(_ image: CGImage) async throws -> [TextRegion] {
        // CoreML 检测实现
        // ...
    }
    
    private func recognizeText(in image: CGImage, region: CGRect) async throws -> String {
        // CoreML 识别实现
        // ...
    }
}
```

### 5.5 已知问题与挑战

1. **模型转换兼容性**
   - PaddleOCR 使用的某些算子可能不被 CoreML 支持
   - 需要自定义层或修改模型结构

2. **后处理逻辑**
   - OCR 的后处理（DBNet、CRNN 解码）需要用 Swift 重新实现

3. **模型大小**
   - PP-OCRv4 检测模型：~4.7MB
   - PP-OCRv4 识别模型：~10MB
   - 总计约 15-20MB（可接受）

### 5.6 现有开源项目

- **[ppocronnx](https://github.com/niconicodex/ppocronnx)** - PaddleOCR ONNX 版本
- **[PaddleOCR-CoreML](https://github.com/niconicodex/PaddleOCR-CoreML)** - 部分 CoreML 移植（非官方）

### 5.7 优缺点

**优点：**
- ✅ 完全离线
- ✅ 兼容 Mac App Store
- ✅ 利用 Apple Neural Engine 加速
- ✅ App 体积增加较少（~20-50MB）

**缺点：**
- ⚠️ 模型转换过程复杂，可能有兼容性问题
- ⚠️ 需要用 Swift 重新实现后处理逻辑
- ⚠️ 没有官方支持，需要自行维护
- ⚠️ 中文识别精度可能下降

### 5.8 结论

**可行但高成本** - 如果必须使用 PaddleOCR 且需要上架 App Store，这是唯一可行方案，但开发成本高。

---

## 6. 方案 D: ONNX Runtime

### 6.1 技术原理

使用 ONNX Runtime 直接在 macOS 上运行 PaddleOCR 的 ONNX 模型。

### 6.2 依赖

```swift
// Package.swift
dependencies: [
    .package(url: "https://github.com/niconicodex/onnxruntime-swift", from: "1.16.0")
]
```

### 6.3 实现示例

```swift
import OnnxRuntime

final class ONNXOCRService {
    private let session: ORTSession
    
    init() throws {
        let modelPath = Bundle.main.path(forResource: "ocr_det", ofType: "onnx")!
        let env = try ORTEnv(loggingLevel: .warning)
        let options = try ORTSessionOptions()
        try options.appendCoreMLExecutionProvider(with: [])
        self.session = try ORTSession(env: env, modelPath: modelPath, sessionOptions: options)
    }
    
    func recognize(_ image: NSImage) async throws -> OCRResult {
        // ONNX 推理实现
        // ...
    }
}
```

### 6.4 优缺点

**优点：**
- ✅ 保持 PaddleOCR 模型原生精度
- ✅ 支持 CoreML EP 加速
- ✅ 跨平台兼容

**缺点：**
- ⚠️ ONNX Runtime 库较大（~30-50MB）
- ⚠️ Mac App Store 审核可能有问题（动态库签名）
- ⚠️ 需要实现后处理逻辑

### 6.5 结论

**中等可行性** - 比 CoreML 转换简单，但 App Store 兼容性存疑。

---

## 7. 方案 E: Apple Vision 框架（推荐）

### 7.1 为什么推荐

考虑到 SyncNos 的以下需求：

1. **已上架 Mac App Store** - 需要完全兼容沙盒
2. **用户即装即用** - 无需配置后端
3. **主要处理中英文聊天截图** - 不需要复杂版面分析
4. **现有代码依赖 bbox** - Vision 框架完全支持

**Apple Vision 框架是最佳选择。**

### 7.2 详细技术文档

请参阅 [Apple Vision OCR 技术文档](./Apple-Vision-OCR技术文档.md)。

---

## 8. 最终建议

### 8.1 推荐方案

**采用 Apple Vision 框架替换 PaddleOCR**

理由：
1. ✅ 零依赖，无需增加 App 体积
2. ✅ 完全兼容 Mac App Store 沙盒
3. ✅ 用户即装即用，无需任何配置
4. ✅ 支持中英文识别，满足聊天截图场景
5. ✅ 返回完整的 bounding box 数据，兼容现有 `ChatOCRParser`
6. ✅ 利用 Apple Silicon 优化，性能优秀

### 8.2 迁移路径

```
Phase 1: 实现 VisionOCRService（遵循 OCRAPIServiceProtocol）
         ↓
Phase 2: 在 ChatOCRParser 中测试 Vision 输出的 bbox 精度
         ↓
Phase 3: 添加 OCR 引擎切换选项（Vision / PaddleOCR API）
         ↓
Phase 4: 默认使用 Vision，保留 PaddleOCR 作为高级选项
```

### 8.3 保留 PaddleOCR 的场景

如果用户需要：
- 更高的中文识别精度
- 复杂版面分析（表格、公式）
- 多语言混合识别

可以保留 PaddleOCR 云端 API 作为 **可选高级功能**。

---

## 9. 附录

### 9.1 PaddleOCR 官方资源

- GitHub: https://github.com/PaddlePaddle/PaddleOCR
- 模型下载: https://paddleocr.bj.bcebos.com/
- API 文档: https://aistudio.baidu.com/paddleocr

### 9.2 相关开源项目

- [ppocronnx](https://github.com/niconicodex/ppocronnx) - PaddleOCR ONNX
- [onnxruntime-swift](https://github.com/niconicodex/onnxruntime-swift) - Swift ONNX Runtime

### 9.3 Apple 文档

- [Vision Framework](https://developer.apple.com/documentation/vision)
- [VNRecognizeTextRequest](https://developer.apple.com/documentation/vision/vnrecognizetextrequest)
- [Core ML](https://developer.apple.com/documentation/coreml)

---

*文档版本: 1.0*
*创建日期: 2025-01-29*
*适用项目: SyncNos macOS*

