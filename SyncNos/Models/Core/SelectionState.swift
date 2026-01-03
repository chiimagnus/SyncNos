import SwiftUI

// MARK: - SelectionState

/// 统一选择状态管理器
/// 替代 MainListView 中的 5 个独立 @State 变量
///
/// **使用方式**:
/// ```swift
/// @State private var selectionState = SelectionState()
///
/// // 获取当前数据源的选择
/// let selectedIds = selectionState.selection(for: contentSource)
///
/// // 获取绑定（用于 List selection）
/// List(selection: selectionState.selectionBinding(for: contentSource))
/// ```
@Observable
final class SelectionState {
    
    /// 每个数据源的选择状态
    private var selections: [ContentSource: Set<String>] = [:]
    
    // MARK: - Public API
    
    /// 获取指定数据源的选择
    func selection(for source: ContentSource) -> Set<String> {
        selections[source] ?? []
    }
    
    /// 获取指定数据源选择的 Binding
    func selectionBinding(for source: ContentSource) -> Binding<Set<String>> {
        Binding(
            get: { self.selections[source] ?? [] },
            set: { self.selections[source] = $0 }
        )
    }
    
    /// 设置指定数据源的选择
    func setSelection(for source: ContentSource, ids: Set<String>) {
        selections[source] = ids
    }
    
    /// 添加选择（追加到现有选择）
    func addSelection(for source: ContentSource, id: String) {
        var current = selections[source] ?? []
        current.insert(id)
        selections[source] = current
    }
    
    /// 移除选择
    func removeSelection(for source: ContentSource, id: String) {
        var current = selections[source] ?? []
        current.remove(id)
        selections[source] = current
    }
    
    /// 切换选择状态
    func toggleSelection(for source: ContentSource, id: String) {
        var current = selections[source] ?? []
        if current.contains(id) {
            current.remove(id)
        } else {
            current.insert(id)
        }
        selections[source] = current
    }
    
    /// 清除所有选择
    func clearAll() {
        selections.removeAll()
    }
    
    /// 清除指定数据源的选择
    func clear(for source: ContentSource) {
        selections[source] = []
    }
    
    // MARK: - Query Methods
    
    /// 当前数据源是否有单选
    func hasSingleSelection(for source: ContentSource) -> Bool {
        selection(for: source).count == 1
    }
    
    /// 获取当前数据源的选中数量
    func selectionCount(for source: ContentSource) -> Int {
        selection(for: source).count
    }
    
    /// 获取单选的 ID（仅当选中一个时返回）
    func singleSelectedId(for source: ContentSource) -> String? {
        let selected = selection(for: source)
        return selected.count == 1 ? selected.first : nil
    }
    
    /// 检查是否有任何选择
    func hasSelection(for source: ContentSource) -> Bool {
        !selection(for: source).isEmpty
    }
}

