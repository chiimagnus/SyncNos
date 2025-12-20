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
                        Task { await viewModel.testConnection() }
                    }
                    .disabled(viewModel.apiKey.isEmpty || viewModel.isTesting)
                    
                    if viewModel.isTesting {
                        ProgressView().scaleEffect(0.8)
                    }
                    
                    Spacer()
                    
                    Link("获取 API Key", destination: URL(string: "https://cloud.siliconflow.cn")!)
                        .font(.caption)
                }
                
                if let result = viewModel.testResult {
                    Label(result.message, systemImage: result.success ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .foregroundColor(result.success ? .green : .red)
                        .font(.caption)
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
                Picker("识别模式", selection: $viewModel.useGrounding) {
                    Text("Free OCR（纯文字）").tag(false)
                    Text("Grounding（带 bbox）").tag(true)
                }
                .pickerStyle(.segmented)
                
                Button("选择图片测试") {
                    viewModel.showImagePicker = true
                }
                .disabled(!viewModel.isConfigured)
                
                if viewModel.isRecognizing {
                    HStack {
                        ProgressView().scaleEffect(0.8)
                        Text("正在识别...")
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
                                .font(.system(.caption, design: .monospaced))
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .frame(maxHeight: 300)
                    }
                }
                
                if let error = viewModel.ocrError {
                    Text(error).foregroundColor(.red).font(.caption)
                }
            } header: {
                Text("测试识别")
            } footer: {
                Text(viewModel.useGrounding 
                    ? "输出格式: <|ref|>文字<|/ref|><|det|>[[x1,y1,x2,y2]]<|/det|>" 
                    : "纯文字输出，无位置信息")
                    .font(.caption2)
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
        .onAppear { viewModel.loadSettings() }
        .onDisappear { viewModel.saveSettings() }
    }
}

// MARK: - View Model

@MainActor
class OCRSettingsViewModel: ObservableObject {
    @Published var apiKey: String = ""
    @Published var useGrounding: Bool = false
    
    @Published var isTesting: Bool = false
    @Published var testResult: TestResult?
    
    @Published var showImagePicker: Bool = false
    @Published var testImage: NSImage?
    @Published var isRecognizing: Bool = false
    @Published var ocrResult: String?
    @Published var ocrError: String?
    
    private var configStore: OCRConfigStoreProtocol
    private let ocrService: OCRAPIServiceProtocol
    private let logger: LoggerServiceProtocol
    
    var isConfigured: Bool { !apiKey.isEmpty }
    
    struct TestResult {
        let success: Bool
        let message: String
    }
    
    init() {
        self.configStore = DIContainer.shared.ocrConfigStore
        self.ocrService = DIContainer.shared.ocrAPIService
        self.logger = DIContainer.shared.loggerService
    }
    
    func loadSettings() {
        apiKey = configStore.apiKey ?? ""
    }
    
    func saveSettings() {
        configStore.apiKey = apiKey.isEmpty ? nil : apiKey
    }
    
    func testConnection() async {
        isTesting = true
        testResult = nil
        saveSettings()
        
        do {
            let success = try await ocrService.testConnection()
            testResult = TestResult(success: success, message: success ? "连接成功" : "连接失败")
        } catch {
            testResult = TestResult(success: false, message: error.localizedDescription)
        }
        
        isTesting = false
    }
    
    func handleImageSelection(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            guard let url = urls.first else { return }
            guard url.startAccessingSecurityScopedResource() else {
                ocrError = "无法访问文件"
                return
            }
            defer { url.stopAccessingSecurityScopedResource() }
            
            if let image = NSImage(contentsOf: url) {
                testImage = image
                ocrResult = nil
                ocrError = nil
                Task { await recognizeImage(image) }
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
        saveSettings()
        
        do {
            if useGrounding {
                let result = try await ocrService.recognizeWithGrounding(image)
                ocrResult = formatBBoxResult(result)
            } else {
                let text = try await ocrService.recognizeFreeOCR(image)
                ocrResult = text
            }
            logger.info("[OCR] Recognition completed")
        } catch {
            ocrError = error.localizedDescription
            logger.error("[OCR] Recognition failed: \(error)")
        }
        
        isRecognizing = false
    }
    
    private func formatBBoxResult(_ result: OCRResultWithBBox) -> String {
        var output = "=== 原始输出 ===\n\(result.rawText)\n\n"
        output += "=== 解析的文本块 (\(result.textBlocks.count) 个) ===\n"
        
        for (i, block) in result.textBlocks.enumerated() {
            output += "\n[\(i + 1)] \(block.text)"
            output += "\n    坐标: [\(block.rawBbox.map { String($0) }.joined(separator: ", "))]"
        }
        
        if let usage = result.tokenUsage {
            output += "\n\n=== Token ===\nTotal: \(usage.totalTokens ?? 0)"
        }
        
        return output
    }
}

#Preview {
    OCRSettingsView()
        .frame(width: 500, height: 600)
}
