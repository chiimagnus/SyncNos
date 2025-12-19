import SwiftUI
import UniformTypeIdentifiers

/// OCR 设置视图（硅基流动 DeepSeek-OCR）
struct OCRSettingsView: View {
    @StateObject private var viewModel = OCRSettingsViewModel()
    
    var body: some View {
        Form {
            // MARK: - API Key 配置
            Section {
                SecureField("硅基流动 API Key", text: $viewModel.apiKey)
                    .textFieldStyle(.roundedBorder)
                
                HStack {
                    Button("测试连接") {
                        Task {
                            await viewModel.testConnection()
                        }
                    }
                    .disabled(viewModel.apiKey.isEmpty || viewModel.isTesting)
                    
                    if viewModel.isTesting {
                        ProgressView()
                            .scaleEffect(0.8)
                    }
                    
                    Spacer()
                    
                    Link("获取 API Key", destination: URL(string: "https://cloud.siliconflow.cn")!)
                        .font(.caption)
                }
                
                if let result = viewModel.testResult {
                    HStack {
                        Image(systemName: result.success ? "checkmark.circle.fill" : "xmark.circle.fill")
                            .foregroundColor(result.success ? .green : .red)
                        Text(result.message)
                            .foregroundColor(result.success ? .green : .red)
                            .font(.caption)
                    }
                }
            } header: {
                Text("硅基流动 API 配置")
            } footer: {
                Text("模型: deepseek-ai/DeepSeek-OCR")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            // MARK: - 测试识别
            Section {
                Picker("识别模式", selection: $viewModel.recognitionMode) {
                    Text("微信聊天解析").tag(OCRRecognitionMode.wechatChat)
                    Text("带 BBox 识别").tag(OCRRecognitionMode.withBBox)
                    Text("纯文字识别").tag(OCRRecognitionMode.plainText)
                }
                .pickerStyle(.segmented)
                
                Button("选择图片测试 OCR") {
                    viewModel.showImagePicker = true
                }
                .disabled(!viewModel.isConfigured)
                
                if viewModel.isRecognizing {
                    HStack {
                        ProgressView()
                            .scaleEffect(0.8)
                        Text("正在识别...")
                            .foregroundColor(.secondary)
                    }
                }
                
                if let image = viewModel.testImage {
                    Image(nsImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(maxHeight: 200)
                        .cornerRadius(8)
                }
                
                if let result = viewModel.ocrResult {
                    GroupBox("识别结果") {
                        ScrollView {
                            Text(result)
                                .font(.system(.body, design: .monospaced))
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .frame(maxHeight: 300)
                    }
                }
                
                if let error = viewModel.ocrError {
                    Text(error)
                        .foregroundColor(.red)
                        .font(.caption)
                }
            } header: {
                Text("测试识别")
            } footer: {
                switch viewModel.recognitionMode {
                case .wechatChat:
                    Text("解析微信聊天截图，输出结构化消息列表")
                case .withBBox:
                    Text("使用 <|grounding|> 模式，输出每个文本块的位置信息")
                case .plainText:
                    Text("纯文字识别，不解析位置信息")
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("OCR 设置")
        .fileImporter(
            isPresented: $viewModel.showImagePicker,
            allowedContentTypes: [.image],
            allowsMultipleSelection: false
        ) { result in
            viewModel.handleImageSelection(result)
        }
        .onAppear {
            viewModel.loadSettings()
        }
        .onDisappear {
            viewModel.saveSettings()
        }
    }
}

// MARK: - Recognition Mode

enum OCRRecognitionMode {
    case wechatChat   // 微信聊天解析
    case withBBox     // 带 BBox 识别
    case plainText    // 纯文字识别
}

// MARK: - View Model

@MainActor
class OCRSettingsViewModel: ObservableObject {
    // MARK: - Published Properties
    @Published var apiKey: String = ""
    @Published var recognitionMode: OCRRecognitionMode = .wechatChat
    
    @Published var isTesting: Bool = false
    @Published var testResult: TestResult?
    
    @Published var showImagePicker: Bool = false
    @Published var testImage: NSImage?
    @Published var isRecognizing: Bool = false
    @Published var ocrResult: String?
    @Published var ocrError: String?
    
    // MARK: - Dependencies
    private var configStore: OCRConfigStoreProtocol
    private let ocrService: OCRAPIServiceProtocol
    private let logger: LoggerServiceProtocol
    
    // MARK: - Computed Properties
    var isConfigured: Bool {
        !apiKey.isEmpty
    }
    
    // MARK: - Types
    struct TestResult {
        let success: Bool
        let message: String
    }
    
    // MARK: - Init
    init() {
        self.configStore = DIContainer.shared.ocrConfigStore
        self.ocrService = DIContainer.shared.ocrAPIService
        self.logger = DIContainer.shared.loggerService
    }
    
    // MARK: - Public Methods
    
    func loadSettings() {
        apiKey = configStore.apiKey ?? ""
    }
    
    func saveSettings() {
        configStore.apiKey = apiKey.isEmpty ? nil : apiKey
    }
    
    func testConnection() async {
        isTesting = true
        testResult = nil
        
        // 先保存配置
        saveSettings()
        
        do {
            let success = try await ocrService.testConnection()
            testResult = TestResult(
                success: success,
                message: success ? "连接成功！" : "连接失败"
            )
        } catch {
            testResult = TestResult(
                success: false,
                message: error.localizedDescription
            )
        }
        
        isTesting = false
    }
    
    func handleImageSelection(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            guard let url = urls.first else { return }
            
            // 获取安全访问权限
            guard url.startAccessingSecurityScopedResource() else {
                ocrError = "无法访问选择的文件"
                return
            }
            defer { url.stopAccessingSecurityScopedResource() }
            
            // 加载图片
            if let image = NSImage(contentsOf: url) {
                testImage = image
                ocrResult = nil
                ocrError = nil
                
                // 自动开始识别
                Task {
                    await recognizeImage(image)
                }
            } else {
                ocrError = "无法加载图片"
            }
            
        case .failure(let error):
            ocrError = error.localizedDescription
        }
    }
    
    func recognizeImage(_ image: NSImage) async {
        isRecognizing = true
        ocrResult = nil
        ocrError = nil
        
        // 确保配置已保存
        saveSettings()
        
        do {
            switch recognitionMode {
            case .wechatChat:
                let result = try await ocrService.recognizeWechatChat(image)
                ocrResult = formatWechatResult(result)
                
            case .withBBox:
                let result = try await ocrService.recognizeImageWithBBox(image)
                ocrResult = formatBBoxResult(result)
                
            case .plainText:
                let text = try await ocrService.recognizeImage(image, prompt: nil)
                ocrResult = "=== OCR 识别结果 ===\n\n\(text)"
            }
            
            logger.info("[OCR] Recognition completed successfully")
            
        } catch {
            ocrError = error.localizedDescription
            logger.error("[OCR] Recognition failed: \(error)")
        }
        
        isRecognizing = false
    }
    
    private func formatWechatResult(_ result: WechatOCRResult) -> String {
        var output = "=== 原始 OCR 结果 ===\n"
        output += result.rawText
        output += "\n\n=== 解析的消息 (\(result.messages.count) 条) ===\n"
        
        for (index, message) in result.messages.enumerated() {
            let direction = message.isFromMe ? "→" : "←"
            output += "\n[\(index + 1)] \(direction) \(message.sender): \(message.content)"
            if let time = message.timestamp {
                let formatter = DateFormatter()
                formatter.dateFormat = "HH:mm"
                output += " (\(formatter.string(from: time)))"
            }
        }
        
        if let usage = result.tokenUsage {
            output += "\n\n=== Token 使用量 ===\n"
            output += "Prompt: \(usage.promptTokens ?? 0), Completion: \(usage.completionTokens ?? 0), Total: \(usage.totalTokens ?? 0)"
        }
        
        return output
    }
    
    private func formatBBoxResult(_ result: OCRResultWithBBox) -> String {
        var output = "=== 原始 OCR 结果 (Grounding) ===\n"
        output += result.rawText
        output += "\n\n=== 解析的文本块 (\(result.textBlocks.count) 个) ===\n"
        
        for (index, block) in result.textBlocks.enumerated() {
            output += "\n[\(index + 1)] \(block.blockType.rawValue.uppercased())"
            output += "\n    文字: \(block.text)"
            output += "\n    坐标: [\(block.rawBbox.map { String($0) }.joined(separator: ", "))]"
            output += "\n    归一化: x=\(String(format: "%.3f", block.bbox.origin.x)), y=\(String(format: "%.3f", block.bbox.origin.y)), w=\(String(format: "%.3f", block.bbox.width)), h=\(String(format: "%.3f", block.bbox.height))"
        }
        
        if let usage = result.tokenUsage {
            output += "\n\n=== Token 使用量 ===\n"
            output += "Prompt: \(usage.promptTokens ?? 0), Completion: \(usage.completionTokens ?? 0), Total: \(usage.totalTokens ?? 0)"
        }
        
        return output
    }
}

#Preview {
    OCRSettingsView()
        .frame(width: 500, height: 600)
}
