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
    let recentEvents: [GoodLinksAutoFetchEvent]
}

