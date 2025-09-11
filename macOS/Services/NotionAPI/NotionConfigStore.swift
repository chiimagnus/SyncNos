import Foundation
import Security

// MARK: - NotionConfigStore

final class NotionConfigStore {
    static let shared = NotionConfigStore()
    private init() {}

    private let defaults = UserDefaults.standard
    private let serviceName = "SyncBookNotesWithNotion.Notion"
    private let accountName = "NotionAPIToken"

    // MARK: - Keys
    private enum DefaultsKey: String {
        case databaseId = "NotionDatabaseId"
        case apiVersion = "NotionAPIVersion"
    }

    // MARK: - Public API
    func saveDatabaseId(_ id: String) {
        defaults.set(id, forKey: DefaultsKey.databaseId.rawValue)
    }

    func loadDatabaseId() -> String? {
        return defaults.string(forKey: DefaultsKey.databaseId.rawValue)
    }

    func saveAPIVersion(_ version: String) {
        defaults.set(version, forKey: DefaultsKey.apiVersion.rawValue)
    }

    func loadAPIVersion() -> String {
        return defaults.string(forKey: DefaultsKey.apiVersion.rawValue) ?? "2025-09-03"
    }

    func saveToken(_ token: String) throws {
        let tokenData = token.data(using: .utf8) ?? Data()

        // Try update first
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: accountName
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: tokenData
        ]

        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecSuccess { return }
        if status == errSecItemNotFound {
            var addQuery = query
            addQuery[kSecValueData as String] = tokenData
            let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
            if addStatus == errSecSuccess { return }
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(addStatus), userInfo: [NSLocalizedDescriptionKey: "Keychain add failed: \(addStatus)"])
        } else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Keychain update failed: \(status)"])
        }
    }

    func loadToken() throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: accountName,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        if status != errSecSuccess {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status), userInfo: [NSLocalizedDescriptionKey: "Keychain read failed: \(status)"])
        }
        guard let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}


