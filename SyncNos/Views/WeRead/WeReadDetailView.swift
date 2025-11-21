import SwiftUI

struct WeReadDetailView: View {
    @ObservedObject var listViewModel: WeReadViewModel
    @Binding var selectedBookId: String?
    @StateObject private var detailViewModel = WeReadDetailViewModel()

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .short
        f.timeStyle = .short
        return f
    }()

    private var selectedBook: WeReadBookListItem? {
        listViewModel.displayBooks.first { $0.bookId == (selectedBookId ?? "") } ?? listViewModel.displayBooks.first
    }

    private func color(for style: Int?) -> Color {
        guard let style else {
            return Color.gray.opacity(0.4)
        }
        return HighlightColorUI.color(for: style, source: .weRead)
    }

    var body: some View {
        Group {
            if let book = selectedBook {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        InfoHeaderCardView(
                            title: book.title,
                            subtitle: book.author.isEmpty ? nil : book.author
                        ) {
                            if let url = URL(string: "https://weread.qq.com/web/reader/\(book.bookId)") {
                                Link("Open in WeRead Web", destination: url)
                                    .font(.subheadline)
                            }
                        } content: {
                            HStack(spacing: 12) {
                                HStack(spacing: 6) {
                                    Image(systemName: "highlighter")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                    Text("\(book.highlightCount) highlights")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                        }

                        if detailViewModel.isLoading {
                            ProgressView("Loading highlights...")
                                .padding(.top)
                        } else if detailViewModel.highlights.isEmpty {
                            Text("No highlights found for this book.")
                                .foregroundColor(.secondary)
                                .padding(.top)
                        } else {
                            WaterfallLayout(minColumnWidth: 280, spacing: 12) {
                                ForEach(detailViewModel.highlights) { h in
                                    HighlightCardView(
                                        colorMark: color(for: h.colorIndex),
                                        content: h.text,
                                        note: h.reviewContent ?? h.note,  // 优先显示想法内容，其次是简短笔记
                                        createdDate: h.createdAt.map { Self.dateFormatter.string(from: $0) },
                                        modifiedDate: h.modifiedAt.map { Self.dateFormatter.string(from: $0) }
                                    )
                                }
                            }
                            .padding(.top)
                        }
                    }
                    .padding()
                }
            } else {
                Text("Select a WeRead book to view details")
                    .foregroundColor(.secondary)
            }
        }
        .navigationTitle("WeRead")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                FiltetSortBar(
                    noteFilter: $detailViewModel.noteFilter,
                    selectedStyles: $detailViewModel.selectedStyles,
                    colorTheme: .weRead,
                    sortField: detailViewModel.sortField,
                    isAscending: detailViewModel.isAscending,
                    onSortFieldChanged: { field in
                        detailViewModel.sortField = field
                        Task { await detailViewModel.reloadCurrent() }
                    },
                    onAscendingChanged: { asc in
                        detailViewModel.isAscending = asc
                        Task { await detailViewModel.reloadCurrent() }
                    }
                )
            }

            ToolbarItem(placement: .automatic) {
                if detailViewModel.isSyncing {
                    HStack(spacing: 8) {
                        ProgressView().scaleEffect(0.8)
                        if let progress = detailViewModel.syncProgressText {
                            Text(progress).font(.caption)
                        } else {
                            Text("Syncing...").font(.caption)
                        }
                    }
                } else if let book = selectedBook {
                    Button {
                        detailViewModel.syncSmart(book: book)
                    } label: {
                        Label("Sync", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .help("Sync highlights to Notion")
                }
            }
        }
        .onAppear {
            if let book = selectedBook {
                Task {
                    await detailViewModel.loadHighlights(for: book.bookId)
                }
            }
        }
        .onChange(of: selectedBookId) { _, _ in
            if let book = selectedBook {
                Task {
                    await detailViewModel.loadHighlights(for: book.bookId)
                }
            }
        }
    }
}
