import SwiftUI

@available(macOS 14.0, *)
struct WeReadDetailView: View {
    @ObservedObject var viewModel: WeReadViewModel
    @Binding var selectedBookId: String?
    
    var body: some View {
        Group {
            if let id = selectedBookId, let book = viewModel.books.first(where: { $0.bookId == id }) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        HStack(alignment: .top) {
                            AsyncImage(url: URL(string: book.coverURL)) { image in
                                image.resizable().aspectRatio(contentMode: .fit)
                            } placeholder: {
                                Rectangle().fill(Color.gray)
                            }
                            .frame(width: 100, height: 150)
                            .cornerRadius(8)
                            
                            VStack(alignment: .leading, spacing: 8) {
                                Text(book.title)
                                    .font(.largeTitle)
                                    .fontWeight(.bold)
                                
                                Text(book.author)
                                    .font(.title3)
                                    .foregroundColor(.secondary)
                                
                                if let last = book.lastSyncTime {
                                    Text("Last synced: \(last.formatted())")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                        }
                        
                        Divider()
                        
                        if book.highlights.isEmpty {
                            Text("No highlights")
                                .foregroundColor(.secondary)
                                .frame(maxWidth: .infinity, alignment: .center)
                                .padding(.top, 40)
                        } else {
                            LazyVStack(alignment: .leading, spacing: 16) {
                                ForEach(book.highlights.sorted { $0.createTime < $1.createTime }) { highlight in
                                    VStack(alignment: .leading, spacing: 8) {
                                        Text(highlight.text)
                                            .font(.body)
                                            .textSelection(.enabled)
                                        
                                        if let note = highlight.note, !note.isEmpty {
                                            Text(note)
                                                .font(.callout)
                                                .foregroundColor(.blue)
                                                .padding(.leading, 8)
                                                .overlay(
                                                    Rectangle()
                                                        .fill(Color.blue.opacity(0.3))
                                                        .frame(width: 2)
                                                        .padding(.trailing, 4),
                                                    alignment: .leading
                                                )
                                        }
                                        
                                        Text(highlight.createTime.formatted())
                                            .font(.caption2)
                                            .foregroundColor(.secondary)
                                    }
                                    .padding()
                                    .background(Color.gray.opacity(0.1))
                                    .cornerRadius(8)
                                }
                            }
                        }
                    }
                    .padding()
                }
            } else {
                Text("Select a book")
                    .foregroundColor(.secondary)
            }
        }
    }
}

