import SwiftUI

/// 已同步高亮记录调试视图
/// 用于查看和管理本地 UUID → blockId 映射记录
struct SyncedHighlightDebugView: View {
    @StateObject private var viewModel = SyncedHighlightDebugViewModel()
    @State private var showClearAllConfirmation = false
    @State private var expandedSources: Set<String> = []
    @State private var expandedBooks: Set<String> = []
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            headerView
            
            Divider()
            
            // Content
            if viewModel.isLoading {
                loadingView
            } else if let error = viewModel.errorMessage {
                errorView(error)
            } else if viewModel.sourceGroups.isEmpty {
                emptyView
            } else {
                recordsListView
            }
        }
        .frame(minWidth: 500, minHeight: 400)
        .onAppear {
            viewModel.loadAllRecords()
        }
        .confirmationDialog(
            "Clear All Synced Records?",
            isPresented: $showClearAllConfirmation,
            titleVisibility: .visible
        ) {
            Button("Clear All", role: .destructive) {
                viewModel.clearAllSourceRecords()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will remove all local UUID records. The next sync will re-fetch from Notion.")
        }
    }
    
    // MARK: - Header
    
    private var headerView: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Synced Highlight Records")
                    .font(.headline)
                Text("Local UUID → Notion Block ID mappings")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            
            Spacer()
            
            Text("\(viewModel.totalRecordCount) records")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(.quaternary)
                .clipShape(Capsule())
            
            Button {
                viewModel.loadAllRecords()
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonStyle(.borderless)
            .help("Refresh")
            
            Button(role: .destructive) {
                showClearAllConfirmation = true
            } label: {
                Image(systemName: "trash")
            }
            .buttonStyle(.borderless)
            .help("Clear All Records")
            .disabled(viewModel.sourceGroups.isEmpty)
        }
        .padding()
    }
    
    // MARK: - Loading
    
    private var loadingView: some View {
        VStack {
            ProgressView()
            Text("Loading records...")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    
    // MARK: - Error
    
    private func errorView(_ error: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.largeTitle)
                .foregroundStyle(.red)
            Text("Error loading records")
                .font(.headline)
            Text(error)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button("Retry") {
                viewModel.loadAllRecords()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
    
    // MARK: - Empty
    
    private var emptyView: some View {
        VStack(spacing: 12) {
            Image(systemName: "tray")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text("No synced records")
                .font(.headline)
            Text("Records will be created after syncing highlights to Notion")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
    
    // MARK: - Records List
    
    private var recordsListView: some View {
        List {
            ForEach(viewModel.sourceGroups) { sourceGroup in
                sourceSection(sourceGroup)
            }
        }
        .listStyle(.sidebar)
    }
    
    private func sourceSection(_ group: SourceRecordGroup) -> some View {
        DisclosureGroup(
            isExpanded: Binding(
                get: { expandedSources.contains(group.sourceKey) },
                set: { if $0 { expandedSources.insert(group.sourceKey) } else { expandedSources.remove(group.sourceKey) } }
            )
        ) {
            ForEach(group.books) { bookGroup in
                bookSection(bookGroup, sourceKey: group.sourceKey)
            }
        } label: {
            HStack {
                sourceIcon(group.sourceKey)
                Text(sourceDisplayName(group.sourceKey))
                    .font(.headline)
                Spacer()
                Text("\(group.books.count) books • \(group.totalCount) records")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                
                Button(role: .destructive) {
                    viewModel.clearAllRecords(sourceKey: group.sourceKey)
                } label: {
                    Image(systemName: "trash")
                        .font(.caption)
                }
                .buttonStyle(.borderless)
                .help("Clear all records for \(sourceDisplayName(group.sourceKey))")
            }
        }
    }
    
    private func bookSection(_ group: BookRecordGroup, sourceKey: String) -> some View {
        let bookKey = "\(sourceKey):\(group.bookId)"
        
        return DisclosureGroup(
            isExpanded: Binding(
                get: { expandedBooks.contains(bookKey) },
                set: { if $0 { expandedBooks.insert(bookKey) } else { expandedBooks.remove(bookKey) } }
            )
        ) {
            ForEach(group.records, id: \.uuid) { record in
                recordRow(record)
            }
        } label: {
            HStack {
                Image(systemName: "book.closed")
                    .foregroundStyle(.secondary)
                Text(truncatedBookId(group.bookId))
                    .font(.subheadline)
                    .lineLimit(1)
                Spacer()
                Text("\(group.records.count) highlights")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                
                Button(role: .destructive) {
                    viewModel.clearRecords(sourceKey: sourceKey, bookId: group.bookId)
                } label: {
                    Image(systemName: "trash")
                        .font(.caption2)
                }
                .buttonStyle(.borderless)
                .help("Clear records for this book")
            }
        }
        .padding(.leading, 16)
    }
    
    private func recordRow(_ record: SyncedHighlightRecordSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("UUID:")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(record.uuid)
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
            }
            HStack {
                Text("Block ID:")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(record.notionBlockId)
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
            }
            HStack {
                Text("Hash:")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(record.contentHash.prefix(16) + "...")
                    .font(.caption.monospaced())
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.leading, 32)
        .padding(.vertical, 4)
    }
    
    // MARK: - Helpers
    
    private func sourceIcon(_ sourceKey: String) -> some View {
        let (icon, color): (String, Color) = switch sourceKey {
        case "appleBooks": ("book.closed.fill", .orange)
        case "goodLinks": ("link", .blue)
        case "weRead": ("book.fill", .green)
        case "dedao": ("headphones", .purple)
        default: ("questionmark.circle", .gray)
        }
        
        return Image(systemName: icon)
            .foregroundStyle(color)
    }
    
    private func sourceDisplayName(_ sourceKey: String) -> String {
        switch sourceKey {
        case "appleBooks": return "Apple Books"
        case "goodLinks": return "GoodLinks"
        case "weRead": return "WeRead"
        case "dedao": return "Dedao"
        default: return sourceKey
        }
    }
    
    private func truncatedBookId(_ bookId: String) -> String {
        if bookId.count > 40 {
            return String(bookId.prefix(20)) + "..." + String(bookId.suffix(10))
        }
        return bookId
    }
}

#Preview {
    SyncedHighlightDebugView()
}


