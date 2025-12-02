import Foundation
import Combine

/// 得到书籍详情 ViewModel
/// 负责加载和管理单本书籍的笔记列表
@MainActor
final class DedaoDetailViewModel: ObservableObject {
    // MARK: - Published Properties
    
    /// 高亮笔记列表
    @Published private(set) var highlights: [DedaoEbookNote] = []
    
    /// 可见的高亮列表（分页加载）
    @Published private(set) var visibleHighlights: [DedaoEbookNote] = []
    
    /// 总过滤后数量
    @Published private(set) var totalFilteredCount: Int = 0
    
    /// 是否正在加载
    @Published private(set) var isLoading: Bool = false
    
    /// 是否正在加载更多
    @Published private(set) var isLoadingMore: Bool = false
    
    /// 是否正在同步
    @Published private(set) var isSyncing: Bool = false
    
    /// 同步进度文本
    @Published private(set) var syncProgressText: String?
    
    /// 笔记过滤器（true = 仅显示有笔记的，false = 显示全部）
    @Published var noteFilter: NoteFilter = false
    
    /// 选中的颜色样式（得到不支持颜色，保留为空）
    @Published var selectedStyles: Set<Int> = []
    
    /// 排序字段
    @Published var sortField: HighlightSortField = .created
    
    /// 升序/降序
    @Published var isAscending: Bool = false
    
    /// 当前书籍 ID
    private(set) var currentBookId: String?
    
    // MARK: - Private Properties
    
    private let apiService: DedaoAPIServiceProtocol
    private let cacheService: DedaoCacheServiceProtocol
    private let syncEngine: NotionSyncEngine
    private let logger: LoggerServiceProtocol
    
    private let pageSize: Int = 50
    private var currentPage: Int = 0
    private var allFilteredHighlights: [DedaoEbookNote] = []
    
    private var cancellables = Set<AnyCancellable>()
    
    /// 当前加载任务（用于取消）
    private var loadingTask: Task<Void, Never>?
    
    // MARK: - Computed Properties
    
    var canLoadMore: Bool {
        visibleHighlights.count < totalFilteredCount
    }
    
    // MARK: - Initialization
    
    init(
        apiService: DedaoAPIServiceProtocol = DIContainer.shared.dedaoAPIService,
        cacheService: DedaoCacheServiceProtocol = DIContainer.shared.dedaoCacheService,
        syncEngine: NotionSyncEngine = DIContainer.shared.notionSyncEngine,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.apiService = apiService
        self.cacheService = cacheService
        self.syncEngine = syncEngine
        self.logger = logger
        
        setupFilterPipeline()
    }
    
    // MARK: - Public Methods
    
    /// 当前书名（用于日志）
    private(set) var currentBookTitle: String?
    
    /// 加载指定书籍的高亮笔记
    /// - Parameters:
    ///   - bookId: 书籍 ID
    ///   - bookTitle: 书名（用于日志记录）
    func loadHighlights(for bookId: String, bookTitle: String? = nil) {
        // 如果是同一本书，不重复加载
        guard currentBookId != bookId else { return }
        
        // 取消之前的加载任务
        loadingTask?.cancel()
        
        currentBookId = bookId
        currentBookTitle = bookTitle
        isLoading = true
        highlights = []
        visibleHighlights = []
        allFilteredHighlights = []
        currentPage = 0
        
        let displayName = bookTitle ?? bookId
        
        // 创建新的加载任务
        loadingTask = Task { [weak self] in
            guard let self else { return }
            
            do {
                // 检查任务是否被取消
                try Task.checkCancellation()
                
                // 1. 先尝试从本地缓存加载
                let cached = try await self.cacheService.getHighlights(bookId: bookId)
                
                try Task.checkCancellation()
                
                if !cached.isEmpty {
                    let notes = cached.map { self.cachedToNote($0) }
                    self.applyFiltersAndSort(notes)
                    self.isLoading = false
                    self.logger.debug("[DedaoDetail] Loaded \(cached.count) highlights from cache for \"\(displayName)\"")
                }
                
                try Task.checkCancellation()
                
                // 2. 从 API 获取最新数据
                let apiNotes = try await self.apiService.fetchEbookNotes(ebookEnid: bookId, bookTitle: bookTitle)
                
                try Task.checkCancellation()
                
                // 3. 保存到缓存
                try await self.cacheService.saveHighlights(apiNotes, bookId: bookId)
                
                try Task.checkCancellation()
                
                // 4. 更新显示
                self.applyFiltersAndSort(apiNotes)
                
                self.logger.info("[DedaoDetail] Loaded \(apiNotes.count) highlights from API for \"\(displayName)\"")
            } catch is CancellationError {
                self.logger.debug("[DedaoDetail] Loading cancelled for \"\(displayName)\"")
            } catch {
                self.logger.error("[DedaoDetail] Failed to load highlights for \"\(displayName)\": \(error.localizedDescription)")
            }
            
            self.isLoading = false
        }
    }
    
