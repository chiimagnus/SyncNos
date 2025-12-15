import SwiftUI

struct SyncQueueView: View {
    @StateObject private var viewModel = SyncQueueViewModel()
    @State private var isFailedExpanded: Bool = false
    @State private var expandedErrorTaskId: String? = nil
    
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Running Tasks Section
            runningSection
            
            Divider()
                .padding(.horizontal, 12)

            // Queued Tasks Section
            queuedSection
            
            Divider()
                .padding(.horizontal, 12)

            // Failed Tasks Section (可折叠)
            failedSection
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
    
    // MARK: - Running Section
    
    private var runningSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Running")
                    .scaledFont(.headline)
                    .foregroundStyle(.primary)
                if !runningTasks.isEmpty {
                    Text("\(runningTasks.count)")
                        .scaledFont(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 12)
            
            if runningTasks.isEmpty {
                Text("No active sync tasks")
                    .scaledFont(.body)
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
    }
    
    // MARK: - Queued Section
    
    private var queuedSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Waiting")
                    .scaledFont(.headline)
                    .foregroundStyle(.primary)
                if queuedTotalCount > 0 {
                    Text("\(queuedTotalCount)")
                        .scaledFont(.caption)
                        .foregroundStyle(.secondary)
                }
                
                Spacer()
                
                // 取消所有等待任务按钮
                if viewModel.hasQueuedTasks {
                    Button {
                        viewModel.cancelAllQueued()
                    } label: {
                        Label("Cancel All", systemImage: "xmark.circle")
                            .scaledFont(.caption)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 12)
            
            if queuedTasks.isEmpty {
                Text("No queued tasks")
                    .scaledFont(.body)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
            } else {
                VStack(spacing: 8) {
                    ForEach(queuedTasks) { task in
                        queuedTaskRow(task)
                            .padding(.horizontal, 12)
                    }
                }
            }
        }
    }
    
    // MARK: - Failed Section
    
