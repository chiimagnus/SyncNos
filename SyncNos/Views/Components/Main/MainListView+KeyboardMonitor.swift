import SwiftUI
import AppKit

// MARK: - MainListView Keyboard & Focus Extension

extension MainListView {
    
    // MARK: - Keyboard Monitor
    
    func startKeyboardMonitorIfNeeded() {
        guard keyDownMonitor == nil else { return }
        
        keyDownMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            // 只处理 MainListView 所在窗口的事件，避免影响 Settings 等其它窗口
            guard let window = self.mainWindow, event.window === window else {
                return event
            }
            
            // 检查修饰键
            let modifiers = event.modifierFlags
            let hasCommand = modifiers.contains(.command)
            let hasOption = modifiers.contains(.option)
            let hasControl = modifiers.contains(.control)
            
            // Cmd+↑/↓ 用于 Detail 滚动到顶部/底部
            if hasCommand && !hasOption && !hasControl {
                switch event.keyCode {
                case 126: // Cmd+↑ 滚动到顶部
                    if self.keyboardNavigationTarget == .detail {
                        self.scrollCurrentDetailToTop()
                        return nil
                    }
                    return event
                case 125: // Cmd+↓ 滚动到底部
                    if self.keyboardNavigationTarget == .detail {
                        self.scrollCurrentDetailToBottom()
                        return nil
                    }
                    return event
                default:
                    // 其他 Cmd 组合键（如 Cmd+←/→ 切换数据源）不拦截
                    return event
                }
            }
            
            // Option + 方向键：WechatChat 分类切换（消息导航改为 ↑/↓，见下方无修饰键分支）
            if hasOption && !hasCommand && !hasControl {
                if self.contentSource == .wechatChat && self.keyboardNavigationTarget == .detail {
                    switch event.keyCode {
                    case 123: // Option+← 切换分类（向左：我 → 系统 → 对方）
                        NotificationCenter.default.post(
                            name: Notification.Name("WechatChatCycleClassification"),
                            object: nil,
                            userInfo: ["direction": "left"]
                        )
                        return nil
                    case 124: // Option+→ 切换分类（向右：对方 → 系统 → 我）
                        NotificationCenter.default.post(
                            name: Notification.Name("WechatChatCycleClassification"),
                            object: nil,
                            userInfo: ["direction": "right"]
                        )
                        return nil
                    default:
                        break
                    }
                }
                // 其他 Option 组合键不拦截
                return event
            }
            
            // 不拦截带 Control 的组合键
            if hasControl {
                return event
            }
            
            switch event.keyCode {
            case 123: // ←
                if self.keyboardNavigationTarget == .detail {
                    self.keyboardNavigationTarget = .list
                    self.focusBackToMaster(window: window)
                    return nil
                }
                return event
            case 124: // →
                if self.keyboardNavigationTarget == .list, self.hasSingleSelectionForCurrentSource() {
                    // 保存进入 Detail 前的真实焦点（通常是当前 List），用于返回时恢复
                    self.savedMasterFirstResponder = window.firstResponder
                    self.keyboardNavigationTarget = .detail
                    self.focusDetailScrollViewIfPossible(window: window)
                    return nil
                }
                return event
            case 126: // ↑
                if self.keyboardNavigationTarget == .detail {
                    // WechatChat：↑/↓ 用于消息选择导航（不再做逐行滚动）
                    if self.contentSource == .wechatChat {
                        NotificationCenter.default.post(
                            name: Notification.Name("WechatChatNavigateMessage"),
                            object: nil,
                            userInfo: ["direction": "up"]
                        )
                        return nil
                    }
                    self.scrollCurrentDetail(byLines: -1)
                    return nil
                }
                return event
            case 125: // ↓
                if self.keyboardNavigationTarget == .detail {
                    // WechatChat：↑/↓ 用于消息选择导航（不再做逐行滚动）
                    if self.contentSource == .wechatChat {
                        NotificationCenter.default.post(
                            name: Notification.Name("WechatChatNavigateMessage"),
                            object: nil,
                            userInfo: ["direction": "down"]
                        )
                        return nil
                    }
                    self.scrollCurrentDetail(byLines: 1)
                    return nil
                }
                return event
            case 115: // Home (Fn+←)
                if self.keyboardNavigationTarget == .detail {
                    self.scrollCurrentDetailToTop()
                    return nil
                }
                return event
            case 119: // End (Fn+→)
                if self.keyboardNavigationTarget == .detail {
                    self.scrollCurrentDetailToBottom()
                    return nil
                }
                return event
            case 116: // Page Up (Fn+↑)
                if self.keyboardNavigationTarget == .detail {
                    self.scrollCurrentDetailByPage(up: true)
                    return nil
                }
                return event
            case 121: // Page Down (Fn+↓)
                if self.keyboardNavigationTarget == .detail {
                    self.scrollCurrentDetailByPage(up: false)
                    return nil
                }
                return event
            default:
                return event
            }
        }
        
