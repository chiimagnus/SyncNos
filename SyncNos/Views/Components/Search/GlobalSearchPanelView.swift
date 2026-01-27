import SwiftUI
import AppKit

// MARK: - Global Search Panel

/// Notion 风格的全局搜索面板（⌘K 打开）
struct GlobalSearchPanelView: View {
    @Binding var isPresented: Bool
    let enabledSources: [ContentSource]
    let onNavigate: (GlobalSearchNavigationTarget) -> Void

    @StateObject private var viewModel = GlobalSearchViewModel()
    @FocusState private var isQueryFocused: Bool

    var body: some View {
        ZStack {
            // 背景遮罩
            Color.black.opacity(0.22)
                .ignoresSafeArea()
                .onTapGesture { isPresented = false }

            panel
        }
        .onAppear {
            viewModel.updateEnabledSources(enabledSources)
            isQueryFocused = true
        }
        .onChange(of: enabledSources) { _, newValue in
            viewModel.updateEnabledSources(newValue)
            viewModel.scheduleSearch()
        }
        .onExitCommand {
            isPresented = false
        }
    }

    // MARK: - Panel

    private var panel: some View {
        VStack(spacing: 0) {
            header
            Divider()
            resultsList
        }
        .frame(width: 720, height: 520)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color(NSColor.windowBackgroundColor))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(Color.secondary.opacity(0.12), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.18), radius: 18, x: 0, y: 10)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .foregroundColor(.secondary)

                TextField("搜索：标题 / 作者 / 高亮 / 正文 / 消息", text: $viewModel.query)
                    .textFieldStyle(.plain)
                    .focused($isQueryFocused)
                    .onChange(of: viewModel.query) { _, _ in
                        viewModel.scheduleSearch()
                    }
                    .onSubmit {
                        navigateSelectedIfPossible()
                    }

                if !viewModel.query.isEmpty {
                    Button {
                        viewModel.query = ""
                        viewModel.scheduleSearch()
                        isQueryFocused = true
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(.plain)
                    .help("清空")
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)

            scopePicker
                .padding(.horizontal, 14)
                .padding(.bottom, 12)
        }
    }

    private var scopePicker: some View {
        HStack(spacing: 8) {
            scopeChip(title: "全部", isSelected: isAllScopeSelected) {
                viewModel.scope = .allEnabled
                viewModel.scheduleSearch()
            }

            ForEach(enabledSources, id: \.rawValue) { s in
                scopeChip(title: s.displayName, isSelected: isSourceSelected(s)) {
                    viewModel.scope = .source(s)
                    viewModel.scheduleSearch()
                }
            }

            Spacer()

            if viewModel.isSearching {
                HStack(spacing: 6) {
                    ProgressView().scaleEffect(0.7)
                    Text("搜索中…")
                        .scaledFont(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
    }

    private func scopeChip(title: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .scaledFont(.caption)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(isSelected ? Color.accentColor.opacity(0.16) : Color.gray.opacity(0.10))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(isSelected ? Color.accentColor.opacity(0.35) : Color.secondary.opacity(0.10), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    private var isAllScopeSelected: Bool {
        if case .allEnabled = viewModel.scope { return true }
        return false
    }

    private func isSourceSelected(_ s: ContentSource) -> Bool {
        if case .source(let selected) = viewModel.scope { return selected == s }
        return false
    }

    // MARK: - Results

    private var resultsList: some View {
        Group {
            if viewModel.results.isEmpty {
                emptyState
            } else {
                List(selection: $viewModel.selectedResultId) {
                    ForEach(viewModel.results) { r in
                        resultRow(r)
                            .tag(r.id)
                    }
                }
                .listStyle(.inset)
                .scrollContentBackground(.hidden)
                .background(Color.clear)
                .onSubmit {
                    navigateSelectedIfPossible()
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.horizontal, 2)
        .padding(.bottom, 2)
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 28))
                .foregroundStyle(.secondary)
            Text(viewModel.query.isEmpty ? "输入关键词开始搜索" : "没有找到匹配结果")
                .scaledFont(.body)
                .foregroundStyle(.secondary)
            if let err = viewModel.errorMessage, !err.isEmpty {
                Text(err)
                    .scaledFont(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func resultRow(_ r: GlobalSearchResult) -> some View {
        Button {
            onNavigate(r.navigationTarget)
            NotificationCenter.default.post(name: .globalSearchNavigateRequested, object: nil, userInfo: r.navigationTarget.userInfo)
            isPresented = false
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: r.source.iconName)
                    .foregroundColor(r.source.accentColor)
                    .frame(width: 18, height: 18)

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text(r.containerTitle)
                            .scaledFont(.body, weight: .semibold)
                            .foregroundColor(.primary)
                            .lineLimit(1)
                        if let sub = r.containerSubtitle, !sub.isEmpty {
                            Text(sub)
                                .scaledFont(.caption)
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                        }
                        Spacer()
                        Text(r.kind == .textBlock ? "内容" : "标题")
                            .scaledFont(.caption2)
                            .foregroundColor(.secondary)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(
                                RoundedRectangle(cornerRadius: 6)
                                    .fill(Color.gray.opacity(0.10))
                            )
                    }

                    HighlightedText(text: r.snippet, matchRangesUTF16: r.snippetMatchRangesUTF16)
                        .scaledFont(.callout)
                        .foregroundColor(.primary)
                        .lineLimit(2)
                }
            }
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
    }

    private func navigateSelectedIfPossible() {
        guard let id = viewModel.selectedResultId,
              let r = viewModel.results.first(where: { $0.id == id }) else { return }
        onNavigate(r.navigationTarget)
        NotificationCenter.default.post(name: .globalSearchNavigateRequested, object: nil, userInfo: r.navigationTarget.userInfo)
        isPresented = false
    }
}
