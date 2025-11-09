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
    private var _appleBooksSyncService: AppleBooksSyncServiceProtocol?
    private var _iapService: IAPServiceProtocol?
    private var _goodLinksService: GoodLinksDatabaseServiceExposed?
    private var _autoSyncService: AutoSyncServiceProtocol?
    private var _syncTimestampStore: SyncTimestampStoreProtocol?
    private var _authService: AuthServiceProtocol?
    private var _syncActivityMonitor: SyncActivityMonitorProtocol?
    private var _syncQueueStore: SyncQueueStoreProtocol?
    private var _syncConcurrencyLimiter: ConcurrencyLimiter?
    private var _loginItemService: LoginItemServiceProtocol?
    private var _backgroundActivityService: BackgroundActivityServiceProtocol?

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

    

    var appleBooksSyncService: AppleBooksSyncServiceProtocol {
        if _appleBooksSyncService == nil {
            _appleBooksSyncService = AppleBooksSyncService()
        }
        return _appleBooksSyncService!
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
    
    var backgroundActivityService: BackgroundActivityServiceProtocol {
        if _backgroundActivityService == nil {
            _backgroundActivityService = BackgroundActivityService()
        }
        return _backgroundActivityService!
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

    

    func register(appleBooksSyncService: AppleBooksSyncServiceProtocol) {
        self._appleBooksSyncService = appleBooksSyncService
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
    
    func register(backgroundActivityService: BackgroundActivityServiceProtocol) {
        self._backgroundActivityService = backgroundActivityService
    }

}