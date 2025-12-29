import SwiftUI

/// OCR 设置视图
struct OCRSettingsView: View {
    @AppStorage("datasource.chats.enabled") private var chatsSourceEnabled: Bool = false
    @StateObject private var configStore = OCRConfigStore.shared
    @State private var showingLanguageSheet = false
    
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
                        Text("Native macOS OCR • Offline • 30 languages")
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
            }
            
            // MARK: - 语言设置
            Section {
                // 语言模式选择
                Picker("Detection Mode", selection: $configStore.languageMode) {
                    ForEach(OCRLanguageMode.allCases, id: \.self) { mode in
                        Text(mode.displayName).tag(mode)
                    }
                }
                .pickerStyle(.menu)
                
                // 手动模式下显示语言选择
                if configStore.languageMode == .manual {
                    Button {
                        showingLanguageSheet = true
                    } label: {
                        HStack {
                            Text("Languages")
                            Spacer()
                            if configStore.selectedLanguages.isEmpty {
                                Text("None (using defaults)")
                                    .foregroundStyle(.secondary)
                            } else {
                                Text(configStore.selectedLanguages.prefix(3).map(\.code).joined(separator: ", "))
                                    .foregroundStyle(.secondary)
                                if configStore.selectedLanguages.count > 3 {
                                    Text("+\(configStore.selectedLanguages.count - 3)")
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Image(systemName: "chevron.right")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                        }
                    }
                    .buttonStyle(.plain)
                }
            } header: {
                Text("Language")
            } footer: {
                if configStore.languageMode == .automatic {
                    Text("Vision automatically detects languages in the image.")
                } else {
                    Text("Select specific languages for better accuracy. Note: Chinese and Japanese cannot be used together.")
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("OCR Settings")
        .sheet(isPresented: $showingLanguageSheet) {
            LanguageSelectionSheet(configStore: configStore)
        }
    }
}

// MARK: - Language Selection Sheet

private struct LanguageSelectionSheet: View {
    @ObservedObject var configStore: OCRConfigStore
    @Environment(\.dismiss) private var dismiss
    @State private var searchText = ""
    
    private var filteredGroups: [(String, [OCRLanguage])] {
        let allGroups = OCRLanguage.groupedLanguages()
        
        if searchText.isEmpty {
            return allGroups
        }
        
        return allGroups.compactMap { (groupName, languages) in
            let filtered = languages.filter { language in
                language.name.localizedCaseInsensitiveContains(searchText) ||
                language.localizedName.localizedCaseInsensitiveContains(searchText) ||
                language.code.localizedCaseInsensitiveContains(searchText)
            }
            return filtered.isEmpty ? nil : (groupName, filtered)
        }
    }
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Button("Cancel") {
                    dismiss()
                }
                
                Spacer()
                
                Text("Select Languages")
                    .font(.headline)
                
                Spacer()
                
                Button("Done") {
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
            }
            .padding()
            
            // Search
            TextField("Search languages...", text: $searchText)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal)
                .padding(.bottom, 8)
            
            // Selected count
            if !configStore.selectedLanguageCodes.isEmpty {
                HStack {
                    Text("\(configStore.selectedLanguageCodes.count) language(s) selected")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    
                    Spacer()
                    
                    Button("Clear All") {
                        configStore.selectedLanguageCodes = []
                    }
                    .font(.caption)
                    .buttonStyle(.borderless)
                }
                .padding(.horizontal)
                .padding(.bottom, 4)
            }
            
            Divider()
            
            // Language List
            List {
                ForEach(filteredGroups, id: \.0) { group in
                    Section(group.0) {
                        ForEach(group.1) { language in
                            LanguageToggleRow(
                                language: language,
                                isSelected: configStore.selectedLanguageCodes.contains(language.code)
                            ) {
                                configStore.toggleLanguage(language.code)
                            }
                        }
                    }
                }
            }
            .listStyle(.inset)
        }
        .frame(width: 420, height: 500)
    }
}

// MARK: - Language Toggle Row

private struct LanguageToggleRow: View {
    let language: OCRLanguage
    let isSelected: Bool
    let onToggle: () -> Void
    
    var body: some View {
        Button {
            onToggle()
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(language.name)
                        .font(.body)
                        .foregroundStyle(.primary)
                    Text(language.localizedName)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                
                Spacer()
                
                Text(language.code)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.secondary.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(isSelected ? .blue : .secondary)
                    .font(.title3)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    OCRSettingsView()
        .frame(width: 500, height: 400)
}
