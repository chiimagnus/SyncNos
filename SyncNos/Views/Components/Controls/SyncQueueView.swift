import SwiftUI

// MARK: - SyncSourceBadge

/// 数据源标签徽章（可复用）
struct SyncSourceBadge: View {
    let source: SyncSource
    
    var body: some View {
        Label(source.displayName, systemImage: source.iconName)
            .scaledFont(.caption2)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .foregroundStyle(source.brandColor)
            .background(source.brandColor.opacity(source.brandBackgroundOpacity), in: Capsule())
    }
}

// MARK: - SyncQueueSectionHeader

/// 同步队列区块标题栏
struct SyncQueueSectionHeader: View {
    let title: LocalizedStringKey
    let count: Int
    let isExpanded: Bool?
    let actionLabel: LocalizedStringKey?
    let actionIcon: String?
    let showAction: Bool
    var onToggle: (() -> Void)?
    var onAction: (() -> Void)?
    
    init(
        title: LocalizedStringKey,
        count: Int,
        isExpanded: Bool? = nil,
        actionLabel: LocalizedStringKey? = nil,
        actionIcon: String? = nil,
        showAction: Bool = false,
        onToggle: (() -> Void)? = nil,
        onAction: (() -> Void)? = nil
    ) {
        self.title = title
        self.count = count
        self.isExpanded = isExpanded
        self.actionLabel = actionLabel
        self.actionIcon = actionIcon
        self.showAction = showAction
        self.onToggle = onToggle
        self.onAction = onAction
    }
    
    var body: some View {
        HStack {
            // 折叠指示器（可选）
            if let isExpanded, let onToggle {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        onToggle()
                    }
                } label: {
                    headerContent(showChevron: true, isExpanded: isExpanded)
                }
                .buttonStyle(.plain)
            } else {
                headerContent(showChevron: false, isExpanded: false)
            }
            
            Spacer()
            
