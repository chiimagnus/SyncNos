import SwiftUI

struct SyncQueueView: View {
    @StateObject private var viewModel = SyncQueueViewModel()
    
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
                    if !queuedTasks.isEmpty {
                        Text("\(queuedTasks.count)")
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
            Label("GoodLinks", systemImage: "link")
                .font(.caption2)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .foregroundStyle(.red)
                .background(.red.opacity(0.12), in: Capsule())
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