import Foundation
import AppKit

/// 得到登录状态
enum DedaoLoginStatus: Equatable {
    case idle
    case generatingQRCode
    case waitingForScan(qrCodeString: String, qrCodeImage: String?)
    case scanned
    case loginSuccess
    case loginFailed(message: String)
    case qrCodeExpired
}

@MainActor
final class DedaoLoginViewModel: ObservableObject {
    @Published var isLoggedIn: Bool = false
    @Published var status: DedaoLoginStatus = .idle
    @Published var statusMessage: String = ""
    @Published var qrCodeImage: NSImage?
    
    /// 手动输入的 Cookie（备选方案）
    @Published var manualCookie: String = ""
    
    private let authService: DedaoAuthServiceProtocol
    private let apiService: DedaoAPIServiceProtocol
    private let logger: LoggerServiceProtocol
    
    /// 二维码轮询任务
    private var pollingTask: Task<Void, Never>?
    
    /// 当前二维码字符串
    private var currentQRCodeString: String?
    
    init(
        authService: DedaoAuthServiceProtocol,
        apiService: DedaoAPIServiceProtocol,
        logger: LoggerServiceProtocol = DIContainer.shared.loggerService
    ) {
        self.authService = authService
        self.apiService = apiService
        self.logger = logger
        refreshState()
    }
    
    deinit {
        pollingTask?.cancel()
    }
    
    func refreshState() {
        isLoggedIn = authService.isLoggedIn
        if isLoggedIn {
            statusMessage = String(localized: "dedao.login.detected")
            status = .loginSuccess
        } else {
            statusMessage = String(localized: "dedao.login.scanQRCode")
            status = .idle
        }
    }
    
    // MARK: - QR Code Login
    
    /// 开始二维码登录流程
    func startQRCodeLogin() async {
        // 取消之前的轮询任务
        pollingTask?.cancel()
        pollingTask = nil
        currentQRCodeString = nil
        qrCodeImage = nil
        
        status = .generatingQRCode
        statusMessage = String(localized: "dedao.login.generatingQRCode")
        
        do {
            let qrResponse = try await apiService.generateQRCode()
            currentQRCodeString = qrResponse.qrCodeString
            
            // 生成二维码图片
            if let imageBase64 = qrResponse.qrCodeImage {
                // 从 Base64 解码图片
                if let imageData = Data(base64Encoded: imageBase64) {
                    qrCodeImage = NSImage(data: imageData)
                }
            }
            
            // 如果没有 Base64 图片，使用字符串生成二维码
            if qrCodeImage == nil {
                qrCodeImage = generateQRCodeImage(from: qrResponse.qrCodeString)
            }
            
            status = .waitingForScan(qrCodeString: qrResponse.qrCodeString, qrCodeImage: qrResponse.qrCodeImage)
            statusMessage = String(localized: "dedao.login.scanWithDedaoApp")
            
            // 开始轮询登录状态
            startPolling(qrCodeString: qrResponse.qrCodeString, expireSeconds: qrResponse.expire)
            
        } catch {
            status = .loginFailed(message: error.localizedDescription)
            statusMessage = String(localized: "dedao.login.qrCodeGenerateFailed")
            logger.error("[Dedao] QR code generation failed: \(error.localizedDescription)")
        }
    }
    
    /// 开始轮询登录状态
    private func startPolling(qrCodeString: String, expireSeconds: Int) {
        pollingTask = Task { [weak self] in
            guard let self else { return }
            
            let startTime = Date()
            let expireTime = startTime.addingTimeInterval(TimeInterval(expireSeconds))
            
            while !Task.isCancelled {
                // 检查是否已过期
                if Date() > expireTime {
                    await MainActor.run {
                        self.status = .qrCodeExpired
                        self.statusMessage = String(localized: "dedao.login.qrCodeExpired")
                    }
                    break
                }
                
                do {
                    let checkResponse = try await self.apiService.checkQRCodeLogin(qrCodeString: qrCodeString)
                    
                    switch checkResponse.status {
                    case 0:
                        // 等待扫码
                        break
                    case 1:
                        // 已扫码，等待确认
                        await MainActor.run {
                            self.status = .scanned
                            self.statusMessage = String(localized: "dedao.login.scannedWaitingConfirm")
                        }
                    case 2:
                        // 登录成功
                        // 从响应中提取 Cookie（这里需要根据实际 API 响应调整）
                        if let loginData = checkResponse.data,
                           let token = loginData.token {
                            // 保存 token 为 Cookie
                            self.authService.updateCookieHeader("token=\(token)")
                        }
                        
                        await MainActor.run {
                            self.status = .loginSuccess
                            self.statusMessage = String(localized: "dedao.login.success")
                            self.isLoggedIn = true
                        }
                        return
                    case -1:
                        // 二维码过期
                        await MainActor.run {
                            self.status = .qrCodeExpired
                            self.statusMessage = String(localized: "dedao.login.qrCodeExpired")
                        }
                        return
                    default:
                        break
                    }
                } catch {
                    self.logger.warning("[Dedao] Login status check failed: \(error.localizedDescription)")
                }
                
                // 等待 2 秒后继续轮询
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }
    
    /// 停止轮询
    func stopPolling() {
        pollingTask?.cancel()
        pollingTask = nil
    }
    
    /// 刷新二维码
    func refreshQRCode() async {
        await startQRCodeLogin()
    }
    
    // MARK: - Manual Cookie Login
    
    /// 保存手动输入的 Cookie
    func saveCookieHeader(_ header: String) {
        authService.updateCookieHeader(header)
        isLoggedIn = authService.isLoggedIn
        if isLoggedIn {
            status = .loginSuccess
            statusMessage = String(localized: "dedao.login.cookieSaved")
        } else {
            status = .loginFailed(message: "Invalid cookie")
            statusMessage = String(localized: "dedao.login.cookieInvalid")
        }
    }
    
    func applyManualCookie() {
        let trimmed = manualCookie.trimmingCharacters(in: .whitespacesAndNewlines)
        saveCookieHeader(trimmed)
    }
    
    // MARK: - Logout
    
    func logout() async {
        stopPolling()
        await authService.clearCookies()
        isLoggedIn = false
        status = .idle
        statusMessage = String(localized: "dedao.login.loggedOut")
    }
    
    // MARK: - QR Code Generation
    
    /// 从字符串生成二维码图片
    private func generateQRCodeImage(from string: String) -> NSImage? {
        guard let data = string.data(using: .utf8) else { return nil }
        
        guard let filter = CIFilter(name: "CIQRCodeGenerator") else { return nil }
        filter.setValue(data, forKey: "inputMessage")
        filter.setValue("H", forKey: "inputCorrectionLevel")
        
        guard let ciImage = filter.outputImage else { return nil }
        
        // 放大图片
        let scale = 10.0
        let transform = CGAffineTransform(scaleX: scale, y: scale)
        let scaledImage = ciImage.transformed(by: transform)
        
        let rep = NSCIImageRep(ciImage: scaledImage)
        let nsImage = NSImage(size: rep.size)
        nsImage.addRepresentation(rep)
        
        return nsImage
    }
}

