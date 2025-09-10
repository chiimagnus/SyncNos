//
//  DIContainer.swift
//  SyncBookNotesWithNotion
//
//  Created by chii_magnus on 2025/9/10.
//

import Foundation

// MARK: - Dependency Injection Container
class DIContainer {
    static let shared = DIContainer()
    
    private init() {}
    
    // MARK: - Services
    private var _databaseService: DatabaseServiceProtocol?
    private var _bookmarkStore: BookmarkStoreProtocol?
    
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
    
    // MARK: - Registration Methods
    func register(databaseService: DatabaseServiceProtocol) {
        self._databaseService = databaseService
    }
    
    func register(bookmarkStore: BookmarkStoreProtocol) {
        self._bookmarkStore = bookmarkStore
    }
}