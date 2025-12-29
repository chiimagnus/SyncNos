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
            guard let window = self.mainWindow, event.window === window else {
                return event
            }
            
            // 记录点击位置（窗口坐标系：原点在左下）
            let clickLocationInWindow = event.locationInWindow
            
            // 延迟检查焦点，因为点击后焦点可能还没有切换
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
                // 先按当前 firstResponder 同步状态
                self.syncNavigationTargetWithFocus()
                
                // 兜底：如果用户点击了 Detail 区域，但 firstResponder 仍停留在 List，
                // 则强制让 Detail 的 NSScrollView 成为 firstResponder，
                // 这样 List 选中高亮会立即变为非激活（灰色）。
                guard self.keyboardNavigationTarget == .list else { return }
                
                // 检查点击是否在 Detail ScrollView 内，并且是否点击的是"被动区域"（非交互元素）
                guard let (isInside, hitView) = self.checkPointInDetailScrollView(clickLocationInWindow, window: window),
                      isInside else { return }
                
                // 如果点击的是交互控件，不强制切换焦点
                // 允许 SwiftUI 的手势处理器和控件自然处理焦点
                if self.isInteractiveElement(hitView) {
                    return
                }
                
                // 点击的是被动区域（如背景、padding、空白ScrollView等），强制切换焦点
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
                if r === detailScrollView || r === detailScrollView.contentView {
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
        guard let scrollView = currentDetailScrollView else { return }
        DispatchQueue.main.async {
            // 让 Detail 真正成为 first responder，List 的选中高亮会变为非激活（灰色）
            _ = window.makeFirstResponder(scrollView.contentView)
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
    
    /// 检查点击是否在当前 Detail 的 NSScrollView 区域内，并返回命中的视图
    /// - Returns: (isInside: Bool, hitView: NSView?)
    private func checkPointInDetailScrollView(_ locationInWindow: NSPoint, window: NSWindow) -> (Bool, NSView?) {
        guard let scrollView = currentDetailScrollView else { return (false, nil) }
        // 只在 scrollView 仍挂载在当前窗口时才判断，避免使用过期引用
        guard scrollView.window === window else { return (false, nil) }
        guard let contentView = window.contentView else { return (false, nil) }
        
        // 命中测试：确保点击确实落在 Detail 的 ScrollView 视图树内
        let pointInContentView = contentView.convert(locationInWindow, from: nil)
        guard let hitView = contentView.hitTest(pointInContentView) else { return (false, nil) }
        
        var view: NSView? = hitView
        while let v = view {
            if v === scrollView || v === scrollView.contentView || v === scrollView.documentView {
                return (true, hitView)
            }
            view = v.superview
        }
        
        return (false, nil)
    }
    
    /// 判断视图是否为交互元素（按钮、文本框、可点击控件等）
    /// 如果是交互元素，不应强制切换焦点，让元素自然处理
    private func isInteractiveElement(_ view: NSView?) -> Bool {
        guard let view = view else { return false }
        
        // 检查常见的 AppKit 交互控件
        if view is NSButton || view is NSTextField || view is NSTextView {
            return true
        }
        
        // 检查视图类名，识别 SwiftUI 的手势响应视图
        let className = String(describing: type(of: view))
        
        // SwiftUI 在交互元素上会添加特殊的内部视图类
        // 例如：SwiftUI 的 Button、onTapGesture 会创建特定的 hosting view
        if className.contains("Button") || 
           className.contains("Control") || 
           className.contains("Gesture") ||
           className.contains("Interaction") {
            return true
        }
        
        // 检查父视图链，看是否在已知的交互容器中
        var parent = view.superview
        var depth = 0
        while let p = parent, depth < 5 {  // 限制深度避免过度遍历
            let parentClassName = String(describing: type(of: p))
            if parentClassName.contains("Button") || 
               parentClassName.contains("Control") ||
               parentClassName.contains("TextField") {
                return true
            }
            parent = p.superview
            depth += 1
        }
        
        return false
    }
}
