import SwiftUI
import AppKit

/// OCR 设置视图
struct OCRSettingsView: View {
    @AppStorage("datasource.chats.enabled") private var chatsSourceEnabled: Bool = false
    @AppStorage("autoSync.chats") private var autoSyncEnabled: Bool = false
    @ObservedObject private var configStore = OCRConfigStore.shared
    @State private var showingLanguageSheet = false
    @State private var showingDebugSheet = false
    
    var body: some View {
        List {
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
                    .scaledFont(.headline)
                    .foregroundStyle(.primary)
            }
            
            // MARK: - Sync Settings
            Section {
                Toggle(isOn: $autoSyncEnabled) {
                    Text("Smart Auto Sync")
                        .scaledFont(.body)
                }
                .toggleStyle(.switch)
                .controlSize(.mini)
                .help("Sync every 5 minutes")
            } header: {
                Text("Sync Settings")
                    .scaledFont(.headline)
                    .foregroundStyle(.primary)
            }
            
            // MARK: - OCR 设置
            Section {
                // OCR Languages
                Button {
                    showingLanguageSheet = true
                } label: {
                    HStack {
                        Text("OCR Languages")
                            .scaledFont(.body)
                        
                        Spacer()
                        
                        if configStore.selectedLanguages.isEmpty {
                            Text("Auto")
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
                
                // Test OCR Recognition
                Button {
                    showingDebugSheet = true
                } label: {
                    HStack {
                        Image(systemName: "ladybug")
                            .foregroundStyle(.orange)
                        Text("Test OCR Recognition")
                            .scaledFont(.body)
                        Spacer()
                    }
                }
                .buttonStyle(.plain)
            } header: {
                Text("Apple OCR")
                    .scaledFont(.headline)
                    .foregroundStyle(.primary)
            }
        }
        .listStyle(.sidebar)
        .scrollContentBackground(.hidden)
        .background(VisualEffectBackground(material: .windowBackground))
        .navigationTitle("Chats")
        .sheet(isPresented: $showingLanguageSheet) {
            LanguageSelectionSheet(configStore: configStore)
        }
        .sheet(isPresented: $showingDebugSheet) {
            OCRDebugSheet(configStore: configStore)
        }
    }
}

// MARK: - Language Selection Sheet

private struct LanguageSelectionSheet: View {
    @ObservedObject var configStore: OCRConfigStore
    @Environment(\.dismiss) private var dismiss
    @State private var searchText = ""
    
    /// 扁平化的语言列表（无分组）
    private var filteredLanguages: [OCRLanguage] {
        let allLanguages = OCRLanguage.allSupported
        
        if searchText.isEmpty {
            return allLanguages
        }
        
        return allLanguages.filter { language in
            language.name.localizedCaseInsensitiveContains(searchText) ||
            language.localizedName.localizedCaseInsensitiveContains(searchText) ||
            language.code.localizedCaseInsensitiveContains(searchText)
        }
    }
    
    var body: some View {
        NavigationStack {
            List {
                ForEach(filteredLanguages) { language in
                    LanguageToggleRow(
                        language: language,
                        isSelected: configStore.selectedLanguageCodes.contains(language.code)
                    ) {
                        configStore.toggleLanguage(language.code)
                    }
                }
            }
            .listStyle(.inset)
            .searchable(text: $searchText, prompt: "Search languages")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if !configStore.selectedLanguageCodes.isEmpty {
                        Button("Clear All") {
                            configStore.selectedLanguageCodes = []
                        }
                        .foregroundStyle(.secondary)
                    }
                }
                
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
                
                ToolbarItem(placement: .principal) {
                    if !configStore.selectedLanguageCodes.isEmpty {
                        Text("\(configStore.selectedLanguageCodes.count) selected")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .frame(width: 360, height: 480)
    }
}

// MARK: - Language Toggle Row

private struct LanguageToggleRow: View {
    let language: OCRLanguage
    let isSelected: Bool
    let onToggle: () -> Void
    
    var body: some View {
        Toggle(isOn: Binding(
            get: { isSelected },
            set: { _ in onToggle() }
        )) {
            Text(language.localizedName.isEmpty ? language.name : language.localizedName)
                .font(.body)
        }
        .toggleStyle(.checkbox)
    }
}

// MARK: - OCR Debug Sheet

private struct OCRDebugSheet: View {
    @ObservedObject var configStore: OCRConfigStore
    @Environment(\.dismiss) private var dismiss
    
    @State private var selectedImage: NSImage?
    @State private var ocrResult: OCRResult?
    @State private var parsedMessages: [ChatMessage] = []
    @State private var isProcessing = false
    @State private var errorMessage: String?
    @State private var processingTime: TimeInterval = 0
    @State private var detectedScripts: [String] = []
    
    private let ocrService = DIContainer.shared.ocrAPIService
    private let parser = ChatOCRParser()
    private let logger = DIContainer.shared.loggerService
    
    var body: some View {
        VStack(spacing: 0) {            
            // Content
            if let image = selectedImage {
                HSplitView {
                    // 左侧：图片预览
                    VStack {
                        Text("Input Image")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        
                        Image(nsImage: image)
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .background(Color.secondary.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        
                        if let size = selectedImage?.size {
                            Text("\(Int(size.width)) × \(Int(size.height)) px")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding()
                    .frame(minWidth: 300)
                    
                    // 右侧：识别结果
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Recognition Results")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        
                        if isProcessing {
                            VStack(spacing: 12) {
                                ProgressView()
                                    .progressViewStyle(.circular)
                                Text("Processing...")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        } else if let error = errorMessage {
                            VStack(spacing: 12) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .font(.largeTitle)
                                    .foregroundStyle(.red)
                                Text(error)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .multilineTextAlignment(.center)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        } else if let result = ocrResult {
                            ScrollView {
                                VStack(alignment: .leading, spacing: 16) {
                                    // 统计信息（合并 OCR 和解析统计）
                                    GroupBox("Statistics") {
                                        VStack(alignment: .leading, spacing: 8) {
                                            // OCR 统计
                                            StatRow(label: "OCR Blocks", value: "\(result.blocks.count)")
                                            StatRow(label: "Processing Time", value: String(format: "%.2fs", processingTime))
                                            StatRow(
                                                label: "Languages",
                                                value: configStore.selectedLanguages.isEmpty
                                                    ? "Auto"
                                                    : configStore.selectedLanguages.map(\.code).joined(separator: ", ")
                                            )
                                            if !detectedScripts.isEmpty {
                                                StatRow(label: "Detected Scripts", value: detectedScripts.joined(separator: ", "))
                                            }
                                            
                                            Divider()
                                            
                                            // 解析统计（消息分类）
                                            HStack(spacing: 16) {
                                                Text("Parsed:")
                                                    .foregroundStyle(.secondary)
                                                messageStatBadge(
                                                    icon: "arrow.right.circle.fill",
                                                    color: .blue,
                                                    count: parsedMessages.filter(\.isFromMe).count,
                                                    label: "Me"
                                                )
                                                messageStatBadge(
                                                    icon: "arrow.left.circle.fill",
                                                    color: .green,
                                                    count: parsedMessages.filter { !$0.isFromMe && $0.kind != .system }.count,
                                                    label: "Other"
                                                )
                                                messageStatBadge(
                                                    icon: "info.circle.fill",
                                                    color: .orange,
                                                    count: parsedMessages.filter { $0.kind == .system }.count,
                                                    label: "System"
                                                )
                                                Spacer()
                                                Text("Total: \(parsedMessages.count)")
                                                    .fontWeight(.medium)
                                            }
                                            .font(.caption)
                                        }
                                        .padding(.vertical, 4)
                                    }
                                    
                                    // OCR Blocks + Parsed Messages 合并显示
                                    combinedResultsView(result: result)
                                }
                            }
                        } else {
                            VStack(spacing: 12) {
                                Image(systemName: "doc.text.magnifyingglass")
                                    .font(.largeTitle)
                                    .foregroundStyle(.secondary)
                                Text("Import an image to see OCR results")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                    }
                    .padding()
                    .frame(minWidth: 350)
                }
            } else {
                // 无图片时的占位视图
                VStack(spacing: 20) {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.system(size: 60))
                        .foregroundStyle(.secondary)
                    
                    Button {
                        selectImage()
                    } label: {
                        Label("Select Image", systemImage: "photo.badge.plus")
                    }
                    .buttonStyle(.borderedProminent)
                    .padding(.top, 8)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.secondary.opacity(0.05))
            }
        }
        .frame(width: 800, height: 600)
        .onDrop(of: [.image, .fileURL], isTargeted: nil) { providers in
            handleDrop(providers: providers)
            return true
        }
    }
    
    // MARK: - Sub Views
    
    /// 合并的 OCR Blocks + Parsed Messages 视图
    @ViewBuilder
    private func combinedResultsView(result: OCRResult) -> some View {
        GroupBox("Recognition Details") {
            if result.blocks.isEmpty && parsedMessages.isEmpty {
                Text("No content recognized")
                    .foregroundStyle(.secondary)
                    .italic()
                    .padding(.vertical, 4)
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    // 解析后的消息（主要展示）
                    if !parsedMessages.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Parsed Messages")
                                .font(.caption)
                                .fontWeight(.semibold)
                                .foregroundStyle(.secondary)
                            
                            ForEach(Array(parsedMessages.sorted { $0.order < $1.order }.enumerated()), id: \.element.id) { index, message in
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack(alignment: .top, spacing: 8) {
                                        // 方向指示器
                                        messageDirectionIndicator(message: message)
                                            .frame(width: 20)
                                        
                                        VStack(alignment: .leading, spacing: 2) {
                                            // 消息内容
                                            Text(message.content)
                                                .font(.system(.caption, design: .monospaced))
                                                .lineLimit(3)
                                                .foregroundStyle(message.kind == .system ? .secondary : .primary)
                                            
                                            // 元数据
                                            HStack(spacing: 8) {
                                                Text("order: \(message.order)")
                                                if let bbox = message.bbox {
                                                    Text("x: \(Int(bbox.minX))–\(Int(bbox.maxX))")
                                                }
                                                Text(message.kind.rawValue)
                                                    .padding(.horizontal, 4)
                                                    .padding(.vertical, 1)
                                                    .background(kindColor(message.kind).opacity(0.2))
                                                    .clipShape(RoundedRectangle(cornerRadius: 3))
                                            }
                                            .font(.caption2)
                                            .foregroundStyle(.tertiary)
                                        }
                                    }
                                }
                                
                                if index < parsedMessages.count - 1 {
                                    Divider()
                                }
                            }
                        }
                    }
                    
                    // OCR Blocks（可折叠的详细信息）
                    if !result.blocks.isEmpty {
                        DisclosureGroup {
                            VStack(alignment: .leading, spacing: 8) {
                                ForEach(Array(result.blocks.enumerated()), id: \.offset) { index, block in
                                    VStack(alignment: .leading, spacing: 4) {
                                        HStack {
                                            Text("[\(index + 1)]")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                                .frame(width: 30, alignment: .leading)
                                            
                                            Text(block.text)
                                                .font(.system(.caption, design: .monospaced))
                                                .lineLimit(2)
                                        }
                                        
                                        Text("bbox: (\(Int(block.bbox.origin.x)), \(Int(block.bbox.origin.y)), \(Int(block.bbox.width))×\(Int(block.bbox.height)))")
                                            .font(.caption2)
                                            .foregroundStyle(.tertiary)
                                            .padding(.leading, 30)
                                    }
                                    
                                    if index < result.blocks.count - 1 {
                                        Divider()
                                    }
                                }
                            }
                            .padding(.top, 8)
                        } label: {
                            Text("OCR Blocks (\(result.blocks.count))")
                                .font(.caption)
                                .fontWeight(.semibold)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }
    
    /// 消息统计徽章
    @ViewBuilder
    private func messageStatBadge(icon: String, color: Color, count: Int, label: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .foregroundStyle(color)
            Text("\(count)")
                .fontWeight(.medium)
            Text(label)
                .foregroundStyle(.secondary)
        }
        .font(.caption)
    }
    
    /// 消息方向指示器
    @ViewBuilder
    private func messageDirectionIndicator(message: ChatMessage) -> some View {
        Group {
            if message.kind == .system {
                Image(systemName: "info.circle.fill")
                    .foregroundStyle(.orange)
            } else if message.isFromMe {
                Image(systemName: "arrow.right.circle.fill")
                    .foregroundStyle(.blue)
            } else {
                Image(systemName: "arrow.left.circle.fill")
                    .foregroundStyle(.green)
            }
        }
        .font(.caption)
    }
    
    /// 消息类型颜色
    private func kindColor(_ kind: ChatMessageKind) -> Color {
        switch kind {
        case .system: return .orange
        case .text: return .blue
        case .image: return .purple
        case .voice: return .pink
        case .card: return .teal
        }
    }
    
    // MARK: - Actions
    
    private func selectImage() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.message = "Select an image to test OCR recognition"
        
        if panel.runModal() == .OK, let url = panel.url {
            loadImage(from: url)
        }
    }
    
    private func handleDrop(providers: [NSItemProvider]) {
        for provider in providers {
            if provider.canLoadObject(ofClass: NSImage.self) {
                provider.loadObject(ofClass: NSImage.self) { object, error in
                    if let image = object as? NSImage {
                        DispatchQueue.main.async {
                            self.selectedImage = image
                            self.runOCR(on: image)
                        }
                    }
                }
                return
            }
            
            if provider.hasItemConformingToTypeIdentifier("public.file-url") {
                provider.loadItem(forTypeIdentifier: "public.file-url", options: nil) { item, error in
                    if let data = item as? Data,
                       let url = URL(dataRepresentation: data, relativeTo: nil) {
                        DispatchQueue.main.async {
                            loadImage(from: url)
                        }
                    }
                }
                return
            }
        }
    }
    
    private func loadImage(from url: URL) {
        guard let image = NSImage(contentsOf: url) else {
            errorMessage = "Failed to load image from: \(url.lastPathComponent)"
            return
        }
        
        selectedImage = image
        runOCR(on: image)
    }
    
    private func runOCR(on image: NSImage) {
        isProcessing = true
        errorMessage = nil
        ocrResult = nil
        parsedMessages = []
        detectedScripts = []
        
        let startTime = Date()
        
        Task {
            do {
                let result = try await ocrService.recognize(image)
                let endTime = Date()
                
                // 获取图像尺寸用于解析
                let imageSize = result.coordinateSize ?? image.size
                
                // 解析 OCR 结果为消息
                let messages = parser.parse(ocrResult: result, imageSize: imageSize)
                
                await MainActor.run {
                    self.ocrResult = result
                    self.parsedMessages = messages
                    self.processingTime = endTime.timeIntervalSince(startTime)
                    self.detectedScripts = detectScriptsInResult(result)
                    self.isProcessing = false
                }
            } catch {
                await MainActor.run {
                    self.errorMessage = error.localizedDescription
                    self.isProcessing = false
                }
            }
        }
    }
    
    /// 检测识别结果中使用的书写系统
    private func detectScriptsInResult(_ result: OCRResult) -> [String] {
        var scripts: Set<String> = []
        
        for block in result.blocks {
            for scalar in block.text.unicodeScalars {
                if CharacterSet(charactersIn: "\u{4E00}"..."\u{9FFF}").contains(scalar) ||
                   CharacterSet(charactersIn: "\u{3400}"..."\u{4DBF}").contains(scalar) {
                    scripts.insert("CJK")
                } else if CharacterSet(charactersIn: "\u{3040}"..."\u{309F}").contains(scalar) {
                    scripts.insert("Hiragana")
                } else if CharacterSet(charactersIn: "\u{30A0}"..."\u{30FF}").contains(scalar) {
                    scripts.insert("Katakana")
                } else if CharacterSet(charactersIn: "\u{AC00}"..."\u{D7AF}").contains(scalar) {
                    scripts.insert("Hangul")
                } else if CharacterSet(charactersIn: "\u{0600}"..."\u{06FF}").contains(scalar) {
                    scripts.insert("Arabic")
                } else if CharacterSet(charactersIn: "\u{0400}"..."\u{04FF}").contains(scalar) {
                    scripts.insert("Cyrillic")
                } else if CharacterSet(charactersIn: "\u{0E00}"..."\u{0E7F}").contains(scalar) {
                    scripts.insert("Thai")
                }
            }
        }
        
        if scripts.isEmpty && !result.rawText.isEmpty {
            scripts.insert("Latin")
        }
        
        return scripts.sorted()
    }
}

// MARK: - Stat Row

private struct StatRow: View {
    let label: String
    let value: String
    
    var body: some View {
        HStack {
            Text(label)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .fontWeight(.medium)
        }
        .font(.caption)
    }
}

