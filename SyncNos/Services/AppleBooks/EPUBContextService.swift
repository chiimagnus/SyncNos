import Foundation

/// Main service for extracting EPUB context (previous and next paragraphs) for highlights
class EPUBContextService: EPUBContextServiceProtocol {
    private let logger = DIContainer.shared.loggerService
    private let cfiParser = EPUBCFIParser()
    private let fileAccessor = EPUBFileAccessor()
    private let contextExtractor = ParagraphContextExtractor()
    
    // Cache to avoid re-extracting the same EPUB multiple times
    private var epubURLCache: [String: URL] = [:]
    private var chapterContentCache: [String: String] = [:]
    
    private let cacheQueue = DispatchQueue(label: "com.syncnos.epubcontext.cache")
    
    /// Enrich a single highlight with context from EPUB
    /// - Parameters:
    ///   - highlight: The highlight to enrich
    ///   - iBooksDirectoryURL: URL to iCloud Books directory
    /// - Returns: Enriched HighlightRow with previousParagraph and nextParagraph filled
    func enrichHighlight(_ highlight: HighlightRow, iBooksDirectoryURL: URL?) -> HighlightRow {
        guard let iBooksDirectoryURL = iBooksDirectoryURL else {
            logger.warning("iBooks directory URL not provided, skipping context extraction")
            return highlight
        }
        
        guard let location = highlight.location else {
            logger.debug("Highlight has no location data, skipping context extraction")
            return highlight
        }
        
        // Parse CFI location
        guard let epubLocation = cfiParser.parse(location) else {
            logger.warning("Failed to parse CFI: \(location)")
            return highlight
        }
        
        // Locate EPUB file
        var epubURL: URL?
        cacheQueue.sync {
            if let cached = epubURLCache[highlight.assetId] {
                epubURL = cached
            } else {
                epubURL = fileAccessor.locateEPUBFile(assetId: highlight.assetId, in: iBooksDirectoryURL)
                if let url = epubURL {
                    epubURLCache[highlight.assetId] = url
                }
            }
        }
        
        guard let epubURL = epubURL else {
            logger.warning("Could not locate EPUB file for assetId: \(highlight.assetId)")
            return highlight
        }
        
        // Extract chapter ID from CFI
        let chapterID = cfiParser.extractChapterID(from: epubLocation.chapterPath)
        
        // Extract chapter content
        let cacheKey = "\(highlight.assetId):\(chapterID ?? "default")"
        var chapterContent: String?
        cacheQueue.sync {
            if let cached = chapterContentCache[cacheKey] {
                chapterContent = cached
            } else {
                chapterContent = fileAccessor.extractChapterContent(from: epubURL, chapterID: chapterID)
                if let content = chapterContent {
                    chapterContentCache[cacheKey] = content
                }
            }
        }
        
        guard let chapterContent = chapterContent else {
            logger.warning("Could not extract chapter content")
            return highlight
        }
        
        // Extract paragraph context
        guard let context = contextExtractor.extractContext(from: chapterContent,
                                                           highlightText: highlight.text,
                                                           location: epubLocation) else {
            logger.warning("Could not extract paragraph context for highlight")
            return highlight
        }
        
        // Create enriched highlight
        var enrichedHighlight = highlight
        enrichedHighlight.previousParagraph = context.previousParagraph
        enrichedHighlight.nextParagraph = context.nextParagraph
        
        logger.info("Successfully enriched highlight with context")
        return enrichedHighlight
    }
    
    /// Enrich multiple highlights with context
    /// - Parameters:
    ///   - highlights: Array of highlights to enrich
    ///   - iBooksDirectoryURL: URL to iCloud Books directory
    ///   - progressHandler: Optional callback for progress updates (called with current index)
    /// - Returns: Array of enriched highlights
    func enrichHighlights(_ highlights: [HighlightRow], 
                         iBooksDirectoryURL: URL?,
                         progressHandler: ((Int, Int) -> Void)? = nil) -> [HighlightRow] {
        logger.info("Enriching \(highlights.count) highlights with EPUB context")
        
        var enrichedHighlights: [HighlightRow] = []
        
        for (index, highlight) in highlights.enumerated() {
            let enriched = enrichHighlight(highlight, iBooksDirectoryURL: iBooksDirectoryURL)
            enrichedHighlights.append(enriched)
            
            // Report progress
            progressHandler?(index + 1, highlights.count)
        }
        
        let successCount = enrichedHighlights.filter { $0.previousParagraph != nil || $0.nextParagraph != nil }.count
        logger.info("Enrichment complete: \(successCount)/\(highlights.count) highlights enriched")
        
        return enrichedHighlights
    }
    
    /// Clear caches to free memory
    func clearCache() {
        cacheQueue.sync {
            epubURLCache.removeAll()
            chapterContentCache.removeAll()
            logger.debug("EPUB context cache cleared")
        }
    }
}
