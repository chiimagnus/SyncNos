import SwiftUI

// MARK: - Detail Search Bar

/// Detail 顶部常驻搜索栏（⌘F 聚焦）
struct DetailSearchBar: View {
    @Binding var searchText: String
    let placeholder: String
    let isFocused: FocusState<Bool>.Binding

    init(
        searchText: Binding<String>,
        placeholder: String = "Search current content",
        isFocused: FocusState<Bool>.Binding
    ) {
        self._searchText = searchText
        self.placeholder = placeholder
        self.isFocused = isFocused
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)

            TextField(placeholder, text: $searchText)
                .textFieldStyle(.plain)
                .focused(isFocused)

            if !searchText.isEmpty {
                Button {
                    searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help("Clear")
            }

        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.secondary.opacity(0.10), lineWidth: 1)
        }
    }
}
