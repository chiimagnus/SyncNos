import Foundation

/// Parser for EPUB Canonical Fragment Identifier (CFI)
/// Example CFI: epubcfi(/6/10[id9]!/4/2[filepos2892]/1,:11,:23)
class EPUBCFIParser {
    private let logger = DIContainer.shared.loggerService
    
    /// Parse an EPUB CFI string into structured location data
    /// - Parameter cfi: CFI string like "epubcfi(/6/10[id9]!/4/2[filepos2892]/1,:11,:23)"
    /// - Returns: EPUBLocation or nil if parsing fails
    func parse(_ cfi: String?) -> EPUBLocation? {
        guard let cfi = cfi, !cfi.isEmpty else {
            return nil
        }
        
        // Remove "epubcfi(" prefix and ")" suffix if present
        var cleanCFI = cfi
        if cleanCFI.hasPrefix("epubcfi(") {
            cleanCFI = String(cleanCFI.dropFirst(8))
        }
        if cleanCFI.hasSuffix(")") {
            cleanCFI = String(cleanCFI.dropLast(1))
        }
        
        logger.verbose("Parsing CFI: \(cleanCFI)")
        
        // Split by "!" to separate chapter path from element path
        let parts = cleanCFI.split(separator: "!", maxSplits: 1, omittingEmptySubsequences: false)
        
        guard parts.count > 0 else {
            logger.warning("Invalid CFI format: no parts found")
            return nil
        }
        
        let chapterPath = String(parts[0])
        var elementPath: String? = nil
        var charOffsetStart: Int? = nil
        var charOffsetEnd: Int? = nil
        
        // Parse element path and character offsets if present
        if parts.count > 1 {
            let remainder = String(parts[1])
            
            // Check for character offsets (format: ",:11,:23" or ":11,:23")
            if let offsetRange = remainder.range(of: ",?:\\d+,:\\d+", options: .regularExpression) {
                let offsetString = String(remainder[offsetRange])
                let offsets = parseCharacterOffsets(offsetString)
                charOffsetStart = offsets.0
                charOffsetEnd = offsets.1
                
                // Element path is everything before the offsets
                elementPath = String(remainder[..<offsetRange.lowerBound])
            } else {
                elementPath = remainder
            }
        }
        
        return EPUBLocation(
            rawCFI: cfi,
            chapterPath: chapterPath,
            elementPath: elementPath,
            charOffsetStart: charOffsetStart,
            charOffsetEnd: charOffsetEnd
        )
    }
    
    /// Extract chapter identifier from chapter path
    /// Example: "/6/10[id9]" -> "id9"
    func extractChapterID(from chapterPath: String) -> String? {
        // Look for pattern like [id9] or [chapter1]
        if let range = chapterPath.range(of: "\\[[^\\]]+\\]", options: .regularExpression) {
            var id = String(chapterPath[range])
            id.removeFirst() // Remove [
            id.removeLast()  // Remove ]
            return id
        }
        return nil
    }
    
    /// Parse character offsets from string like ",:11,:23" or ":0,:45"
    private func parseCharacterOffsets(_ offsetString: String) -> (Int?, Int?) {
        let pattern = ":(\\d+)"
        let regex = try? NSRegularExpression(pattern: pattern, options: [])
        let nsString = offsetString as NSString
        let matches = regex?.matches(in: offsetString, options: [], range: NSRange(location: 0, length: nsString.length)) ?? []
        
        var offsets: [Int] = []
        for match in matches {
            if match.numberOfRanges > 1 {
                let range = match.range(at: 1)
                if let offsetStr = nsString.substring(with: range) as String?, let offset = Int(offsetStr) {
                    offsets.append(offset)
                }
            }
        }
        
        let start = offsets.count > 0 ? offsets[0] : nil
        let end = offsets.count > 1 ? offsets[1] : nil
        
        logger.verbose("Parsed offsets: start=\(start?.description ?? "nil"), end=\(end?.description ?? "nil")")
        return (start, end)
    }
}
