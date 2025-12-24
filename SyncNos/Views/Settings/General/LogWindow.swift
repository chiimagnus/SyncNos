import SwiftUI
import AppKit

struct LogWindow: View {
    @StateObject private var viewModel = LogViewModel()
    @State private var isAutoScrollEnabled: Bool = true
    #if DEBUG
    @State private var showOcrDebugPanel: Bool = false
    #endif
    @Environment(\.fontScale) private var fontScale

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 4) {
                        ForEach(viewModel.entries) { entry in
                            logEntryView(entry: entry)
                                .id(entry.id)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(8)
                }
                .onChange(of: viewModel.entries.count) { _, _ in
                    guard isAutoScrollEnabled, let last = viewModel.entries.last else { return }
                    withAnimation {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
                .gesture(DragGesture().onChanged { _ in isAutoScrollEnabled = false })
            }
        }
        .frame(minWidth: 600, minHeight: 300)
        .navigationTitle("Logs")
        .searchable(text: $viewModel.searchText, prompt: "Search logs...")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Picker("Level", selection: $viewModel.levelFilter) {
                    ForEach(LogLevel.allCases, id: \ .self) { level in
                        Text(level.description.capitalized).tag(level)
                    }
                }
                .pickerStyle(MenuPickerStyle())

#if DEBUG
                Button {
                    showOcrDebugPanel = true
                } label: {
                    Image(systemName: "doc.text.magnifyingglass")
                }
                .help("Inspect WechatChat OCR payloads (Debug)")
#endif

                Button(action: { viewModel.clear() }) {
                    Image(systemName: "trash")
                }
                .help("Clear logs")

                Button(action: { shareLogs() }) {
                    Image(systemName: "square.and.arrow.up.on.square")
                }
                .help("Share logs")
            }
        }
#if DEBUG
        .sheet(isPresented: $showOcrDebugPanel) {
            WechatChatOCRDebugPanel()
        }
#endif
    }

    private func logEntryView(entry: LogEntry) -> some View {
        let scaledSize = Font.TextStyle.caption.basePointSize * fontScale
        return Text(formatted(entry: entry))
            .font(.system(size: scaledSize, design: .monospaced))
            .foregroundColor(Color(entry.level.color))
            .textSelection(.enabled)
    }

    private func formatted(entry: LogEntry) -> String {
        let formatter = DateFormatter()
        formatter.timeStyle = .medium
        return "\(formatter.string(from: entry.timestamp)) [\(entry.level.description)] \(entry.file):\(entry.line) - \(entry.message)"
    }

    private func shareLogs() {
        let tempURL = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("syncnos-logs.txt")
        do {
            // 导出当前过滤后的日志，而不是全部日志
            try viewModel.exportFiltered(to: tempURL)

            guard let contentView = NSApp.keyWindow?.contentView else { return }
            let picker = NSSharingServicePicker(items: [tempURL])
            picker.show(relativeTo: contentView.bounds, of: contentView, preferredEdge: .minY)
        } catch {
            // optionally show error
        }
    }
}

#if DEBUG

// MARK: - WechatChat OCR Debug Panel (Debug Only)

private struct WechatChatOCRDebugPanel: View {
    @StateObject private var viewModel = WechatChatOCRDebugViewModel()
    @State private var selection: String?
    @State private var selectedTab: Tab = .response
    @State private var prettyPrintEnabled: Bool = true

    private enum Tab: String, CaseIterable {
        case response = "Response JSON"
        case blocks = "Normalized Blocks"
        case request = "Request JSON"
    }

