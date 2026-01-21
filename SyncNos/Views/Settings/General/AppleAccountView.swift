import SwiftUI
import AuthenticationServices

struct AppleAccountView: View {
    @StateObject private var appleViewModel = AppleSignInViewModel()
    @StateObject private var accountViewModel = AccountViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Apple Sign In (macOS)
                VStack {
                    SignInWithAppleButton(.signIn) { request in
                        appleViewModel.configure(request: request)
                    } onCompletion: { result in
                        appleViewModel.handle(completion: result)
                        switch result {
                        case .success:
                            if case .succeeded(let user) = appleViewModel.state, let code = user.authorizationCode, !code.isEmpty {
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                                    accountViewModel.loginWithApple(authorizationCode: code, nonce: appleViewModel.rawNonce)
                                }
                            } else {
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                                    accountViewModel.load()
                                }
                            }
                        case .failure:
                            break
                        }
                    }
                    .signInWithAppleButtonStyle(.black)
                    .cornerRadius(8)

                    Group {
                        switch appleViewModel.state {
                        case .idle:
                            HStack(spacing: 8) {
                                Image(systemName: "info.circle")
                                    .foregroundColor(.secondary)
                                Text(String(localized: "Click the button above to start authorization", table: "Settings"))
                                    .foregroundColor(.secondary)
                                    .scaledFont(.subheadline)
                            }
                        case .processing:
                            HStack(spacing: 8) {
                                ProgressView()
                                Text(String(localized: "Requesting authorization...", table: "Settings"))
                                    .scaledFont(.subheadline)
                            }
                        case .succeeded(let user):
                            VStack(alignment: .leading, spacing: 8) {
                                Text(String(localized: "Authorization successful", table: "Settings"))
                                    .scaledFont(.headline)
                                if let name = user.fullName, !name.isEmpty { Text("Name: \(name)").scaledFont(.body) }
                                if let mail = user.email, !mail.isEmpty { Text("Email: \(mail)").scaledFont(.body) }
                                Text("User Identifier：\(user.userIdentifier)")
                                    .scaledFont(.footnote)
                                    .foregroundColor(.secondary)
#if DEBUG
                                if let code = user.authorizationCode, !code.isEmpty {
                                    Text("authorization_code：\(code)")
                                        .scaledFont(.footnote)
                                        .foregroundColor(.secondary)
                                        .textSelection(.enabled)
                                }
                                if let idt = user.identityToken, !idt.isEmpty {
                                    Text("identity_token：\(idt)")
                                        .scaledFont(.footnote)
                                        .foregroundColor(.secondary)
                                        .textSelection(.enabled)
                                }
#endif
                                Button(String(localized: "Reset status", table: "Settings")) { appleViewModel.reset() }
                                    .buttonStyle(.bordered)
                            }
                        case .failed(let message):
                            VStack(alignment: .leading, spacing: 8) {
                                Text(String(localized: "Authorization failed", table: "Settings")).scaledFont(.headline)
                                Text(message).foregroundColor(.red).scaledFont(.subheadline)
                                Button(String(localized: "Retry", table: "Common")) { appleViewModel.reset() }
                                    .buttonStyle(.bordered)
                            }
                        }
                    }
                }

                Divider().padding(.vertical)

                // Account information
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        Text(String(localized: "Account information", table: "Settings")).scaledFont(.title3, weight: .bold)
                        Spacer()
                        if accountViewModel.isLoading { ProgressView() }
                    }

                    if let err = accountViewModel.errorMessage {
                        Text(err).foregroundColor(.red).scaledFont(.footnote)
                    }

                    if let p = accountViewModel.profile {
                        GroupBox(label: Text(String(localized: "Basic information", table: "Settings"))) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("User ID: \(p.userId)").scaledFont(.body)
                                if let name = p.displayName, !name.isEmpty { Text("Display name: \(name)").scaledFont(.body) }
                                if let email = p.email, !email.isEmpty { Text("Email: \(email)").scaledFont(.body) }
                                if let created = p.createdAt { Text("Creation time: \(created)").scaledFont(.footnote).foregroundColor(.secondary) }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    } else {
                        Text(String(localized: "User information not loaded", table: "Settings")).foregroundColor(.secondary).scaledFont(.body)
                    }

                    GroupBox(label: Text(String(localized: "Login methods", table: "Settings"))) {
                        if accountViewModel.loginMethods.isEmpty {
                            Text(String(localized: "None", table: "Settings")).foregroundColor(.secondary).scaledFont(.body)
                        } else {
                            ForEach(Array(accountViewModel.loginMethods.enumerated()), id: \.0) { _, m in
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("\(m.providerName)").bold().scaledFont(.body)
                                    Text("key: \(m.providerKey)")
                                        .scaledFont(.footnote)
                                        .foregroundColor(.secondary)
                                }
                            }
                        }
                    }

                    HStack(spacing: 12) {
                        Button(String(localized: "Refresh information", table: "Settings")) { accountViewModel.load() }
                            .buttonStyle(.bordered)
                        Button(String(localized: "Sign out", table: "Settings")) { accountViewModel.logout() }
                            .buttonStyle(.bordered)
                        Button(String(localized: "Delete account", table: "Settings")) { accountViewModel.deleteAccount() }
                            .buttonStyle(.borderedProminent)
                            .tint(.red)
                    }
                }
            }
            .padding()
        }
        .navigationTitle(String(localized: "Apple Account & Sign In", table: "Settings"))
        .onAppear { accountViewModel.load() }
    }
}

struct AppleAccountView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationView { AppleAccountView() }
            .applyFontScale()
    }
}
