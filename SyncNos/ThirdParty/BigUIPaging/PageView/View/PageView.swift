import SwiftUI

/// 页面视图 - 支持左右滑动切换的容器视图
public struct PageView<SelectionValue, Page>: View where SelectionValue: Hashable, Page: View {
    
    @Binding var selection: SelectionValue
    let next: (SelectionValue) -> SelectionValue?
    let previous: (SelectionValue) -> SelectionValue?
    @ViewBuilder let pageContent: (SelectionValue) -> Page
    
    @Environment(\.pageViewStyle) private var style
    private let id = UUID()
    
    // MARK: - Initializers
    
    /// 使用 next/previous 闭包创建页面视图
    public init(
        selection: Binding<SelectionValue>,
        @ViewBuilder next: @escaping (SelectionValue) -> SelectionValue?,
        @ViewBuilder previous: @escaping (SelectionValue) -> SelectionValue?,
        @ViewBuilder content: @escaping (SelectionValue) -> Page
    ) {
        self._selection = selection
        self.next = next
        self.previous = previous
        self.pageContent = content
    }
    
    // MARK: - Body
    
    public var body: some View {
        let configuration = makeConfiguration()
        
        return AnyView(style.makeBody(configuration: configuration))
            .environment(\.navigatePageView, configuration.navigateAction(id))
            .preference(
                key: PageViewCanNavigatePreference.self,
                value: configuration.canNavigate
            )
            .preference(
                key: PageViewNavigateActionPreference.self,
                value: configuration.navigateAction(id)
            )
    }
    
    // MARK: - Private
    
    private func makeConfiguration() -> PageViewStyleConfiguration {
        PageViewStyleConfiguration(
            selection: Binding(
                get: { PageViewStyleConfiguration.Value(selection) },
                set: { newValue in
                    if let unwrapped = newValue.unwrap(as: SelectionValue.self) {
                        selection = unwrapped
                    }
                }
            ),
            next: { value in
                guard let unwrapped = value.unwrap(as: SelectionValue.self),
                      let nextValue = next(unwrapped) else {
                    return nil
                }
                return PageViewStyleConfiguration.Value(nextValue)
            },
            previous: { value in
                guard let unwrapped = value.unwrap(as: SelectionValue.self),
                      let previousValue = previous(unwrapped) else {
                    return nil
                }
                return PageViewStyleConfiguration.Value(previousValue)
            },
            content: { value in
                guard let unwrapped = value.unwrap(as: SelectionValue.self) else {
                    return PageViewStyleConfiguration.Page(EmptyView())
                }
                return PageViewStyleConfiguration.Page(pageContent(unwrapped))
            }
        )
    }
}

// MARK: - ForEach 便捷初始化器

extension PageView where SelectionValue == Int {
    /// 使用整数索引和 ForEach 风格创建页面视图
    public init<Data, Content>(
        selection: Binding<Int>,
        @ViewBuilder content: @escaping () -> ForEach<Data, Int, Content>
    ) where Data: RandomAccessCollection, Data.Index == Int, Page == AnyView, Content: View {
        let forEach = content()
        let data = forEach.data
        
        self._selection = selection
        self.next = { index in
            let nextIndex = index + 1
            return nextIndex < data.count ? nextIndex : nil
        }
        self.previous = { index in
            let previousIndex = index - 1
            return previousIndex >= 0 ? previousIndex : nil
        }
        self.pageContent = { index in
            if index >= 0 && index < data.count {
                return AnyView(forEach.content(data[data.startIndex.advanced(by: index)]))
            }
            return AnyView(EmptyView())
        }
    }
}

// MARK: - ForEach 扩展

extension ForEach {
    var data: Data {
        // 通过 Mirror 获取 data 属性
        let mirror = Mirror(reflecting: self)
        for child in mirror.children {
            if child.label == "data", let data = child.value as? Data {
                return data
            }
        }
        fatalError("Could not extract data from ForEach")
    }
}

