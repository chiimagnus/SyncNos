import SwiftUI

struct AppleBooksDetailContainerView: View {
    @ObservedObject var viewModel: BookViewModel
    @Binding var selectedBookId: String?

    var body: some View {
        if let book = (viewModel.books.first { $0.bookId == (selectedBookId ?? "") }) ?? viewModel.books.first {
            BookDetailView(book: book, annotationDBPath: viewModel.annotationDatabasePath)
                .id(book.bookId)
        } else {
            Text("Select a book to view details").foregroundColor(.secondary)
        }
    }
}


