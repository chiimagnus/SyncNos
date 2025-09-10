import SwiftUI
import AppKit

struct BookDetailView: View {
    let book: BookListItem
    let annotationDBPath: String?
    @StateObject private var viewModel = BookDetailViewModel()
    
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
    
    private static var gridColumns: [GridItem] {
        [GridItem(.adaptive(minimum: 280), spacing: 12, alignment: .top)]
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
                    
                    Text("\(book.highlightCount) highlights")
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
                LazyVGrid(columns: Self.gridColumns, spacing: 12) {
                    ForEach(viewModel.highlights, id: \.uuid) { highlight in
                        // Card
                        ZStack(alignment: .topTrailing) {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(spacing: 8) {
                                    if let style = highlight.style {
                                        Text(Self.highlightStyleText(for: style))
                                            .font(.caption)
                                            .fontWeight(.semibold)
                                            .padding(.horizontal, 6)
                                            .padding(.vertical, 2)
                                            .background(Color.white.opacity(0.25))
                                            .cornerRadius(4)
                                    }
                                    
                                    Text("高亮笔记")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                    
                                    Spacer(minLength: 0)
                                }
                                
                                Text(highlight.text)
                                    .font(.body)
                                    .fixedSize(horizontal: false, vertical: true)
                                
                                if let note = highlight.note, !note.isEmpty {
                                    Text(note)
                                        .font(.subheadline)
                                        .foregroundColor(.secondary)
                                }
                                
                                HStack(spacing: 12) {
                                    if let style = highlight.style {
                                        Text("样式：\(Self.highlightStyleText(for: style))")
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                    }
                                    
                                    if let dateAdded = highlight.dateAdded {
                                        Text("创建：\(dateAdded, formatter: Self.dateFormatter)")
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                    }
                                    
                                    if let modified = highlight.modified {
                                        Text("修改：\(modified, formatter: Self.dateFormatter)")
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                    }
                                    
                                    Spacer(minLength: 0)
                                }
                            }
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(
                                highlight.style.map { Self.highlightStyleColor(for: $0) } ?? Color.gray.opacity(0.12)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .stroke(Color.black.opacity(0.05))
                            )
                            .shadow(color: Color.black.opacity(0.05), radius: 3, x: 0, y: 1)
                            
                            Button {
                                if let location = highlight.location {
                                    let url = URL(string: "ibooks://assetid/\(book.bookId)#\(location)")!
                                    NSWorkspace.shared.open(url)
                                } else {
                                    let url = URL(string: "ibooks://assetid/\(book.bookId)")!
                                    NSWorkspace.shared.open(url)
                                }
                            } label: {
                                Image(systemName: "book.fill")
                                    .imageScale(.medium)
                                    .padding(8)
                                    .background(Color.white.opacity(0.7))
                                    .clipShape(Circle())
                            }
                            .buttonStyle(.plain)
                            .padding(8)
                            .help("在 Apple Books 中打开")
                            .accessibilityLabel("在 Apple Books 中打开")
                        }
                    }
                }
                .padding(.top)

                if viewModel.canLoadMore {
                    HStack {
                        Spacer()
                        Button(action: {
                            viewModel.loadNextPage(dbPath: annotationDBPath, assetId: book.bookId)
                        }) {
                            if viewModel.isLoadingPage {
                                ProgressView()
                            } else {
                                Text("加载更多")
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        Spacer()
                    }
                    .padding(.top, 8)
                }
            }
            .padding()
        }
        .onAppear {
            viewModel.resetAndLoadFirstPage(dbPath: annotationDBPath, assetId: book.bookId, expectedTotalCount: book.highlightCount)
        }
        .navigationTitle("Highlights")
    }
}

struct BookDetailView_Previews: PreviewProvider {
    static var previews: some View {
        let sampleBook = BookListItem(bookId: "sample-id",
                                       authorName: "Sample Author",
                                       bookTitle: "Sample Book Title",
                                       ibooksURL: "ibooks://assetid/sample-id",
                                       highlightCount: 123)
        
        NavigationView {
            BookDetailView(book: sampleBook, annotationDBPath: nil)
        }
    }
}
