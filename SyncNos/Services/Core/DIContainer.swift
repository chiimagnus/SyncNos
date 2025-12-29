import Foundation

// MARK: - Dependency Injection Container
class DIContainer {
    static let shared = DIContainer()

    private init() {}

    // MARK: - Services
    private var _databaseService: DatabaseServiceProtocol?
    private var _bookmarkStore: BookmarkStoreProtocol?
    private var _notionConfigStore: NotionConfigStoreProtocol?
    private var _notionService: NotionServiceProtocol?
    private var _loggerService: LoggerServiceProtocol?
    private var _iapService: IAPServiceProtocol?
    private var _goodLinksService: GoodLinksDatabaseServiceExposed?
    private var _autoSyncService: AutoSyncServiceProtocol?
    private var _syncTimestampStore: SyncTimestampStoreProtocol?
    private var _authService: AuthServiceProtocol?
    private var _syncActivityMonitor: SyncActivityMonitorProtocol?
    private var _syncQueueStore: SyncQueueStoreProtocol?
    private var _syncConcurrencyLimiter: ConcurrencyLimiter?
    private var _loginItemService: LoginItemServiceProtocol?
    private var _notionOAuthService: NotionOAuthService?
    // WeRead
    private var _weReadAuthService: WeReadAuthServiceProtocol?
    private var _weReadAPIService: WeReadAPIServiceProtocol?
    private var _weReadCacheService: WeReadCacheServiceProtocol?
    // Dedao
    private var _dedaoAuthService: DedaoAuthServiceProtocol?
    private var _dedaoAPIService: DedaoAPIServiceProtocol?
    private var _dedaoCacheService: DedaoCacheServiceProtocol?
    // Sync Engine
    private var _notionSyncEngine: NotionSyncEngine?
    // Synced Highlight Store
    private var _syncedHighlightStore: SyncedHighlightStoreProtocol?
    // Environment
    private var _environmentDetector: EnvironmentDetectorProtocol?
    // OCR
    private var _ocrConfigStore: OCRConfigStoreProtocol?
    private var _ocrAPIService: OCRAPIServiceProtocol?
    // Chats
    private var _chatsCacheService: ChatCacheServiceProtocol?

    // MARK: - Computed Properties
    var databaseService: DatabaseServiceProtocol {
        if _databaseService == nil {
            _databaseService = DatabaseService()
        }
        return _databaseService!
    }

    var bookmarkStore: BookmarkStoreProtocol {
        if _bookmarkStore == nil {
            _bookmarkStore = BookmarkStore.shared
        }
        return _bookmarkStore!
    }

    var notionConfigStore: NotionConfigStoreProtocol {
        if _notionConfigStore == nil {
            _notionConfigStore = NotionConfigStore.shared
        }
        return _notionConfigStore!
    }

    var notionService: NotionServiceProtocol {
        if _notionService == nil {
            _notionService = NotionService(configStore: notionConfigStore)
        }
        return _notionService!
    }

    var loggerService: LoggerServiceProtocol {
        if _loggerService == nil {
            _loggerService = LoggerService.shared
        }
        return _loggerService!
    }

    var iapService: IAPServiceProtocol {
        if _iapService == nil {
            _iapService = IAPService()
        }
        return _iapService!
    }

    var goodLinksService: GoodLinksDatabaseServiceExposed {
        if _goodLinksService == nil {
            _goodLinksService = GoodLinksDatabaseService()
        }
        return _goodLinksService!
    }

    var autoSyncService: AutoSyncServiceProtocol {
        if _autoSyncService == nil {
            _autoSyncService = AutoSyncService()
        }
        return _autoSyncService!
    }

    var syncTimestampStore: SyncTimestampStoreProtocol {
        if _syncTimestampStore == nil {
            _syncTimestampStore = SyncTimestampStore.shared
        }
        return _syncTimestampStore!
    }

    var authService: AuthServiceProtocol {
        if _authService == nil {
            _authService = AuthService()
        }
        return _authService!
    }

    var syncActivityMonitor: SyncActivityMonitorProtocol {
        if _syncActivityMonitor == nil {
            _syncActivityMonitor = SyncActivityMonitor()
        }
        return _syncActivityMonitor!
    }

    var syncQueueStore: SyncQueueStoreProtocol {
        if _syncQueueStore == nil {
            _syncQueueStore = SyncQueueStore()
        }
        return _syncQueueStore!
    }

    // 全局并发限制器：统一限制所有 Notion 同步的并发度（AppleBooks/GoodLinks/AutoSync 合计）
    var syncConcurrencyLimiter: ConcurrencyLimiter {
        if _syncConcurrencyLimiter == nil {
            _syncConcurrencyLimiter = ConcurrencyLimiter(limit: NotionSyncConfig.batchConcurrency)
        }
        return _syncConcurrencyLimiter!
    }

