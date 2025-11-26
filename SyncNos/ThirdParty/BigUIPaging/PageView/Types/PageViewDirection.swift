import Foundation

/// 页面视图的导航方向
public enum PageViewDirection: Hashable {
    case forwards
    case backwards
}

/// 页面视图可导航的方向集合
public struct PageViewNavigationDirections: OptionSet {
    public let rawValue: Int
    
    public init(rawValue: Int) {
        self.rawValue = rawValue
    }
    
    public static let forwards = PageViewNavigationDirections(rawValue: 1 << 0)
    public static let backwards = PageViewNavigationDirections(rawValue: 1 << 1)
    public static let all: PageViewNavigationDirections = [.forwards, .backwards]
}

