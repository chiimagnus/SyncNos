import Foundation
import AuthenticationServices
import CryptoKit

final class AppleSignInViewModel: ObservableObject {
    enum State {
        case idle
        case processing
        case succeeded(User)
        case failed(String)
    }

    struct User: Equatable {
        let userIdentifier: String
        let email: String?
        let fullName: String?
        let authorizationCode: String?
        let identityToken: String?
    }

    @Published private(set) var state: State = .idle
    private(set) var rawNonce: String?

    func configure(request: ASAuthorizationAppleIDRequest) {
        state = .processing
        request.requestedScopes = [.fullName, .email]
        // 生成随机 nonce，并设置其 sha256 给 request
        let nonce = Self.randomNonceString()
        self.rawNonce = nonce
        request.nonce = Self.sha256(nonce)
    }

    func handle(completion result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let auth):
            if let credential = auth.credential as? ASAuthorizationAppleIDCredential {
                let code = credential.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
                let token = credential.identityToken.flatMap { String(data: $0, encoding: .utf8) }
                let name = [credential.fullName?.givenName, credential.fullName?.familyName]
                    .compactMap { $0 }
                    .filter { !$0.isEmpty }
                    .joined(separator: " ")
                let user = User(
                    userIdentifier: credential.user,
                    email: credential.email,
                    fullName: name.isEmpty ? nil : name,
                    authorizationCode: code,
                    identityToken: token
                )
                state = .succeeded(user)
            } else {
                state = .failed("授权凭证类型不匹配")
            }
        case .failure(let error):
            state = .failed(error.localizedDescription)
        }
    }

    func reset() { state = .idle }

    // MARK: - Nonce helpers
    private static func randomNonceString(length: Int = 32) -> String {
        precondition(length > 0)
        let charset: [Character] = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var result = ""
        var remainingLength = length
        while remainingLength > 0 {
            let randoms: [UInt8] = (0..<16).map { _ in UInt8.random(in: 0...255) }
            randoms.forEach { random in
                if remainingLength == 0 { return }
                if random < charset.count {
                    result.append(charset[Int(random)])
                    remainingLength -= 1
                }
            }
        }
        return result
    }

    private static func sha256(_ input: String) -> String {
        let data = Data(input.utf8)
        let hashed = CryptoKit.SHA256.hash(data: data)
        return hashed.map { String(format: "%02x", $0) }.joined()
    }
}


