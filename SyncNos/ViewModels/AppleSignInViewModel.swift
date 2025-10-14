import Foundation
import AuthenticationServices

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

    func configure(request: ASAuthorizationAppleIDRequest) {
        state = .processing
        request.requestedScopes = [.fullName, .email]
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
}


