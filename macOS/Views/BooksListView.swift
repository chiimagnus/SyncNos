//
//  BooksListView.swift
//  SyncBookNotesWithNotion
//
//  Created by chii_magnus on 2025/9/10.
//

import SwiftUI

struct BooksListView: View {
    @StateObject private var viewModel = BookViewModel()
    
    var body: some View {
        NavigationView {
            VStack {
                if viewModel.isLoading {
                    ProgressView("Loading books...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMessage = viewModel.errorMessage {
                    VStack {
                        Image(systemName: "exclamationmark.triangle")
                            .foregroundColor(.orange)
                            .font(.largeTitle)
                        Text("Error: \(errorMessage)")
                            .multilineTextAlignment(.center)
                            .padding()
                        Button("Retry") {
                            viewModel.loadBooks()
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if viewModel.books.isEmpty {
                    VStack {
                        Image(systemName: "books.vertical")
                            .foregroundColor(.secondary)
                            .font(.largeTitle)
                        Text("No books found")
                            .padding()
                        Button("Refresh") {
                            viewModel.loadBooks()
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(viewModel.books, id: \.bookId) { book in
                        NavigationLink(destination: BookDetailView(book: book)) {
                            VStack(alignment: .leading) {
                                Text(book.bookTitle)
                                    .font(.headline)
                                Text(book.authorName)
                                    .font(.subheadline)
                                    .foregroundColor(.secondary)
                                Text("\(book.highlights.count) highlights")
                                    .font(.caption)
//                                    .foregroundColor(.tertiary)
                            }
                            .padding(.vertical, 4)
                        }
                    }
                    .listStyle(PlainListStyle())
                }
            }
            .navigationTitle("Books")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button(action: {
                        viewModel.loadBooks()
                    }) {
                        Image(systemName: "arrow.clockwise")
                    }
                    .help("Refresh")
                }
            }
        }
        .onAppear {
            viewModel.loadBooks()
        }
    }
}

struct BooksListView_Previews: PreviewProvider {
    static var previews: some View {
        BooksListView()
    }
}
