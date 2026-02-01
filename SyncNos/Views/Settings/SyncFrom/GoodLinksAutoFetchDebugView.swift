import SwiftUI

// MARK: - GoodLinks Auto Fetch Debug View

#if DEBUG
struct GoodLinksAutoFetchDebugView: View {
    @Environment(\.dismiss) private var dismiss
    
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
        GroupBox("Recent Events") {
            if snapshot.recentEvents.isEmpty {
                Text("No events")
                    .scaledFont(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        ForEach(snapshot.recentEvents.reversed()) { event in
                            eventRow(event)
                                .padding(.vertical, 6)
                            Divider()
                        }
                    }
                    .padding(.vertical, 8)
                }
            }
        }
        .frame(minWidth: 380)
    }
    
    private func eventRow(_ event: GoodLinksAutoFetchEvent) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Text(event.time.formatted(date: .omitted, time: .standard))
                    .scaledFont(.caption)
                    .foregroundStyle(.secondary)
                
                Text(event.kind.rawValue)
                    .scaledFont(.caption)
                    .foregroundStyle(color(for: event.kind))
                    .fontWeight(.semibold)
                
                Spacer()
            }
            
            if !event.url.isEmpty {
                Text(event.url)
                    .scaledFont(.caption)
                    .textSelection(.enabled)
            }
            
            if let message = event.message, !message.isEmpty {
                Text(message)
                    .scaledFont(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
    
    private func color(for kind: GoodLinksAutoFetchEventKind) -> Color {
        switch kind {
        case .enqueued, .started:
            return .blue
        case .cacheHit:
            return .secondary
        case .succeeded:
            return .green
        case .noContent, .failed:
            return .red
        case .skipped:
            return .orange
        case .reset:
            return .purple
        }
    }
    
    private func refreshLoop() async {
        while !Task.isCancelled {
            snapshot = await service.snapshot()
            try? await Task.sleep(nanoseconds: 500_000_000)
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

