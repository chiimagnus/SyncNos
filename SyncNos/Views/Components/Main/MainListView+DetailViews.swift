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
        let filteredCount = appleBooksVM.displayBooks.count
        let logicalCount = selectionState.logicalSelectedCount(for: .appleBooks, totalCount: filteredCount)
        let selectedIds = selectionState.selection(for: .appleBooks)
        if selectedIds.count == 1 && !selectionState.isAllSelected(for: .appleBooks) {
            let singleBookBinding = Binding<String?>(
                get: { [selectionState] in selectionState.singleSelectedId(for: .appleBooks) },
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
                count: logicalCount == 0 ? nil : logicalCount,
                filteredCount: filteredCount,
                totalCount: appleBooksVM.books.count,
                onSyncSelected: logicalCount == 0 ? nil : { syncSelectedAppleBooks() }
            )
        }
    }
    
    @ViewBuilder
    var goodLinksDetailView: some View {
        let filteredCount = goodLinksVM.displayLinks.count
        let logicalCount = selectionState.logicalSelectedCount(for: .goodLinks, totalCount: filteredCount)
        let selectedIds = selectionState.selection(for: .goodLinks)
        if selectedIds.count == 1 && !selectionState.isAllSelected(for: .goodLinks) {
            let singleLinkBinding = Binding<String?>(
                get: { [selectionState] in selectionState.singleSelectedId(for: .goodLinks) },
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
                count: logicalCount == 0 ? nil : logicalCount,
                filteredCount: filteredCount,
                totalCount: goodLinksVM.links.count,
                onSyncSelected: logicalCount == 0 ? nil : { syncSelectedGoodLinks() }
            )
        }
    }
    
    @ViewBuilder
    var weReadDetailView: some View {
        let filteredCount = weReadVM.displayBooks.count
        let logicalCount = selectionState.logicalSelectedCount(for: .weRead, totalCount: filteredCount)
        let selectedIds = selectionState.selection(for: .weRead)
        if selectedIds.count == 1 && !selectionState.isAllSelected(for: .weRead) {
            let singleWeReadBinding = Binding<String?>(
                get: { [selectionState] in selectionState.singleSelectedId(for: .weRead) },
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
                count: logicalCount == 0 ? nil : logicalCount,
                filteredCount: filteredCount,
                totalCount: weReadVM.books.count,
                onSyncSelected: logicalCount == 0 ? nil : { syncSelectedWeRead() }
            )
        }
    }
    
    @ViewBuilder
    var dedaoDetailView: some View {
        let filteredCount = dedaoVM.displayBooks.count
        let logicalCount = selectionState.logicalSelectedCount(for: .dedao, totalCount: filteredCount)
        let selectedIds = selectionState.selection(for: .dedao)
        if selectedIds.count == 1 && !selectionState.isAllSelected(for: .dedao) {
            let singleDedaoBookBinding = Binding<String?>(
                get: { [selectionState] in selectionState.singleSelectedId(for: .dedao) },
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
                count: logicalCount == 0 ? nil : logicalCount,
                filteredCount: filteredCount,
                totalCount: dedaoVM.books.count,
                onSyncSelected: logicalCount == 0 ? nil : { syncSelectedDedao() }
            )
        }
    }
    
    @ViewBuilder
    var chatsDetailView: some View {
        let filteredCount = chatsVM.contacts.count
        let logicalCount = selectionState.logicalSelectedCount(for: .chats, totalCount: filteredCount)
        let selectedIds = selectionState.selection(for: .chats)
        if selectedIds.count == 1 && !selectionState.isAllSelected(for: .chats) {
            let singleContactBinding = Binding<String?>(
                get: { [selectionState] in selectionState.singleSelectedId(for: .chats) },
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
                count: logicalCount == 0 ? nil : logicalCount,
                filteredCount: filteredCount,
                totalCount: filteredCount,
                onSyncSelected: logicalCount == 0 ? nil : { syncSelectedChats() }
            )
        }
    }
    
    // MARK: - Sync Selected Methods
    
    /// 同步选中的 Apple Books
    func syncSelectedAppleBooks() {
        let allIds = Set(appleBooksVM.displayBooks.map { $0.bookId })
        let selectedIds = selectionState.logicalSelectedIds(for: .appleBooks, allIds: allIds)
        appleBooksVM.batchSync(bookIds: selectedIds, concurrency: NotionSyncConfig.batchConcurrency)
    }
    
    /// 同步选中的 GoodLinks
    func syncSelectedGoodLinks() {
        let allIds = Set(goodLinksVM.displayLinks.map { $0.id })
        let selectedIds = selectionState.logicalSelectedIds(for: .goodLinks, allIds: allIds)
        goodLinksVM.batchSync(linkIds: selectedIds, concurrency: NotionSyncConfig.batchConcurrency)
    }
    
    /// 同步选中的 WeRead
    func syncSelectedWeRead() {
        let allIds = Set(weReadVM.displayBooks.map { $0.bookId })
        let selectedIds = selectionState.logicalSelectedIds(for: .weRead, allIds: allIds)
        weReadVM.batchSync(bookIds: selectedIds, concurrency: NotionSyncConfig.batchConcurrency)
    }
    
    /// 同步选中的 Dedao
    func syncSelectedDedao() {
        let allIds = Set(dedaoVM.displayBooks.map { $0.bookId })
        let selectedIds = selectionState.logicalSelectedIds(for: .dedao, allIds: allIds)
        dedaoVM.batchSync(bookIds: selectedIds, concurrency: NotionSyncConfig.batchConcurrency)
    }
    
    /// 同步选中的 Chats
    func syncSelectedChats() {
        let allIds = Set(chatsVM.contacts.map { $0.id })
        let selectedIds = selectionState.logicalSelectedIds(for: .chats, allIds: allIds)
        chatsVM.batchSync(contactIds: selectedIds, concurrency: NotionSyncConfig.batchConcurrency)
    }
}
