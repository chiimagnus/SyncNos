import Foundation
import AppKit

/// 平台页面视图配置
struct PlatformPageViewConfiguration {
    /// 过渡样式
    enum Transition {
        case scroll
        case historyStack
        case bookStack
        case book
        
        #if os(macOS)
        var platform: NSPageController.TransitionStyle {
            switch self {
            case .scroll:
                return .horizontalStrip
            case .historyStack:
                return .stackHistory
            case .bookStack:
                return .stackBook
            case .book:
                return .horizontalStrip
            }
        }
        #endif
    }
    
    let transition: Transition
    let orientation: Axis
    let spacing: Double
}

/// 轴向枚举
public enum Axis {
    case horizontal
    case vertical
}

