import SwiftUI

struct DedaoDetailView: View {
    @ObservedObject var listViewModel: DedaoViewModel
    @Binding var selectedBookId: String?
    @StateObject private var detailViewModel = DedaoDetailViewModel()
    
    // 使用 debounce 延迟更新布局宽度，避免窗口调整大小时频繁重新计算
    @State private var measuredLayoutWidth: CGFloat = 0
    @State private var debouncedLayoutWidth: CGFloat = 0
    @State private var layoutWidthDebounceTask: Task<Void, Never>?

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .short
        f.timeStyle = .short
        return f
    }()

    private var selectedBook: DedaoBookListItem? {
        listViewModel.displayBooks.first { $0.bookId == (selectedBookId ?? "") } ?? listViewModel.displayBooks.first
    }

    /// 得到品牌色 #FF6B00
    private let dedaoColor = Color(red: 255/255, green: 107/255, blue: 0/255)

    var body: some View {
        Group {
            if let book = selectedBook {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        InfoHeaderCardView(
                            title: book.title,
                            subtitle: book.author.isEmpty ? nil : book.author,
                            timestamps: TimestampInfo(
                                addedAt: nil,  // Dedao 不提供添加时间
                                modifiedAt: nil,  // Dedao 不提供修改时间
                                lastSyncAt: listViewModel.lastSync(for: book.bookId)
                            )
                        ) {
                            if let url = URL(string: "https://www.dedao.cn/") {
                                Link("Open in Dedao Web", destination: url)
                                    .font(.subheadline)
                            }
                        } content: {
                            HStack(spacing: 6) {
                                Image(systemName: "highlighter")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                // 显示已加载/总数
                                if detailViewModel.totalFilteredCount > 0 {
                                    Text("\(detailViewModel.visibleHighlights.count)/\(detailViewModel.totalFilteredCount) highlights")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                } else {
                                    Text("\(book.highlightCount) highlights")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                        }

                        if detailViewModel.isLoading {
                            ProgressView("Loading...")
                                .padding(.top)
                        } else if detailViewModel.visibleHighlights.isEmpty {
                            VStack(spacing: 12) {
                                Image(systemName: "text.quote")
                                    .font(.largeTitle)
                                    .foregroundColor(.secondary)
                                Text("No highlights found for this book.")
                                    .foregroundColor(.secondary)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.top, 40)
                        } else {
                            WaterfallLayout(minColumnWidth: 280, spacing: 12, overrideWidth: debouncedLayoutWidth > 0 ? debouncedLayoutWidth : nil) {
                                ForEach(detailViewModel.visibleHighlights, id: \.effectiveId) { h in
                                    HighlightCardView(
                                        colorMark: dedaoColor,  // 使用得到品牌色
                                        content: h.effectiveNoteLine,
                                        note: h.note,
                                        reviewContents: [],  // 得到没有想法功能
                                        createdDate: h.effectiveCreateTime > 0 
                                            ? Self.dateFormatter.string(from: Date(timeIntervalSince1970: TimeInterval(h.effectiveCreateTime))) 
                                            : nil,
                                        modifiedDate: h.effectiveUpdateTime > 0 && h.effectiveUpdateTime != h.effectiveCreateTime
                                            ? Self.dateFormatter.string(from: Date(timeIntervalSince1970: TimeInterval(h.effectiveUpdateTime)))
                                            : nil
                                    )
                                    .onAppear {
                                        // 当卡片出现时，检查是否需要加载更多
                                        detailViewModel.loadMoreIfNeeded(currentItem: h)
                                    }
                                }
                            }
                            .padding(.top)
                            .overlay(
                                GeometryReader { proxy in
                                    let w = proxy.size.width
                                    Color.clear
                                        .onAppear {
                                            measuredLayoutWidth = w
                                            debouncedLayoutWidth = w
                                        }
                                        .onChange(of: w) { _, newValue in
                                            measuredLayoutWidth = newValue
                                            // 取消之前的 debounce 任务
                                            layoutWidthDebounceTask?.cancel()
                                            // 创建新的 debounce 任务，延迟 0.3 秒更新
                                            layoutWidthDebounceTask = Task { @MainActor in
                                                try? await Task.sleep(nanoseconds: 300_000_000) // 0.3 秒
                                                if !Task.isCancelled {
                                                    debouncedLayoutWidth = newValue
                                                }
                                            }
                                        }
                                }
                            )
                            
                            // 加载更多指示器
                            if detailViewModel.isLoadingMore {
                                HStack {
                                    Spacer()
                                    ProgressView()
                                        .scaleEffect(0.8)
                                    Text("Loading...")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                    Spacer()
                                }
                                .padding()
                            } else if detailViewModel.canLoadMore {
                                // 手动加载更多按钮（备用）
                                HStack {
                                    Spacer()
                                    Button {
                                        detailViewModel.loadNextPage()
                                    } label: {
                                        Text("Load More (\(detailViewModel.totalFilteredCount - detailViewModel.visibleHighlights.count) remaining)")
                                            .font(.caption)
                                    }
                                    .buttonStyle(.plain)
                                    .foregroundColor(.accentColor)
                                    Spacer()
                                }
                                .padding()
                            }
                        }
                    }
                    .padding()
                }
            }
        }
        .navigationTitle("Dedao")
        .toolbar {
            ToolbarItem(placement: .automatic) {
                FiltetSortBar(
                    noteFilter: $detailViewModel.noteFilter,
                    selectedStyles: $detailViewModel.selectedStyles,
                    colorTheme: .dedao,
                    sortField: detailViewModel.sortField,
                    isAscending: detailViewModel.isAscending,
                    availableSortFields: [.created, .modified],
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
                Spacer()
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

