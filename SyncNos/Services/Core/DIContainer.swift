import Foundation
import SwiftData

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
    private var _weReadModelContainer: ModelContainer?
    // Dedao
    private var _dedaoAuthService: DedaoAuthServiceProtocol?
    private var _dedaoAPIService: DedaoAPIServiceProtocol?
    private var _dedaoCacheService: DedaoCacheServiceProtocol?
    private var _dedaoModelContainer: ModelContainer?
    // Sync Engine
    private var _notionSyncEngine: NotionSyncEngine?
    private var _goodLinksSyncService: GoodLinksSyncServiceProtocol?
    // Environment
    private var _environmentDetector: EnvironmentDetectorProtocol?

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
    
    /// WeRead 数据的 ModelContainer
    var weReadModelContainer: ModelContainer? {
        if _weReadModelContainer == nil {
            do {
                let schema = Schema([
                    CachedWeReadBook.self,
                    CachedWeReadHighlight.self,
                    WeReadSyncState.self
                ])
                let modelConfiguration = ModelConfiguration(
                    schema: schema,
                    isStoredInMemoryOnly: false,
                    allowsSave: true
                )
                _weReadModelContainer = try ModelContainer(
                    for: schema,
                    configurations: [modelConfiguration]
                )
            } catch {
                loggerService.error("[DIContainer] Failed to create WeRead ModelContainer: \(error.localizedDescription)")
            }
        }
        return _weReadModelContainer
    }
    
    var weReadCacheService: WeReadCacheServiceProtocol? {
        if _weReadCacheService == nil {
            guard let container = weReadModelContainer else {
                loggerService.warning("[DIContainer] WeRead ModelContainer not available, cache service disabled")
                return nil
            }
            _weReadCacheService = WeReadCacheService(
                modelContainer: container,
                logger: loggerService
            )
        }
        return _weReadCacheService
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
    
    /// Dedao 数据的 ModelContainer
    var dedaoModelContainer: ModelContainer? {
        if _dedaoModelContainer == nil {
            do {
                let schema = Schema([
                    CachedDedaoBook.self,
                    CachedDedaoHighlight.self,
                    DedaoSyncState.self
                ])
                let modelConfiguration = ModelConfiguration(
                    schema: schema,
                    isStoredInMemoryOnly: false,
                    allowsSave: true
                )
                _dedaoModelContainer = try ModelContainer(
                    for: schema,
                    configurations: [modelConfiguration]
                )
            } catch {
                loggerService.error("[DIContainer] Failed to create Dedao ModelContainer: \(error.localizedDescription)")
            }
        }
        return _dedaoModelContainer
    }
    
    var dedaoCacheService: DedaoCacheServiceProtocol {
        if _dedaoCacheService == nil {
            guard let container = dedaoModelContainer else {
                fatalError("[DIContainer] Dedao ModelContainer not available")
            }
            _dedaoCacheService = DedaoCacheService(
                modelContainer: container,
                logger: loggerService
            )
        }
        return _dedaoCacheService!
    }
    
    // MARK: - Sync Engine
    
    var notionSyncEngine: NotionSyncEngine {
        if _notionSyncEngine == nil {
            _notionSyncEngine = NotionSyncEngine(
                notionService: notionService,
                notionConfig: notionConfigStore,
                logger: loggerService,
                timestampStore: syncTimestampStore
            )
        }
        return _notionSyncEngine!
    }
    
    var goodLinksSyncService: GoodLinksSyncServiceProtocol {
        if _goodLinksSyncService == nil {
            _goodLinksSyncService = GoodLinksSyncService(
                syncEngine: notionSyncEngine,
                notionService: notionService,
                notionConfig: notionConfigStore,
                databaseService: goodLinksService,
                logger: loggerService,
                timestampStore: syncTimestampStore
            )
        }
        return _goodLinksSyncService!
    }

    var environmentDetector: EnvironmentDetectorProtocol {
        if _environmentDetector == nil {
            _environmentDetector = EnvironmentDetector()
        }
        return _environmentDetector!
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
    
    func register(weReadModelContainer: ModelContainer) {
        self._weReadModelContainer = weReadModelContainer
    }
    
    func register(notionSyncEngine: NotionSyncEngine) {
        self._notionSyncEngine = notionSyncEngine
    }
    
    func register(goodLinksSyncService: GoodLinksSyncServiceProtocol) {
        self._goodLinksSyncService = goodLinksSyncService
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
    
    func register(dedaoModelContainer: ModelContainer) {
        self._dedaoModelContainer = dedaoModelContainer
    }

}