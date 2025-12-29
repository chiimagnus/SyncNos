import SwiftUI

/// OCR 设置视图
struct OCRSettingsView: View {
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
            
            // MARK: - OCR 引擎信息
            Section {
                HStack(spacing: 12) {
                    Image(systemName: "eye")
                        .font(.title2)
                        .foregroundStyle(.blue)
                    
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Apple Vision")
                            .font(.headline)
                        Text("Native macOS OCR, offline, no configuration required")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    
                    Spacer()
                    
                    Label("Ready", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .font(.caption)
                }
                .padding(.vertical, 4)
            } header: {
                Text("OCR Engine")
            } footer: {
                Text("Apple Vision uses the built-in macOS text recognition. Supports Chinese (Simplified & Traditional) and English.")
            }
            
            // MARK: - 支持的语言
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    LanguageRow(name: "Chinese (Simplified)", code: "zh-Hans")
                    LanguageRow(name: "Chinese (Traditional)", code: "zh-Hant")
                    LanguageRow(name: "English", code: "en-US")
                }
            } header: {
                Text("Supported Languages")
            }
        }
        .formStyle(.grouped)
        .navigationTitle("OCR Settings")
    }
}

// MARK: - Language Row

private struct LanguageRow: View {
    let name: String
    let code: String
    
    var body: some View {
        HStack {
            Text(name)
                .font(.body)
            Spacer()
            Text(code)
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 8)
                .padding(.vertical, 2)
                .background(Color.secondary.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 4))
        }
    }
}

#Preview {
    OCRSettingsView()
        .frame(width: 500, height: 400)
}
