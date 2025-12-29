import SwiftUI

// MARK: - MainListView Focus Manager Extension

/// 焦点管理扩展
/// 负责处理 List/Detail 之间的焦点切换和同步
extension MainListView {
    
    // MARK: - Mouse Monitor
    
    /// 启动鼠标点击监听器，用于同步焦点状态
    func startMouseDownMonitorIfNeeded() {
        guard mouseDownMonitor == nil else { return }
        
        mouseDownMonitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { event in
            // 只处理 MainListView 所在窗口的事件
            // - mainWindow 可能在视图初次渲染时尚未注入；此时用 event.window 兜底，避免鼠标点击完全不生效
            // - 若 mainWindow 已存在，则严格过滤，避免影响 Settings 等其它窗口
            guard let eventWindow = event.window else { return event }
            if let mainWindow = self.mainWindow, eventWindow !== mainWindow {
                return event
            }
            let window = self.mainWindow ?? eventWindow
            
            // 记录点击位置（窗口坐标系：原点在左下）
            let clickLocationInWindow = event.locationInWindow
            
            // 延迟检查焦点，因为点击后焦点可能还没有切换
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                // 先按当前 firstResponder 同步状态
                self.syncNavigationTargetWithFocus()
                
                // 兜底：如果用户点击了 Detail 区域，但 firstResponder 仍停留在 List，
                // 则强制让 Detail 的 NSScrollView 成为 firstResponder，
                // 这样 List 选中高亮会立即变为非激活（灰色）。
                guard self.keyboardNavigationTarget == .list else { return }
                guard self.isPointInsideCurrentDetailScrollView(clickLocationInWindow, window: window) else { return }
                
                // 保存进入 Detail 前的 firstResponder，用于 ← 返回时恢复
                self.savedMasterFirstResponder = window.firstResponder
                self.keyboardNavigationTarget = .detail
                self.focusDetailScrollViewIfPossible(window: window)
            }
            
            return event
        }
    }
    
    /// 停止鼠标点击监听器
    func stopMouseDownMonitorIfNeeded() {
        if let monitor = mouseDownMonitor {
            NSEvent.removeMonitor(monitor)
            mouseDownMonitor = nil
        }
    }
    
    // MARK: - Focus Sync
    
    /// 根据当前 firstResponder 同步 keyboardNavigationTarget 状态
    func syncNavigationTargetWithFocus() {
        guard let window = mainWindow else { return }
        guard let firstResponder = window.firstResponder else { return }
        
        // 检查 firstResponder 是否在 Detail 的 ScrollView 中
        if let detailScrollView = currentDetailScrollView {
            var responder: NSResponder? = firstResponder
            while let r = responder {
                if r === detailScrollView || r === detailScrollView.contentView || r === detailScrollView.documentView {
                    keyboardNavigationTarget = .detail
                    return
                }
                responder = r.nextResponder
            }
        }
        
        // 否则认为焦点在 List
        keyboardNavigationTarget = .list
    }
    
    // MARK: - Focus Helpers
    
    /// 将焦点切换到 Detail 的 ScrollView
    func focusDetailScrollViewIfPossible(window: NSWindow) {
        DispatchQueue.main.async {
            // 让 Detail 真正成为 first responder，List 的选中高亮会变为非激活（灰色）
            // 优先使用 Detail 侧稳定的 firstResponder “落点”，避免依赖 ScrollView 内部实现细节
            if let proxy = self.detailFirstResponderProxyView, window.makeFirstResponder(proxy) {
                return
            }
            
            // 兜底：仍尝试让 NSScrollView 成为 firstResponder（某些场景下更符合系统行为）
            guard let scrollView = self.currentDetailScrollView else { return }
            if window.makeFirstResponder(scrollView) { return }
            if window.makeFirstResponder(scrollView.contentView) { return }
            if let documentView = scrollView.documentView, window.makeFirstResponder(documentView) { return }
            _ = window.makeFirstResponder(nil)
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
    
    // MARK: - Hit Testing Helpers
    
    /// 判断一次点击是否发生在当前 Detail 的 NSScrollView 区域内（窗口坐标系）
    private func isPointInsideCurrentDetailScrollView(_ locationInWindow: NSPoint, window: NSWindow) -> Bool {
        guard let scrollView = currentDetailScrollView else { return false }
        // 只在 scrollView 仍挂载在当前窗口时才判断，避免使用过期引用
        guard scrollView.window === window else { return false }
        guard let contentView = window.contentView else { return false }
        
        // 命中测试：确保点击确实落在 Detail 的 ScrollView 视图树内，
        // 避免仅靠 rect 判断在极端情况下误判（导致“点 List 也自动切到 Detail”）
        let pointInContentView = contentView.convert(locationInWindow, from: nil)
        if let hitView = contentView.hitTest(pointInContentView) {
            var view: NSView? = hitView
            while let v = view {
                if v === scrollView || v === scrollView.contentView || v === scrollView.documentView {
                    return true
                }
                view = v.superview
            }
        }
        
        // 兜底：某些 Detail 视图会在 ScrollView 之上覆盖一层（例如 Chats 的空/加载态 ZStack），
        // 导致 hitTest 命中的是覆盖层而不是 ScrollView 的视图树。
        // 此时用几何范围做二次判定：点击点若落在 scrollView 的 bounds 内，也视为点击了 Detail 区域。
        let pointInScrollView = scrollView.convert(pointInContentView, from: contentView)
        return scrollView.bounds.contains(pointInScrollView)
    }
}

