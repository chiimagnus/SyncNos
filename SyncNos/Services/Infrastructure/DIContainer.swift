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

}