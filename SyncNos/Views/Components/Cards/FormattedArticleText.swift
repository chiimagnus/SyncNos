import SwiftUI

/// A view that renders article content with proper paragraph formatting.
/// Handles both plain text with newlines and HTML content by converting to styled paragraphs.
struct FormattedArticleText: View {
    let content: String
    let lineLimit: Int?
    
    @Environment(\.fontScale) private var fontScale
    
    init(_ content: String, lineLimit: Int? = nil) {
        self.content = content
        self.lineLimit = lineLimit
    }
    
    @ViewBuilder
    var body: some View {
        if lineLimit != nil {
            // Collapsed mode: use simple Text with line limit
            Text(processedContent)
                .scaledFont(.body)
                .foregroundColor(.primary)
                .textSelection(.enabled)
                .lineLimit(lineLimit)
        } else {
            // Expanded mode: render paragraphs with proper spacing
            VStack(alignment: .leading, spacing: 12) {
                ForEach(Array(paragraphs.enumerated()), id: \.offset) { _, paragraph in
                    if !paragraph.isEmpty {
                        Text(paragraph)
                            .scaledFont(.body)
                            .foregroundColor(.primary)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }
    
    // MARK: - Private Helpers
    
    /// Check if content appears to be HTML
    private var isHTMLContent: Bool {
        content.contains("<") && content.contains(">")
    }
    
    /// Process content: strip HTML if needed and normalize whitespace
    private var cleanedContent: String {
        var text = content
        if isHTMLContent {
            text = stripHTMLTags(text)
        }
        return text
    }
    
    /// Process content to handle HTML and normalize whitespace (for collapsed mode)
    private var processedContent: String {
        normalizeWhitespace(cleanedContent)
    }
    
    /// Split content into paragraphs for proper rendering (for expanded mode)
    private var paragraphs: [String] {
        let text = cleanedContent
        
        // Split by double newlines (paragraph breaks)
        let rawParagraphs = text.components(separatedBy: "\n\n")
        
        // Process each paragraph and filter empty ones
        return rawParagraphs
            .map { paragraph in
                // Normalize whitespace within paragraph
                paragraph
                    .replacingOccurrences(of: "\n", with: " ")
                    .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
                    .trimmingCharacters(in: .whitespaces)
            }
            .filter { !$0.isEmpty }
    }
    
    /// Strip HTML tags from content
    private func stripHTMLTags(_ html: String) -> String {
        var text = html
        
        // Replace common block elements with paragraph breaks
        let blockElements = ["</p>", "</div>", "</h1>", "</h2>", "</h3>", "</h4>", "</h5>", "</h6>", "<br>", "<br/>", "<br />"]
        for element in blockElements {
            text = text.replacingOccurrences(of: element, with: "\n\n", options: .caseInsensitive)
        }
        
        // Replace list items with newlines
        text = text.replacingOccurrences(of: "</li>", with: "\n", options: .caseInsensitive)
        
        // Remove all remaining HTML tags
        text = text.replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
        
        // Decode common HTML entities
        text = text.replacingOccurrences(of: "&nbsp;", with: " ")
        text = text.replacingOccurrences(of: "&amp;", with: "&")
        text = text.replacingOccurrences(of: "&lt;", with: "<")
        text = text.replacingOccurrences(of: "&gt;", with: ">")
        text = text.replacingOccurrences(of: "&quot;", with: "\"")
        text = text.replacingOccurrences(of: "&#39;", with: "'")
        text = text.replacingOccurrences(of: "&apos;", with: "'")
        
        return text
    }
    
    /// Normalize whitespace while preserving paragraph structure
    private func normalizeWhitespace(_ text: String) -> String {
        // Replace multiple newlines with double newline (paragraph break)
        var result = text.replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
        
        // Replace multiple spaces with single space
        result = result.replacingOccurrences(of: #" {2,}"#, with: " ", options: .regularExpression)
        
        // Trim leading/trailing whitespace
        result = result.trimmingCharacters(in: .whitespacesAndNewlines)
        
        return result
    }
}

// MARK: - Preview

#Preview {
    VStack(alignment: .leading, spacing: 20) {
        Text("Plain Text Example:")
            .font(.headline)
        FormattedArticleText("""
        This is the first paragraph. It contains some text that explains something important.
        
        This is the second paragraph. It has more details about the topic being discussed.
        
        And here's a third paragraph with a conclusion.
        """)
        
        Divider()
        
        Text("HTML Example:")
            .font(.headline)
        FormattedArticleText("""
        <p>This is the first paragraph in HTML.</p>
        <p>This is the second paragraph with <strong>bold</strong> text.</p>
        <p>And a third paragraph.</p>
        """)
    }
    .padding()
    .frame(width: 400)
}
