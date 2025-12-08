import SwiftUI

/// 数据源指示器栏
/// 悬浮显示在侧边栏底部，用于显示和切换当前数据源
/// 支持拖拽排序以自定义数据源顺序
struct DataSourceIndicatorBar: View {
    @ObservedObject var viewModel: DataSourceSwitchViewModel
    
    /// 当前正在拖拽的数据源
    @State private var draggingSource: ContentSource?
    /// 拖拽时的临时顺序（用于预览效果）
    @State private var draggedOrder: [ContentSource]?
    
    /// 显示用的数据源列表（拖拽时使用临时顺序）
    private var displaySources: [ContentSource] {
        draggedOrder ?? viewModel.enabledDataSources
    }
    
    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(displaySources.enumerated()), id: \.element) { index, source in
                DataSourceIndicatorItem(
                    source: source,
                    isActive: viewModel.activeIndex == viewModel.enabledDataSources.firstIndex(of: source),
                    isDragging: draggingSource == source
                ) {
                    if let actualIndex = viewModel.enabledDataSources.firstIndex(of: source) {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            viewModel.switchTo(index: actualIndex)
                        }
                    }
                }
                .onDrag {
                    draggingSource = source
                    return NSItemProvider(object: source.rawValue as NSString)
                }
                .onDrop(of: [.text], delegate: DataSourceDropDelegate(
                    source: source,
                    sources: viewModel.enabledDataSources,
                    draggingSource: $draggingSource,
                    draggedOrder: $draggedOrder,
                    viewModel: viewModel
                ))
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .glassCapsuleBackground()
        .animation(.easeInOut(duration: 0.2), value: draggedOrder)
    }
}

/// 拖放代理：处理数据源的拖拽排序
private struct DataSourceDropDelegate: DropDelegate {
    let source: ContentSource
    let sources: [ContentSource]
    @Binding var draggingSource: ContentSource?
    @Binding var draggedOrder: [ContentSource]?
    let viewModel: DataSourceSwitchViewModel
    
    func dropEntered(info: DropInfo) {
        guard let dragging = draggingSource, dragging != source else { return }
        
        // 使用当前顺序或启用的数据源列表
        var currentOrder = draggedOrder ?? sources
        
        guard let fromIndex = currentOrder.firstIndex(of: dragging),
              let toIndex = currentOrder.firstIndex(of: source) else { return }
        
        // 移动元素
        currentOrder.move(fromOffsets: IndexSet(integer: fromIndex), toOffset: toIndex > fromIndex ? toIndex + 1 : toIndex)
        
        withAnimation(.easeInOut(duration: 0.15)) {
            draggedOrder = currentOrder
        }
    }
    
    func performDrop(info: DropInfo) -> Bool {
        // 保存新顺序到 UserDefaults
        if let newOrder = draggedOrder {
            saveNewOrder(newOrder)
        }
        
        // 重置拖拽状态
        draggingSource = nil
        draggedOrder = nil
        
        return true
    }
    
    func dropExited(info: DropInfo) {
        // 拖出时不重置，保持预览效果
    }
    
    func dropUpdated(info: DropInfo) -> DropProposal? {
        DropProposal(operation: .move)
    }
    
    /// 保存新的数据源顺序
    private func saveNewOrder(_ enabledOrder: [ContentSource]) {
        // 获取当前完整的自定义顺序
        let fullOrder = ContentSource.customOrder
        
        // 根据新的启用顺序重新排列
        // 思路：将启用的数据源按新顺序排列，未启用的保持原位置
        let disabledSources = fullOrder.filter { !sources.contains($0) }
        
        // 构建新的完整顺序：先放启用的（按新顺序），再放未启用的
        var newFullOrder: [ContentSource] = []
        var enabledIndex = 0
        var disabledIndex = 0
        
        for source in fullOrder {
            if sources.contains(source) {
                // 这是启用的数据源，使用新顺序
                if enabledIndex < enabledOrder.count {
                    newFullOrder.append(enabledOrder[enabledIndex])
                    enabledIndex += 1
                }
            } else {
                // 这是未启用的数据源，保持原位置
                if disabledIndex < disabledSources.count {
                    newFullOrder.append(disabledSources[disabledIndex])
                    disabledIndex += 1
                }
            }
        }
        
        // 添加可能遗漏的数据源
        for source in enabledOrder where !newFullOrder.contains(source) {
            newFullOrder.append(source)
        }
        for source in disabledSources where !newFullOrder.contains(source) {
            newFullOrder.append(source)
        }
        
        // 保存到 UserDefaults（会触发 orderChangedNotification，供 ViewCommands 等组件使用）
        ContentSource.customOrder = newFullOrder
        
        // 直接更新 ViewModel（updateEnabledDataSources 会自动保持当前活动的数据源）
        viewModel.updateEnabledDataSources(enabledOrder)
        
        // 触发触觉反馈
        NSHapticFeedbackManager.defaultPerformer.perform(.levelChange, performanceTime: .default)
    }
}

/// 单个数据源指示器项
private struct DataSourceIndicatorItem: View {
    let source: ContentSource
    let isActive: Bool?
    let isDragging: Bool
    let action: () -> Void
    
    @State private var isHovering: Bool = false
    
    private var isCurrentlyActive: Bool {
        isActive ?? false
    }
    
    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: source.icon)
                    .scaledFont(.caption2, weight: .medium)
                
                if isCurrentlyActive {
                    Text(source.displayName)
                        .scaledFont(.caption2, weight: .medium)
                        .lineLimit(1)
                }
            }
            .foregroundStyle(isCurrentlyActive ? source.accentColor : .secondary)
            .padding(.horizontal, isCurrentlyActive ? 8 : 6)
            .padding(.vertical, 4)
            .background(
                Capsule()
                    .fill(backgroundColor)
            )
            .opacity(isDragging ? 0.5 : (isCurrentlyActive ? 1.0 : 0.6))
            .scaleEffect(isDragging ? 1.1 : 1.0)
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .animation(.easeInOut(duration: 0.2), value: isCurrentlyActive)
        .animation(.easeInOut(duration: 0.15), value: isDragging)
        // 添加 Large Content Viewer 支持
        .accessibilityShowsLargeContentViewer {
            Label(source.displayName, systemImage: source.icon)
        }
    }
    
    private var backgroundColor: Color {
        if isDragging {
            return source.accentColor.opacity(0.3)
        } else if isCurrentlyActive {
            return source.accentColor.opacity(0.15)
        } else if isHovering {
            return Color.primary.opacity(0.08)
        }
        return Color.clear
    }
}

// MARK: - Glass Helpers

extension View {
    /// 玻璃态 Capsule 背景，macOS 26 起使用 Liquid Glass，旧系统回退为 ultraThinMaterial
    @ViewBuilder
    func glassCapsuleBackground() -> some View {
        if #available(macOS 26.0, *) {
            background {
                Capsule()
                    .glassEffect(.regular)
            }
        } else {
            background(
                Capsule()
                    .fill(.ultraThinMaterial)
                    .shadow(color: .black.opacity(0.1), radius: 4, x: 0, y: 2)
            )
        }
    }
}

#Preview {
    DataSourceIndicatorBar(viewModel: DataSourceSwitchViewModel())
        .frame(width: 300)
        .applyFontScale()
}
