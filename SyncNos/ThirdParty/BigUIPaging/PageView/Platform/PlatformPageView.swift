import SwiftUI

/// 平台页面视图的通用接口
struct PlatformPageView<SelectionValue, Content> where SelectionValue: Hashable, Content: View {
    @Binding var selection: SelectionValue
    let configuration: PlatformPageViewConfiguration
    let next: (SelectionValue) -> SelectionValue?
    let previous: (SelectionValue) -> SelectionValue?
    @ViewBuilder let content: (SelectionValue) -> Content
    
    /// 创建围绕当前选择值的排列对象数组
    func makeArrangedObjects(around value: SelectionValue, limit: Int = 3) -> ([Any], Int) {
        var currentValue = value
        var previousObjects = [SelectionValue]()
        
        // 向前查找
        while let previousValue = previous(currentValue), previousObjects.count < limit {
            previousObjects.insert(previousValue, at: 0)
            currentValue = previousValue
        }
        
        // 向后查找
        currentValue = value
        var nextObjects = [value]
        while let nextValue = next(currentValue), nextObjects.count <= limit {
            nextObjects.append(nextValue)
            currentValue = nextValue
        }
        
        let allObjects = previousObjects + nextObjects
        let selectedIndex = previousObjects.count
        return (allObjects, selectedIndex)
    }
}

