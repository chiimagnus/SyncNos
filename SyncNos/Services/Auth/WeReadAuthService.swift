import Foundation
import WebKit

enum WeReadAuthError: Error {
    case noCookies
    case notLoggedIn
}

protocol WeReadAuthServiceProtocol: AnyObject {
    var isLoggedIn: Bool { get }
    var cookieString: String? { get }
    func updateCookies(from webView: WKWebView) async
    func logout()
}

final class WeReadAuthService: WeReadAuthServiceProtocol {
    static let shared = WeReadAuthService()
    private let keychainService = "com.syncnos.weread.cookies"
    private let keychainAccount = "current_user"
    
    private var cachedCookies: String?
    
    var isLoggedIn: Bool {
        return cookieString != nil
    }
    
    var cookieString: String? {
        if let cached = cachedCookies {
            return cached
        }
        if let data = KeychainHelper.shared.read(service: keychainService, account: keychainAccount),
           let str = String(data: data, encoding: .utf8) {
            cachedCookies = str
            return str
        }
        return nil
    }
    
    private init() {}
    
    @MainActor
    func updateCookies(from webView: WKWebView) async {
        let cookies = await webView.configuration.websiteDataStore.httpCookieStore.allCookies()
        // Filter for weread.qq.com cookies if needed, or just take all relevant ones
        // Essential cookies usually include: wr_skey, wr_vid, wr_name, wr_pf
        
        let wereadCookies = cookies.filter { $0.domain.contains("weread.qq.com") }
        
        guard !wereadCookies.isEmpty else { return }
        
        // Check if we have logged in (look for specific cookies like wr_vid or wr_skey)
        let hasLoginCookie = wereadCookies.contains { $0.name == "wr_vid" || $0.name == "wr_skey" }
        guard hasLoginCookie else { return }
        
        // Construct cookie string
        let cookieStr = wereadCookies.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
        
        // Save to Keychain
        if let data = cookieStr.data(using: .utf8) {
            KeychainHelper.shared.save(service: keychainService, account: keychainAccount, data: data)
            cachedCookies = cookieStr
            // Notify login status changed
            NotificationCenter.default.post(name: Notification.Name("WeReadLoginStatusChanged"), object: true)
        }
    }
    
    func logout() {
        KeychainHelper.shared.delete(service: keychainService, account: keychainAccount)
        cachedCookies = nil
        NotificationCenter.default.post(name: Notification.Name("WeReadLoginStatusChanged"), object: false)
    }
}

