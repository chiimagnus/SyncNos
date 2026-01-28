import SwiftUI

// MARK: - Detail Search Bar

/// Detail 顶部常驻搜索栏（⌘F 聚焦）
struct DetailSearchBar: View {
    @Binding var searchText: String
    let placeholder: String
    let isFocused: FocusState<Bool>.Binding
    let onPrev: () -> Void
    let onNext: () -> Void

    init(
        searchText: Binding<String>,
        placeholder: String = "搜索当前内容",
        isFocused: FocusState<Bool>.Binding,
        onPrev: @escaping () -> Void,
        onNext: @escaping () -> Void
    ) {
        self._searchText = searchText
        self.placeholder = placeholder
        self.isFocused = isFocused
        self.onPrev = onPrev
        self.onNext = onNext
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)

            TextField(placeholder, text: $searchText)
                .textFieldStyle(.plain)
                .focused(isFocused)
                .onSubmit { onNext() }

            if !searchText.isEmpty {
                Button {
                    searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .help("清空")
            }

            Divider().frame(height: 16)

            Button(action: onPrev) {
                Image(systemName: "chevron.up")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .help("上一个")

            Button(action: onNext) {
                Image(systemName: "chevron.down")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .help("下一个")
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

