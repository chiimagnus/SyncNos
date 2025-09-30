import Foundation

// MARK: - EPUB Location Models

/// Parsed EPUB CFI (Canonical Fragment Identifier) location
struct EPUBLocation {
    let rawCFI: String
    let chapterPath: String
    let elementPath: String?
    let charOffsetStart: Int?
    let charOffsetEnd: Int?
}

/// Context extracted from EPUB
struct EPUBContext {
    let previousParagraph: String?
    let currentParagraph: String
    let nextParagraph: String?
}