    var loginItemService: LoginItemServiceProtocol {
        if _loginItemService == nil {
            _loginItemService = LoginItemService()
        }
        return _loginItemService!
    }

    var notionOAuthService: NotionOAuthService {
        if _notionOAuthService == nil {
            _notionOAuthService = NotionOAuthService()
        }
        return _notionOAuthService!
    }

    // MARK: - WeRead Services

    var weReadAuthService: WeReadAuthServiceProtocol {
        if _weReadAuthService == nil {
            _weReadAuthService = WeReadAuthService()
        }
        return _weReadAuthService!
    }

    var weReadAPIService: WeReadAPIServiceProtocol {
        if _weReadAPIService == nil {
            _weReadAPIService = WeReadAPIService(authService: weReadAuthService)
        }
        return _weReadAPIService!
    }
    
    var weReadCacheService: WeReadCacheServiceProtocol {
        if _weReadCacheService == nil {
            // WeReadCacheService 使用 @ModelActor，需要传入 ModelContainer
            // 如果创建失败，会在首次使用时抛出错误
            do {
                let container = try WeReadModelContainerFactory.createContainer()
                _weReadCacheService = WeReadCacheService(modelContainer: container)
                loggerService.info("[DIContainer] WeRead ModelContainer created successfully")
            } catch {
                loggerService.error("[DIContainer] Failed to create WeRead ModelContainer: \(error.localizedDescription)")
                // 创建一个带有错误的占位服务（实际使用时会抛出错误）
                fatalError("Failed to create WeRead ModelContainer: \(error.localizedDescription)")
            }
        }
        return _weReadCacheService!
    }
    
    // MARK: - Dedao Services
    
    var dedaoAuthService: DedaoAuthServiceProtocol {
        if _dedaoAuthService == nil {
            _dedaoAuthService = DedaoAuthService()
        }
        return _dedaoAuthService!
    }
    
    var dedaoAPIService: DedaoAPIServiceProtocol {
        if _dedaoAPIService == nil {
            _dedaoAPIService = DedaoAPIService(
                authService: dedaoAuthService,
                logger: loggerService
            )
        }
        return _dedaoAPIService!
    }
    
    var dedaoCacheService: DedaoCacheServiceProtocol {
        if _dedaoCacheService == nil {
            // 使用 @ModelActor 的 DedaoCacheService 需要 ModelContainer
            // 如果创建失败，会在首次使用时抛出错误
            do {
                let container = try DedaoModelContainerFactory.createContainer()
                _dedaoCacheService = DedaoCacheService(modelContainer: container)
                loggerService.info("[DIContainer] DedaoCacheService initialized with ModelContainer")
            } catch {
                loggerService.error("[DIContainer] Failed to create Dedao ModelContainer: \(error.localizedDescription)")
                // 创建一个带有错误的占位服务（实际使用时会抛出错误）
                fatalError("Failed to create Dedao ModelContainer: \(error.localizedDescription)")
            }
        }
        return _dedaoCacheService!
    }
    
    // MARK: - Synced Highlight Store
    
    var syncedHighlightStore: SyncedHighlightStoreProtocol {
        if _syncedHighlightStore == nil {
            do {
                let container = try SyncedHighlightModelContainerFactory.createContainer()
                _syncedHighlightStore = SyncedHighlightStore(modelContainer: container)
                loggerService.info("[DIContainer] SyncedHighlightStore initialized with ModelContainer")
            } catch {
                loggerService.error("[DIContainer] Failed to create SyncedHighlight ModelContainer: \(error.localizedDescription)")
                fatalError("Failed to create SyncedHighlight ModelContainer: \(error.localizedDescription)")
            }
        }
        return _syncedHighlightStore!
    }
    
    // MARK: - Sync Engine
    
    var notionSyncEngine: NotionSyncEngine {
        if _notionSyncEngine == nil {
            _notionSyncEngine = NotionSyncEngine(
                notionService: notionService,
                notionConfig: notionConfigStore,
                logger: loggerService,
                timestampStore: syncTimestampStore,
                syncedHighlightStore: syncedHighlightStore
            )
        }
        return _notionSyncEngine!
    }

    var environmentDetector: EnvironmentDetectorProtocol {
        if _environmentDetector == nil {
            _environmentDetector = EnvironmentDetector()
        }
        return _environmentDetector!
    }
    
    // MARK: - OCR Services
    
    private var _visionOCRService: OCRAPIServiceProtocol?
    private var _paddleOCRService: OCRAPIServiceProtocol?
    
    var ocrConfigStore: OCRConfigStoreProtocol {
        if _ocrConfigStore == nil {
            _ocrConfigStore = OCRConfigStore.shared
        }
        return _ocrConfigStore!
    }
    
    /// 根据当前选择的引擎返回对应的 OCR 服务
    var ocrAPIService: OCRAPIServiceProtocol {
        let engine = OCRConfigStore.shared.selectedEngine
        switch engine {
        case .vision:
            return visionOCRService
        case .paddleOCR:
            return paddleOCRService
        }
    }
    
