import Foundation
import Security

final class KeychainHelper {
    static let shared = KeychainHelper()
    private init() {}

    private let trialService = "com.syncnos.trial"
    private let firstLaunchAccount = "firstLaunchDate"
    private let deviceFingerprintAccount = "deviceFingerprint"

    @discardableResult
    func save(service: String, account: String, data: Data) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data
        ]
        SecItemDelete(query as CFDictionary)
        let status = SecItemAdd(query as CFDictionary, nil)
        return status == errSecSuccess
    }

    func read(service: String, account: String) -> Data? {
        let (data, status) = readWithStatus(service: service, account: account)
        guard status == errSecSuccess else { return nil }
        return data
    }
    
    /// Read Keychain data and return status (distinguish unavailable vs missing)
    /// - Returns: Tuple containing optional data and the OSStatus from SecItemCopyMatching
    func readWithStatus(service: String, account: String) -> (data: Data?, status: OSStatus) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard let data = item as? Data else {
            return (nil, status)
        }
        return (data, status)
    }

    @discardableResult
    func delete(service: String, account: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }

    // MARK: - Trial Period Helpers
    func saveFirstLaunchDate(_ date: Date) {
        let data = try? JSONEncoder().encode(date)
        guard let data = data else { return }
        save(service: trialService, account: firstLaunchAccount, data: data)
    }

    func getFirstLaunchDate() -> Date? {
        guard let data = read(service: trialService, account: firstLaunchAccount) else { return nil }
        return try? JSONDecoder().decode(Date.self, from: data)
    }

    func saveDeviceFingerprint(_ fingerprint: String) {
        guard let data = fingerprint.data(using: .utf8) else { return }
        save(service: trialService, account: deviceFingerprintAccount, data: data)
    }

    func getDeviceFingerprint() -> String? {
        guard let data = read(service: trialService, account: deviceFingerprintAccount) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}


// MARK: - Delete Methods (for IAP Debug)
extension KeychainHelper {
    func deleteFirstLaunchDate() {
        delete(service: trialService, account: firstLaunchAccount)
    }
    
    func deleteDeviceFingerprint() {
        delete(service: trialService, account: deviceFingerprintAccount)
    }
}
