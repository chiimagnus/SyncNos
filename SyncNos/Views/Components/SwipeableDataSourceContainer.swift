import SwiftUI
import AppKit

/// 可滑动的数据源容器
/// 包含滑动区域和悬浮底部指示器
struct SwipeableDataSourceContainer: View {
    @ObservedObject var viewModel: DataSourceSwitchViewModel
    
    // 各数据源的 ViewModel
    @ObservedObject var appleBooksVM: AppleBooksViewModel
    @ObservedObject var goodLinksVM: GoodLinksViewModel
    @ObservedObject var weReadVM: WeReadViewModel
    
    // 选择状态绑定
    @Binding var selectedBookIds: Set<String>
    @Binding var selectedLinkIds: Set<String>
    @Binding var selectedWeReadBookIds: Set<String>
    
    // 滑动状态
    @State private var dragOffset: CGFloat = 0
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
            
            // 悬浮底部指示器
            if viewModel.hasEnabledSources && viewModel.enabledDataSources.count > 1 {
                DataSourceIndicatorBar(viewModel: viewModel)
                    .padding(.bottom, 8)
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
        selectedWeReadBookIds: .constant([])
    )
    .frame(width: 300, height: 600)
}

