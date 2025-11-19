import SwiftUI

@available(macOS 14.0, *)
struct WeReadListView: View {
    @StateObject var viewModel: WeReadViewModel
    @Binding var selectionIds: Set<String>
    
    var body: some View {
        List(selection: $selectionIds) {
            ForEach(viewModel.displayBooks) { book in
                HStack {
                    AsyncImage(url: URL(string: book.coverURL)) { image in
                        image.resizable().aspectRatio(contentMode: .fit)
                    } placeholder: {
                        Color.gray
                    }
                    .frame(width: 30, height: 45)
                    
                    VStack(alignment: .leading) {
                        Text(book.title)
                            .font(.headline)
                        Text(book.author)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    
                    Spacer()
                    
                    if let last = book.lastSyncTime {
                        Text(last, style: .date)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
                .tag(book.bookId)
                .padding(.vertical, 4)
            }
        }
        .searchable(text: $viewModel.searchText)
        .toolbar {
            ToolbarItem {
                Button {
                    viewModel.triggerRefresh()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(viewModel.isSyncing)
            }
        }
        .onAppear {
            viewModel.refreshBooks()
        }
    }
}

