import Foundation

/// 用于在切换数据源/离开页面时主动释放内存占用（清空大数组、重置分页状态等）。
///
/// - 设计意图：比“等待 ARC 回收”更可控；允许破坏性地丢弃缓存，下次进入时重新加载。
@MainActor
protocol MemoryPurgeable: AnyObject {
    func purgeMemory()
}


