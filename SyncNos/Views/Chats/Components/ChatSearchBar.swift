import SwiftUI

/// Chat search and filter bar
struct ChatSearchBar: View {
    @Binding var searchText: String
    @Binding var filterSender: String?
    @Binding var filterKind: ChatMessageKind?
    
    let availableSenders: [String]
    
    @State private var isExpanded = false
    @Environment(\.fontScale) private var fontScale
    
    var body: some View {
        VStack(spacing: 8) {
            // Search field
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.secondary)
                
                TextField("Search messages...", text: $searchText)
                    .textFieldStyle(.plain)
                
                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(.plain)
                }
                
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        isExpanded.toggle()
                    }
                } label: {
                    Image(systemName: isExpanded ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                        .foregroundColor(hasActiveFilters ? .accentColor : .secondary)
                }
                .buttonStyle(.plain)
                .help("Filter options")
            }
            .padding(8)
            .background(Color(NSColor.controlBackgroundColor))
            .cornerRadius(8)
            
            // Filter options (expandable)
            if isExpanded {
                VStack(alignment: .leading, spacing: 8) {
                    // Sender filter
                    if !availableSenders.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Sender:")
                                .scaledFont(.caption)
                                .foregroundColor(.secondary)
                            
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 8) {
                                    FilterChip(
                                        title: "All",
                                        isSelected: filterSender == nil,
                                        onTap: { filterSender = nil }
                                    )
                                    
                                    ForEach(availableSenders, id: \.self) { sender in
                                        FilterChip(
                                            title: sender,
                                            isSelected: filterSender == sender,
                                            onTap: { filterSender = sender }
                                        )
                                    }
                                }
                            }
                        }
                    }
                    
                    // Message type filter
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Type:")
                            .scaledFont(.caption)
                            .foregroundColor(.secondary)
                        
                        HStack(spacing: 8) {
                            FilterChip(
                                title: "All",
                                isSelected: filterKind == nil,
                                onTap: { filterKind = nil }
                            )
                            
                            FilterChip(
                                title: "Text",
                                systemImage: "text.bubble",
                                isSelected: filterKind == .text,
                                onTap: { filterKind = .text }
                            )
                            
                            FilterChip(
                                title: "System",
                                systemImage: "info.circle",
                                isSelected: filterKind == .system,
                                onTap: { filterKind = .system }
                            )
                        }
                    }
                    
                    // Clear all filters button
                    if hasActiveFilters {
                        Button {
                            clearAllFilters()
                        } label: {
                            Label("Clear All Filters", systemImage: "xmark.circle")
                                .scaledFont(.caption)
                        }
                        .buttonStyle(.plain)
                        .foregroundColor(.accentColor)
                    }
                }
                .padding(8)
                .background(Color(NSColor.controlBackgroundColor).opacity(0.5))
                .cornerRadius(8)
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
    }
    
    private var hasActiveFilters: Bool {
        filterSender != nil || filterKind != nil
    }
    
    private func clearAllFilters() {
        filterSender = nil
        filterKind = nil
    }
}

/// Reusable filter chip component
private struct FilterChip: View {
    let title: String
    var systemImage: String?
    let isSelected: Bool
    let onTap: () -> Void
    
    var body: some View {
        Button {
            onTap()
        } label: {
            HStack(spacing: 4) {
                if let image = systemImage {
                    Image(systemName: image)
                        .font(.caption)
                }
                Text(title)
                    .scaledFont(.caption)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(isSelected ? Color.accentColor : Color.secondary.opacity(0.15))
            )
            .foregroundColor(isSelected ? .white : .primary)
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    ChatSearchBar(
        searchText: .constant(""),
        filterSender: .constant(nil),
        filterKind: .constant(nil),
        availableSenders: ["Alice", "Bob", "Charlie"]
    )
    .applyFontScale()
    .frame(width: 400)
}
