import SwiftUI

/// 页面视图导航动作
public struct PageViewNavigateAction: Equatable {
    let id: UUID
    let action: (PageViewDirection) -> Void
    
    public static func == (lhs: PageViewNavigateAction, rhs: PageViewNavigateAction) -> Bool {
        lhs.id == rhs.id
    }
    
    public func callAsFunction(_ direction: PageViewDirection) {
        action(direction)
    }
}

