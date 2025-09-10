//
//  BookDetailView.swift
//  SyncBookNotesWithNotion
//
//  Created by chii_magnus on 2025/9/10.
//

import SwiftUI

struct BookDetailView: View {
    let book: BookExport
    
    static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter
    }()
    
    static func highlightStyleText(for style: Int) -> String {
        switch style {
        case 0:
            return "下划线"
        case 1:
            return "绿色"
        case 2:
            return "蓝色"
        case 3:
            return "黄色"
        case 4:
            return "粉色"
        case 5:
            return "紫色"
        default:
            return "其他"
        }
    }
    
    static func highlightStyleColor(for style: Int) -> Color {
        switch style {
        case 0:
            return Color.orange.opacity(0.3) // Underline style
        case 1:
            return Color.green.opacity(0.3)
        case 2:
            return Color.blue.opacity(0.3)
        case 3:
            return Color.yellow.opacity(0.3)
        case 4:
            return Color.pink.opacity(0.3)
        case 5:
            return Color.purple.opacity(0.3)
        default:
            return Color.gray.opacity(0.3)
        }
    }
    
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Book header
                VStack(alignment: .leading, spacing: 8) {
                    Text(book.bookTitle)
                        .font(.title)
                        .fontWeight(.bold)
                    
                    Text("by \(book.authorName)")
                        .font(.title2)
                        .foregroundColor(.secondary)
                    
                    Text("\(book.highlights.count) highlights")
                        .font(.subheadline)
//                        .foregroundColor(.tertiary)
                    
                    Link("Open in Apple Books", destination: URL(string: book.ibooksURL)!)
                        .font(.subheadline)
                        .padding(.top, 4)
                }
                .padding()
                .background(Color.gray.opacity(0.1))
                .cornerRadius(8)
                
                // Highlights section
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(book.highlights, id: \.uuid) { highlight in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                // Display highlight style/color indicator
                                if let style = highlight.style {
                                    Text(Self.highlightStyleText(for: style))
                                        .font(.caption)
                                        .fontWeight(.bold)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(Self.highlightStyleColor(for: style))
                                        .cornerRadius(4)
                                }
                                
                                Text("高亮笔记")
                                    .font(.caption)
                                    .fontWeight(.medium)
                                    .foregroundColor(.secondary)
                            }
                            
                            Text(highlight.text)
                                .padding()
                                .background(Color.blue.opacity(0.1))
                                .cornerRadius(8)
                            
                            // Display additional highlight information
                            if let note = highlight.note, !note.isEmpty {
                                Text("Note: \(note)")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                    .padding(.horizontal)
                            }
                            
                            HStack {
                                if let style = highlight.style {
                                    Text("Style: \(style)")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                
                                if let dateAdded = highlight.dateAdded {
                                    Text("Created: \(dateAdded, formatter: Self.dateFormatter)")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                
                                if let modified = highlight.modified {
                                    Text("Modified: \(modified, formatter: Self.dateFormatter)")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                
                                Spacer()
                            }
                            .padding(.horizontal)
                            
                            HStack {
                                if let location = highlight.location {
                                    Text("Location: \(location)")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                
                                if let rangeStart = highlight.rangeStart {
                                    Text("Range Start: \(rangeStart)")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                
                                if let rangeEnd = highlight.rangeEnd {
                                    Text("Range End: \(rangeEnd)")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                                
                                Spacer()
                            }
                            .padding(.horizontal)
                        }
                        .padding(.vertical, 4)
                    }
                }
                .padding(.top)
            }
            .padding()
        }
        .navigationTitle("Highlights")
    }
}

struct BookDetailView_Previews: PreviewProvider {
    static var previews: some View {
        let sampleBook = BookExport(
            bookId: "sample-id",
            authorName: "Sample Author",
            bookTitle: "Sample Book Title",
            ibooksURL: "ibooks://assetid/sample-id",
            highlights: [
                Highlight(uuid: "highlight-1", text: "This is a sample highlight text.", note: nil, style: nil, stylingColor: nil, dateAdded: nil, modified: nil, location: nil, rangeStart: nil, rangeEnd: nil),
                Highlight(uuid: "highlight-2", text: "This is another sample highlight text.", note: nil, style: nil, stylingColor: nil, dateAdded: nil, modified: nil, location: nil, rangeStart: nil, rangeEnd: nil)
            ]
        )
        
        NavigationView {
            BookDetailView(book: sampleBook)
        }
    }
}
