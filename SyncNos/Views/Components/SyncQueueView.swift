import SwiftUI

struct SyncQueueView: View {
    @StateObject private var viewModel = SyncQueueViewModel()
    @State private var isFailedExpanded: Bool = false
    
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Running Tasks Section
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Running")
                        .font(.headline)
                        .foregroundStyle(.primary)
                    if !runningTasks.isEmpty {
                        Text("\(runningTasks.count)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 12)
                
                if runningTasks.isEmpty {
                    Text("No active sync tasks")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                } else {
                    VStack(spacing: 8) {
                        ForEach(runningTasks) { task in
                            taskRow(task)
                                .padding(.horizontal, 12)
                        }
                    }
                }
            }
            
            Divider()
                .padding(.horizontal, 12)

            // Queued Tasks Section
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Waiting")
                        .font(.headline)
                        .foregroundStyle(.primary)
                    if queuedTotalCount > 0 {
                        Text("\(queuedTotalCount)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, 12)
                
                if queuedTasks.isEmpty {
                    Text("No queued tasks")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                } else {
                    VStack(spacing: 8) {
                        ForEach(queuedTasks) { task in
                            taskRow(task)
                                .padding(.horizontal, 12)
                        }
                    }
                }
            }
            
            Divider()
                .padding(.horizontal, 12)

            // Failed Tasks Section
            VStack(alignment: .leading, spacing: 8) {
                Button {
                    if !failedTasks.isEmpty {
                        isFailedExpanded.toggle()
                    }
                } label: {
                    HStack {
                        Image(systemName: isFailedExpanded ? "chevron.down" : "chevron.right")
                            .foregroundStyle(.secondary)
                        Text("Failed")
                            .font(.headline)
                            .foregroundStyle(.primary)
                        if failedTotalCount > 0 {
                            Text("\(failedTotalCount)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 12)

                if failedTasks.isEmpty {
                    Text("No failed tasks")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                } else if isFailedExpanded {
                    VStack(spacing: 8) {
                        ForEach(failedTasks) { task in
                            taskRow(task)
                                .padding(.horizontal, 12)
                        }
                    }
                }
            }
        }
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.gray.opacity(0.06))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.secondary.opacity(0.08), lineWidth: 1)
        )
    }
    
    private var runningTasks: [SyncQueueTask] { viewModel.runningTasks }
    private var queuedTasks: [SyncQueueTask] { viewModel.queuedTasks }
    private var failedTasks: [SyncQueueTask] { viewModel.failedTasks }
    private var queuedTotalCount: Int { viewModel.queuedTotalCount }
    private var failedTotalCount: Int { viewModel.failedTotalCount }
    
    private func taskRow(_ task: SyncQueueTask) -> some View {
        Button {
            selectTask(task)
        } label: {
            HStack(spacing: 12) {
            // Status indicator
            statusIndicator(for: task)
                .frame(width: 8, height: 8)
                .clipShape(Circle())
            
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(task.title)
                        .font(.body)
                    
                    sourceBadge(for: task.source)
                }
                
                if let subtitle = task.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                
                if let progressText = task.progressText, !progressText.isEmpty {
                    Text(progressText)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            
            Spacer()
            
            // Progress indicator for running tasks
            if task.state == .running {
                ProgressView()
                    .controlSize(.small)
            }
            }
        }
        .buttonStyle(.plain)
    }

    private func selectTask(_ task: SyncQueueTask) {
        NotificationCenter.default.post(name: Notification.Name("SyncQueueTaskSelected"), object: nil, userInfo: ["source": task.source.rawValue, "id": task.rawId])
    }

    
    
    @ViewBuilder
    private func sourceBadge(for source: SyncSource) -> some View {
        switch source {
        case .appleBooks:
            Label("Apple Books", systemImage: "book")
                .font(.caption2)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .foregroundStyle(.yellow)
                .background(.yellow.opacity(0.18), in: Capsule())
        case .goodLinks:
            Label("GoodLinks", systemImage: "bookmark")
                .font(.caption2)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .foregroundStyle(.red)
                .background(.red.opacity(0.12), in: Capsule())
        case .weRead:
            Label("WeRead", systemImage: "text.book.closed")
                .font(.caption2)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .foregroundStyle(.blue)
                .background(.blue.opacity(0.14), in: Capsule())
        case .dedao:
            Label("Dedao", systemImage: "books.vertical")
                .font(.caption2)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .foregroundStyle(Color(red: 255/255, green: 107/255, blue: 0/255))  // #FF6B00
                .background(Color(red: 255/255, green: 107/255, blue: 0/255).opacity(0.14), in: Capsule())
        }
    }
    
    @ViewBuilder
    private func statusIndicator(for task: SyncQueueTask) -> some View {
        switch task.state {
        case .queued:
            Color.secondary.opacity(0.5)
        case .running:
            LinearGradient(
                colors: [.yellow, .orange],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        case .succeeded:
            Color.green
        case .failed:
            Color.red
        }
    }
}

#Preview {
    NavigationStack {
        SyncQueueView()
    }
    .frame(width: 420, height: 600)
}