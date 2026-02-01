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
        HSplitView {
            leftPanel
            rightPanel
        }
        .padding(16)
    }
    
    private var leftPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            GroupBox("Progress") {
                VStack(alignment: .leading, spacing: 10) {
                    ProgressView(value: Double(snapshot.completed), total: Double(max(snapshot.total, 1)))
                    
                    HStack {
                        StatChip(label: "Total", value: "\(snapshot.total)")
                        StatChip(label: "Pending", value: "\(snapshot.pending)")
                        StatChip(label: "In-Flight", value: "\(snapshot.inFlight)")
                        StatChip(label: "Completed", value: "\(snapshot.completed)")
                    }
                    
                    HStack {
                        StatChip(label: "Cache Hit", value: "\(snapshot.cacheHit)")
                        StatChip(label: "Succeeded", value: "\(snapshot.succeeded)")
                        StatChip(label: "Failed", value: "\(snapshot.failed)")
                    }
                }
                .padding(.vertical, 4)
            }
            
            GroupBox("Notes") {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Auto fetch starts after GoodLinks list finishes loading.")
                        .scaledFont(.caption)
                        .foregroundStyle(.secondary)
                    Text("Failures/no-content will not retry in the same app session.")
                        .scaledFont(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
            }
            
            Spacer()
        }
        .frame(minWidth: 320)
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
        .frame(minWidth: 380)
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
                    AutoFetchRowView(item: item)
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
    
    private func refreshLoop() async {
        while !Task.isCancelled {
            snapshot = await service.snapshot()
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
    }
}

private struct AutoFetchRowView: View {
    let item: GoodLinksAutoFetchItem
    
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(item.url)
                    .scaledFont(.body)
                    .lineLimit(2)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                
                Text(item.state.rawValue)
                    .scaledFont(.caption2)
                    .lineLimit(1)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .foregroundStyle(color(for: item.state))
                    .background(color(for: item.state).opacity(0.12), in: Capsule())
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

private struct StatChip: View {
    let label: String
    let value: String
    
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .scaledFont(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .scaledFont(.body)
                .fontWeight(.semibold)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.secondary.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}
#endif
