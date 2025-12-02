import SwiftUI
import AppKit

/// 可滑动的数据源容器
/// 包含滑动区域和悬浮底部指示器
/// 使用触控板双指水平滑动切换数据源
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
                                    Color.clear.frame(height: bottomBarHeight)
                                }
                        }
                    }
                    .offset(x: -CGFloat(viewModel.activeIndex) * geometry.size.width)
                    .animation(.timingCurve(0.2, 0.0, 0.0, 1.0, duration: 0.2), value: viewModel.activeIndex)
                }
                .background(
                    TrackpadSwipeDetector(
                        onSwipeLeft: {
                            let maxIndex = viewModel.enabledDataSources.count - 1
                            if viewModel.activeIndex < maxIndex {
                                viewModel.switchTo(index: viewModel.activeIndex + 1)
                                clearAllSelections()
                            }
                        },
                        onSwipeRight: {
                            if viewModel.activeIndex > 0 {
                                viewModel.switchTo(index: viewModel.activeIndex - 1)
                                clearAllSelections()
                            }
                        }
                    )
                )
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

// MARK: - Trackpad Swipe Detector

/// 触控板双指水平滑动检测器
/// 简单可靠的实现：检测滑动手势，触发切换回调
struct TrackpadSwipeDetector: NSViewRepresentable {
    let onSwipeLeft: () -> Void
    let onSwipeRight: () -> Void
    
    func makeNSView(context: Context) -> SwipeDetectorView {
        let view = SwipeDetectorView()
        view.onSwipeLeft = onSwipeLeft
        view.onSwipeRight = onSwipeRight
        return view
    }
    
    func updateNSView(_ nsView: SwipeDetectorView, context: Context) {
        nsView.onSwipeLeft = onSwipeLeft
        nsView.onSwipeRight = onSwipeRight
    }
}

/// 检测触控板滑动的 NSView
final class SwipeDetectorView: NSView {
    var onSwipeLeft: (() -> Void)?
    var onSwipeRight: (() -> Void)?
    
    // 滑动状态
    private var accumulatedScrollX: CGFloat = 0
    private var isTracking = false
    private var lastSwipeTime: Date?
    
    // 阈值
    private let swipeThreshold: CGFloat = 50
    private let cooldownInterval: TimeInterval = 0.3
    
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        // 允许触控板事件
        wantsLayer = true
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    override func scrollWheel(with event: NSEvent) {
        // 只处理触控板事件
        guard event.phase != [] || event.momentumPhase != [] else {
            super.scrollWheel(with: event)
            return
        }
        
        let deltaX = event.scrollingDeltaX
        let deltaY = event.scrollingDeltaY
        
        // 开始新的滑动
        if event.phase == .began {
            accumulatedScrollX = 0
            isTracking = abs(deltaX) > abs(deltaY) * 1.5
        }
        
        // 如果不是水平滑动，传递给父视图
        guard isTracking else {
            super.scrollWheel(with: event)
            return
        }
        
        // 累积水平滚动量
        accumulatedScrollX += deltaX
        
        // 滑动结束时检查是否触发切换
        if event.phase == .ended || event.phase == .cancelled {
            // 检查冷却时间
            if let lastTime = lastSwipeTime, Date().timeIntervalSince(lastTime) < cooldownInterval {
                resetState()
                return
            }
            
            // 检查是否达到阈值
            if accumulatedScrollX > swipeThreshold {
                lastSwipeTime = Date()
                DispatchQueue.main.async { [weak self] in
                    self?.onSwipeRight?()
                }
            } else if accumulatedScrollX < -swipeThreshold {
                lastSwipeTime = Date()
                DispatchQueue.main.async { [weak self] in
                    self?.onSwipeLeft?()
                }
            }
            
            resetState()
        }
    }
    
    private func resetState() {
        accumulatedScrollX = 0
        isTracking = false
    }
}

// Preview disabled due to dependency injection requirements
// #Preview {
//     SwipeableDataSourceContainer(...)
// }

