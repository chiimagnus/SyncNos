import SwiftUI

/// 数据源指示器栏
/// 悬浮显示在侧边栏底部，用于显示和切换当前数据源
struct DataSourceIndicatorBar: View {
    @ObservedObject var viewModel: DataSourceSwitchViewModel
    
    var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(viewModel.enabledDataSources.enumerated()), id: \.element) { index, source in
                DataSourceIndicatorItem(
                    source: source,
                    isActive: viewModel.activeIndex == index
                ) {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        viewModel.switchTo(index: index)
                    }
                }
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .glassCapsuleBackground()
    }
}

/// 单个数据源指示器项
private struct DataSourceIndicatorItem: View {
    let source: ContentSource
    let isActive: Bool
    let action: () -> Void
    
    @State private var isHovering: Bool = false
    
    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: source.icon)
                    .scaledFont(.caption2, weight: .medium)
                
                if isActive {
                    Text(source.displayName)
                        .scaledFont(.caption2, weight: .medium)
                        .lineLimit(1)
                }
            }
            .foregroundStyle(isActive ? source.accentColor : .secondary)
            .padding(.horizontal, isActive ? 8 : 6)
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
        // 添加 Large Content Viewer 支持
        .accessibilityShowsLargeContentViewer {
            Label(source.displayName, systemImage: source.icon)
        }
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
