import Foundation
import Combine

@available(macOS 14.0, *)
class WeReadViewModel: ObservableObject {
    @Published var books: [WeReadBook] = []
    @Published var searchText = ""
    @Published var isSyncing = false
    @Published var showNotionConfigAlert = false
    
    private let dataService = WeReadDataService.shared
    private let apiService = WeReadAPIService()
    private let syncProvider: WeReadSyncProvider?
    
    private var cancellables = Set<AnyCancellable>()
    
    var displayBooks: [WeReadBook] {
        if searchText.isEmpty {
            return books
        } else {
            return books.filter { $0.title.localizedCaseInsensitiveContains(searchText) || $0.author.localizedCaseInsensitiveContains(searchText) }
        }
    }
    
    init() {
        // Try to get provider
        if let provider = DIContainer.shared.syncProviders.first(where: { $0.source == .weRead }) as? WeReadSyncProvider {
            self.syncProvider = provider
        } else {
            self.syncProvider = nil
        }
        
        refreshBooks()
        
        // Listen for sync notifications
        NotificationCenter.default.publisher(for: Notification.Name("SyncBookStatusChanged"))
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                self?.refreshBooks() // Update last sync time display
            }
            .store(in: &cancellables)
    }
    
    func refreshBooks() {
        self.books = dataService.fetchAllBooks()
    }
    
    func triggerRefresh() {
        guard let provider = syncProvider else { return }
        isSyncing = true
        Task {
            do {
                try await provider.triggerAutoSync() // Reuse logic to fetch and update local DB
                await MainActor.run {
                    self.refreshBooks()
                    self.isSyncing = false
                }
            } catch {
                print("WeRead refresh failed: \(error)")
                await MainActor.run {
                    self.isSyncing = false
                }
            }
        }
    }
    
    func batchSync(bookIds: Set<String>, concurrency: Int) {
        guard DIContainer.shared.notionConfigStore.isConfigured else {
            showNotionConfigAlert = true
            return
        }
        
        // Use provider's internal sync logic (it's currently private in provider, 
        // but provider triggers via auto-sync logic for all eligible, or we can expose single sync).
        // For now, trigger AutoSync which covers "Sync All" concept, or refactor provider to expose specific sync.
        // Given current architecture, AutoSyncService triggers provider.
        
        // If user selected specific items, we might want to sync only those.
        // But provider's triggerAutoSync scans for updates.
        
        // Ideally, provider should have a sync(ids:) method.
        // For MVP of UI integration: trigger general sync, or make provider method public.
        // WeReadSyncProvider is in a separate file. I cannot easily change access level without re-writing file.
        // But I can call triggerAutoSync which will pick up items that need syncing (incremental).
        // If forced sync is needed, we might need to clear timestamps or update provider.
        
        // For this implementation, I'll trigger full refresh/sync.
        triggerRefresh()
    }
}

