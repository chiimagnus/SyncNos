import Foundation

/// Extracts paragraph context (previous, current, next) from HTML/XHTML content
class ParagraphContextExtractor {
    private let logger = DIContainer.shared.loggerService
    
    /// Extract context paragraphs containing the highlight text
    /// - Parameters:
    ///   - htmlContent: HTML/XHTML content of the chapter
    ///   - highlightText: The highlighted text to search for
    ///   - location: Optional EPUBLocation with character offsets
    /// - Returns: EPUBContext with previous, current, and next paragraphs
    func extractContext(from htmlContent: String, highlightText: String, location: EPUBLocation?) -> EPUBContext? {
        logger.debug("Extracting context for highlight: \(highlightText.prefix(50))...")
        
        // Strategy 1: Use character offsets if available
        if let charStart = location?.charOffsetStart,
           let charEnd = location?.charOffsetEnd {
            if let context = extractByCharacterOffset(from: htmlContent, start: charStart, end: charEnd) {
                return context
            }
        }
        
        // Strategy 2: Search for highlight text in content
        return extractByTextSearch(from: htmlContent, highlightText: highlightText)
    }
    
    // MARK: - Private Methods
    
    private func extractByCharacterOffset(from htmlContent: String, start: Int, end: Int) -> EPUBContext? {
        // Strip HTML tags to get plain text for offset calculation
        let plainText = stripHTMLTags(htmlContent)
        
        guard start < plainText.count, end <= plainText.count else {
            logger.warning("Character offsets out of bounds: start=\(start), end=\(end), textLength=\(plainText.count)")
            return nil
        }
        
        // Find the highlight text position in plain text
        let startIndex = plainText.index(plainText.startIndex, offsetBy: start)
        let endIndex = plainText.index(plainText.startIndex, offsetBy: end)
        let highlightRange = startIndex..<endIndex
        
        // Parse HTML into paragraphs
        let paragraphs = extractParagraphs(from: htmlContent)
        
        // Find which paragraph contains this offset
        return findContextInParagraphs(paragraphs, highlightRange: highlightRange, plainText: plainText)
    }
    
    private func extractByTextSearch(from htmlContent: String, highlightText: String) -> EPUBContext? {
        // Parse HTML into paragraphs
        let paragraphs = extractParagraphs(from: htmlContent)
        
        // Find paragraph containing the highlight text
        for (index, paragraph) in paragraphs.enumerated() {
            let plainParagraph = stripHTMLTags(paragraph)
            
            // Normalize whitespace for comparison
            let normalizedParagraph = normalizeWhitespace(plainParagraph)
            let normalizedHighlight = normalizeWhitespace(highlightText)
            
            if normalizedParagraph.contains(normalizedHighlight) {
                let previous = index > 0 ? stripHTMLTags(paragraphs[index - 1]) : nil
                let current = plainParagraph
                let next = index < paragraphs.count - 1 ? stripHTMLTags(paragraphs[index + 1]) : nil
                
                logger.info("Found context: prev=\(previous != nil), curr=true, next=\(next != nil)")
                return EPUBContext(previousParagraph: previous, currentParagraph: current, nextParagraph: next)
            }
        }
        
        logger.warning("Could not find highlight text in any paragraph")
        return nil
    }
    
    private func findContextInParagraphs(_ paragraphs: [String], highlightRange: Range<String.Index>, plainText: String) -> EPUBContext? {
        var currentOffset = 0
        
        for (index, paragraph) in paragraphs.enumerated() {
            let plainParagraph = stripHTMLTags(paragraph)
            let paragraphLength = plainParagraph.count
            let paragraphRange = plainText.index(plainText.startIndex, offsetBy: currentOffset)..<plainText.index(plainText.startIndex, offsetBy: currentOffset + paragraphLength)
            
            // Check if highlight range overlaps with this paragraph
            if highlightRange.overlaps(paragraphRange) {
                let previous = index > 0 ? stripHTMLTags(paragraphs[index - 1]) : nil
                let current = plainParagraph
                let next = index < paragraphs.count - 1 ? stripHTMLTags(paragraphs[index + 1]) : nil
                
                logger.info("Found context by offset: prev=\(previous != nil), curr=true, next=\(next != nil)")
                return EPUBContext(previousParagraph: previous, currentParagraph: current, nextParagraph: next)
            }
            
            currentOffset += paragraphLength
        }
        
        return nil
    }
    
    /// Extract paragraphs from HTML content
    /// Looks for <p>, <div>, and other block-level elements
    private func extractParagraphs(from html: String) -> [String] {
        var paragraphs: [String] = []
        
        // Patterns to match paragraph-like structures
        let patterns = [
            "<p[^>]*>.*?</p>",           // <p> tags
            "<div[^>]*>.*?</div>",       // <div> tags
            "<section[^>]*>.*?</section>", // <section> tags
            "<article[^>]*>.*?</article>"  // <article> tags
        ]
        
        for pattern in patterns {
            if let regex = try? NSRegularExpression(pattern: pattern, options: [.dotMatchesLineSeparators]) {
                let matches = regex.matches(in: html, range: NSRange(html.startIndex..., in: html))
                for match in matches {
                    if let range = Range(match.range, in: html) {
                        let paragraph = String(html[range])
                        // Only add non-empty paragraphs
                        if !stripHTMLTags(paragraph).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            paragraphs.append(paragraph)
                        }
                    }
                }
            }
        }
        
        // Sort by appearance order (matches should already be in order)
        logger.debug("Extracted \(paragraphs.count) paragraphs from HTML")
        return paragraphs
    }
    
    /// Remove HTML tags from text
    private func stripHTMLTags(_ html: String) -> String {
        var result = html
        
        // Remove script and style tags and their content
        result = result.replacingOccurrences(of: "<script[^>]*>.*?</script>", with: "", options: [.regularExpression, .caseInsensitive])
        result = result.replacingOccurrences(of: "<style[^>]*>.*?</style>", with: "", options: [.regularExpression, .caseInsensitive])
        
        // Remove all HTML tags
        result = result.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
        
        // Decode HTML entities
        result = decodeHTMLEntities(result)
        
        return result.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    
    /// Normalize whitespace for comparison
    private func normalizeWhitespace(_ text: String) -> String {
        // Replace multiple whitespace characters with single space
        return text.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
    
    /// Decode common HTML entities
    private func decodeHTMLEntities(_ text: String) -> String {
        var result = text
        let entities: [String: String] = [
            "&amp;": "&",
            "&lt;": "<",
            "&gt;": ">",
            "&quot;": "\"",
            "&apos;": "'",
            "&nbsp;": " ",
            "&#8217;": "'",
            "&#8220;": "",
            "&#8221;": "",
            "&#8211;": "–",
            "&#8212;": "—"
        ]
        
        for (entity, replacement) in entities {
            result = result.replacingOccurrences(of: entity, with: replacement)
        }
        
        // Decode numeric entities (&#xxx;)
        let pattern = "&#(\\d+);"
        if let regex = try? NSRegularExpression(pattern: pattern) {
            let matches = regex.matches(in: result, range: NSRange(result.startIndex..., in: result))
            for match in matches.reversed() {
                if let range = Range(match.range, in: result),
                   let numRange = Range(match.range(at: 1), in: result),
                   let code = Int(result[numRange]),
                   let scalar = UnicodeScalar(code) {
                    result.replaceSubrange(range, with: String(Character(scalar)))
                }
            }
        }
        
        return result
    }
}
