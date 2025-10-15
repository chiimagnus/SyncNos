# Sign in with Apple 技术文档（前后端实现）

版本：1.0

目录
- 概述
- 实现细节（前端 / 客户端）
  - 相关文件
  - 授权流程与数据流
  - 本地令牌存储与刷新
- 实现细节（后端 / 服务）
  - 相关文件
  - Code -> Token 交换流程
  - 本地 JWT 发放与刷新逻辑
- 配置与运行（本地调试）
- 安全注意事项（生产必读）
- 测试与调试建议
- 改进建议


概述
----
本项目采用标准的“客户端拿 authorization_code -> 后端与 Apple 换取 token -> 后端本地签发 access/refresh -> 客户端保存并使用 access 调用 profile”流程。


前端（客户端）实现
------------------

相关文件
- `SyncNos/Views/Settting/AppleAccountView.swift` — macOS 界面与 SignInWithAppleButton 回调。
- `SyncNos/ViewModels/AppleSignInViewModel.swift` — 解析 `ASAuthorization` 并暴露授权状态。
- `SyncNos/ViewModels/AccountViewModel.swift` — 令牌存取、profile 拉取、登录/登出/注销逻辑。
- `SyncNos/Services/Infrastructure/KeychainHelper.swift` — Keychain 读写工具。
- `SyncNos/Services/Infrastructure/AuthService.swift` — 封装与后端 HTTP 交互。

按钮触发与回调（关键片段）
```startLine:endLine:SyncNos/Views/Settting/AppleAccountView.swift
L21:31:SyncNos/Views/Settting/AppleAccountView.swift
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
```

授权解析（ViewModel）
```startLine:endLine:SyncNos/ViewModels/AppleSignInViewModel.swift
L22:44:SyncNos/ViewModels/AppleSignInViewModel.swift
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
                ...
```

令牌存储与使用
- 客户端将后端返回的 `access_token` 与 `refresh_token` 保存到 Keychain（`KeychainHelper`），Keychain 的 service key 为 `syncnos.access.token` / `syncnos.refresh.token`。
- 在需要调用 profile / login-methods 等受保护接口时，先尝试读取 access；若不存在或失效则使用 refresh 去 `/auth/refresh` 换取新对。

关键代码（Keychain 读写）
```startLine:endLine:SyncNos/Services/Infrastructure/KeychainHelper.swift
L8:18:SyncNos/Services/Infrastructure/KeychainHelper.swift
    @discardableResult
    func save(service: String, account: String, data: Data) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecValueData as String: data
        ]
```

HTTP 服务封装
- `AuthService` 提供 `loginWithApple(authorizationCode:)`、`refresh(refreshToken:)`、`logout(refreshToken:)`、`fetchProfile(accessToken:)`、`fetchLoginMethods(accessToken:)`、`deleteAccount(accessToken:)`。
- 默认后端 baseURL 为 `http://127.0.0.1:8000/api/v1`，可通过 `UserDefaults["BackendBaseURL"]` 覆盖以便本地调试。

后端（服务端）实现
------------------

相关文件
- `Backend/app/services/apple_oauth.py` — 与 Apple token endpoint 交互，生成 client_secret（ES256）并 POST 换 token。
- `Backend/app/api/v1/auth.py` — `/auth/login/apple`, `/auth/refresh`, `/auth/logout`。
- `Backend/app/api/v1/users.py` — `/users/profile`, `/users/login-methods`, `/users/me`（delete）。
- `Backend/app/security/jwt.py` — 本地 access/refresh JWT 的创建/解析。

Code -> Token 交换（关键片段）
```startLine:endLine:Backend/app/services/apple_oauth.py
L30:42:Backend/app/services/apple_oauth.py
def exchange_code_for_tokens(authorization_code: str) -> Dict[str, Any]:
    client_secret = generate_client_secret()
    data = {
        "grant_type": "authorization_code",
        "code": authorization_code,
        "client_id": settings.apple_client_id,
        "client_secret": client_secret,
    }
    resp = requests.post(APPLE_TOKEN_URL, data=data, headers=headers, timeout=15)
    if resp.status_code != 200:
        raise ValueError(f"Apple token endpoint error: {resp.status_code} {resp.text}")
    return resp.json()
```

