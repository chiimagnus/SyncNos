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
    
    // MARK: - Internal Types
    
    /// 选择模式：显式选择 / 逻辑全选（带排除集合）
    private enum SelectionMode {
        case explicit(Set<String>)
        case all(excluding: Set<String>)
    }
    
    /// 每个数据源的选择状态
    private var selections: [ContentSource: SelectionMode] = [:]
    
    // MARK: - Public API
    
    /// 获取指定数据源的选择
    func selection(for source: ContentSource) -> Set<String> {
        guard let mode = selections[source] else { return [] }
        switch mode {
        case .explicit(let ids):
            return ids
        case .all:
            // 逻辑全选的“真实集合”依赖 allIds（display*），这里不返回集合以避免误用与性能问题
            return []
        }
    }
    
    /// 获取指定数据源选择的 Binding
    ///
    /// - Parameter scopeIds: 当前 List 已渲染的 id 列表（例如 visibleBooks/visibleLinks）。
    ///   该 binding 只负责维护 UI 范围内的勾选状态，不承诺包含全量选择。
    func selectionBinding(for source: ContentSource, scopeIds: @escaping () -> [String]) -> Binding<Set<String>> {
        Binding(
            get: {
                let scopeSet = Set(scopeIds())
                guard let mode = self.selections[source] else { return [] }
                switch mode {
                case .explicit(let ids):
                    return ids.intersection(scopeSet)
                case .all(let excluding):
                    return scopeSet.subtracting(excluding)
                }
            },
            set: { newSelection in
                let scopeSet = Set(scopeIds())
                guard !scopeSet.isEmpty else { return }
                
                let currentMode = self.selections[source] ?? .explicit([])
                switch currentMode {
                case .explicit(let ids):
                    let updated = ids.subtracting(scopeSet).union(newSelection)
                    self.selections[source] = .explicit(updated)
                case .all(let excluding):
                    // 在 scope 内：未被选中的 item 进入排除集合；选中的 item 从排除集合移除
                    let excludedInScope = scopeSet.subtracting(newSelection)
                    let updated = excluding.subtracting(scopeSet).union(excludedInScope)
                    self.selections[source] = .all(excluding: updated)
                }
            }
        )
    }
    
    /// 设置指定数据源的选择
    func setSelection(for source: ContentSource, ids: Set<String>) {
        selections[source] = .explicit(ids)
    }
    
    /// 添加选择（追加到现有选择）
    func addSelection(for source: ContentSource, id: String) {
        guard let mode = selections[source] else {
            selections[source] = .explicit([id])
            return
        }
        switch mode {
        case .explicit(var ids):
            ids.insert(id)
            selections[source] = .explicit(ids)
        case .all(var excluding):
            excluding.remove(id)
            selections[source] = .all(excluding: excluding)
        }
    }
    
    /// 移除选择
    func removeSelection(for source: ContentSource, id: String) {
        guard let mode = selections[source] else { return }
        switch mode {
        case .explicit(var ids):
            ids.remove(id)
            selections[source] = .explicit(ids)
        case .all(var excluding):
            excluding.insert(id)
            selections[source] = .all(excluding: excluding)
        }
    }
    
    /// 切换选择状态
    func toggleSelection(for source: ContentSource, id: String) {
        guard let mode = selections[source] else {
            selections[source] = .explicit([id])
            return
        }
        switch mode {
        case .explicit(var ids):
            if ids.contains(id) {
                ids.remove(id)
            } else {
                ids.insert(id)
            }
            selections[source] = .explicit(ids)
        case .all(var excluding):
            if excluding.contains(id) {
                excluding.remove(id)
            } else {
                excluding.insert(id)
            }
            selections[source] = .all(excluding: excluding)
        }
    }
    
    /// 清除所有选择
    func clearAll() {
        selections.removeAll()
    }
    
    /// 清除指定数据源的选择
    func clear(for source: ContentSource) {
        selections[source] = .explicit([])
    }
    
    /// 设置为“逻辑全选”（用于 Cmd+A，全选但不强制加载全部行）
    func setAllSelected(for source: ContentSource) {
        selections[source] = .all(excluding: [])
    }
    
    /// 是否处于“逻辑全选”状态
    func isAllSelected(for source: ContentSource) -> Bool {
        guard let mode = selections[source] else { return false }
        if case .all = mode { return true }
        return false
    }
    
    /// 获取全选模式下的排除集合
    func excludedIds(for source: ContentSource) -> Set<String> {
        guard let mode = selections[source] else { return [] }
        switch mode {
        case .explicit:
            return []
        case .all(let excluding):
            return excluding
        }
    }
    
    /// 基于全量 allIds 解析“逻辑选中集合”
    func logicalSelectedIds(for source: ContentSource, allIds: Set<String>) -> Set<String> {
        guard let mode = selections[source] else { return [] }
        switch mode {
        case .explicit(let ids):
            return ids
        case .all(let excluding):
            return allIds.subtracting(excluding)
        }
    }
    
    /// 获取逻辑选中数量（避免构造大集合）
    func logicalSelectedCount(for source: ContentSource, totalCount: Int) -> Int {
        guard totalCount > 0 else { return 0 }
        guard let mode = selections[source] else { return 0 }
        switch mode {
        case .explicit(let ids):
            return ids.count
        case .all(let excluding):
            return max(0, totalCount - excluding.count)
        }
    }
    
    // MARK: - Query Methods
    
    /// 当前数据源是否有单选
    func hasSingleSelection(for source: ContentSource) -> Bool {
        guard let mode = selections[source] else { return false }
        switch mode {
        case .explicit(let ids):
            return ids.count == 1
        case .all:
            return false
        }
    }
    
    /// 获取当前数据源的选中数量
    func selectionCount(for source: ContentSource) -> Int {
        guard let mode = selections[source] else { return 0 }
        switch mode {
        case .explicit(let ids):
            return ids.count
        case .all(let excluding):
            // 无 totalCount 时无法计算逻辑数量，这里仅用于“是否有排除”的调试/展示
            return excluding.count
        }
    }
    
    /// 获取单选的 ID（仅当选中一个时返回）
    func singleSelectedId(for source: ContentSource) -> String? {
        guard let mode = selections[source] else { return nil }
        switch mode {
        case .explicit(let ids):
            return ids.count == 1 ? ids.first : nil
        case .all:
            return nil
        }
    }
    
    /// 检查是否有任何选择
    func hasSelection(for source: ContentSource) -> Bool {
        guard let mode = selections[source] else { return false }
        switch mode {
        case .explicit(let ids):
            return !ids.isEmpty
        case .all:
            return true
        }
    }
}
