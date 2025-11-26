import SwiftUI

// MARK: - 环境键

private struct PageViewStyleKey: EnvironmentKey {
    static let defaultValue: AnyPageViewStyle = AnyPageViewStyle(ScrollPageViewStyle())
}

private struct PageViewOrientationKey: EnvironmentKey {
    static let defaultValue: Axis = .horizontal
}

private struct PageViewSpacingKey: EnvironmentKey {
    static let defaultValue: Double? = nil
}

private struct NavigatePageViewKey: EnvironmentKey {
    static let defaultValue: PageViewNavigateAction? = nil
}

private struct CanNavigatePageViewKey: EnvironmentKey {
    static let defaultValue: PageViewNavigationDirections = []
}

// MARK: - EnvironmentValues 扩展

extension EnvironmentValues {
    var pageViewStyle: AnyPageViewStyle {
        get { self[PageViewStyleKey.self] }
        set { self[PageViewStyleKey.self] = newValue }
    }
    
    var pageViewOrientation: Axis {
        get { self[PageViewOrientationKey.self] }
        set { self[PageViewOrientationKey.self] = newValue }
    }
    
    var pageViewSpacing: Double? {
        get { self[PageViewSpacingKey.self] }
        set { self[PageViewSpacingKey.self] = newValue }
    }
    
    /// 页面视图导航动作
    public var navigatePageView: PageViewNavigateAction? {
        get { self[NavigatePageViewKey.self] }
        set { self[NavigatePageViewKey.self] = newValue }
    }
    
    /// 页面视图可导航方向
    public var canNavigatePageView: PageViewNavigationDirections {
        get { self[CanNavigatePageViewKey.self] }
        set { self[CanNavigatePageViewKey.self] = newValue }
    }
}

// MARK: - View 扩展

extension View {
    /// 设置页面视图样式
    public func pageViewStyle<S>(_ style: S) -> some View where S: PageViewStyle {
        environment(\.pageViewStyle, AnyPageViewStyle(style))
    }
    
    /// 设置页面视图方向
    public func pageViewOrientation(_ orientation: Axis) -> some View {
        environment(\.pageViewOrientation, orientation)
    }
    
    /// 设置页面视图间距
    public func pageViewSpacing(_ spacing: Double) -> some View {
        environment(\.pageViewSpacing, spacing)
    }
}

// MARK: - Preference Keys

struct PageViewCanNavigatePreference: PreferenceKey {
    static var defaultValue: PageViewNavigationDirections = []
    static func reduce(value: inout PageViewNavigationDirections, nextValue: () -> PageViewNavigationDirections) {
        value = nextValue()
    }
}

struct PageViewNavigateActionPreference: PreferenceKey {
    static var defaultValue: PageViewNavigateAction? = nil
    static func reduce(value: inout PageViewNavigateAction?, nextValue: () -> PageViewNavigateAction?) {
        value = nextValue()
    }
}

