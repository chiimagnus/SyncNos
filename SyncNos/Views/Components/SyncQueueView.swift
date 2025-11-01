import SwiftUI

struct SyncQueueView: View {
    @StateObject private var viewModel = SyncQueueViewModel()
    
    var body: some View {
        List {
            // Running Tasks Section
            Section {
                if allRunningTasks.isEmpty {
                    Text("No active sync tasks")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(allRunningTasks) { task in
                        taskRow(task)
                    }
                }
            } header: {
                HStack {
                    Text("Running")
                    Spacer()
                    if !allRunningTasks.isEmpty {
                        Text("\(allRunningTasks.count)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            
            // Queued Tasks Section
            Section {
                if allQueuedTasks.isEmpty {
                    Text("No queued tasks")
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(allQueuedTasks) { task in
                        taskRow(task)
                    }
                }
            } header: {
                HStack {
                    Text("Waiting")
                    Spacer()
                    if !allQueuedTasks.isEmpty {
                        Text("\(allQueuedTasks.count)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .scrollContentBackground(.hidden)
        .background(VisualEffectBackground(material: .windowBackground))
        .navigationTitle("Sync Queue")
        .toolbar {
            ToolbarItem { Text("") }
        }
    }
    
    private var allRunningTasks: [SyncQueueTask] {
        viewModel.runningAppleBooks + viewModel.runningGoodLinks
    }
    
    private var allQueuedTasks: [SyncQueueTask] {
        viewModel.queuedAppleBooks + viewModel.queuedGoodLinks
    }
    
    private func taskRow(_ task: SyncQueueTask) -> some View {
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