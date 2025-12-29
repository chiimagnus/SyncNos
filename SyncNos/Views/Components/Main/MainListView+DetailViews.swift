import SwiftUI

// MARK: - MainListView Detail Views Extension

extension MainListView {
    
    // MARK: - Detail Column
    
    @ViewBuilder
    var detailColumn: some View {
        switch contentSource {
        case .appleBooks:
            appleBooksDetailView
        case .goodLinks:
            goodLinksDetailView
        case .weRead:
            weReadDetailView
        case .dedao:
            dedaoDetailView
        case .chats:
            chatsDetailView
        }
    }
    
    @ViewBuilder
    var appleBooksDetailView: some View {
        if selectedBookIds.count == 1 {
            let singleBookBinding = Binding<String?>(
                get: { selectedBookIds.first },
                set: { new in selectedBookIds = new.map { Set([$0]) } ?? [] }
            )
            AppleBooksDetailView(
                viewModelList: appleBooksVM,
                selectedBookId: singleBookBinding,
                onScrollViewResolved: { scrollView in
                    currentDetailScrollView = scrollView
                }
            )
        } else {
            SelectionPlaceholderView(
                source: contentSource,
                count: selectedBookIds.isEmpty ? nil : selectedBookIds.count,
                filteredCount: appleBooksVM.displayBooks.count,
                totalCount: appleBooksVM.books.count,
                onSyncSelected: selectedBookIds.isEmpty ? nil : { syncSelectedAppleBooks() }
            )
        }
    }
    
    @ViewBuilder
    var goodLinksDetailView: some View {
        if selectedLinkIds.count == 1 {
            let singleLinkBinding = Binding<String?>(
                get: { selectedLinkIds.first },
                set: { new in selectedLinkIds = new.map { Set([$0]) } ?? [] }
            )
            GoodLinksDetailView(
                viewModel: goodLinksVM,
                selectedLinkId: singleLinkBinding,
                onScrollViewResolved: { scrollView in
                    currentDetailScrollView = scrollView
                }
            )
        } else {
            SelectionPlaceholderView(
                source: contentSource,
                count: selectedLinkIds.isEmpty ? nil : selectedLinkIds.count,
                filteredCount: goodLinksVM.displayLinks.count,
                totalCount: goodLinksVM.links.count,
                onSyncSelected: selectedLinkIds.isEmpty ? nil : { syncSelectedGoodLinks() }
            )
        }
    }
    
    @ViewBuilder
    var weReadDetailView: some View {
        if selectedWeReadBookIds.count == 1 {
            let singleWeReadBinding = Binding<String?>(
                get: { selectedWeReadBookIds.first },
                set: { new in selectedWeReadBookIds = new.map { Set([$0]) } ?? [] }
            )
            WeReadDetailView(
                listViewModel: weReadVM,
                selectedBookId: singleWeReadBinding,
                onScrollViewResolved: { scrollView in
                    currentDetailScrollView = scrollView
                }
            )
        } else {
            SelectionPlaceholderView(
                source: contentSource,
                count: selectedWeReadBookIds.isEmpty ? nil : selectedWeReadBookIds.count,
                filteredCount: weReadVM.displayBooks.count,
                totalCount: weReadVM.books.count,
                onSyncSelected: selectedWeReadBookIds.isEmpty ? nil : { syncSelectedWeRead() }
            )
        }
    }
    
    @ViewBuilder
    var dedaoDetailView: some View {
        if selectedDedaoBookIds.count == 1 {
            let singleDedaoBookBinding = Binding<String?>(
                get: { selectedDedaoBookIds.first },
                set: { new in selectedDedaoBookIds = new.map { Set([$0]) } ?? [] }
            )
            DedaoDetailView(
                listViewModel: dedaoVM,
                selectedBookId: singleDedaoBookBinding,
                onScrollViewResolved: { scrollView in
                    currentDetailScrollView = scrollView
                }
            )
        } else {
            SelectionPlaceholderView(
                source: contentSource,
                count: selectedDedaoBookIds.isEmpty ? nil : selectedDedaoBookIds.count,
                filteredCount: dedaoVM.displayBooks.count,
                totalCount: dedaoVM.books.count,
                onSyncSelected: selectedDedaoBookIds.isEmpty ? nil : { syncSelectedDedao() }
            )
        }
    }
    
    @ViewBuilder
    var chatsDetailView: some View {
        if selectedChatsContactIds.count == 1 {
            let singleContactBinding = Binding<String?>(
                get: { selectedChatsContactIds.first },
                set: { new in selectedChatsContactIds = new.map { Set([$0]) } ?? [] }
            )
            ChatDetailView(
                listViewModel: chatsVM,
                selectedContactId: singleContactBinding,
                onScrollViewResolved: { scrollView in
                    currentDetailScrollView = scrollView
                }
            )
        } else {
            // Chats does not have sync functionality, show simple placeholder
            VStack(spacing: 16) {
                Image(systemName: "message")
                    .font(.system(size: 48))
                    .foregroundColor(.secondary)
                if selectedChatsContactIds.isEmpty {
                    Text("Select a chat")
                        .scaledFont(.title3)
                        .foregroundColor(.secondary)
                } else {
                    Text("\(selectedChatsContactIds.count) chats selected")
                        .scaledFont(.title3)
                        .foregroundColor(.secondary)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
    
    // MARK: - Sync Selected Methods
    
    /// 同步选中的 Apple Books
    func syncSelectedAppleBooks() {
        appleBooksVM.batchSync(bookIds: selectedBookIds, concurrency: NotionSyncConfig.batchConcurrency)
    }
    
    /// 同步选中的 GoodLinks
    func syncSelectedGoodLinks() {
        goodLinksVM.batchSync(linkIds: selectedLinkIds, concurrency: NotionSyncConfig.batchConcurrency)
    }
    
    /// 同步选中的 WeRead
    func syncSelectedWeRead() {
        weReadVM.batchSync(bookIds: selectedWeReadBookIds, concurrency: NotionSyncConfig.batchConcurrency)
    }
    
    /// 同步选中的 Dedao
    func syncSelectedDedao() {
        dedaoVM.batchSync(bookIds: selectedDedaoBookIds, concurrency: NotionSyncConfig.batchConcurrency)
    }
}

