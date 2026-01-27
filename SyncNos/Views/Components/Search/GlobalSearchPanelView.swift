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
    @FocusState private var isResultsFocused: Bool
    @State private var panelWindow: NSWindow?
    @State private var panelKeyMonitor: Any?
    @State private var shouldFixQuerySelectionAfterFocus: Bool = false

    var body: some View {
        GeometryReader { geo in
            ZStack {
                // 背景遮罩
                Color.black.opacity(0.22)
                    .ignoresSafeArea()
                    .onTapGesture { isPresented = false }

                panel
                    .frame(
                        width: panelWidth(in: geo.size),
                        height: panelHeight(in: geo.size)
                    )
                    .padding(.horizontal, 22)
                    .padding(.vertical, 18)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onAppear {
            viewModel.updateEnabledSources(enabledSources)
            isQueryFocused = true
            isResultsFocused = false
            // 兜底：避免首次弹出时 SwiftUI 焦点未及时生效，导致键盘事件落回主窗口。
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                isQueryFocused = true
            }
            startPanelKeyMonitorIfNeeded()
        }
        .onChange(of: isQueryFocused) { _, newValue in
            guard newValue, shouldFixQuerySelectionAfterFocus else { return }
            shouldFixQuerySelectionAfterFocus = false
            // SwiftUI 切焦点到 TextField 时，AppKit 可能默认 selectAll；这里主动把光标放到末尾并取消全选。
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.01) {
                collapseFieldEditorSelectionToEnd()
            }
        }
        .onDisappear {
            stopPanelKeyMonitorIfNeeded()
        }
        .onChange(of: enabledSources) { _, newValue in
            viewModel.updateEnabledSources(newValue)
            viewModel.scheduleSearch()
        }
        .onExitCommand {
            isPresented = false
        }
        // 读取所在窗口，用于过滤 NSEvent（只拦截本窗口）
        .background(WindowReader(window: $panelWindow))
    }

    // MARK: - Panel

    private var panel: some View {
        VStack(spacing: 0) {
            header
            Divider()
            resultsList
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Color.secondary.opacity(0.12), lineWidth: 1)
        }
        .shadow(color: Color.black.opacity(0.20), radius: 22, x: 0, y: 12)
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

    @ViewBuilder
    private var resultsList: some View {
        if viewModel.results.isEmpty {
            emptyState
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(.horizontal, 2)
                .padding(.bottom, 2)
        } else {
            List(selection: $viewModel.selectedResultId) {
                ForEach(viewModel.results) { r in
                    resultRow(r)
                        .tag(r.id)
                        .id(r.id)
                }
            }
            .onChange(of: viewModel.selectedResultId) { _, _ in
                // 焦点在结果列表时，selection 变化来自用户导航；用于锁定自动选中逻辑
                if self.isResultsFocused {
                    self.viewModel.markUserSelectionInteraction()
                }
            }
            .listStyle(.inset)
            .scrollContentBackground(.hidden)
            .background(Color.clear)
            .focused($isResultsFocused)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.horizontal, 2)
            .padding(.bottom, 2)
        }
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
            // 单击也先同步 selection（让系统高亮与 Enter 行为一致）
            self.viewModel.selectedResultId = r.id
            self.viewModel.markUserSelectionInteraction()
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

    // MARK: - Keyboard Navigation

    /// 面板大小：随主窗口尺寸自适应，避免固定 720x520 显得突兀。
    private func panelWidth(in size: CGSize) -> CGFloat {
        let target: CGFloat = 760
        let maxWidth = max(520, size.width - 80)
        return min(target, maxWidth)
    }

    private func panelHeight(in size: CGSize) -> CGFloat {
        let target: CGFloat = 560
        let maxHeight = max(420, size.height - 120)
        return min(target, maxHeight)
    }

    private func hasMarkedTextInFieldEditor() -> Bool {
        // 中文/日文输入法候选选择期间，↑↓/Enter/Tab 等按键应交给输入法处理
        guard let w = panelWindow else { return false }
        guard let inputClient = w.firstResponder as? NSTextInputClient else { return false }
        return inputClient.hasMarkedText()
    }

    private func startPanelKeyMonitorIfNeeded() {
        guard panelKeyMonitor == nil else { return }
        panelKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            // 仅处理该面板所在窗口的事件
            if let w = self.panelWindow, event.window !== w {
                return event
            }

            // 输入法候选期间：完全交给系统，避免破坏候选选择/上屏体验
            if self.hasMarkedTextInFieldEditor() {
                return event
            }

            // 只处理“无修饰键”的面板导航；其他组合键交给系统/菜单项
            let modifiers = event.modifierFlags
            let hasCommand = modifiers.contains(.command)
            let hasOption = modifiers.contains(.option)
            let hasControl = modifiers.contains(.control)
            guard !hasCommand && !hasOption && !hasControl else {
                return event
            }

            switch event.keyCode {
            case 48: // Tab：切换过滤范围（Shift+Tab 反向）
                let forward = !modifiers.contains(.shift)
                DispatchQueue.main.async {
                    self.cycleScope(forward: forward)
                    self.isQueryFocused = true
                    self.isResultsFocused = false
                }
                return nil

            case 126: // ↑：把焦点切到结果列表，并移动选中项（系统焦点样式）
                if self.isQueryFocused {
                    DispatchQueue.main.async {
                        self.isResultsFocused = true
                        self.isQueryFocused = false
                        self.moveSelection(delta: -1)
                    }
                    return nil
                }
                // 已在列表：让系统 List 自己处理 ↑↓
                return event

            case 125: // ↓：把焦点切到结果列表，并移动选中项（系统焦点样式）
                if self.isQueryFocused {
                    DispatchQueue.main.async {
                        self.isResultsFocused = true
                        self.isQueryFocused = false
                        self.moveSelection(delta: 1)
                    }
                    return nil
                }
                return event

            case 123, 124: // ← / →：把焦点切回搜索框（下一次 ←/→ 才开始移动光标）
                if self.isResultsFocused {
                    DispatchQueue.main.async {
                        self.isQueryFocused = true
                        self.isResultsFocused = false
                        self.shouldFixQuerySelectionAfterFocus = true
                    }
                    return nil
                }
                return event

            case 36, 76: // Return / Enter：跳转到选中结果
                DispatchQueue.main.async {
                    self.navigateSelectedIfPossible()
                }
                return nil

            default:
                // ←/→ 等交给 TextField，用于光标移动
                return event
            }
        }
    }

    private func stopPanelKeyMonitorIfNeeded() {
        if let monitor = panelKeyMonitor {
            NSEvent.removeMonitor(monitor)
            panelKeyMonitor = nil
        }
    }

    /// 取消 TextField 获得焦点后的默认全选：把插入点放到文本末尾。
    private func collapseFieldEditorSelectionToEnd() {
        guard let w = panelWindow else { return }
        guard let tv = w.firstResponder as? NSTextView else { return }
        // 输入法候选期间不要干预选区
        if tv.hasMarkedText() { return }
        let length = (tv.string as NSString).length
        tv.setSelectedRange(NSRange(location: length, length: 0))
        tv.scrollRangeToVisible(NSRange(location: length, length: 0))
    }

    private func cycleScope(forward: Bool) {
        let scopes: [GlobalSearchScope] = [.allEnabled] + enabledSources.map { .source($0) }
        guard !scopes.isEmpty else { return }

        let currentIndex: Int = {
            if let idx = scopes.firstIndex(where: { $0 == viewModel.scope }) {
                return idx
            }
            return 0
        }()

        let nextIndex: Int = {
            if forward {
                return (currentIndex + 1) % scopes.count
            }
            return (currentIndex - 1 + scopes.count) % scopes.count
        }()

        viewModel.scope = scopes[nextIndex]
        viewModel.scheduleSearch()
    }

    private func moveSelection(delta: Int) {
        guard !viewModel.results.isEmpty else { return }

        let currentIndex: Int = {
            if let id = viewModel.selectedResultId,
               let idx = viewModel.results.firstIndex(where: { $0.id == id }) {
                return idx
            }
            return delta >= 0 ? -1 : viewModel.results.count
        }()

        let rawNext = currentIndex + delta
        let next = min(max(rawNext, 0), viewModel.results.count - 1)
        viewModel.selectedResultId = viewModel.results[next].id
    }
}
