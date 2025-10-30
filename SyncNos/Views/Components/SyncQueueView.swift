import SwiftUI

struct SyncQueueView: View {
    @StateObject private var viewModel = SyncQueueViewModel()

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Sync Queue")
                        .font(.title)
                        .fontWeight(.bold)
                    Spacer()
                    Text("Concurrency: \(viewModel.concurrencyLimit)")
                        .foregroundColor(.secondary)
                        .font(.subheadline)
                }

                GroupBox(label: Label("Running", systemImage: "arrow.triangle.2.circlepath.circle.fill")) {
                    queueSection(title: "Apple Books", tasks: viewModel.runningAppleBooks)
                    Divider()
                    queueSection(title: "GoodLinks", tasks: viewModel.runningGoodLinks)
                }

                GroupBox(label: Label("Waiting", systemImage: "clock")) {
                    queueSection(title: "Apple Books", tasks: viewModel.queuedAppleBooks)
                    Divider()
                    queueSection(title: "GoodLinks", tasks: viewModel.queuedGoodLinks)
                }

                Spacer(minLength: 0)
            }
            .padding()
            .frame(minWidth: 520, minHeight: 420)
        }
    }

    @ViewBuilder
    private func queueSection(title: String, tasks: [SyncQueueTask]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title)
                    .font(.headline)
                Spacer()
                Text("\(tasks.count)")
                    .foregroundColor(.secondary)
            }
            if tasks.isEmpty {
                Text("None")
                    .foregroundColor(.secondary)
                    .font(.caption)
            } else {
                ForEach(tasks) { t in
                    HStack(spacing: 10) {
                        Image(systemName: iconName(for: t))
                            .foregroundColor(color(for: t))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(t.title).font(.subheadline)
                            if let s = t.subtitle, !s.isEmpty {
                                Text(s).font(.caption).foregroundColor(.secondary)
                            }
                            if let p = t.progressText, !p.isEmpty {
                                Text(p).font(.caption2).foregroundColor(.secondary)
                            }
                        }
                        Spacer()
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    private func iconName(for task: SyncQueueTask) -> String {
        switch task.state {
        case .queued: return "clock"
        case .running: return "arrow.triangle.2.circlepath"
        case .succeeded: return "checkmark.circle"
        case .failed: return "xmark.circle"
        }
    }

    private func color(for task: SyncQueueTask) -> Color {
        switch task.state {
        case .queued: return .secondary
        case .running: return .yellow
        case .succeeded: return .green
        case .failed: return .red
        }
    }
}


