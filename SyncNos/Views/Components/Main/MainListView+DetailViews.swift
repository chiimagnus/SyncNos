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
        let selectedIds = selectionState.selection(for: .appleBooks)
        if selectedIds.count == 1 {
            let singleBookBinding = Binding<String?>(
                get: { selectedIds.first },
                set: { [selectionState] new in
                    selectionState.setSelection(for: .appleBooks, ids: new.map { Set([$0]) } ?? [])
                }
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
                count: selectedIds.isEmpty ? nil : selectedIds.count,
                filteredCount: appleBooksVM.displayBooks.count,
                totalCount: appleBooksVM.books.count,
                onSyncSelected: selectedIds.isEmpty ? nil : { syncSelectedAppleBooks() }
            )
        }
    }
    
    @ViewBuilder
    var goodLinksDetailView: some View {
        let selectedIds = selectionState.selection(for: .goodLinks)
        if selectedIds.count == 1 {
            let singleLinkBinding = Binding<String?>(
                get: { selectedIds.first },
                set: { [selectionState] new in
                    selectionState.setSelection(for: .goodLinks, ids: new.map { Set([$0]) } ?? [])
                }
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
                count: selectedIds.isEmpty ? nil : selectedIds.count,
                filteredCount: goodLinksVM.displayLinks.count,
                totalCount: goodLinksVM.links.count,
                onSyncSelected: selectedIds.isEmpty ? nil : { syncSelectedGoodLinks() }
            )
        }
    }
    
    @ViewBuilder
    var weReadDetailView: some View {
        let selectedIds = selectionState.selection(for: .weRead)
        if selectedIds.count == 1 {
            let singleWeReadBinding = Binding<String?>(
                get: { selectedIds.first },
                set: { [selectionState] new in
                    selectionState.setSelection(for: .weRead, ids: new.map { Set([$0]) } ?? [])
                }
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
                count: selectedIds.isEmpty ? nil : selectedIds.count,
                filteredCount: weReadVM.displayBooks.count,
                totalCount: weReadVM.books.count,
                onSyncSelected: selectedIds.isEmpty ? nil : { syncSelectedWeRead() }
            )
        }
    }
    
    @ViewBuilder
    var dedaoDetailView: some View {
        let selectedIds = selectionState.selection(for: .dedao)
        if selectedIds.count == 1 {
            let singleDedaoBookBinding = Binding<String?>(
                get: { selectedIds.first },
                set: { [selectionState] new in
                    selectionState.setSelection(for: .dedao, ids: new.map { Set([$0]) } ?? [])
                }
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
                count: selectedIds.isEmpty ? nil : selectedIds.count,
                filteredCount: dedaoVM.displayBooks.count,
                totalCount: dedaoVM.books.count,
                onSyncSelected: selectedIds.isEmpty ? nil : { syncSelectedDedao() }
            )
        }
    }
    
    @ViewBuilder
    var chatsDetailView: some View {
        let selectedIds = selectionState.selection(for: .chats)
        if selectedIds.count == 1 {
            let singleContactBinding = Binding<String?>(
                get: { selectedIds.first },
                set: { [selectionState] new in
                    selectionState.setSelection(for: .chats, ids: new.map { Set([$0]) } ?? [])
                }
            )
            ChatDetailView(
                listViewModel: chatsVM,
                selectedContactId: singleContactBinding,
                onScrollViewResolved: { scrollView in
                    currentDetailScrollView = scrollView
                }
            )
        } else {
            SelectionPlaceholderView(
                source: contentSource,
                count: selectedIds.isEmpty ? nil : selectedIds.count,
                filteredCount: chatsVM.contacts.count,
                totalCount: chatsVM.contacts.count,
                onSyncSelected: selectedIds.isEmpty ? nil : { syncSelectedChats() }
            )
        }
    }
    
    // MARK: - Sync Selected Methods
    
    /// 同步选中的 Apple Books
    func syncSelectedAppleBooks() {
        appleBooksVM.batchSync(bookIds: selectionState.selection(for: .appleBooks), concurrency: NotionSyncConfig.batchConcurrency)
    }
    
    /// 同步选中的 GoodLinks
    func syncSelectedGoodLinks() {
        goodLinksVM.batchSync(linkIds: selectionState.selection(for: .goodLinks), concurrency: NotionSyncConfig.batchConcurrency)
    }
    
    /// 同步选中的 WeRead
    func syncSelectedWeRead() {
        weReadVM.batchSync(bookIds: selectionState.selection(for: .weRead), concurrency: NotionSyncConfig.batchConcurrency)
    }
    
    /// 同步选中的 Dedao
    func syncSelectedDedao() {
        dedaoVM.batchSync(bookIds: selectionState.selection(for: .dedao), concurrency: NotionSyncConfig.batchConcurrency)
    }
    
    /// 同步选中的 Chats
    func syncSelectedChats() {
        chatsVM.batchSync(contactIds: selectionState.selection(for: .chats), concurrency: NotionSyncConfig.batchConcurrency)
    }
}