            // 操作按钮（可选）
            if showAction, let actionLabel, let actionIcon, let onAction {
                Button(action: onAction) {
                    Label(actionLabel, systemImage: actionIcon)
                        .scaledFont(.caption)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }
        }
                .padding(.horizontal, 12)
    }

    @ViewBuilder
    private func headerContent(showChevron: Bool, isExpanded: Bool) -> some View {
                HStack {
            if showChevron {
                Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                    .foregroundStyle(.secondary)
            }
            Text(title)
                        .scaledFont(.headline)
                        .foregroundStyle(.primary)
            if count > 0 {
                Text("\(count)")
                            .scaledFont(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
        .contentShape(Rectangle())
    }
}

// MARK: - SyncTaskRowView

/// 同步任务行视图
struct SyncTaskRowView: View {
    let task: SyncQueueTask
    let variant: Variant
    @Binding var expandedErrorTaskId: String?
    var onSelect: () -> Void
    var onCancel: (() -> Void)?
    
    enum Variant {
        case running
        case queued
        case failed
    }
    
    var body: some View {
        switch variant {
        case .running:
            runningRow
        case .queued:
            queuedRow
        case .failed:
            failedRow
        }
    }
    
    // MARK: - Running Row
    
    private var runningRow: some View {
        Button(action: onSelect) {
            HStack(spacing: 12) {
                statusIndicator
                taskInfo(showProgress: true)
                Spacer()
                ProgressView()
                    .controlSize(.small)
            }
        }
        .buttonStyle(.plain)
    }
    
    // MARK: - Queued Row
    
    private var queuedRow: some View {
        HStack(spacing: 12) {
            statusIndicator
            
            Button(action: onSelect) {
                taskInfo(showProgress: false)
            }
            .buttonStyle(.plain)
            
            Spacer()
            
            if let onCancel {
                Button(action: onCancel) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help(String(localized: "Cancel this task"))
            }
        }
    }
    
    // MARK: - Failed Row
    
    private var failedRow: some View {
            VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                // 错误类型图标
                if let errorType = task.errorType {
                    Image(systemName: errorType.iconName)
                        .foregroundStyle(.red)
                        .frame(width: 16, height: 16)
                } else {
                    statusIndicator
                }
                
                Button(action: onSelect) {
                    VStack(alignment: .leading, spacing: 4) {
                        taskTitleRow
                        subtitleIfNeeded
                        errorMessageIfNeeded
                    }
                }
                .buttonStyle(.plain)
                
                Spacer()
                
                // 展开/收起详情按钮
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
                    .help(String(localized: "Show error details"))
                }
            }
            
            // 详细错误信息
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
    
    // MARK: - Shared Components
    
    private var statusIndicator: some View {
        Group {
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
        .frame(width: 8, height: 8)
        .clipShape(Circle())
    }
    
    private func taskInfo(showProgress: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            taskTitleRow
            subtitleIfNeeded
            if showProgress {
                progressTextIfNeeded
            }
        }
    }
    
    private var taskTitleRow: some View {
        HStack {
            Text(task.title)
                .scaledFont(.body)
            SyncSourceBadge(source: task.source)
        }
    }
    
    @ViewBuilder
    private var subtitleIfNeeded: some View {
        if let subtitle = task.subtitle, !subtitle.isEmpty {
            Text(subtitle)
                .scaledFont(.caption)
                .foregroundStyle(.secondary)
        }
    }
    
    @ViewBuilder
    private var progressTextIfNeeded: some View {
        if let progressText = task.progressText, !progressText.isEmpty {
            Text(progressText)
                .scaledFont(.caption2)
                .foregroundStyle(.tertiary)
        }
    }
    
    @ViewBuilder
    private var errorMessageIfNeeded: some View {
        if let errorMessage = task.errorMessage {
            Text(errorMessage)
                .scaledFont(.caption)
                .foregroundStyle(.red.opacity(0.8))
                .lineLimit(1)
        }
    }
}

// MARK: - SyncQueueView

struct SyncQueueView: View {
    @StateObject private var viewModel = SyncQueueViewModel()
    @State private var isFailedExpanded: Bool = false
    @State private var expandedErrorTaskId: String? = nil
    
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            runningSection
            
            Divider()
                .padding(.horizontal, 12)

            queuedSection
            
            Divider()
                .padding(.horizontal, 12)

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
            SyncQueueSectionHeader(
                title: "Running",
                count: viewModel.runningTasks.count
            )
            
            if viewModel.runningTasks.isEmpty {
                emptyStateText("No active sync tasks")
            } else {
                taskList(viewModel.runningTasks, variant: .running)
            }
        }
    }
    
    // MARK: - Queued Section
    
    private var queuedSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SyncQueueSectionHeader(
                title: "Waiting",
                count: viewModel.queuedTotalCount,
                actionLabel: "Cancel All",
                actionIcon: "xmark.circle",
                showAction: viewModel.hasQueuedTasks,
                onAction: { viewModel.cancelAllQueued() }
            )
            
            if viewModel.queuedTasks.isEmpty {
                emptyStateText("No queued tasks")
            } else {
                taskList(viewModel.queuedTasks, variant: .queued)
            }
        }
    }
    
    // MARK: - Failed Section
    
    private var failedSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SyncQueueSectionHeader(
                title: "Failed",
                count: viewModel.failedTotalCount,
                isExpanded: isFailedExpanded,
                actionLabel: "Clear",
                actionIcon: "trash",
                showAction: viewModel.hasCompletedTasks,
                onToggle: { isFailedExpanded.toggle() },
                onAction: { viewModel.clearCompleted() }
            )

            if isFailedExpanded {
                if viewModel.failedTasks.isEmpty {
                    emptyStateText("No failed tasks")
                } else {
                    taskList(viewModel.failedTasks, variant: .failed)
                }
            }
        }
    }
    
    // MARK: - Helpers
    
    private func emptyStateText(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .scaledFont(.body)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
    }
    
    private func taskList(_ tasks: [SyncQueueTask], variant: SyncTaskRowView.Variant) -> some View {
        VStack(spacing: 8) {
            ForEach(tasks) { task in
                SyncTaskRowView(
                    task: task,
                    variant: variant,
                    expandedErrorTaskId: $expandedErrorTaskId,
                    onSelect: { selectTask(task) },
                    onCancel: variant == .queued ? { viewModel.cancelTask(task) } : nil
                )
                .padding(.horizontal, 12)
            }
        }
    }
    
    private func selectTask(_ task: SyncQueueTask) {
        NotificationCenter.default.post(
            name: .syncQueueTaskSelected,
            object: nil,
            userInfo: ["source": task.source.rawValue, "id": task.rawId]
        )
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        SyncQueueView()
    }
    .frame(width: 420, height: 600)
}