        // 监听鼠标点击，同步焦点状态
        startMouseDownMonitorIfNeeded()
    }
    
    func startMouseDownMonitorIfNeeded() {
        guard mouseDownMonitor == nil else { return }
        
        mouseDownMonitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { event in
            // 只处理 MainListView 所在窗口的事件
            guard let window = self.mainWindow, event.window === window else {
                return event
            }
            
            // 延迟检查焦点，因为点击后焦点可能还没有切换
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                self.syncNavigationTargetWithFocus()
            }
            
            return event
        }
    }
    
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
    
    func stopKeyboardMonitorIfNeeded() {
        if let monitor = keyDownMonitor {
            NSEvent.removeMonitor(monitor)
            keyDownMonitor = nil
        }
        if let monitor = mouseDownMonitor {
            NSEvent.removeMonitor(monitor)
            mouseDownMonitor = nil
        }
    }
    
    func hasSingleSelectionForCurrentSource() -> Bool {
        switch contentSource {
        case .appleBooks:
            return selectedBookIds.count == 1
        case .goodLinks:
            return selectedLinkIds.count == 1
        case .weRead:
            return selectedWeReadBookIds.count == 1
        case .dedao:
            return selectedDedaoBookIds.count == 1
        case .wechatChat:
            return selectedWechatContactIds.count == 1
        }
    }
    
    // MARK: - Scroll Helpers
    
    func scrollCurrentDetail(byLines lines: Int) {
        guard let scrollView = currentDetailScrollView else { return }
        guard let documentView = scrollView.documentView else { return }
        
        // 基于 "一行" 的滚动步长（同时考虑动态字体缩放）
        let baseStep: CGFloat = 56
        let step = baseStep * fontScaleManager.scaleFactor
        let delta = CGFloat(lines) * step
        
        // flipped 坐标系下，y 增大表示向下
        let effectiveDelta = (documentView.isFlipped ? delta : -delta)
        
        let clipView = scrollView.contentView
        var newOrigin = clipView.bounds.origin
        newOrigin.y += effectiveDelta
        
        let maxY = max(0, documentView.bounds.height - clipView.bounds.height)
        newOrigin.y = min(max(newOrigin.y, 0), maxY)
        
        clipView.scroll(to: newOrigin)
        scrollView.reflectScrolledClipView(clipView)
    }
    
    /// 滚动到顶部 (Home)
    func scrollCurrentDetailToTop() {
        guard let scrollView = currentDetailScrollView else { return }
        let clipView = scrollView.contentView
        clipView.scroll(to: NSPoint(x: 0, y: 0))
        scrollView.reflectScrolledClipView(clipView)
    }
    
    /// 滚动到底部 (End)
    func scrollCurrentDetailToBottom() {
        guard let scrollView = currentDetailScrollView else { return }
        guard let documentView = scrollView.documentView else { return }
        
        let clipView = scrollView.contentView
        let maxY = max(0, documentView.bounds.height - clipView.bounds.height)
        clipView.scroll(to: NSPoint(x: 0, y: maxY))
        scrollView.reflectScrolledClipView(clipView)
    }
    
    /// 按页滚动 (Page Up / Page Down)
    func scrollCurrentDetailByPage(up: Bool) {
        guard let scrollView = currentDetailScrollView else { return }
        guard let documentView = scrollView.documentView else { return }
        
        let clipView = scrollView.contentView
        // 页滚动量为可见区域高度的 90%，留一点重叠便于阅读连贯
        let pageHeight = clipView.bounds.height * 0.9
        let delta = up ? -pageHeight : pageHeight
        
        // flipped 坐标系下，y 增大表示向下
        let effectiveDelta = (documentView.isFlipped ? delta : -delta)
        
        var newOrigin = clipView.bounds.origin
        newOrigin.y += effectiveDelta
        
        let maxY = max(0, documentView.bounds.height - clipView.bounds.height)
        newOrigin.y = min(max(newOrigin.y, 0), maxY)
        
        clipView.scroll(to: newOrigin)
        scrollView.reflectScrolledClipView(clipView)
    }
    
    // MARK: - Focus Helpers
    
    func focusDetailScrollViewIfPossible(window: NSWindow) {
        guard let scrollView = currentDetailScrollView else { return }
        DispatchQueue.main.async {
            // 让 Detail 真正成为 first responder，List 的选中高亮会变为非激活（灰色）
            _ = window.makeFirstResponder(scrollView.contentView)
        }
    }
    
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
        case .wechatChat:
            return Notification.Name("DataSourceSwitchedToWechatChat")
        }
    }
}

