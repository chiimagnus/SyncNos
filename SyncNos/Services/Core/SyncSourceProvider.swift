import Foundation
import Combine

// MARK: - Sync Source Provider Protocol
protocol SyncSourceProvider: AnyObject, Sendable {
    /// The content source type identifier
    var source: ContentSource { get }
    
    /// Whether auto-sync is enabled for this source (usually checked via UserDefaults)
    var isAutoSyncEnabled: Bool { get }
    
    /// Trigger an auto-sync operation
    /// Should handle:
    /// 1. Precondition checks (e.g. DB existence, login status)
    /// 2. Finding eligible items (incremental sync)
    /// 3. Enqueueing tasks (posting SyncTasksEnqueued notification)
    /// 4. Executing the sync
    func triggerAutoSync() async throws
}

