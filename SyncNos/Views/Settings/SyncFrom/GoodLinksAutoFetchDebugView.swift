import SwiftUI

// MARK: - GoodLinks Auto Fetch Debug View

#if DEBUG
struct GoodLinksAutoFetchDebugView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var selectedTab: Tab = .running
    
    @State private var snapshot = GoodLinksAutoFetchSnapshot(
        total: 0,
        pending: 0,
        inFlight: 0,
        completed: 0,
        cacheHit: 0,
        succeeded: 0,
        failed: 0,
        startedAt: nil,
        lastUpdatedAt: nil,
        items: [],
        recentEvents: []
    )
    
    private var service: GoodLinksArticleAutoFetchServiceProtocol {
        DIContainer.shared.goodLinksArticleAutoFetchService
    }
    
    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
        }
        .frame(width: 760, height: 520)
        .task {
            await refreshLoop()
        }
    }
    
    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 6) {
                Text("GoodLinks Auto Fetch Debug")
                    .scaledFont(.headline)
                HStack(spacing: 12) {
                    if let startedAt = snapshot.startedAt {
                        Text("Started: \(startedAt.formatted(date: .abbreviated, time: .standard))")
                            .scaledFont(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Text("Not started")
                            .scaledFont(.caption)
                            .foregroundStyle(.secondary)
                    }
                    
                    if let updatedAt = snapshot.lastUpdatedAt {
                        Text("Updated: \(updatedAt.formatted(date: .omitted, time: .standard))")
                            .scaledFont(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            Spacer()
            HStack(spacing: 10) {
                Button("Reset Session") {
                    Task {
                        await service.resetSessionState()
                        snapshot = await service.snapshot()
                    }
                }
                .buttonStyle(.bordered)
                
                Button("Close") {
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(16)
    }
    
    private var content: some View {
        rightPanel
        .padding(16)
    }
    
    private var rightPanel: some View {
        GroupBox("Queue") {
            VStack(alignment: .leading, spacing: 12) {
                Picker("", selection: $selectedTab) {
                    Text("Running (\(runningItems.count))").tag(Tab.running)
                    Text("Waiting (\(waitingItems.count))").tag(Tab.waiting)
                    Text("Failed (\(failedItems.count))").tag(Tab.failed)
                    Text("Completed (\(completedItems.count))").tag(Tab.completed)
                }
                .pickerStyle(.segmented)
                .labelsHidden()

                queueContent
            }
            .padding(.vertical, 4)
        }
    }

    // MARK: - Queue
    
    private enum Tab: Hashable {
        case running
        case waiting
        case failed
        case completed
    }
    
    private var runningItems: [GoodLinksAutoFetchItem] {
        snapshot.items.filter { $0.state == .running }
    }
    
    private var waitingItems: [GoodLinksAutoFetchItem] {
        snapshot.items.filter { $0.state == .waiting }
    }
    
    private var failedItems: [GoodLinksAutoFetchItem] {
        snapshot.items.filter { $0.state == .failed }
    }
    
    private var completedItems: [GoodLinksAutoFetchItem] {
        snapshot.items.filter { $0.state == .cached || $0.state == .succeeded }
    }
    
    @ViewBuilder
    private var queueContent: some View {
        let items: [GoodLinksAutoFetchItem] = {
            switch selectedTab {
            case .running: return runningItems
            case .waiting: return waitingItems
            case .failed: return failedItems
            case .completed: return completedItems
            }
        }()
        
        if items.isEmpty {
            Text(emptyText(for: selectedTab))
                .scaledFont(.body)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, minHeight: 220, alignment: .center)
        } else {
            List {
                ForEach(items) { item in
                    AutoFetchRowView(item: item, onSelect: {
                        selectItem(item)
                    })
                        .listRowSeparator(.hidden)
                }
            }
            .scrollContentBackground(.hidden)
            .frame(minHeight: 220)
        }
    }
    
    private func emptyText(for tab: Tab) -> String {
        switch tab {
        case .running:
            return "No running tasks"
        case .waiting:
            return "No waiting tasks"
        case .failed:
            return "No failed tasks"
        case .completed:
            return "No completed tasks"
        }
    }
    
    private func selectItem(_ item: GoodLinksAutoFetchItem) {
        NotificationCenter.default.post(
            name: .syncQueueTaskSelected,
            object: nil,
            userInfo: ["source": ContentSource.goodLinks.rawValue, "id": item.linkId]
        )
        dismiss()
    }
    
    private func refreshLoop() async {
        while !Task.isCancelled {
            snapshot = await service.snapshot()
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
    }
}

private struct AutoFetchRowView: View {
    let item: GoodLinksAutoFetchItem
    var onSelect: () -> Void
    
    var body: some View {
        Button(action: onSelect) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(item.title)
                        .scaledFont(.body)
                        .lineLimit(2)
                        .truncationMode(.middle)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    
                    Text(item.state.rawValue)
                        .scaledFont(.caption2)
                        .lineLimit(1)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .foregroundStyle(color(for: item.state))
                        .background(color(for: item.state).opacity(0.12), in: Capsule())
                    
                    Image(systemName: "arrow.up.right.square")
                        .foregroundStyle(.secondary)
                        .scaledFont(.caption)
                }

                if item.state == .failed, let msg = item.message, !msg.isEmpty {
                    Text(msg)
                        .scaledFont(.caption)
                        .foregroundStyle(.red.opacity(0.8))
                        .lineLimit(2)
                        .textSelection(.enabled)
                }
                
                Text(item.updatedAt.formatted(date: .omitted, time: .standard))
                    .scaledFont(.caption2)
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 6)
        }
        .buttonStyle(.plain)
    }
    
    private func color(for state: GoodLinksAutoFetchItemState) -> Color {
        switch state {
        case .waiting:
            return .blue
        case .running:
            return .blue
        case .cached:
            return .secondary
        case .succeeded:
            return .green
        case .failed:
            return .red
        }
    }
}

#endif
