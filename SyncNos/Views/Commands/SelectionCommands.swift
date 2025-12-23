import SwiftUI

// 聚焦场景下用于驱动列表选择相关命令的动作集合
struct SelectionCommands {
    let selectAll: () -> Void
    let deselectAll: () -> Void
    let canSelectAll: () -> Bool
    let canDeselect: () -> Bool
}

private struct SelectionCommandsFocusedKey: FocusedValueKey {
    typealias Value = SelectionCommands
}

extension FocusedValues {
    var selectionCommands: SelectionCommands? {
        get { self[SelectionCommandsFocusedKey.self] }
        set { self[SelectionCommandsFocusedKey.self] = newValue }
    }
}
