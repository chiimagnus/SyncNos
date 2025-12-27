import SwiftUI
import UniformTypeIdentifiers

/// OCR 设置视图（PaddleOCR-VL）
struct OCRSettingsView: View {
    @StateObject private var viewModel = OCRSettingsViewModel()
    @AppStorage("datasource.chats.enabled") private var chatsSourceEnabled: Bool = false
    
    var body: some View {
        Form {
            // MARK: - 数据源开关
            Section {
                Toggle(isOn: $chatsSourceEnabled) {
                    Text("Enable Chats source")
                        .scaledFont(.body)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .help("Show Chats in the main list")
            } header: {
                Text("Data Source")
            }
            
            // MARK: - API 配置
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    TextField("API URL", text: $viewModel.apiURL)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(.body, design: .monospaced))
                        .autocorrectionDisabled()
                        .textSelection(.enabled)
                }

                VStack(alignment: .leading, spacing: 8) {
                    SecureField("API Token", text: $viewModel.token)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(.body, design: .monospaced))
                        .autocorrectionDisabled()
                        .textSelection(.enabled)
                }
                
                Link("获取 API URL 和 Token", destination: URL(string: "https://aistudio.baidu.com/paddleocr/task")!)
                    .font(.caption)
                
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
                Text("PaddleOCR-VL API 配置")
            } footer: {
                Text("PaddleOCR-VL 支持 109 种语言，可识别文本、表格、公式和图表")
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
                    VStack(alignment: .leading, spacing: 8) {
                        // 显示 Markdown 结果（如果有）
                        if let markdown = result.markdownText, !markdown.isEmpty {
                            GroupBox("Markdown 结果") {
                                ScrollView {
                                    Text(markdown)
                                        .font(.system(.caption, design: .monospaced))
                                        .textSelection(.enabled)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                .frame(maxHeight: 200)
                            }
                        }
                        
                        // 显示识别的 Blocks
                        GroupBox("识别内容 (\(result.blocks.count) 个区块)") {
                            ScrollView {
                                VStack(alignment: .leading, spacing: 4) {
                                    ForEach(result.blocks) { block in
                                        HStack(alignment: .top) {
                                            Text("[\(block.label)]")
                                                .font(.caption2)
                                                .foregroundColor(.secondary)
                                                .frame(width: 60, alignment: .leading)
                                            Text(block.text)
                                                .font(.caption)
                                                .textSelection(.enabled)
                                        }
                                        Divider()
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .frame(maxHeight: 200)
                        }
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
    @Published var apiURL: String = "" {
        didSet { configStore.apiURL = apiURL.isEmpty ? nil : apiURL }
    }
    @Published var token: String = "" {
        didSet { configStore.token = token.isEmpty ? nil : token }
    }
    
    @Published var isTesting = false
    @Published var testResult: TestResult?
    
    @Published var showImagePicker = false
    @Published var testImage: NSImage?
    @Published var isRecognizing = false
    @Published var ocrResult: OCRResult?
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
        
        self.apiURL = configStore.apiURL ?? ""
        self.token = configStore.token ?? ""
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
            let result = try await ocrService.recognize(image)
            ocrResult = result
            logger.info("[OCR] Recognition completed: \(result.blocks.count) blocks")
        } catch {
            ocrError = error.localizedDescription
            logger.error("[OCR] Recognition failed: \(error)")
        }
        
        isRecognizing = false
    }
}

#Preview {
    OCRSettingsView()
        .frame(width: 500, height: 700)
}