    var body: some View {
        NavigationSplitView {
            List(viewModel.payloads, selection: $selection) { item in
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.screenshotId)
                        .font(.caption)
                        .lineLimit(1)
                        .truncationMode(.middle)

                    Text(item.importedAt, style: .time)
                        .font(.caption2)
                        .foregroundStyle(.secondary)

                    Text("resp \(formatBytes(item.responseBytes)), blocks \(formatBytes(item.blocksBytes))")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .tag(item.screenshotId)
            }
            .navigationTitle("WechatChat OCR")
            .toolbar {
                ToolbarItemGroup {
                    Button("Refresh") {
                        Task { await viewModel.reload() }
                    }
                    .disabled(viewModel.isLoading)

                    Spacer()
                }
            }
        } detail: {
            detailView
                .navigationTitle("Payload")
        }
        .frame(minWidth: 900, minHeight: 600)
        .task {
            await viewModel.reload()
            if selection == nil {
                selection = viewModel.payloads.first?.screenshotId
            }
        }
        .onChange(of: selection) { _, newValue in
            guard let id = newValue else {
                viewModel.detail = nil
                return
            }
            Task { await viewModel.loadDetail(screenshotId: id) }
        }
    }

    @ViewBuilder
    private var detailView: some View {
        if let detail = viewModel.detail {
            VStack(spacing: 12) {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("screenshotId: \(detail.screenshotId)")
                        Text("conversationId: \(detail.conversationId)")
                        Text("importedAt: \(detail.importedAt.formatted(date: .abbreviated, time: .standard))")
                        Text("parsedAt: \(detail.parsedAt.formatted(date: .abbreviated, time: .standard))")
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)

                    Spacer()

                    Toggle("Pretty", isOn: $prettyPrintEnabled)
                        .toggleStyle(.switch)
                        .controlSize(.small)

                    Button("Copy") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(currentText(detail: detail), forType: .string)
                    }
                }

                Picker("", selection: $selectedTab) {
                    ForEach(Tab.allCases, id: \.self) { tab in
                        Text(tab.rawValue).tag(tab)
                    }
                }
                .pickerStyle(.segmented)

                TextEditor(text: .constant(currentText(detail: detail)))
                    .font(.system(.caption, design: .monospaced))
                    .textSelection(.enabled)
            }
            .padding()
        } else {
            VStack(spacing: 12) {
                Text("Select one payload from the list.")
                    .foregroundStyle(.secondary)
                if let error = viewModel.errorMessage {
                    Text(error).foregroundStyle(.red).font(.caption)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func currentText(detail: WechatOcrPayloadDetail) -> String {
        let raw: String
        switch selectedTab {
        case .response:
            raw = detail.responseJSON
        case .blocks:
            raw = detail.normalizedBlocksJSON
        case .request:
            raw = detail.requestJSON ?? "<nil>"
        }
        return maybePrettyPrint(raw)
    }

    private func maybePrettyPrint(_ text: String) -> String {
        guard prettyPrintEnabled else { return text }

        // 避免对超大 JSON 做 pretty print 导致卡顿
        if text.utf8.count > 1_000_000 {
            return text
        }

        guard let data = text.data(using: .utf8),
              let jsonObject = try? JSONSerialization.jsonObject(with: data),
              let prettyData = try? JSONSerialization.data(withJSONObject: jsonObject, options: [.prettyPrinted, .sortedKeys]),
              let pretty = String(data: prettyData, encoding: .utf8) else {
            return text
        }
        return pretty
    }

    private func formatBytes(_ bytes: Int) -> String {
        let kb = Double(bytes) / 1024.0
        if kb < 1024 { return String(format: "%.1fKB", kb) }
        return String(format: "%.2fMB", kb / 1024.0)
    }
}

@MainActor
private final class WechatChatOCRDebugViewModel: ObservableObject {
    @Published var payloads: [WechatOcrPayloadSummary] = []
    @Published var detail: WechatOcrPayloadDetail?
    @Published var isLoading: Bool = false
    @Published var errorMessage: String?

    private let cacheService: WechatChatCacheServiceProtocol = DIContainer.shared.wechatChatCacheService

    func reload() async {
        isLoading = true
        defer { isLoading = false }

        do {
            payloads = try await cacheService.fetchRecentOcrPayloads(limit: 50)
            errorMessage = nil
        } catch {
            errorMessage = "加载 OCR payload 失败: \(error.localizedDescription)"
        }
    }

    func loadDetail(screenshotId: String) async {
        do {
            detail = try await cacheService.fetchOcrPayload(screenshotId: screenshotId)
            errorMessage = nil
        } catch {
            errorMessage = "读取 OCR payload 失败: \(error.localizedDescription)"
        }
    }
}

#endif

struct LogWindow_Previews: PreviewProvider {
    static var previews: some View {
        LogWindow()
            .applyFontScale()
    }
}
