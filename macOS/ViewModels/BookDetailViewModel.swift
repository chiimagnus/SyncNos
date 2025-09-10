import Foundation
import SQLite3

class BookDetailViewModel: ObservableObject {
    @Published var highlights: [Highlight] = []
    @Published var isLoadingPage = false
    @Published var errorMessage: String?
    
    var canLoadMore: Bool { expectedTotalCount > highlights.count }
    
    private let databaseService: DatabaseServiceProtocol
    private var dbHandle: OpaquePointer?
    private var currentAssetId: String?
    private var currentOffset = 0
    private let pageSize = 100
    private var expectedTotalCount = 0
    
    init(databaseService: DatabaseServiceProtocol = DIContainer.shared.databaseService) {
        self.databaseService = databaseService
    }
    
    deinit {
        closeHandle()
    }
    
    func resetAndLoadFirstPage(dbPath: String?, assetId: String, expectedTotalCount: Int) {
        errorMessage = nil
        closeHandle()
        highlights = []
        currentOffset = 0
        currentAssetId = assetId
        self.expectedTotalCount = expectedTotalCount
        
        if let path = dbPath {
            do {
                dbHandle = try databaseService.openReadOnlyDatabase(dbPath: path)
            } catch {
                errorMessage = error.localizedDescription
                return
            }
        }
        loadNextPage(dbPath: dbPath, assetId: assetId)
    }
    
    func loadNextPage(dbPath: String?, assetId: String) {
        if isLoadingPage { return }
        if highlights.count >= expectedTotalCount { return }
        
        if currentAssetId == nil {
            currentAssetId = assetId
        }
        if dbHandle == nil, let path = dbPath {
            do {
                dbHandle = try databaseService.openReadOnlyDatabase(dbPath: path)
            } catch {
                errorMessage = error.localizedDescription
                return
            }
        }
        guard let handle = dbHandle, let asset = currentAssetId else { return }
        
        isLoadingPage = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            do {
                let rows = try self.databaseService.fetchHighlightPage(db: handle, assetId: asset, limit: self.pageSize, offset: self.currentOffset)
                let page = rows.map { r in
                    Highlight(uuid: r.uuid, text: r.text, note: r.note, style: r.style, dateAdded: r.dateAdded, modified: r.modified, location: r.location)
                }
                DispatchQueue.main.async {
                    self.highlights.append(contentsOf: page)
                    self.currentOffset += page.count
                    self.isLoadingPage = false
                }
            } catch {
                DispatchQueue.main.async {
                    self.errorMessage = error.localizedDescription
                    self.isLoadingPage = false
                }
            }
        }
    }
    
    private func closeHandle() {
        if let handle = dbHandle {
            databaseService.close(handle)
            dbHandle = nil
        }
    }
}


