import SwiftUI

// MARK: - MainListView Focus Manager Extension

/// 焦点管理扩展
/// 负责处理 List/Detail 之间的焦点切换和同步
extension MainListView {

    // MARK: - Focus Helpers
    
    /// 将焦点切换到 Detail（使 List 选中高亮进入非激活态）
    func focusDetailIfPossible(window: NSWindow) {
        DispatchQueue.main.async {
            // 让 Detail 真正成为 first responder，List 的选中高亮会变为非激活（灰色）
            // 只依赖 Detail 侧稳定的 firstResponder “落点”，避免与 ScrollView 内部实现耦合
            guard let proxy = self.detailFirstResponderProxyView else { return }
            _ = window.makeFirstResponder(proxy)
        }
    }
    
    /// 将焦点返回到 List
    func focusBackToMaster(window: NSWindow) {
        let responder = savedMasterFirstResponder
        DispatchQueue.main.async {
            if let responder, window.makeFirstResponder(responder) {
                return
            }
            // 兜底：触发当前数据源 List 再次请求焦点（保留现有机制，避免焦点丢失导致 ↑↓ 不再选中 List）
            NotificationCenter.default.post(name: self.focusNotificationName(for: self.contentSource), object: nil)
        }
    }
    
    /// 获取数据源对应的焦点通知名称
    func focusNotificationName(for source: ContentSource) -> Notification.Name {
        switch source {
        case .appleBooks:
            return Notification.Name("DataSourceSwitchedToAppleBooks")
        case .goodLinks:
            return Notification.Name("DataSourceSwitchedToGoodLinks")
        case .weRead:
            return Notification.Name("DataSourceSwitchedToWeRead")
        case .dedao:
            return Notification.Name("DataSourceSwitchedToDedao")
        case .chats:
            return Notification.Name("DataSourceSwitchedToChats")
        }
    }
}