后端登录端点（关键片段）
```startLine:endLine:Backend/app/api/v1/auth.py
L29:77:Backend/app/api/v1/auth.py
@router.post("/login/apple", response_model=TokenResponse)
def login_with_apple(payload: AppleLoginRequest, db: Session = Depends(get_db)):
    if not payload.authorization_code:
        raise HTTPException(status_code=400, detail="authorization_code is required")
    token_resp = exchange_code_for_tokens(payload.authorization_code)
    id_token = token_resp.get("id_token")
    decoded = jwt.decode(id_token, options={"verify_signature": False, "verify_aud": False})
    apple_sub = decoded.get("sub")
    ...
    access = create_access_token(user.id)
    refresh = refresh_token
    return TokenResponse(access_token=access, refresh_token=refresh)
```

本地 JWT 签发
- `create_access_token` / `create_refresh_token` 使用 `APP_JWT_SECRET`（HS256）签发。本项目的实现位于 `Backend/app/security/jwt.py`。

配置与运行（本地）
-------------------
1. 在 `Backend/` 根目录创建 `.env` 并设置：
   - `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_CLIENT_ID`, `APPLE_PRIVATE_KEY`（.p8），`APP_JWT_SECRET` 等（参见 `Backend/README.md`）。
2. 启动后端：
   - cd Backend && pip install -r requirements.txt
   - uvicorn app.main:app --reload --port 8000
3. 在客户端运行 App，打开 Settings -> General -> Apple Account，点击 Sign in。
4. 若需要用本地后端测试，确保 `AuthService` 的 baseURL 正确（或用 `UserDefaults.standard.set("http://127.0.0.1:8000/api/v1", forKey: "BackendBaseURL")` 覆盖）。

安全注意事项（生产必读）
-----------------------
- **必须验证 Apple 的 id_token 签名（JWKS 验签）**：当前后端为 MVP 在解析 `id_token` 时没有执行公钥验签（见 `jwt.decode(..., options={"verify_signature": False})`）。生产系统必须从 Apple JWKS 拉取公钥并验证 JWT 的 signature、aud、exp 等声明。
- **私钥与密钥管理**：`.p8` 与 `APP_JWT_SECRET` 均为敏感信息，应放入受管控的 secrets 存储（不要提交到仓库）。
- **使用 HTTPS**：生产后端应强制 HTTPS，客户端默认不应使用 http 明文。
- **refresh token 管理**：后端已在 DB 持久化 refresh token 并支持作废，这是推荐做法；应支持 token revocation、设备区分、并发 refresh 限制。

测试与调试建议
----------------
- 在开发阶段：可将 Apple 的授权 flow 在真实设备/沙盒测试账号上完成以获取 `authorization_code`，然后用 curl POST 到后端 `/auth/login/apple` 验证后端处理。README 中有 curl 示例。
- 如需在没有 Apple 授权环境下测试前端 UI，可在 `AppleSignInViewModel` 模拟 `state = .succeeded(...)`。
- 使用 `UserDefaults["BackendBaseURL"]` 指向本地/远程后端，避免硬编码修改。

改进建议（优先级）
-------------------
1. 后端实现 Apple id_token 的 JWKS 验签（高）。
2. 后端 auth 接口使用 Authorization header 解析 user_id（避免使用“第一个用户”简化实现）（高）。
3. 优化 `generate_client_secret` 的签名频率（可缓存短期 client_secret），并对请求失败添加重试/熔断策略（中）。
4. 前端将 access token 的过期时间与 refresh 流程更明确地结合（例如在 token 里传 exp 并据此提前刷新），避免频繁请求 401 后再刷新（中）。


如需我把这份文档扩展为 README 风格（附图、示例 curl、端到端测试脚本）或自动化把 JWKS 验签加入后端实现，我可以继续实现并提交相应代码和测试说明。


