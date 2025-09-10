//
//  BooksListView.swift
//  SyncBookNotesWithNotion
//
//  Created by chii_magnus on 2025/9/10.
//

import SwiftUI
import AppKit

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
                ToolbarItem(placement: .automatic) {
                    Button("查看Apple Books笔记") {
                        pickAppleBooksContainer()
                    }
                    .help("选择 Apple Books 容器目录并加载笔记")
                }
            }
        }
        .onAppear {
            viewModel.loadBooks()
        }
    }

    // MARK: - Private Helpers
    private func pickAppleBooksContainer() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = false
        panel.prompt = "选择"
        panel.message = "请选择 Apple Books 容器目录（com.apple.iBooksX）或其 Data/Documents 路径"

        let home = NSHomeDirectory()
        let defaultContainer = "\(home)/Library/Containers/com.apple.iBooksX"
        panel.directoryURL = URL(fileURLWithPath: defaultContainer, isDirectory: true)

        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            let selectedPath = url.path

            // Normalize selection to the root that contains AEAnnotation/BKLibrary under Data/Documents
            let fm = FileManager.default
            var rootCandidate = selectedPath

            let maybeDataDocs = (selectedPath as NSString).appendingPathComponent("Data/Documents")
            let aeAnnoInDataDocs = (maybeDataDocs as NSString).appendingPathComponent("AEAnnotation")
            let bkLibInDataDocs = (maybeDataDocs as NSString).appendingPathComponent("BKLibrary")

            if fm.fileExists(atPath: aeAnnoInDataDocs) || fm.fileExists(atPath: bkLibInDataDocs) {
                rootCandidate = maybeDataDocs
            } else {
                // If they picked Data/Documents directly, accept as-is
                let aeAnno = (selectedPath as NSString).appendingPathComponent("AEAnnotation")
                let bkLib = (selectedPath as NSString).appendingPathComponent("BKLibrary")
                if fm.fileExists(atPath: aeAnno) || fm.fileExists(atPath: bkLib) {
                    rootCandidate = selectedPath
                }
            }

            DispatchQueue.main.async {
                viewModel.setDbRootOverride(rootCandidate)
                viewModel.loadBooks()
            }
        }
    }
}

struct BooksListView_Previews: PreviewProvider {
    static var previews: some View {
        BooksListView()
    }
}
