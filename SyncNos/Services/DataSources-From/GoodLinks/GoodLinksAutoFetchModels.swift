import Foundation

// MARK: - GoodLinks Auto Fetch Models

enum GoodLinksAutoFetchEventKind: String, Sendable {
    case enqueued
    case cacheHit
    case started
    case succeeded
    case noContent
    case failed
    case skipped
    case reset
}

// MARK: - Item State

enum GoodLinksAutoFetchItemState: String, Sendable {
    case waiting
    case running
    case cached
    case succeeded
    case failed
}

struct GoodLinksAutoFetchItem: Sendable, Identifiable {
    var id: String { linkId }
    let linkId: String
    let title: String
    let url: String
    let state: GoodLinksAutoFetchItemState
    let message: String?
    let updatedAt: Date
}

struct GoodLinksAutoFetchEvent: Sendable, Identifiable {
    let id: UUID
    let time: Date
    let url: String
    let kind: GoodLinksAutoFetchEventKind
    let message: String?
    
    init(time: Date = Date(), url: String, kind: GoodLinksAutoFetchEventKind, message: String? = nil) {
        self.id = UUID()
        self.time = time
        self.url = url
        self.kind = kind
        self.message = message
    }
}

struct GoodLinksAutoFetchSnapshot: Sendable {
    let total: Int
    let pending: Int
    let inFlight: Int
    let completed: Int
    
    let cacheHit: Int
    let succeeded: Int
    let failed: Int
    
    let startedAt: Date?
    let lastUpdatedAt: Date?
    let items: [GoodLinksAutoFetchItem]
    let recentEvents: [GoodLinksAutoFetchEvent]
}
