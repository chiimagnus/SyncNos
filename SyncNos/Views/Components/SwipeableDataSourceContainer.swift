import SwiftUI
import AppKit

/// 可滑动的数据源容器
/// 包含滑动区域和悬浮底部指示器
/// 使用触控板双指水平滑动（swipe gesture）切换数据源，不与 List 垂直滚动冲突
struct SwipeableDataSourceContainer<FilterMenu: View>: View {
    @ObservedObject var viewModel: DataSourceSwitchViewModel
    
    // 各数据源的 ViewModel
    @ObservedObject var appleBooksVM: AppleBooksViewModel
    @ObservedObject var goodLinksVM: GoodLinksViewModel
    @ObservedObject var weReadVM: WeReadViewModel
    @ObservedObject var dedaoVM: DedaoViewModel
    
    // 选择状态绑定
    @Binding var selectedBookIds: Set<String>
    @Binding var selectedLinkIds: Set<String>
    @Binding var selectedWeReadBookIds: Set<String>
    @Binding var selectedDedaoBookIds: Set<String>
    
    // Filter 菜单
    @ViewBuilder var filterMenu: () -> FilterMenu
    
    // 触控板滑动监听器
    @StateObject private var swipeHandler = TrackpadSwipeHandler()
    
    /// 底部栏的高度（用于内容区域的底部空间）
    private let bottomBarHeight: CGFloat = 20
    
    var body: some View {
        ZStack(alignment: .bottom) {
            // 滑动区域
            if viewModel.hasEnabledSources {
                GeometryReader { geometry in
                    HStack(spacing: 0) {
                        ForEach(Array(viewModel.enabledDataSources.enumerated()), id: \.offset) { _, source in
                            dataSourceView(for: source)
                                .frame(width: geometry.size.width)
                                .safeAreaInset(edge: .bottom) {
                                    // 底部空间，避免被底部栏遮挡
                                    Color.clear.frame(height: bottomBarHeight)
                                }
                        }
                    }
                    .offset(x: -CGFloat(viewModel.activeIndex) * geometry.size.width)
                    .animation(.interactiveSpring(response: 0.3, dampingFraction: 0.8), value: viewModel.activeIndex)
                }
            } else {
                emptyStateView
            }
            
            // 悬浮底部栏：指示器 + Filter 按钮
            if viewModel.hasEnabledSources {
                HStack(spacing: 8) {
                    // 左侧：数据源指示器（只在多数据源时显示）
                    if viewModel.enabledDataSources.count > 1 {
                        DataSourceIndicatorBar(viewModel: viewModel)
                    }
                    
                    Spacer()
                    
                    // 右侧：Filter 按钮
                    filterMenu()
                        .buttonStyle(.plain)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                        .background(
                            Capsule()
                                .fill(.ultraThinMaterial)
                                .shadow(color: .black.opacity(0.1), radius: 4, x: 0, y: 2)
                        )
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 8)
            }
        }
        // 根据当前活动的 DataSource 设置 SelectionCommands
        .focusedSceneValue(\.selectionCommands, currentSelectionCommands)
        // 监听触控板滑动事件
        .onAppear {
            swipeHandler.onSwipeLeft = { [weak viewModel] in
                guard let vm = viewModel else { return }
                // 切换到下一个数据源
                if vm.activeIndex < vm.enabledDataSources.count - 1 {
                    vm.switchTo(index: vm.activeIndex + 1)
                    clearAllSelections()
                }
            }
            swipeHandler.onSwipeRight = { [weak viewModel] in
                guard let vm = viewModel else { return }
                // 切换到上一个数据源
                if vm.activeIndex > 0 {
                    vm.switchTo(index: vm.activeIndex - 1)
                    clearAllSelections()
                }
            }
            swipeHandler.startListening()
        }
        .onDisappear {
            swipeHandler.stopListening()
        }
    }
    
    // MARK: - Computed Properties
    
    /// 根据当前活动的 DataSource 返回对应的 SelectionCommands
    private var currentSelectionCommands: SelectionCommands {
        guard let currentSource = viewModel.currentDataSource else {
            return SelectionCommands(
                selectAll: {},
                deselectAll: {},
                canSelectAll: { false },
                canDeselect: { false }
            )
        }
        
        switch currentSource {
        case .appleBooks:
            return SelectionCommands(
                selectAll: {
                    let all = Set(appleBooksVM.displayBooks.map { $0.bookId })
                    if !all.isEmpty { selectedBookIds = all }
                },
                deselectAll: {
                    selectedBookIds.removeAll()
                },
                canSelectAll: {
                    let total = appleBooksVM.displayBooks.count
                    return total > 0 && selectedBookIds.count < total
                },
                canDeselect: {
                    !selectedBookIds.isEmpty
                }
            )
        case .goodLinks:
            return SelectionCommands(
                selectAll: {
                    let all = Set(goodLinksVM.displayLinks.map { $0.id })
                    if !all.isEmpty { selectedLinkIds = all }
                },
                deselectAll: {
                    selectedLinkIds.removeAll()
                },
                canSelectAll: {
                    let total = goodLinksVM.displayLinks.count
                    return total > 0 && selectedLinkIds.count < total
                },
                canDeselect: {
                    !selectedLinkIds.isEmpty
                }
            )
        case .weRead:
            return SelectionCommands(
                selectAll: {
                    let all = Set(weReadVM.displayBooks.map { $0.bookId })
                    if !all.isEmpty { selectedWeReadBookIds = all }
                },
                deselectAll: {
                    selectedWeReadBookIds.removeAll()
                },
                canSelectAll: {
                    let total = weReadVM.displayBooks.count
                    return total > 0 && selectedWeReadBookIds.count < total
                },
                canDeselect: {
                    !selectedWeReadBookIds.isEmpty
                }
            )
        case .dedao:
            return SelectionCommands(
                selectAll: {
                    let all = Set(dedaoVM.displayBooks.map { $0.bookId })
                    if !all.isEmpty { selectedDedaoBookIds = all }
                },
                deselectAll: {
                    selectedDedaoBookIds.removeAll()
                },
                canSelectAll: {
                    let total = dedaoVM.displayBooks.count
                    return total > 0 && selectedDedaoBookIds.count < total
                },
                canDeselect: {
                    !selectedDedaoBookIds.isEmpty
                }
            )
        }
    }
    
