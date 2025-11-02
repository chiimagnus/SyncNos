import Foundation

enum SyncSource: String, Codable, CaseIterable, Sendable {
    case appleBooks
    case goodLinks
}

enum SyncTaskState: String, Codable, Sendable {
    case queued
    case running
    case succeeded
    case failed
}

struct SyncQueueTask: Identifiable, Equatable, Sendable {
    let id: String
    let rawId: String
    let source: SyncSource
    var title: String
    var subtitle: String?
    var state: SyncTaskState
    var progressText: String?

    init(rawId: String, source: SyncSource, title: String, subtitle: String?, state: SyncTaskState = .queued, progressText: String? = nil) {
        self.rawId = rawId
        self.source = source
        self.title = title
        self.subtitle = subtitle
        self.state = state
        self.progressText = progressText
        self.id = "\(source.rawValue):\(rawId)"
    }
}
