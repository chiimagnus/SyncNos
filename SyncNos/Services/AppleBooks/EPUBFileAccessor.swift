import Foundation

/// Handles accessing EPUB files from iCloud Books directory
class EPUBFileAccessor {
    private let logger = DIContainer.shared.loggerService
    private let fileManager = FileManager.default
    
    /// Locate EPUB file for a given assetId
    /// - Parameters:
    ///   - assetId: The Apple Books asset ID
    ///   - iBooksDirectoryURL: URL to iCloud Books directory (user must have granted access)
    /// - Returns: URL to the EPUB file or nil if not found
    func locateEPUBFile(assetId: String, in iBooksDirectoryURL: URL) -> URL? {
        logger.debug("Locating EPUB file for assetId: \(assetId)")
        
        // Strategy 1: Search for files matching the assetId pattern
        // Asset IDs often appear in filenames or metadata
        if let foundURL = searchByAssetId(assetId, in: iBooksDirectoryURL) {
            return foundURL
        }
        
        // Strategy 2: Search all .epub files and check their metadata
        // This is slower but more thorough
        logger.debug("Asset ID search failed, falling back to metadata search")
        return searchByMetadata(assetId, in: iBooksDirectoryURL)
    }
    
    /// Extract content from an EPUB file at a specific chapter
    /// - Parameters:
    ///   - epubURL: URL to the EPUB file
    ///   - chapterID: Chapter identifier from CFI
    /// - Returns: HTML/XHTML content of the chapter or nil
    func extractChapterContent(from epubURL: URL, chapterID: String?) -> String? {
        logger.debug("Extracting chapter content from: \(epubURL.lastPathComponent), chapterID: \(chapterID ?? "nil")")
        
        // EPUB is a ZIP file containing XHTML/HTML files
        // We need to:
        // 1. Unzip the EPUB
        // 2. Parse container.xml to find content.opf
        // 3. Parse content.opf to find the chapter file
        // 4. Read the chapter XHTML/HTML content
        
        guard let tempDir = createTempExtractionDirectory() else {
            logger.error("Failed to create temp directory for EPUB extraction")
            return nil
        }
        
        defer {
            // Clean up temp directory
            try? fileManager.removeItem(at: tempDir)
        }
        
        // Extract EPUB contents
        guard extractEPUB(from: epubURL, to: tempDir) else {
            logger.error("Failed to extract EPUB")
            return nil
        }
        
        // Find the chapter file
        guard let chapterPath = findChapterFile(in: tempDir, chapterID: chapterID) else {
            logger.warning("Could not locate chapter file")
            return nil
        }
        
        // Read chapter content
        let chapterURL = tempDir.appendingPathComponent(chapterPath)
        guard let content = try? String(contentsOf: chapterURL, encoding: .utf8) else {
            logger.error("Failed to read chapter content from: \(chapterPath)")
            return nil
        }
        
        logger.debug("Successfully extracted chapter content (\(content.count) chars)")
        return content
    }
    
    // MARK: - Private Helpers
    
    private func searchByAssetId(_ assetId: String, in directory: URL) -> URL? {
        let enumerator = fileManager.enumerator(at: directory, 
                                               includingPropertiesForKeys: [.nameKey],
                                               options: [.skipsHiddenFiles])
        
        while let fileURL = enumerator?.nextObject() as? URL {
            // Check if filename contains assetId
            if fileURL.pathExtension.lowercased() == "epub" && 
               fileURL.lastPathComponent.contains(assetId) {
                logger.info("Found EPUB by filename: \(fileURL.lastPathComponent)")
                return fileURL
            }
        }
        
        return nil
    }
    
    private func searchByMetadata(_ assetId: String, in directory: URL) -> URL? {
        // TODO: Implement metadata-based search
        // This would involve extracting metadata from each EPUB and comparing
        // For MVP, we rely on filename-based search
        logger.warning("Metadata-based search not yet implemented")
        return nil
    }
    
    private func createTempExtractionDirectory() -> URL? {
        let tempDir = fileManager.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        do {
            try fileManager.createDirectory(at: tempDir, withIntermediateDirectories: true)
            return tempDir
        } catch {
            logger.error("Failed to create temp directory: \(error)")
            return nil
        }
    }
    
    private func extractEPUB(from epubURL: URL, to destinationURL: URL) -> Bool {
        // Use unzip command (available on macOS)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
        process.arguments = ["-q", epubURL.path, "-d", destinationURL.path]
        
        do {
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus == 0
        } catch {
            logger.error("Failed to unzip EPUB: \(error)")
            return false
        }
    }
    
    private func findChapterFile(in epubDir: URL, chapterID: String?) -> String? {
        // Parse container.xml to find content.opf location
        let containerPath = epubDir.appendingPathComponent("META-INF/container.xml")
        guard let containerXML = try? String(contentsOf: containerPath, encoding: .utf8),
              let opfPath = parseOPFPath(from: containerXML) else {
            logger.warning("Could not parse container.xml")
            return findFirstHTMLFile(in: epubDir)
        }
        
        // Parse content.opf to find chapter file
        let opfURL = epubDir.appendingPathComponent(opfPath)
        guard let opfXML = try? String(contentsOf: opfURL, encoding: .utf8) else {
            logger.warning("Could not read content.opf")
            return findFirstHTMLFile(in: epubDir)
        }
        
        // Find chapter file by ID
        if let chapterID = chapterID,
           let chapterFile = parseChapterFile(from: opfXML, chapterID: chapterID, opfBasePath: (opfPath as NSString).deletingLastPathComponent) {
            return chapterFile
        }
        
        // Fallback: return first HTML file
        return findFirstHTMLFile(in: epubDir)
    }
    
    private func parseOPFPath(from containerXML: String) -> String? {
        // Simple regex to extract full-path attribute
        let pattern = "full-path=\"([^\"]+)\""
        if let regex = try? NSRegularExpression(pattern: pattern),
           let match = regex.firstMatch(in: containerXML, range: NSRange(containerXML.startIndex..., in: containerXML)),
           let range = Range(match.range(at: 1), in: containerXML) {
            return String(containerXML[range])
        }
        return nil
    }
    
    private func parseChapterFile(from opfXML: String, chapterID: String, opfBasePath: String) -> String? {
        // Look for item with matching id
        // Pattern: <item id="chapterID" href="chapter.xhtml" ...>
        let pattern = "id=\"\(chapterID)\"[^>]*href=\"([^\"]+)\""
        if let regex = try? NSRegularExpression(pattern: pattern),
           let match = regex.firstMatch(in: opfXML, range: NSRange(opfXML.startIndex..., in: opfXML)),
           let range = Range(match.range(at: 1), in: opfXML) {
            let href = String(opfXML[range])
            return opfBasePath.isEmpty ? href : "\(opfBasePath)/\(href)"
        }
        return nil
    }
    
    private func findFirstHTMLFile(in directory: URL) -> String? {
        let enumerator = fileManager.enumerator(at: directory,
                                               includingPropertiesForKeys: [.nameKey],
                                               options: [.skipsHiddenFiles])
        
        while let fileURL = enumerator?.nextObject() as? URL {
            let ext = fileURL.pathExtension.lowercased()
            if ext == "html" || ext == "xhtml" || ext == "htm" {
                // Return relative path
                if let relativePath = fileURL.path.replacingOccurrences(of: directory.path + "/", with: "") as String? {
                    logger.info("Using first HTML file: \(relativePath)")
                    return relativePath
                }
            }
        }
        
        return nil
    }
}
