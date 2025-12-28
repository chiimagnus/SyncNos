import SwiftUI

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
                
                Link("Get API URL and Token", destination: URL(string: "https://aistudio.baidu.com/paddleocr/task")!)
                    .font(.caption)
                
                HStack {
                    Button("Test Connection") {
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
                Text("PaddleOCR-VL API Configuration")
            } footer: {
                Text("PaddleOCR-VL supports 109 languages, recognizing text, tables, formulas, and charts")
            }
        }
        .formStyle(.grouped)
        .navigationTitle("OCR Settings")
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
            testResult = TestResult(success: success, message: success ? "Connection successful" : "Connection failed")
        } catch {
            testResult = TestResult(success: false, message: error.localizedDescription)
        }
        
        isTesting = false
    }
}

#Preview {
    OCRSettingsView()
        .frame(width: 500, height: 700)
}