    /// 重新加载当前书籍
    func reloadCurrent() {
        guard let bookId = currentBookId else { return }
        let title = currentBookTitle
        currentBookId = nil  // 强制重新加载
        loadHighlights(for: bookId, bookTitle: title)
    }
    
    /// 加载下一页
    func loadNextPage() {
        guard canLoadMore, !isLoadingMore else { return }
        
        isLoadingMore = true
        currentPage += 1
        
        let startIndex = currentPage * pageSize
        let endIndex = min(startIndex + pageSize, allFilteredHighlights.count)
        
        if startIndex < allFilteredHighlights.count {
            let newItems = Array(allFilteredHighlights[startIndex..<endIndex])
            visibleHighlights.append(contentsOf: newItems)
        }
        
        isLoadingMore = false
    }
    
    /// 检查是否需要加载更多
    func loadMoreIfNeeded(currentItem: DedaoEbookNote) {
        guard let index = visibleHighlights.firstIndex(where: { $0.effectiveId == currentItem.effectiveId }) else { return }
        
        let threshold = max(visibleHighlights.count - 10, 0)
        guard index >= threshold else { return }
        
        loadNextPage()
    }
    
    /// 同步当前书籍到 Notion
    func syncSmart(book: DedaoBookListItem) {
        guard !isSyncing else { return }
        
        isSyncing = true
        syncProgressText = "Preparing..."
        
        Task {
            defer {
                isSyncing = false
                syncProgressText = nil
            }
            
            do {
                let adapter = DedaoNotionAdapter.create(book: book, preferCache: false)
                try await syncEngine.syncSmart(source: adapter) { [weak self] progress in
                    self?.syncProgressText = progress
                }
                logger.info("[DedaoDetail] Sync completed for bookId=\(book.bookId)")
            } catch {
                logger.error("[DedaoDetail] Sync failed for bookId=\(book.bookId): \(error.localizedDescription)")
            }
        }
    }
    
    // MARK: - Private Methods
    
    private func setupFilterPipeline() {
        // 监听过滤条件变化
        Publishers.CombineLatest3($noteFilter, $sortField, $isAscending)
            .dropFirst()
            .debounce(for: .milliseconds(150), scheduler: DispatchQueue.main)
            .sink { [weak self] _, _, _ in
                guard let self else { return }
                self.applyFiltersAndSort(self.highlights)
            }
            .store(in: &cancellables)
    }
    
    private func applyFiltersAndSort(_ notes: [DedaoEbookNote]) {
        highlights = notes
        
        // 1. 应用笔记过滤（true = 仅显示有笔记的）
        var filtered = notes
        if noteFilter {
            filtered = filtered.filter { note in
                guard let noteContent = note.note else { return false }
                return !noteContent.isEmpty
            }
        }
        
        // 2. 应用排序
        filtered.sort { a, b in
            switch sortField {
            case .created:
                let t1 = a.effectiveCreateTime
                let t2 = b.effectiveCreateTime
                return isAscending ? (t1 < t2) : (t1 > t2)
            case .modified:
                let t1 = a.effectiveUpdateTime
                let t2 = b.effectiveUpdateTime
                return isAscending ? (t1 < t2) : (t1 > t2)
            }
        }
        
        allFilteredHighlights = filtered
        totalFilteredCount = filtered.count
        
        // 3. 重置分页
        currentPage = 0
        let endIndex = min(pageSize, filtered.count)
        visibleHighlights = Array(filtered.prefix(endIndex))
    }
    
    /// 将缓存的高亮转换为 API 模型（用于统一处理）
    private func cachedToNote(_ cached: CachedDedaoHighlight) -> DedaoEbookNote {
        // 创建一个简化的 DedaoEbookNote 用于显示
        // 由于 DedaoEbookNote 所有字段都是可选的，我们可以创建一个部分填充的实例
        return DedaoEbookNote(
            noteId: nil,
            noteIdStr: cached.highlightId,
            noteIdHazy: nil,
            uid: nil,
            isFromMe: 1,
            notesOwner: nil,
            noteType: nil,
            sourceType: nil,
            note: cached.note,
            noteTitle: nil,
            noteLine: cached.text,
            noteLineStyle: nil,
            createTime: cached.createdAt.map { Int64($0.timeIntervalSince1970) },
            updateTime: cached.updatedAt.map { Int64($0.timeIntervalSince1970) },
            tips: nil,
            shareUrl: nil,
            extra: DedaoNoteExtra(
                title: cached.chapterTitle,
                sourceType: nil,
                sourceTypeName: nil,
                bookId: nil,
                bookName: nil,
                bookSection: cached.bookSection,
                bookStartPos: nil,
                bookOffset: nil,
                bookAuthor: nil
            ),
            notesCount: nil,
            canEdit: nil,
            isPermission: nil,
            originNoteIdHazy: nil,
            rootNoteId: nil,
            rootNoteIdHazy: nil,
            originContentType: nil,
            contentType: nil,
            noteClass: nil,
            highlights: nil,
            rootHighlights: nil,
            state: nil,
            auditState: nil,
            lesson: nil,
            ddurl: nil,
            video: nil,
            notesLikeCount: nil
        )
    }
}