    /// Vision OCR 服务（始终可用）
    var visionOCRService: OCRAPIServiceProtocol {
        if _visionOCRService == nil {
            _visionOCRService = VisionOCRService(logger: loggerService)
        }
        return _visionOCRService!
    }
    
    /// PaddleOCR 云端服务（需要配置）
    var paddleOCRService: OCRAPIServiceProtocol {
        if _paddleOCRService == nil {
            _paddleOCRService = OCRAPIService(
                configStore: ocrConfigStore,
                logger: loggerService
            )
        }
        return _paddleOCRService!
    }
    
    // MARK: - Chats Services
    
    var chatsCacheService: ChatCacheServiceProtocol {
        if _chatsCacheService == nil {
            do {
                let container = try ChatModelContainerFactory.createContainer()
                _chatsCacheService = ChatCacheService(modelContainer: container)
                loggerService.info("[DIContainer] ChatCacheService initialized with ModelContainer")
            } catch {
                loggerService.error("[DIContainer] Failed to create Chats ModelContainer: \(error.localizedDescription)")
                fatalError("Failed to create Chats ModelContainer: \(error.localizedDescription)")
            }
        }
        return _chatsCacheService!
    }

    // MARK: - Registration Methods
    func register(databaseService: DatabaseServiceProtocol) {
        self._databaseService = databaseService
    }

    func register(bookmarkStore: BookmarkStoreProtocol) {
        self._bookmarkStore = bookmarkStore
    }

    func register(notionConfigStore: NotionConfigStoreProtocol) {
        self._notionConfigStore = notionConfigStore
    }

    func register(notionService: NotionServiceProtocol) {
        self._notionService = notionService
    }

    func register(loggerService: LoggerServiceProtocol) {
        self._loggerService = loggerService
    }

    func register(iapService: IAPServiceProtocol) {
        self._iapService = iapService
    }

    func register(goodLinksService: GoodLinksDatabaseServiceExposed) {
        self._goodLinksService = goodLinksService
    }

    func register(autoSyncService: AutoSyncServiceProtocol) {
        self._autoSyncService = autoSyncService
    }

    func register(syncTimestampStore: SyncTimestampStoreProtocol) {
        self._syncTimestampStore = syncTimestampStore
    }

    func register(authService: AuthServiceProtocol) {
        self._authService = authService
    }

    func register(syncActivityMonitor: SyncActivityMonitorProtocol) {
        self._syncActivityMonitor = syncActivityMonitor
    }

    func register(syncQueueStore: SyncQueueStoreProtocol) {
        self._syncQueueStore = syncQueueStore
    }

    func register(syncConcurrencyLimiter: ConcurrencyLimiter) {
        self._syncConcurrencyLimiter = syncConcurrencyLimiter
    }

    func register(loginItemService: LoginItemServiceProtocol) {
        self._loginItemService = loginItemService
    }

    func register(notionOAuthService: NotionOAuthService) {
        self._notionOAuthService = notionOAuthService
    }

    func register(weReadAuthService: WeReadAuthServiceProtocol) {
        self._weReadAuthService = weReadAuthService
    }

    func register(weReadAPIService: WeReadAPIServiceProtocol) {
        self._weReadAPIService = weReadAPIService
    }
    
    func register(weReadCacheService: WeReadCacheServiceProtocol) {
        self._weReadCacheService = weReadCacheService
    }
    
    
    func register(notionSyncEngine: NotionSyncEngine) {
        self._notionSyncEngine = notionSyncEngine
    }
    
    func register(syncedHighlightStore: SyncedHighlightStoreProtocol) {
        self._syncedHighlightStore = syncedHighlightStore
    }

    func register(environmentDetector: EnvironmentDetectorProtocol) {
        self._environmentDetector = environmentDetector
    }
    
    func register(dedaoAuthService: DedaoAuthServiceProtocol) {
        self._dedaoAuthService = dedaoAuthService
    }
    
    func register(dedaoAPIService: DedaoAPIServiceProtocol) {
        self._dedaoAPIService = dedaoAPIService
    }
    
    func register(dedaoCacheService: DedaoCacheServiceProtocol) {
        self._dedaoCacheService = dedaoCacheService
    }
    
    func register(ocrConfigStore: OCRConfigStoreProtocol) {
        self._ocrConfigStore = ocrConfigStore
    }
    
    func register(ocrAPIService: OCRAPIServiceProtocol) {
        self._ocrAPIService = ocrAPIService
    }
    
    func register(visionOCRService: OCRAPIServiceProtocol) {
        self._visionOCRService = visionOCRService
    }
    
    func register(paddleOCRService: OCRAPIServiceProtocol) {
        self._paddleOCRService = paddleOCRService
    }
    
    func register(chatsCacheService: ChatCacheServiceProtocol) {
        self._chatsCacheService = chatsCacheService
    }
}