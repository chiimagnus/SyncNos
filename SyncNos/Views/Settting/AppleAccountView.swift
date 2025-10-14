import SwiftUI
import AuthenticationServices

struct AppleAccountView: View {
    @StateObject private var appleViewModel = AppleSignInViewModel()
    @StateObject private var accountViewModel = AccountViewModel()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Apple登录（macOS）
                VStack(alignment: .leading, spacing: 16) {
                    Text("Apple 账号登录")
                        .font(.title3)
                        .bold()

                    Text("使用系统原生 Sign in with Apple 完成授权，成功后与后端交换令牌并拉取账户信息。")
                        .font(.footnote)
                        .foregroundColor(.secondary)

                    SignInWithAppleButton(.signIn) { request in
                        appleViewModel.configure(request: request)
                    } onCompletion: { result in
                        appleViewModel.handle(completion: result)
                        switch result {
                        case .success:
                            if case .succeeded(let user) = appleViewModel.state, let code = user.authorizationCode, !code.isEmpty {
                                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                                    accountViewModel.loginWithApple(authorizationCode: code)
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
                    .frame(height: 44)
                    .cornerRadius(8)

                    Group {
                        switch appleViewModel.state {
                        case .idle:
                            HStack(spacing: 8) {
                                Image(systemName: "info.circle")
                                    .foregroundColor(.secondary)
                                Text("点击上方按钮开始授权")
                                    .foregroundColor(.secondary)
                                    .font(.subheadline)
                            }
                        case .processing:
                            HStack(spacing: 8) {
                                ProgressView()
                                Text("正在请求授权...")
                                    .font(.subheadline)
                            }
                        case .succeeded(let user):
                            VStack(alignment: .leading, spacing: 8) {
                                Text("授权成功")
                                    .font(.headline)
                                if let name = user.fullName, !name.isEmpty { Text("姓名：\(name)") }
                                if let mail = user.email, !mail.isEmpty { Text("邮箱：\(mail)") }
                                Text("User Identifier：\(user.userIdentifier)")
                                    .font(.footnote)
                                    .foregroundColor(.secondary)
                                if let code = user.authorizationCode, !code.isEmpty {
                                    Text("authorization_code：\(code)")
                                        .font(.footnote)
                                        .foregroundColor(.secondary)
                                        .textSelection(.enabled)
                                }
                                if let idt = user.identityToken, !idt.isEmpty {
                                    Text("identity_token：\(idt)")
                                        .font(.footnote)
                                        .foregroundColor(.secondary)
                                        .textSelection(.enabled)
                                }
                                Button("重置状态") { appleViewModel.reset() }
                                    .buttonStyle(.bordered)
                            }
                        case .failed(let message):
                            VStack(alignment: .leading, spacing: 8) {
                                Text("授权失败").font(.headline)
                                Text(message).foregroundColor(.red).font(.subheadline)
                                Button("重试") { appleViewModel.reset() }
                                    .buttonStyle(.bordered)
                            }
                        }
                    }

                    Text("提示：首次授权可能返回邮箱与姓名，后续授权通常不再返回。")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Divider().padding(.vertical)

                // 账户信息
                VStack(alignment: .leading, spacing: 16) {
                    HStack {
                        Text("账户信息").font(.title3).bold()
                        Spacer()
                        if accountViewModel.isLoading { ProgressView() }
                    }

                    if let err = accountViewModel.errorMessage {
                        Text(err).foregroundColor(.red).font(.footnote)
                    }

                    if let p = accountViewModel.profile {
                        GroupBox(label: Text("基本信息")) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("User ID: \(p.userId)")
                                if let name = p.displayName, !name.isEmpty { Text("显示名称: \(name)") }
                                if let email = p.email, !email.isEmpty { Text("邮箱: \(email)") }
                                if let created = p.createdAt { Text("创建时间: \(created)").font(.footnote).foregroundColor(.secondary) }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    } else {
                        Text("未加载到用户信息").foregroundColor(.secondary)
                    }

                    GroupBox(label: Text("登录方式")) {
                        if accountViewModel.loginMethods.isEmpty {
                            Text("暂无").foregroundColor(.secondary)
                        } else {
                            ForEach(Array(accountViewModel.loginMethods.enumerated()), id: \\.0) { _, m in
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("\(m.providerName)").bold()
                                    Text("key: \(m.providerKey)")
                                        .font(.footnote)
                                        .foregroundColor(.secondary)
                                }
                                Divider()
                            }
                        }
                    }

                    HStack(spacing: 12) {
                        Button("刷新信息") { accountViewModel.load() }
                            .buttonStyle(.bordered)
                        Button("退出登录") { accountViewModel.logout() }
                            .buttonStyle(.bordered)
                        Button("注销账号") { accountViewModel.deleteAccount() }
                            .buttonStyle(.borderedProminent)
                            .tint(.red)
                    }
                }
            }
            .padding()
        }
        .navigationTitle("Apple 账号与登录")
        .onAppear { accountViewModel.load() }
    }
}

struct AppleAccountView_Previews: PreviewProvider {
    static var previews: some View {
        NavigationView { AppleAccountView() }
    }
}