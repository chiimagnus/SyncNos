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
    
    /// 处理同步队列任务选择
    func handleSyncQueueTaskSelection(source: ContentSource, id: String) {
        // 先清除所有选择
        selectionState.clearAll()
        
        // 切换到对应数据源并选中指定项
        contentSourceRawValue = source.rawValue
        selectionState.setSelection(for: source, ids: [id])
    }
    
    // MARK: - Sync Selected
    
    func syncSelectedForCurrentSource() {
        let selectedIds = selectionState.selection(for: contentSource)
        switch contentSource {
        case .appleBooks:
            appleBooksVM.batchSync(bookIds: selectedIds, concurrency: NotionSyncConfig.batchConcurrency)
        case .goodLinks:
            goodLinksVM.batchSync(linkIds: selectedIds, concurrency: NotionSyncConfig.batchConcurrency)
        case .weRead:
            weReadVM.batchSync(bookIds: selectedIds, concurrency: NotionSyncConfig.batchConcurrency)
        case .dedao:
            dedaoVM.batchSync(bookIds: selectedIds, concurrency: NotionSyncConfig.batchConcurrency)
        case .chats:
            chatsVM.batchSync(contactIds: selectedIds, concurrency: NotionSyncConfig.batchConcurrency)
        }
    }
    
    /// 完整重新同步：清除本地 UUID 记录，然后触发同步
    func fullResyncSelectedForCurrentSource() {
        let syncedHighlightStore = DIContainer.shared.syncedHighlightStore
        let logger = DIContainer.shared.loggerService
        let selectedIds = selectionState.selection(for: contentSource)
        
        Task {
            // 使用协议驱动获取 sourceKey，消除部分 switch 语句
            let sourceKey = contentSource.sourceKey
            
            // 根据当前数据源获取选中的 ID 和书名
            // 注：此 switch 保留是因为各 ViewModel 的数据集合类型和属性不同
            let selectedItems: [(id: String, title: String)]
            
            switch contentSource {
            case .appleBooks:
                selectedItems = selectedIds.compactMap { id in
                    if let book = appleBooksVM.books.first(where: { $0.bookId == id }) {
                        return (id: id, title: book.bookTitle)
                    }
                    return nil
                }
            case .goodLinks:
                selectedItems = selectedIds.compactMap { id in
                    if let link = goodLinksVM.links.first(where: { $0.id == id }) {
                        return (id: id, title: link.title ?? "Unknown")
                    }
                    return nil
                }
            case .weRead:
                selectedItems = selectedIds.compactMap { id in
                    if let book = weReadVM.books.first(where: { $0.bookId == id }) {
                        return (id: id, title: book.title)
                    }
                    return nil
                }
            case .dedao:
                selectedItems = selectedIds.compactMap { id in
                    if let book = dedaoVM.books.first(where: { $0.bookId == id }) {
                        return (id: id, title: book.title)
                    }
                    return nil
                }
            case .chats:
                selectedItems = selectedIds.compactMap { id in
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

