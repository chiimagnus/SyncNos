import SwiftUI

/// OCR 设置视图
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
            
            // MARK: - OCR 引擎选择
            Section {
                Picker("OCR Engine", selection: $viewModel.selectedEngine) {
                    ForEach(OCREngineType.allCases, id: \.self) { engine in
                        HStack {
                            Image(systemName: engine.iconName)
                            Text(engine.displayName)
                        }
                        .tag(engine)
                    }
                }
                .pickerStyle(.radioGroup)
                
                // 引擎描述
                HStack(spacing: 8) {
                    Image(systemName: viewModel.selectedEngine.iconName)
                        .foregroundStyle(.secondary)
                    Text(viewModel.selectedEngine.description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 4)
                
                // 状态指示器
                HStack {
                    if viewModel.selectedEngine == .vision {
                        Label("Ready to use", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                            .font(.caption)
                    } else if viewModel.isPaddleOCRConfigured {
                        Label("Configured", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                            .font(.caption)
                    } else {
                        Label("Configuration required", systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                            .font(.caption)
                    }
                    Spacer()
                }
            } header: {
                Text("OCR Engine")
            } footer: {
                Text("Apple Vision is built-in and works offline. PaddleOCR requires API configuration but supports more languages and features.")
            }
            
            // MARK: - PaddleOCR API 配置
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
                    .disabled(!viewModel.isPaddleOCRConfigured || viewModel.isTesting)
                    
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
            .disabled(viewModel.selectedEngine != .paddleOCR)
            .opacity(viewModel.selectedEngine == .paddleOCR ? 1.0 : 0.6)
        }
        .formStyle(.grouped)
        .navigationTitle("OCR Settings")
    }
}

// MARK: - View Model

@MainActor
final class OCRSettingsViewModel: ObservableObject {
    @Published var selectedEngine: OCREngineType {
        didSet { configStore.selectedEngine = selectedEngine }
    }
    
    @Published var apiURL: String = "" {
        didSet { configStore.apiURL = apiURL.isEmpty ? nil : apiURL }
    }
    @Published var token: String = "" {
        didSet { configStore.token = token.isEmpty ? nil : token }
    }
    
    @Published var isTesting = false
    @Published var testResult: TestResult?
    
    private let configStore: OCRConfigStore
    private let logger: LoggerServiceProtocol
    
    var isConfigured: Bool { configStore.isConfigured }
    var isPaddleOCRConfigured: Bool { configStore.isPaddleOCRConfigured }
    
    struct TestResult {
        let success: Bool
        let message: String
    }
    
    init() {
        self.configStore = OCRConfigStore.shared
        self.logger = DIContainer.shared.loggerService
        
        self.selectedEngine = configStore.selectedEngine
        self.apiURL = configStore.apiURL ?? ""
        self.token = configStore.token ?? ""
    }
    
    func testConnection() async {
        isTesting = true
        testResult = nil
        
        do {
            // 根据当前选择的引擎进行测试
            let service: OCRAPIServiceProtocol
            switch selectedEngine {
            case .vision:
                service = DIContainer.shared.visionOCRService
            case .paddleOCR:
                service = DIContainer.shared.paddleOCRService
            }
            
            let success = try await service.testConnection()
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
