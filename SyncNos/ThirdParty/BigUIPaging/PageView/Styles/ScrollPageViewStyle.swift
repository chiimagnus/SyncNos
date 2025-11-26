import SwiftUI

/// 滑动页面视图样式
public struct ScrollPageViewStyle: PageViewStyle {
    
    public init() { }
    
    public func makeBody(configuration: Configuration) -> some View {
        PlatformPageViewStyle(
            options: PlatformPageViewConfiguration(
                transition: .scroll,
                orientation: .horizontal,
                spacing: 0
            )
        )
        .makeBody(configuration: configuration)
    }
}

/// 平台页面视图样式（内部使用）
struct PlatformPageViewStyle: PageViewStyle {
    let options: PlatformPageViewConfiguration
    
    func makeBody(configuration: Configuration) -> some View {
        PlatformPageViewStyleView(
            configuration: configuration,
            options: options
        )
    }
}

/// 平台页面视图样式的具体视图实现
private struct PlatformPageViewStyleView: View {
    let configuration: PageViewStyleConfiguration
    let options: PlatformPageViewConfiguration
    
    var body: some View {
        PlatformPageView(
            selection: Binding(
                get: { configuration.selection.wrappedValue },
                set: { configuration.selection.wrappedValue = $0 }
            ).map(
                get: { $0.base },
                set: { PageViewStyleConfiguration.Value(AnyHashable($0)) }
            ),
            configuration: options
        ) { value in
            value
        } previous: { value in
            configuration.previous(PageViewStyleConfiguration.Value(value))?.base
        } content: { value in
            configuration.content(PageViewStyleConfiguration.Value(value))
        }
    }
}

// MARK: - Binding 扩展

extension Binding {
    func map<T>(get: @escaping (Value) -> T, set: @escaping (T) -> Value) -> Binding<T> {
        Binding<T>(
            get: { get(wrappedValue) },
            set: { wrappedValue = set($0) }
        )
    }
}

// MARK: - 便捷扩展

extension PageViewStyle where Self == ScrollPageViewStyle {
    /// 滑动样式
    public static var scroll: ScrollPageViewStyle {
        ScrollPageViewStyle()
    }
}

