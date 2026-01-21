import Foundation
import WebKit

/// WeRead Cookie 自动刷新服务
/// 在检测到会话过期时，尝试静默刷新 Cookie
@MainActor
final class WeReadCookieRefreshService: NSObject {
    private let authService: WeReadAuthServiceProtocol
    private let logger: LoggerServiceProtocol
    
    private var webView: WKWebView?
    private var refreshCompletion: ((Result<String, Error>) -> Void)?
    private var timeoutTask: Task<Void, Never>?
    
    init(
        authService: WeReadAuthServiceProtocol = DIContainer.shared.weReadAuthService,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.authService = authService
        self.logger = logger
        super.init()
    }
    
    /// 尝试静默刷新 Cookie
    /// - Parameter timeout: 超时时间（秒），默认 15 秒
    /// - Returns: 新的 Cookie header，如果失败则抛出错误
    func attemptSilentRefresh(timeout: TimeInterval = 15) async throws -> String {
        logger.info("[WeReadCookieRefresh] Attempting silent cookie refresh...")
        
        return try await withCheckedThrowingContinuation { continuation in
            refreshCompletion = { result in
                continuation.resume(with: result)
            }
            
            // 设置超时
            timeoutTask = Task {
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                if !Task.isCancelled {
                    self.handleRefreshFailure(error: WeReadCookieRefreshError.timeout)
                }
            }
            
            // 创建隐藏的 WebView
            let config = WKWebViewConfiguration()
            config.websiteDataStore = .default()
            
            let webView = WKWebView(frame: .zero, configuration: config)
            webView.navigationDelegate = self
            self.webView = webView
            
            // 加载微信读书首页
            if let url = URL(string: "https://weread.qq.com/") {
                let request = URLRequest(url: url)
                webView.load(request)
            } else {
                handleRefreshFailure(error: WeReadCookieRefreshError.invalidURL)
            }
        }
    }
    

    private func handleRefreshSuccess(cookieHeader: String) {
        timeoutTask?.cancel()
        timeoutTask = nil
        
        logger.info("[WeReadCookieRefresh] Cookie refresh succeeded")
        // 注意：Cookie 的更新由 CookieRefreshCoordinator 负责，这里只返回新的 Cookie
        
        refreshCompletion?(.success(cookieHeader))
        refreshCompletion = nil
        cleanup()
    }
    
    private func handleRefreshFailure(error: Error) {
        timeoutTask?.cancel()
        timeoutTask = nil
        
        logger.error("[WeReadCookieRefresh] Cookie refresh failed: \(error.localizedDescription)")
        
        refreshCompletion?(.failure(error))
        refreshCompletion = nil
        cleanup()
    }
    
    private func cleanup() {
        webView?.navigationDelegate = nil
        webView = nil
    }
}

// MARK: - WKNavigationDelegate

extension WeReadCookieRefreshService: WKNavigationDelegate {
    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in
            // 页面加载完成，尝试获取 Cookie
            let store = webView.configuration.websiteDataStore.httpCookieStore
            let cookies = await store.allCookies()

            let relevant = cookies.filter { cookie in
                cookie.domain.contains("weread.qq.com") || cookie.domain.contains("i.weread.qq.com")
            }

            guard !relevant.isEmpty else {
                self.handleRefreshFailure(error: WeReadCookieRefreshError.noCookiesFound)
                return
            }

            let header = relevant.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")

            // 验证 Cookie 是否有效（检查是否包含关键字段）
            if header.contains("wr_vid=") || header.contains("wr_skey=") {
                self.handleRefreshSuccess(cookieHeader: header)
            } else {
                self.handleRefreshFailure(error: WeReadCookieRefreshError.invalidCookies)
            }
        }
    }
    
    nonisolated func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        Task { @MainActor in
            handleRefreshFailure(error: error)
        }
    }
    
    nonisolated func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        Task { @MainActor in
            handleRefreshFailure(error: error)
        }
    }
}

// MARK: - Errors

enum WeReadCookieRefreshError: LocalizedError {
    case timeout
    case noCookiesFound
    case invalidCookies
    case invalidURL
    
    var errorDescription: String? {
        switch self {
        case .timeout:
            return NSLocalizedString("Cookie refresh timeout. Please login manually.", comment: "")
        case .noCookiesFound:
            return NSLocalizedString("No WeRead cookies found. Please login manually.", comment: "")
        case .invalidCookies:
            return NSLocalizedString("Invalid WeRead cookies. Please login manually.", comment: "")
        case .invalidURL:
            return NSLocalizedString("Invalid WeRead URL.", comment: "")
        }
    }
}
