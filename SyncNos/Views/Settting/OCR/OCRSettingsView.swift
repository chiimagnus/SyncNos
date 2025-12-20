import SwiftUI
import UniformTypeIdentifiers

/// OCR 设置视图
struct OCRSettingsView: View {
    @StateObject private var viewModel = OCRSettingsViewModel()
    
    var body: some View {
        Form {
            // MARK: - Provider 选择
            Section {
                Picker("OCR 服务", selection: $viewModel.provider) {
                    ForEach(OCRProvider.allCases) { provider in
                        Text(provider.displayName).tag(provider)
                    }
                }
                .pickerStyle(.menu)
            } header: {
                Text("OCR 服务提供商")
            }
            
            // MARK: - API Key 配置
            Section {
                if viewModel.provider == .deepseekOCR {
                    SecureField("硅基流动 API Key", text: $viewModel.deepseekApiKey)
                        .textFieldStyle(.roundedBorder)
                    
                    Link("获取 API Key", destination: URL(string: "https://cloud.siliconflow.cn")!)
                        .font(.caption)
                } else {
                    SecureField("百度 AI Studio API Key", text: $viewModel.paddleApiKey)
                        .textFieldStyle(.roundedBorder)
                    
                    Link("获取 API Key", destination: URL(string: "https://www.paddleocr.com")!)
                        .font(.caption)
                }
                
                HStack {
                    Button("测试连接") {
                        Task { await viewModel.testConnection() }
                    }
                    .disabled(!viewModel.isConfigured || viewModel.isTesting)
                    
                    if viewModel.isTesting {
                        ProgressView().scaleEffect(0.8)
                    }
                    
                    Spacer()
                }
                
                if let result = viewModel.testResult {
                    Label(result.message, systemImage: result.success ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .foregroundColor(result.success ? .green : .red)
                        .font(.caption)
                }
            } header: {
                Text("API 配置")
            } footer: {
                if viewModel.provider == .deepseekOCR {
                    Text("模型: deepseek-ai/DeepSeek-OCR")
                } else {
                    Text("模型: PP-OCRv5 (通用 OCR)")
                }
            }
            
            // MARK: - 测试识别
            Section {
                Button("选择图片测试 OCR") {
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
    }
}

// MARK: - View Model

@MainActor
final class OCRSettingsViewModel: ObservableObject {
    @Published var provider: OCRProvider {
        didSet { configStore.provider = provider }
    }
    @Published var deepseekApiKey: String = "" {
        didSet { configStore.apiKey = deepseekApiKey.isEmpty ? nil : deepseekApiKey }
    }
    @Published var paddleApiKey: String = "" {
        didSet { configStore.paddleApiKey = paddleApiKey.isEmpty ? nil : paddleApiKey }
    }
    
    @Published var isTesting = false
    @Published var testResult: TestResult?
    
    @Published var showImagePicker = false
    @Published var testImage: NSImage?
    @Published var isRecognizing = false
    @Published var ocrResult: String?
    @Published var ocrError: String?
    
    private let configStore: OCRConfigStore
    private let ocrService: OCRAPIServiceProtocol
    private let logger: LoggerServiceProtocol
    
    var isConfigured: Bool { configStore.isConfigured }
    
    struct TestResult {
        let success: Bool
        let message: String
    }
    
    init() {
        self.configStore = OCRConfigStore.shared
        self.ocrService = DIContainer.shared.ocrAPIService
        self.logger = DIContainer.shared.loggerService
        
        self.provider = configStore.provider
        self.deepseekApiKey = configStore.apiKey ?? ""
        self.paddleApiKey = configStore.paddleApiKey ?? ""
    }
    
    func testConnection() async {
        isTesting = true
        testResult = nil
        
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
    
    private func recognizeImage(_ image: NSImage) async {
        isRecognizing = true
        ocrResult = nil
        ocrError = nil
        
        do {
            // 目前只支持 DeepSeek-OCR
            let text = try await ocrService.recognizeFreeOCR(image)
            ocrResult = text
            logger.info("[OCR] Recognition completed")
        } catch {
            ocrError = error.localizedDescription
            logger.error("[OCR] Recognition failed: \(error)")
        }
        
        isRecognizing = false
    }
}

#Preview {
    OCRSettingsView()
        .frame(width: 500, height: 600)
}
