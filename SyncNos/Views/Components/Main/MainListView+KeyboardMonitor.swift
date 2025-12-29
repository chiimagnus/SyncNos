import SwiftUI

// MARK: - MainListView Keyboard Navigation Extension

/// 键盘导航扩展
/// 负责处理键盘事件监听和 Detail 滚动控制
/// 焦点管理相关逻辑见 MainListView+FocusManager.swift
extension MainListView {
    
    // MARK: - Keyboard Monitor
    
    func startKeyboardMonitorIfNeeded() {
        guard keyDownMonitor == nil else { return }
        
        keyDownMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            // 只处理 MainListView 所在窗口的事件，避免影响 Settings 等其它窗口
            guard let window = self.mainWindow, event.window === window else {
                return event
            }
            
            // 若用户正在文本输入框中（field editor），不拦截任何方向键，避免破坏光标移动体验
            if window.firstResponder is NSTextView {
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
                    // 其他 Cmd 组合键不拦截（数据源切换已改为 ⌥⌘←/→）
                    return event
                }
            }
            
            // Option + 方向键：Chats 分类切换（消息导航改为 ↑/↓，见下方无修饰键分支）
            if hasOption && !hasCommand && !hasControl {
                if self.contentSource == .chats && self.keyboardNavigationTarget == .detail {
                    switch event.keyCode {
                    case 123: // Option+← 切换分类（向左：我 → 系统 → 对方）
                        NotificationCenter.default.post(
                            name: .chatsCycleClassification,
                            object: nil,
                            userInfo: ["direction": "left"]
                        )
                        return nil
                    case 124: // Option+→ 切换分类（向右：对方 → 系统 → 我）
                        NotificationCenter.default.post(
                            name: .chatsCycleClassification,
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
                    self.focusDetailIfPossible(window: window)
                    return nil
                }
                return event
            case 126: // ↑
                if self.keyboardNavigationTarget == .detail {
                    // Chats：↑/↓ 用于消息选择导航（不再做逐行滚动）
                    if self.contentSource == .chats {
                        NotificationCenter.default.post(
                            name: .chatsNavigateMessage,
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
                    // Chats：↑/↓ 用于消息选择导航（不再做逐行滚动）
                    if self.contentSource == .chats {
                        NotificationCenter.default.post(
                            name: .chatsNavigateMessage,
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
    }
    
    func stopKeyboardMonitorIfNeeded() {
        if let monitor = keyDownMonitor {
            NSEvent.removeMonitor(monitor)
            keyDownMonitor = nil
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
        case .chats:
            return selectedChatsContactIds.count == 1
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
    
}

