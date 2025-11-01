import SwiftUI

struct SyncQueueView: View {
    @StateObject private var viewModel = SyncQueueViewModel()
    
    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 16) {            
                // Running Tasks Section
                taskSection(
                    title: "Running",
                    tasks: allRunningTasks,
                    emptyMessage: "No active sync tasks"
                )
                
                // Queued Tasks Section
                taskSection(
                    title: "Waiting",
                    tasks: allQueuedTasks,
                    emptyMessage: "No queued tasks"
                )
            }
            .padding(.vertical, 12)
            .frame(width: 420)
        }
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
    
    private func taskSection(
        title: String,
        tasks: [SyncQueueTask],
        emptyMessage: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeader(title: title, count: tasks.count)
            
            if tasks.isEmpty {
                emptyStateView(message: emptyMessage)
            } else {
                tasksList(tasks: tasks)
            }
        }
    }
    
    private func sectionHeader(title: String, count: Int) -> some View {
        HStack {
            Text(title)
                .font(.headline)
                .fontWeight(.medium)
            
            Spacer()
            
            if count > 0 {
                Text("\(count)")
                    .font(.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(.quaternary.opacity(0.3), in: Capsule())
            }
        }
        .padding(.horizontal)
    }
    
    private func emptyStateView(message: String) -> some View {
        HStack {
            Text(message)
                .foregroundStyle(.secondary)
                .font(.subheadline)
            Spacer()
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(.quaternary.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .padding(.horizontal)
    }
    
    private func tasksList(tasks: [SyncQueueTask]) -> some View {
        VStack(spacing: 6) {
            ForEach(tasks) { task in
                taskRow(task)
                
                if task.id != tasks.last?.id {
                    Divider()
                        .opacity(0.3)
                }
            }
        }
        .padding(.horizontal)
    }
    
    private func taskRow(_ task: SyncQueueTask) -> some View {
        HStack(spacing: 12) {
            // Minimal status indicator
            statusIndicator(for: task)
                .frame(width: 8, height: 8)
                .clipShape(Circle())
            
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(task.title)
                        .font(.subheadline)
                        .fontWeight(.medium)
                    
                    sourceBadge(for: task.source)
                    
                    Spacer()
                    
                    // Progress indicator for running tasks
                    if task.state == .running {
                        ProgressView()
                            .scaleEffect(0.7)
                            .frame(width: 16, height: 16)
                    }
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
        }
        .padding(.vertical, 6)
    }
    
    private func sourceBadge(for source: SyncSource) -> some View {
        switch source {
        case .appleBooks:
            return AnyView(
                Label("Apple Books", systemImage: "book")
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .tint(Color.yellow)
                    .background(Color.yellow.opacity(0.18), in: Capsule())
            )
        case .goodLinks:
            return AnyView(
                Label("GoodLinks", systemImage: "link")
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .tint(Color.red)
                    .background(Color.red.opacity(0.12), in: Capsule())
            )
        }
    }
    
    private func statusIndicator(for task: SyncQueueTask) -> some View {
        switch task.state {
        case .queued:
            return AnyView(Color.secondary.opacity(0.5))
        case .running:
            return AnyView(LinearGradient(
                colors: [.yellow, .orange],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ))
        case .succeeded:
            return AnyView(Color.green)
        case .failed:
            return AnyView(Color.red)
        }
    }
}

#Preview {
    NavigationStack {
        SyncQueueView()
    }
    .frame(width: 420, height: 600)
}