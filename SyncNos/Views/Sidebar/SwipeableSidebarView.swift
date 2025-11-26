import SwiftUI

/// 可滑动切换的侧边栏视图
struct SwipeableSidebarView<Content: View>: View {
    @ObservedObject var dataSourceManager: DataSourceManager
    @Binding var selectionIds: Set<String>
    let contentBuilder: (DataSourceType) -> Content
    
    @State private var refreshTrigger: Bool = false
    
    var body: some View {
        VStack(spacing: 0) {
            // 数据源滑动区域
            dataSourcesPageView
            
            // 底部数据源指示器
            DataSourceIndicatorBar(dataSourceManager: dataSourceManager)
        }
    }
    
    // MARK: - Private Views
    
    @ViewBuilder
    private var dataSourcesPageView: some View {
        let sources = dataSourceManager.enabledDataSources
        
        if sources.isEmpty {
            emptyStateView
        } else {
            PageView(selection: $dataSourceManager.activeIndex) {
                ForEach(sources.indices, id: \.self) { index in
                    DataSourceContentContainer(
                        dataSource: sources[index],
                        isActive: dataSourceManager.activeIndex == index
                    ) {
                        contentBuilder(sources[index].type)
                    }
                    .tag(index)
                }
            }
            .pageViewStyle(.scroll)
            .id(refreshTrigger)
            .onChange(of: dataSourceManager.activeIndex) { _, newIndex in
                handleIndexChange(newIndex)
            }
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
    
    private func handleIndexChange(_ newIndex: Int) {
        let sources = dataSourceManager.enabledDataSources
        guard newIndex >= 0 && newIndex < sources.count else { return }
        
        // 触发触觉反馈
        NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .default)
        
        // 清空选择
        selectionIds.removeAll()
        
        // 刷新视图
        refreshTrigger.toggle()
    }
}

// MARK: - DataSourceContentContainer

/// 数据源内容容器
private struct DataSourceContentContainer<Content: View>: View {
    let dataSource: DataSource
    let isActive: Bool
    @ViewBuilder let content: () -> Content
    
    var body: some View {
        VStack(spacing: 0) {
            // 数据源标题栏
            DataSourceTitleBar(dataSource: dataSource)
            
            // 内容区域
            content()
        }
    }
}

// MARK: - DataSourceTitleBar

/// 数据源标题栏
private struct DataSourceTitleBar: View {
    let dataSource: DataSource
    @State private var isHovering: Bool = false
    
    var body: some View {
        HStack(spacing: 8) {
            // 图标
            Image(systemName: dataSource.icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(dataSource.type.accentColor)
            
            // 名称
            Text(dataSource.name)
                .font(.system(size: 14, weight: .semibold))
                .lineLimit(1)
            
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(isHovering ? Color.primary.opacity(0.05) : Color.clear)
        )
        .onHover { isHovering = $0 }
    }
}

// MARK: - DataSourceIndicatorBar

/// 数据源指示器栏
struct DataSourceIndicatorBar: View {
    @ObservedObject var dataSourceManager: DataSourceManager
    
    var body: some View {
        HStack(spacing: 8) {
            ForEach(Array(dataSourceManager.enabledDataSources.enumerated()), id: \.element.id) { index, source in
                DataSourceIndicatorItem(
                    dataSource: source,
                    isActive: dataSourceManager.activeIndex == index
                ) {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        dataSourceManager.setActiveDataSource(at: index)
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.primary.opacity(0.03))
    }
}

// MARK: - DataSourceIndicatorItem

/// 单个数据源指示器
private struct DataSourceIndicatorItem: View {
    let dataSource: DataSource
    let isActive: Bool
    let action: () -> Void
    
    @State private var isHovering: Bool = false
    
    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: dataSource.icon)
                    .font(.system(size: 12, weight: .medium))
                
                if isActive {
                    Text(dataSource.name)
                        .font(.system(size: 12, weight: .medium))
                        .lineLimit(1)
                }
            }
            .foregroundStyle(isActive ? dataSource.type.accentColor : .secondary)
            .padding(.horizontal, isActive ? 12 : 8)
            .padding(.vertical, 6)
            .background(
                Capsule()
                    .fill(backgroundColor)
            )
            .opacity(isActive ? 1.0 : 0.7)
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .animation(.easeInOut(duration: 0.2), value: isActive)
    }
    
    private var backgroundColor: Color {
        if isActive {
            return dataSource.type.accentColor.opacity(0.15)
        } else if isHovering {
            return Color.primary.opacity(0.08)
        }
        return Color.clear
    }
}

// MARK: - Preview

#Preview {
    SwipeableSidebarView(
        dataSourceManager: DataSourceManager(),
        selectionIds: .constant([])
    ) { type in
        Text("Content for \(type.title)")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .frame(width: 300, height: 600)
}

