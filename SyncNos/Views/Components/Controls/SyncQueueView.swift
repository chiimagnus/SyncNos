import SwiftUI

// MARK: - SyncSourceBadge

/// 数据源标签徽章（可复用）
struct SyncSourceBadge: View {
    let source: ContentSource
    
    var body: some View {
        Label(source.displayName, systemImage: source.iconName)
            .scaledFont(.caption2)
            .lineLimit(1)
            .truncationMode(.tail)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .foregroundStyle(source.brandColor)
            .background(source.brandColor.opacity(source.brandBackgroundOpacity), in: Capsule())
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
        commonRow(showProgressText: true, showErrorMessage: false)
    }
    
    // MARK: - Queued Row
    
    private var queuedRow: some View {
        commonRow(showProgressText: false, showErrorMessage: false)
    }
    
    // MARK: - Failed Row
    
    private var failedRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Button(action: onSelect) {
                    VStack(alignment: .leading, spacing: 4) {
                        taskTitleRow
                        subtitleIfNeeded
                        errorMessageIfNeeded
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)

                if task.errorDetails != nil {
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            expandedErrorTaskId = (expandedErrorTaskId == task.id) ? nil : task.id
                        }
                    } label: {
                        Image(systemName: expandedErrorTaskId == task.id ? "chevron.up" : "chevron.down")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .help(String(localized: "Show error details"))
                }
            }

            if expandedErrorTaskId == task.id, let details = task.errorDetails {
                Text(details)
                    .scaledFont(.caption2)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
            }
        }
    }
    
    // MARK: - Shared Components
    
    private var taskTitleRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(task.title)
                .scaledFont(.body)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
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

    private func commonRow(showProgressText: Bool, showErrorMessage: Bool) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Button(action: onSelect) {
                VStack(alignment: .leading, spacing: 4) {
                    taskTitleRow
                    subtitleIfNeeded
                    if showProgressText {
                        progressTextIfNeeded
                    }
                    if showErrorMessage {
                        errorMessageIfNeeded
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)

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
}

// MARK: - SyncQueueView

struct SyncQueueView: View {
    @StateObject private var viewModel = SyncQueueViewModel()
    @State private var expandedErrorTaskId: String? = nil
    @State private var selectedTab: Tab = .running
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("", selection: $selectedTab) {
                Text("Running (\(viewModel.runningTasks.count))").tag(Tab.running)
                Text("Waiting (\(viewModel.queuedTotalCount))").tag(Tab.waiting)
                Text("Failed (\(viewModel.failedTotalCount))").tag(Tab.failed)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(.horizontal, 12)

            content

            footer
//                 .padding(.horizontal, 12)
        }
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color.gray.opacity(0.06))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.secondary.opacity(0.08), lineWidth: 1)
        )
        .onChange(of: viewModel.runningTasks.count) { _, _ in
            normalizeSelectedTab()
        }
        .onChange(of: viewModel.queuedTotalCount) { _, _ in
            normalizeSelectedTab()
        }
        .onChange(of: viewModel.failedTotalCount) { _, _ in
            normalizeSelectedTab()
        }
    }
    
    // MARK: - Helpers

    private enum Tab: Hashable {
        case running
        case waiting
        case failed
    }

    @ViewBuilder
    private var content: some View {
        switch selectedTab {
        case .running:
            tasksList(
                tasks: viewModel.runningTasks,
                variant: .running,
                emptyText: "No active sync tasks"
            )
        case .waiting:
            tasksList(
                tasks: viewModel.queuedTasks,
                variant: .queued,
                emptyText: "No queued tasks"
            )
        case .failed:
            tasksList(
                tasks: viewModel.failedTasks,
                variant: .failed,
                emptyText: "No failed tasks"
            )
        }
    }

    @ViewBuilder
    private var footer: some View {
        switch selectedTab {
        case .running:
            EmptyView()
        case .waiting:
            footerWaiting
        case .failed:
            footerFailed
        }
    }

    private var footerWaiting: some View {
        HStack(spacing: 10) {
            if viewModel.queuedTotalCount > viewModel.queuedTasks.count {
                Button {
                    viewModel.showAllQueued()
                } label: {
                    Text("Show all (\(viewModel.queuedTotalCount))")
                }
                .buttonStyle(.link)
            } else if viewModel.queuedDisplayLimit == nil, viewModel.queuedTotalCount > 50 {
                Button {
                    viewModel.showQueued(limit: 50)
                } label: {
                    Text("Show less")
                }
                .buttonStyle(.link)
            }

            Spacer()

            if viewModel.hasQueuedTasks {
                Button {
                    viewModel.cancelAllQueued()
                } label: {
                    Label("Cancel All", systemImage: "xmark.circle")
                }
                .controlSize(.small)
            }
        }
    }

    private var footerFailed: some View {
        HStack(spacing: 10) {
            if viewModel.failedTotalCount > viewModel.failedTasks.count {
                Button {
                    viewModel.showAllFailed()
                } label: {
                    Text("Show all (\(viewModel.failedTotalCount))")
                }
                .buttonStyle(.link)
            } else if viewModel.failedDisplayLimit == nil, viewModel.failedTotalCount > 50 {
                Button {
                    viewModel.showFailed(limit: 50)
                } label: {
                    Text("Show less")
                }
                .buttonStyle(.link)
            }

            Spacer()

            if viewModel.hasCompletedTasks {
                Button {
                    viewModel.clearCompleted()
                } label: {
                    Label("Clear", systemImage: "trash")
                }
                .controlSize(.small)
            }
        }
    }

    private func normalizeSelectedTab() {
        // 若当前 tab 为空，则优先跳到有内容的 tab，避免出现“空白页”
        switch selectedTab {
        case .running:
            if !viewModel.runningTasks.isEmpty { return }
        case .waiting:
            if viewModel.queuedTotalCount > 0 { return }
        case .failed:
            if viewModel.failedTotalCount > 0 { return }
        }

        if !viewModel.runningTasks.isEmpty {
            selectedTab = .running
        } else if viewModel.queuedTotalCount > 0 {
            selectedTab = .waiting
        } else if viewModel.failedTotalCount > 0 {
            selectedTab = .failed
        }
    }
    
    @ViewBuilder
    private func tasksList(
        tasks: [SyncQueueTask],
        variant: SyncTaskRowView.Variant,
        emptyText: LocalizedStringKey
    ) -> some View {
        if tasks.isEmpty {
            Text(emptyText)
                .scaledFont(.body)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 180, alignment: .center)
        } else {
            List {
                ForEach(tasks) { task in
                    SyncTaskRowView(
                        task: task,
                        variant: variant,
                        expandedErrorTaskId: $expandedErrorTaskId,
                        onSelect: { selectTask(task) },
                        onCancel: {
                            switch variant {
                            case .running:
                                viewModel.cancelRunningTask(task)
                            case .queued:
                                viewModel.cancelTask(task)
                            case .failed:
                                break
                            }
                        }
                    )
//                    .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                }
            }
//            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .frame(minHeight: 220)
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
