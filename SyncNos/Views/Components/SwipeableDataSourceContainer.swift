import SwiftUI
import AppKit

/// 可滑动的数据源容器
/// 包含滑动区域和悬浮底部指示器
struct SwipeableDataSourceContainer<FilterMenu: View>: View {
    @ObservedObject var viewModel: DataSourceSwitchViewModel
    
    // 各数据源的 ViewModel
    @ObservedObject var appleBooksVM: AppleBooksViewModel
    @ObservedObject var goodLinksVM: GoodLinksViewModel
    @ObservedObject var weReadVM: WeReadViewModel
    
    // 选择状态绑定
    @Binding var selectedBookIds: Set<String>
    @Binding var selectedLinkIds: Set<String>
    @Binding var selectedWeReadBookIds: Set<String>
    
    // Filter 菜单
    @ViewBuilder var filterMenu: () -> FilterMenu
    
    // 滑动状态
    @State private var dragOffset: CGFloat = 0
    @State private var isDragging: Bool = false
    @State private var previousIndex: Int = 0
    
    var body: some View {
        ZStack(alignment: .bottom) {
            // 滑动区域
            if viewModel.hasEnabledSources {
                GeometryReader { geometry in
                    HStack(spacing: 0) {
                        ForEach(Array(viewModel.enabledDataSources.enumerated()), id: \.offset) { index, source in
                            dataSourceView(for: source)
                                .frame(width: geometry.size.width)
                        }
                    }
                    .offset(x: -CGFloat(viewModel.activeIndex) * geometry.size.width + dragOffset)
                    .animation(isDragging ? nil : .interactiveSpring(response: 0.3, dampingFraction: 0.8), value: viewModel.activeIndex)
                    .animation(isDragging ? nil : .interactiveSpring(response: 0.3, dampingFraction: 0.8), value: dragOffset)
                    .gesture(
                        DragGesture(minimumDistance: 30, coordinateSpace: .local)
                            .onChanged { value in
                                // 只处理水平滑动（水平位移大于垂直位移的 1.5 倍）
                                let horizontalAmount = abs(value.translation.width)
                                let verticalAmount = abs(value.translation.height)
                                
                                if horizontalAmount > verticalAmount * 1.5 {
                                    isDragging = true
                                    dragOffset = value.translation.width
                                }
                            }
                            .onEnded { value in
                                let threshold: CGFloat = geometry.size.width * 0.15
                                let horizontalAmount = abs(value.translation.width)
                                let verticalAmount = abs(value.translation.height)
                                
                                // 只有当水平滑动足够明显时才处理
                                if horizontalAmount > verticalAmount * 1.5 {
                                    let predictedEndOffset = value.predictedEndTranslation.width
                                    
                                    if predictedEndOffset < -threshold && viewModel.activeIndex < viewModel.enabledDataSources.count - 1 {
                                        // 向左滑动，切换到下一个
                                        previousIndex = viewModel.activeIndex
                                        viewModel.activeIndex += 1
                                        handleIndexChange(from: previousIndex, to: viewModel.activeIndex)
                                    } else if predictedEndOffset > threshold && viewModel.activeIndex > 0 {
                                        // 向右滑动，切换到上一个
                                        previousIndex = viewModel.activeIndex
                                        viewModel.activeIndex -= 1
                                        handleIndexChange(from: previousIndex, to: viewModel.activeIndex)
                                    }
                                }
                                
                                isDragging = false
                                dragOffset = 0
                            }
                    )
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
    
    private func handleIndexChange(from oldIndex: Int, to newIndex: Int) {
        guard oldIndex != newIndex else { return }
        
        // 触发触觉反馈
        viewModel.triggerHapticFeedback()
        
        // 清空所有选择
        selectedBookIds.removeAll()
        selectedLinkIds.removeAll()
        selectedWeReadBookIds.removeAll()
    }
}

#Preview {
    SwipeableDataSourceContainer(
        viewModel: DataSourceSwitchViewModel(),
        appleBooksVM: AppleBooksViewModel(),
        goodLinksVM: GoodLinksViewModel(),
        weReadVM: WeReadViewModel(),
        selectedBookIds: .constant([]),
        selectedLinkIds: .constant([]),
        selectedWeReadBookIds: .constant([]),
        filterMenu: {
            Menu {
                Text("Filter options")
            } label: {
                Image(systemName: "line.3.horizontal.decrease.circle")
            }
            .menuIndicator(.hidden)
        }
    )
    .frame(width: 300, height: 600)
}

