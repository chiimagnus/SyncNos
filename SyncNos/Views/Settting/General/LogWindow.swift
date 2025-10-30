import SwiftUI
import AppKit

struct LogWindow: View {
    @StateObject private var viewModel = LogViewModel()
    @State private var isAutoScrollEnabled: Bool = true

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 4) {
                        ForEach(viewModel.entries) { entry in
                            Text(formatted(entry: entry))
                                .font(.system(.caption, design: .monospaced))
                                .id(entry.id)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .padding(8)
                }
                .onChange(of: viewModel.entries.count) { _ in
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
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Picker("Level", selection: $viewModel.levelFilter) {
                    ForEach(LogLevel.allCases, id: \ .self) { level in
                        Text(level.description.capitalized).tag(level)
                    }
                }
                .pickerStyle(MenuPickerStyle())

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

struct LogWindow_Previews: PreviewProvider {
    static var previews: some View {
        LogWindow()
    }
}


