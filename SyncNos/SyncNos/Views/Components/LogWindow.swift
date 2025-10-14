import SwiftUI

struct LogWindow: View {
    @StateObject private var viewModel = LogViewModel()
    @State private var isAutoScrollEnabled: Bool = true

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Picker("Level", selection: $viewModel.levelFilter) {
                    Text("All").tag(LogLevel.verbose)
                    ForEach(LogLevel.allCases, id: \ .self) { level in
                        Text(level.description.capitalized).tag(level)
                    }
                }
                .pickerStyle(MenuPickerStyle())

                Spacer()

                Button(action: { viewModel.clear() }) {
                    Image(systemName: "trash")
                }
                .help("Clear logs")

                Button(action: { exportLogs() }) {
                    Image(systemName: "square.and.arrow.up")
                }
                .help("Export logs")
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)

            Divider()

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
    }

    private func formatted(entry: LogEntry) -> String {
        let formatter = DateFormatter()
        formatter.timeStyle = .medium
        return "\(formatter.string(from: entry.timestamp)) [\(entry.level.description)] \(entry.file):\(entry.line) - \(entry.message)"
    }

    private func exportLogs() {
        let panel = NSSavePanel()
        panel.allowedFileTypes = ["txt"]
        panel.nameFieldStringValue = "syncnos-logs.txt"
        panel.begin { response in
            if response == .OK, let url = panel.url {
                do {
                    try viewModel.export(to: url)
                    // optionally show success
                } catch {
                    // optionally show error
                }
            }
        }
    }
}

struct LogWindow_Previews: PreviewProvider {
    static var previews: some View {
        LogWindow()
    }
}


