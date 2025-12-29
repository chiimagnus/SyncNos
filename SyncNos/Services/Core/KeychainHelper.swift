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
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { 
            // 记录 Keychain 读取失败的详细错误
            if status != errSecItemNotFound {
                let errorMessage = SecCopyErrorMessageString(status, nil) as String? ?? "Unknown error"
                print("[KeychainHelper] Failed to read from Keychain: \(errorMessage) (status: \(status))")
            }
            return nil
        }
        return data
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
    
    /// 检查 Keychain 条目是否存在
    func exists(service: String, account: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: false
        ]
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        return status == errSecSuccess
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
