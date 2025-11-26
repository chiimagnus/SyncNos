import SwiftUI

/// 页面视图样式协议
public protocol PageViewStyle: DynamicProperty {
    associatedtype Body: View
    typealias Configuration = PageViewStyleConfiguration
    
    @ViewBuilder func makeBody(configuration: Configuration) -> Body
}

/// 页面视图样式配置
public struct PageViewStyleConfiguration {
    
    /// 包装的选择值类型
    public struct Value: Hashable {
        let base: AnyHashable
        
        init<T: Hashable>(_ value: T) {
            self.base = AnyHashable(value)
        }
        
        func unwrap<T: Hashable>(as type: T.Type) -> T? {
            base.base as? T
        }
    }
    
    /// 包装的页面视图
    public struct Page: View {
        let content: AnyView
        
        init<Content: View>(_ content: Content) {
            self.content = AnyView(content)
        }
        
        public var body: some View {
            content
        }
    }
    
    /// 当前选中值的绑定
    public var selection: Binding<Value>
    
    /// 获取下一个值的闭包
    public let next: (Value) -> Value?
    
    /// 获取上一个值的闭包
    public let previous: (Value) -> Value?
    
    /// 根据值获取页面内容的闭包
    public let content: (Value) -> Page
    
    /// 可导航方向
    var canNavigate: PageViewNavigationDirections {
        var directions: PageViewNavigationDirections = []
        if next(selection.wrappedValue) != nil {
            directions.insert(.forwards)
        }
        if previous(selection.wrappedValue) != nil {
            directions.insert(.backwards)
        }
        return directions
    }
    
    /// 创建导航动作
    func navigateAction(_ id: UUID) -> PageViewNavigateAction {
        PageViewNavigateAction(id: id) { direction in
            switch direction {
            case .forwards:
                if let nextValue = next(selection.wrappedValue) {
                    selection.wrappedValue = nextValue
                }
            case .backwards:
                if let previousValue = previous(selection.wrappedValue) {
                    selection.wrappedValue = previousValue
                }
            }
        }
    }
}

// MARK: - 类型擦除的样式包装器

struct AnyPageViewStyle: PageViewStyle {
    private let _makeBody: (Configuration) -> AnyView
    
    init<S: PageViewStyle>(_ style: S) {
        _makeBody = { configuration in
            AnyView(style.makeBody(configuration: configuration))
        }
    }
    
    func makeBody(configuration: Configuration) -> some View {
        _makeBody(configuration)
    }
}