    private var failedSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isFailedExpanded.toggle()
                }
            } label: {
                HStack {
                    Image(systemName: isFailedExpanded ? "chevron.down" : "chevron.right")
                        .foregroundStyle(.secondary)
                    Text("Failed")
                        .scaledFont(.headline)
                        .foregroundStyle(.primary)
                    if failedTotalCount > 0 {
                        Text("\(failedTotalCount)")
                            .scaledFont(.caption)
                            .foregroundStyle(.secondary)
                    }
                    
                    Spacer()
                    
                    // 清除已完成任务按钮
                    if viewModel.hasCompletedTasks {
                        Button {
                            viewModel.clearCompleted()
                        } label: {
                            Label("Clear", systemImage: "trash")
                                .scaledFont(.caption)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.secondary)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 12)

            if isFailedExpanded {
                if failedTasks.isEmpty {
                    Text("No failed tasks")
                        .scaledFont(.body)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                } else {
                    VStack(spacing: 8) {
                        ForEach(failedTasks) { task in
                            failedTaskRow(task)
                                .padding(.horizontal, 12)
                        }
                    }
                }
            }
        }
    }
    
    // MARK: - Computed Properties
    
    private var runningTasks: [SyncQueueTask] { viewModel.runningTasks }
    private var queuedTasks: [SyncQueueTask] { viewModel.queuedTasks }
    private var failedTasks: [SyncQueueTask] { viewModel.failedTasks }
    private var queuedTotalCount: Int { viewModel.queuedTotalCount }
    private var failedTotalCount: Int { viewModel.failedTotalCount }
    
    // MARK: - Task Rows
    
    /// 通用任务行（用于 running 状态）
    private func taskRow(_ task: SyncQueueTask) -> some View {
        Button {
            selectTask(task)
        } label: {
            HStack(spacing: 12) {
                statusIndicator(for: task)
                    .frame(width: 8, height: 8)
                    .clipShape(Circle())
                
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(task.title)
                            .scaledFont(.body)
                        
                        sourceBadge(for: task.source)
                    }
                    
                    if let subtitle = task.subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .scaledFont(.caption)
                            .foregroundStyle(.secondary)
                    }
                    
                    if let progressText = task.progressText, !progressText.isEmpty {
                        Text(progressText)
                            .scaledFont(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                
                Spacer()
                
                if task.state == .running {
                    ProgressView()
                        .controlSize(.small)
                }
            }
        }
        .buttonStyle(.plain)
    }
    
    /// 等待任务行（带取消按钮）
    private func queuedTaskRow(_ task: SyncQueueTask) -> some View {
        HStack(spacing: 12) {
            statusIndicator(for: task)
                .frame(width: 8, height: 8)
                .clipShape(Circle())
            
            Button {
                selectTask(task)
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(task.title)
                            .scaledFont(.body)
                        
                        sourceBadge(for: task.source)
                    }
                    
                    if let subtitle = task.subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .scaledFont(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .buttonStyle(.plain)
            
            Spacer()
            
            // 取消单个任务按钮
            Button {
                viewModel.cancelTask(task)
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .help("Cancel this task")
        }
    }
    
    /// 失败任务行（带错误信息展示）
    private func failedTaskRow(_ task: SyncQueueTask) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                // 错误类型图标
                if let errorType = task.errorType {
                    Image(systemName: errorType.iconName)
                        .foregroundStyle(.red)
                        .frame(width: 16, height: 16)
                } else {
                    statusIndicator(for: task)
                        .frame(width: 8, height: 8)
                        .clipShape(Circle())
                }
                
                Button {
                    selectTask(task)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(task.title)
                                .scaledFont(.body)
                            
                            sourceBadge(for: task.source)
                        }
                        
                        if let subtitle = task.subtitle, !subtitle.isEmpty {
                            Text(subtitle)
                                .scaledFont(.caption)
                                .foregroundStyle(.secondary)
                        }
                        
                        // 错误摘要
                        if let errorMessage = task.errorMessage {
                            Text(errorMessage)
                                .scaledFont(.caption)
                                .foregroundStyle(.red.opacity(0.8))
                                .lineLimit(1)
                        }
                    }
                }
                .buttonStyle(.plain)
                
                Spacer()
                
                // 展开/收起详情按钮（如果有详细信息）
                if task.errorDetails != nil {
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            if expandedErrorTaskId == task.id {
                                expandedErrorTaskId = nil
                            } else {
                                expandedErrorTaskId = task.id
                            }
                        }
                    } label: {
                        Image(systemName: expandedErrorTaskId == task.id ? "chevron.up" : "chevron.down")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .help("Show error details")
                }
            }
            
            // 详细错误信息（展开时显示）
            if expandedErrorTaskId == task.id, let details = task.errorDetails {
                Text(details)
                    .scaledFont(.caption2)
                    .foregroundStyle(.secondary)
                    .padding(.leading, 28)
                    .padding(.trailing, 12)
                    .textSelection(.enabled)
            }
        }
    }

    private func selectTask(_ task: SyncQueueTask) {
        NotificationCenter.default.post(
            name: Notification.Name("SyncQueueTaskSelected"),
            object: nil,
            userInfo: ["source": task.source.rawValue, "id": task.rawId]
        )
    }
    
    // MARK: - Source Badge
    
    @ViewBuilder
    private func sourceBadge(for source: SyncSource) -> some View {
        switch source {
        case .appleBooks:
            Label("Apple Books", systemImage: "book")
                .scaledFont(.caption2)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .foregroundStyle(Color("BrandAppleBooks"))
                .background(Color("BrandAppleBooks").opacity(0.18), in: Capsule())
        case .goodLinks:
            Label("GoodLinks", systemImage: "bookmark")
                .scaledFont(.caption2)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .foregroundStyle(Color("BrandGoodLinks"))
                .background(Color("BrandGoodLinks").opacity(0.12), in: Capsule())
        case .weRead:
            Label("WeRead", systemImage: "w.square")
                .scaledFont(.caption2)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .foregroundStyle(Color("BrandWeRead"))
                .background(Color("BrandWeRead").opacity(0.14), in: Capsule())
        case .dedao:
            Label("Dedao", systemImage: "d.square")
                .scaledFont(.caption2)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .foregroundStyle(Color("BrandDedao"))
                .background(Color("BrandDedao").opacity(0.14), in: Capsule())
        }
    }
    
    // MARK: - Status Indicator
    
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
        case .cancelled:
            Color.gray
        }
    }
}

#Preview {
    NavigationStack {
        SyncQueueView()
    }
    .frame(width: 420, height: 600)
}