    // MARK: - Private Views
    
    @ViewBuilder
    private func dataSourceView(for source: ContentSource) -> some View {
        switch source {
        case .appleBooks:
            AppleBooksListView(viewModel: appleBooksVM, selectionIds: $selectedBookIds)
        case .goodLinks:
            GoodLinksListView(viewModel: goodLinksVM, selectionIds: $selectedLinkIds)
        case .weRead:
            WeReadListView(viewModel: weReadVM, selectionIds: $selectedWeReadBookIds)
        case .dedao:
            DedaoListView(viewModel: dedaoVM, selectionIds: $selectedDedaoBookIds)
        }
    }
    
    private var emptyStateView: some View {
        VStack(spacing: 16) {
            Image(systemName: "books.vertical")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)
            Text("No data sources enabled")
                .font(.title3)
                .fontWeight(.semibold)
            Text("Please enable at least one source in Settings.")
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
    
    // MARK: - Private Methods
    
    /// 清空所有数据源的选择
    private func clearAllSelections() {
        selectedBookIds.removeAll()
        selectedLinkIds.removeAll()
        selectedWeReadBookIds.removeAll()
        selectedDedaoBookIds.removeAll()
    }
}

// MARK: - Trackpad Swipe Handler

/// 触控板双指水平滑动监听器
/// 监听 macOS 的 swipe 手势事件（类似 Safari 前进/后退）
final class TrackpadSwipeHandler: ObservableObject {
    
    /// 向左滑动回调（切换到下一个）
    var onSwipeLeft: (() -> Void)?
    
    /// 向右滑动回调（切换到上一个）
    var onSwipeRight: (() -> Void)?
    
    private var scrollEventMonitor: Any?
    
    // 累积的水平滚动量
    private var accumulatedScrollX: CGFloat = 0
    // 滚动开始时间
    private var scrollStartTime: Date?
    // 滚动阈值（触发切换所需的累积量）
    private let scrollThreshold: CGFloat = 50
    // 滚动超时时间（秒）
    private let scrollTimeout: TimeInterval = 0.3
    // 是否已触发切换（防止重复触发）
    private var hasTriggered: Bool = false
    
    deinit {
        // 在 deinit 中直接移除监听器（非 @MainActor 隔离）
        if let monitor = scrollEventMonitor {
            NSEvent.removeMonitor(monitor)
            scrollEventMonitor = nil
        }
    }
    
    /// 开始监听触控板滑动事件
    func startListening() {
        guard scrollEventMonitor == nil else { return }
        
        // 监听滚动事件（触控板双指滑动会产生 scrollWheel 事件）
        scrollEventMonitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self] event in
            self?.handleScrollEvent(event)
            return event
        }
    }
    
    /// 停止监听
    func stopListening() {
        if let monitor = scrollEventMonitor {
            NSEvent.removeMonitor(monitor)
            scrollEventMonitor = nil
        }
    }
    
    private func handleScrollEvent(_ event: NSEvent) {
        // 只处理触控板事件（phase 不为 .none 表示是触控板）
        guard event.phase != [] || event.momentumPhase != [] else { return }
        
        let deltaX = event.scrollingDeltaX
        let deltaY = event.scrollingDeltaY
        
        // 只处理水平滚动为主的情况
        guard abs(deltaX) > abs(deltaY) * 1.5 else {
            // 垂直滚动为主，重置状态
            resetScrollState()
            return
        }
        
        // 处理滚动开始
        if event.phase == .began {
            scrollStartTime = Date()
            accumulatedScrollX = 0
            hasTriggered = false
        }
        
        // 累积水平滚动量
        accumulatedScrollX += deltaX
        
        // 检查是否超时
        if let startTime = scrollStartTime, Date().timeIntervalSince(startTime) > scrollTimeout {
            resetScrollState()
            return
        }
        
        // 检查是否达到阈值并触发
        if !hasTriggered {
            if accumulatedScrollX > scrollThreshold {
                // 向右滑动（deltaX 为正 = 手指向右 = 切换到上一个）
                hasTriggered = true
                DispatchQueue.main.async { [weak self] in
                    self?.onSwipeRight?()
                }
            } else if accumulatedScrollX < -scrollThreshold {
                // 向左滑动（deltaX 为负 = 手指向左 = 切换到下一个）
                hasTriggered = true
                DispatchQueue.main.async { [weak self] in
                    self?.onSwipeLeft?()
                }
            }
        }
        
        // 处理滚动结束
        if event.phase == .ended || event.phase == .cancelled {
            resetScrollState()
        }
    }
    
    private func resetScrollState() {
        accumulatedScrollX = 0
        scrollStartTime = nil
        hasTriggered = false
    }
}

// Preview disabled due to dependency injection requirements
// #Preview {
//     SwipeableDataSourceContainer(...)
// }

