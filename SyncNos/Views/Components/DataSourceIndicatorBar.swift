import SwiftUI

/// 数据源指示器栏
/// 悬浮显示在侧边栏底部，用于显示和切换当前数据源
/// 自适应宽度：空间不足时只显示图标
struct DataSourceIndicatorBar: View {
    @ObservedObject var viewModel: DataSourceSwitchViewModel
    
    /// 是否使用紧凑模式（只显示图标）
    var compactMode: Bool = false
    
    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(viewModel.enabledDataSources.enumerated()), id: \.element) { index, source in
                DataSourceIndicatorItem(
                    source: source,
                    isActive: viewModel.activeIndex == index,
                    compactMode: compactMode
                ) {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        viewModel.switchTo(index: index)
                    }
                }
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(
            Capsule()
                .fill(.ultraThinMaterial)
                .shadow(color: .black.opacity(0.1), radius: 4, x: 0, y: 2)
        )
    }
}

/// 单个数据源指示器项
private struct DataSourceIndicatorItem: View {
    let source: ContentSource
    let isActive: Bool
    let compactMode: Bool
    let action: () -> Void
    
    @State private var isHovering: Bool = false
    
    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: source.icon)
                    .font(.system(size: 10, weight: .medium))
                
                // 只在非紧凑模式且当前项激活时显示名称
                if isActive && !compactMode {
                    Text(source.displayName)
                        .font(.system(size: 10, weight: .medium))
                        .lineLimit(1)
                }
            }
            .foregroundStyle(isActive ? source.accentColor : .secondary)
            .padding(.horizontal, (isActive && !compactMode) ? 8 : 6)
            .padding(.vertical, 4)
            .background(
                Capsule()
                    .fill(backgroundColor)
            )
            .opacity(isActive ? 1.0 : 0.6)
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .animation(.easeInOut(duration: 0.2), value: isActive)
    }
    
    private var backgroundColor: Color {
        if isActive {
            return source.accentColor.opacity(0.15)
        } else if isHovering {
            return Color.primary.opacity(0.08)
        }
        return Color.clear
    }
}

#Preview {
    VStack(spacing: 20) {
        DataSourceIndicatorBar(viewModel: DataSourceSwitchViewModel())
            .frame(width: 300)
        
        DataSourceIndicatorBar(viewModel: DataSourceSwitchViewModel(), compactMode: true)
            .frame(width: 150)
    }
}

