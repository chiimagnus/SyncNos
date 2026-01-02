import SwiftUI

// MARK: - MainListView Sync & Refresh Extension

extension MainListView {
    
    // MARK: - Navigation
    
    func navigateToLogin(for source: ContentSource) {
        switch source {
        case .weRead:
            weReadVM.navigateToWeReadLogin()
        case .dedao:
            dedaoVM.navigateToDedaoLogin()
        default:
            break
        }
    }
    
    // MARK: - Sync Queue Task Selection
    
    /// 处理同步队列任务选择（使用 switch 替代 if-else 链）
    func handleSyncQueueTaskSelection(source: ContentSource, id: String) {
        // 先清除所有选择
        clearAllSelections()
        
        // 切换到对应数据源并选中指定项
        contentSourceRawValue = source.rawValue
        
        switch source {
        case .appleBooks:
            selectedBookIds = Set([id])
        case .goodLinks:
            selectedLinkIds = Set([id])
        case .weRead:
            selectedWeReadBookIds = Set([id])
        case .dedao:
            selectedDedaoBookIds = Set([id])
        case .chats:
            selectedChatsContactIds = Set([id])
        }
    }
    
    /// 清除所有数据源的选择状态
    private func clearAllSelections() {
        selectedBookIds.removeAll()
        selectedLinkIds.removeAll()
        selectedWeReadBookIds.removeAll()
        selectedDedaoBookIds.removeAll()
        selectedChatsContactIds.removeAll()
    }
    
    // MARK: - Sync Selected
    
    func syncSelectedForCurrentSource() {
        switch contentSource {
        case .appleBooks:
            appleBooksVM.batchSync(bookIds: selectedBookIds, concurrency: NotionSyncConfig.batchConcurrency)
        case .goodLinks:
            goodLinksVM.batchSync(linkIds: selectedLinkIds, concurrency: NotionSyncConfig.batchConcurrency)
        case .weRead:
            weReadVM.batchSync(bookIds: selectedWeReadBookIds, concurrency: NotionSyncConfig.batchConcurrency)
        case .dedao:
            dedaoVM.batchSync(bookIds: selectedDedaoBookIds, concurrency: NotionSyncConfig.batchConcurrency)
        case .chats:
            chatsVM.batchSync(contactIds: selectedChatsContactIds, concurrency: NotionSyncConfig.batchConcurrency)
        }
    }
    
    /// 完整重新同步：清除本地 UUID 记录，然后触发同步
    func fullResyncSelectedForCurrentSource() {
        let syncedHighlightStore = DIContainer.shared.syncedHighlightStore
        let logger = DIContainer.shared.loggerService
        
        Task {
            // 根据当前数据源获取选中的 ID、书名和 sourceKey
            let sourceKey: String
            let selectedItems: [(id: String, title: String)]
            
            switch contentSource {
            case .appleBooks:
                sourceKey = "appleBooks"
                selectedItems = selectedBookIds.compactMap { id in
                    if let book = appleBooksVM.books.first(where: { $0.bookId == id }) {
                        return (id: id, title: book.bookTitle)
                    }
                    return nil
                }
            case .goodLinks:
                sourceKey = "goodLinks"
                selectedItems = selectedLinkIds.compactMap { id in
                    if let link = goodLinksVM.links.first(where: { $0.id == id }) {
                        return (id: id, title: link.title ?? "Unknown")
                    }
                    return nil
                }
            case .weRead:
                sourceKey = "weRead"
                selectedItems = selectedWeReadBookIds.compactMap { id in
                    if let book = weReadVM.books.first(where: { $0.bookId == id }) {
                        return (id: id, title: book.title)
                    }
                    return nil
                }
            case .dedao:
                sourceKey = "dedao"
                selectedItems = selectedDedaoBookIds.compactMap { id in
                    if let book = dedaoVM.books.first(where: { $0.bookId == id }) {
                        return (id: id, title: book.title)
                    }
                    return nil
                }
            case .chats:
                sourceKey = "chats"
                selectedItems = selectedChatsContactIds.compactMap { id in
                    if let contact = chatsVM.contacts.first(where: { $0.id == id }) {
                        return (id: id, title: contact.name)
                    }
                    return nil
                }
            }
            
            // 清除每个选中项的本地记录
            for item in selectedItems {
                do {
                    try await syncedHighlightStore.clearRecords(sourceKey: sourceKey, bookId: item.id)
                    logger.info("[FullResync] Cleared local records for \"\(item.title)\"")
                } catch {
                    logger.error("[FullResync] Failed to clear records for \"\(item.title)\": \(error.localizedDescription)")
                }
            }
            
            // 触发同步（现在会从 Notion 重新获取）
            await MainActor.run {
                syncSelectedForCurrentSource()
            }
        }
    }
    
    // MARK: - Refresh
    
    func refreshCurrentSource() {
        Task {
            switch contentSource {
            case .appleBooks:
                await appleBooksVM.loadBooks()
            case .goodLinks:
                await goodLinksVM.loadRecentLinks()
            case .weRead:
                await weReadVM.loadBooks()
            case .dedao:
                await dedaoVM.loadBooks()
            case .chats:
                await chatsVM.loadFromCache()
            }
        }
    }
}

