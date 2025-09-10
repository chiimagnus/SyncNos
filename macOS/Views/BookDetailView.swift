//
//  BookDetailView.swift
//  SyncBookNotesWithNotion
//
//  Created by chii_magnus on 2025/9/10.
//

import SwiftUI

struct BookDetailView: View {
    let book: BookExport
    
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
                        HStack(alignment: .top) {
                            Text(highlight.text)
                                .padding()
                                .background(Color.blue.opacity(0.1))
                                .cornerRadius(8)
                            
                            Spacer()
                        }
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
                Highlight(uuid: "highlight-1", text: "This is a sample highlight text."),
                Highlight(uuid: "highlight-2", text: "This is another sample highlight text.")
            ]
        )
        
        NavigationView {
            BookDetailView(book: sampleBook)
        }
    }
}
