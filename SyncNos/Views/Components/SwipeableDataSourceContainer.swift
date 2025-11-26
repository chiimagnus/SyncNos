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
    @State private var previousIndex: Int = 0
    
    // 数据源名称提示状态
    @State private var showDataSourceLabel: Bool = false
    @State private var hideDataSourceLabelTask: Task<Void, Never>?
    
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
                    .animation(.interactiveSpring(response: 0.3, dampingFraction: 0.8), value: viewModel.activeIndex)
                    .highPriorityGesture(
                        DragGesture(minimumDistance: 20)
                            .onChanged { value in
                                // 只处理水平滑动（水平位移大于垂直位移）
                                if abs(value.translation.width) > abs(value.translation.height) {
                                    dragOffset = value.translation.width
                                }
                            }
                            .onEnded { value in
                                let threshold: CGFloat = geometry.size.width * 0.15
                                let predictedEndOffset = value.predictedEndTranslation.width
                                
                                withAnimation(.interactiveSpring(response: 0.3, dampingFraction: 0.8)) {
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
                                    dragOffset = 0
                                }
                            }
                    )
                }
            } else {
                emptyStateView
            }
            
            // 悬浮底部栏：指示器 + Filter 按钮
            if viewModel.hasEnabledSources {
                VStack(spacing: 6) {
                    // 数据源名称提示（切换时临时显示）
                    if showDataSourceLabel, let currentSource = viewModel.currentDataSource {
                        Text(currentSource.displayName)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(currentSource.accentColor)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(
                                Capsule()
                                    .fill(.ultraThinMaterial)
                                    .shadow(color: .black.opacity(0.1), radius: 4, x: 0, y: 2)
                            )
                            .transition(.opacity.combined(with: .scale(scale: 0.9)))
                    }
                    
                    GeometryReader { bottomGeometry in
                        HStack(spacing: 8) {
                            // 左侧：数据源指示器（只在多数据源时显示）
                            if viewModel.enabledDataSources.count > 1 {
                                // 当宽度小于 200 或数据源超过 3 个时使用紧凑模式
                                let useCompactMode = bottomGeometry.size.width < 200 || viewModel.enabledDataSources.count > 3
                                DataSourceIndicatorBar(viewModel: viewModel, compactMode: useCompactMode)
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
                        .frame(maxWidth: .infinity, alignment: .bottom)
                    }
                    .frame(height: 40)
                }
                .padding(.bottom, 8)
            }
        }
        .onChange(of: viewModel.activeIndex) { _, _ in
            showDataSourceLabelTemporarily()
        }
    }
    
    // MARK: - Data Source Label
    
    private func showDataSourceLabelTemporarily() {
        // 取消之前的隐藏任务
        hideDataSourceLabelTask?.cancel()
        
        // 显示标签
        withAnimation(.easeOut(duration: 0.2)) {
            showDataSourceLabel = true
        }
        
        // 1.5 秒后隐藏
        hideDataSourceLabelTask = Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            if !Task.isCancelled {
                await MainActor.run {
                    withAnimation(.easeIn(duration: 0.3)) {
                        showDataSourceLabel = false
                    }
                }
            }
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

