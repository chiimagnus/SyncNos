# Sign in with Apple — 前端实现技术文档（仅前端）

> 位置：`Resource/SignInWithApple-Frontend-Guide.md`
>
> 说明：本文档只覆盖客户端（macOS/iOS）前端实现细节、设计与注意事项；后端交互、JWKS 验签等留在后端文档（见 `Backend/docs/sign_in_with_apple.md`）。

---

## 1 概览

前端实现负责：
- 使用系统原生的 Sign in with Apple UI（`SignInWithAppleButton` / `ASAuthorizationController`）发起授权流程；
- 生成并管理 `rawNonce`（随机字符串），将其 SHA256 后填入 `request.nonce` 以绑定授权请求与后端验证；
- 在回调中提取 `authorization_code`（授权码）和 `identity_token`（id_token，可选），将 `authorization_code` 与原始 `rawNonce` 一并提交至后端换取本地 access/refresh token；
- 展示授权状态、用户信息、并处理失败 / 重试 / 重置等 UI 流程。


## 2 代码位置（仓库内）

- 前端视图：`SyncNos/Views/Settting/AppleAccountView.swift`
- Nonce 与授权处理：`SyncNos/ViewModels/AppleSignInViewModel.swift`
- 登录流协调（将 code/nonce 发送后端并存储 token 等）：
  - `SyncNos/ViewModels/AccountViewModel.swift`
  - `SyncNos/Services/Infrastructure/AuthService.swift`（http 客户端调用，发送到后端 `/auth/login/apple`）
- 后端签名/nonce 验证说明：`Backend/docs/sign_in_with_apple.md`（仅参考）


## 3 关键实现点（详解）

### 3.1 UI：SignInWithAppleButton 使用

在 `AppleAccountView.swift` 中使用 `SignInWithAppleButton(.signIn)` 并提供两个闭包：
- 配置闭包 `request`：传给 ViewModel 的 `configure(request:)`，用于设置 `requestedScopes` 与 `request.nonce`（SHA256 的 nonce）；
- 完成闭包 `onCompletion`：将 `Result<ASAuthorization, Error>` 传给 ViewModel 的 `handle(completion:)`，ViewModel 解析 `ASAuthorizationAppleIDCredential` 中的 `authorizationCode`、`identityToken` 与用户信息。

示例行为：
- 成功后，`AppleSignInViewModel` 的 `state` 变为 `.succeeded(user)`；`AppleAccountView` 会读取 `user.authorizationCode` 并调用 `AccountViewModel.loginWithApple(authorizationCode:nonce:)`。


### 3.2 Nonce 的生成与处理（安全要求）

实现位于 `AppleSignInViewModel`：
- `rawNonce`：在 `configure(request:)` 中生成随机字符串并保存在 `rawNonce`（用于随后发送给后端）；
- `request.nonce`：设置为 `sha256(rawNonce)` 的十六进制字符串（Apple 要求传递哈希值而非原始 nonce）；

具体实现细节：
- `randomNonceString(length:)`：基于安全随机数 (UInt8.random) 生成可打印字符集合的随机 nonce；
- `sha256(_:)`：使用 `CryptoKit.SHA256` 对 `rawNonce` 做哈希并以十六进制字符串返回；

注意：后端将收到的 `rawNonce` 与 Apple 返回的 id_token 中的 `nonce`（解析得到）比对，后端会计算 SHA256(rawNonce) 后与 token 的 nonce 做比较。


### 3.3 从授权回调提取数据

在 `AppleSignInViewModel.handle(completion:)` 中：
- 尝试将 credential 转为 `ASAuthorizationAppleIDCredential`；
- 提取：
  - `credential.user`（user id，持久标识，用于前端展示）
  - `credential.email`（首次授权可能返回）
  - `credential.fullName`（首次授权可能返回）
  - `credential.authorizationCode`（Data -> String）
  - `credential.identityToken`（Data -> String，可选）
- 将这些字段组装为 `User` 并设置 `state = .succeeded(user)`；若失败，更新 `state = .failed(...)`。

注意：Apple 在后续授权中通常不再返回 `email` 与 `fullName`，需要将首次返回的信息与服务端用户记录对齐。


### 3.4 提交授权码到后端

流程在 `AppleAccountView` -> `AccountViewModel.loginWithApple`：
- 点击 Sign in 成功后页面会在短延时内调用 `accountViewModel.loginWithApple(authorizationCode: code, nonce: appleViewModel.rawNonce)`；
- `AccountViewModel` 会委托 `AuthService.loginWithApple(authorizationCode:nonce:)`，该方法封装了 HTTP POST 到后端 `BackendConfig.baseURL/auth/login/apple`，body 包含 `{ "authorization_code": code, "nonce": rawNonce }`（若 nonce 不为 nil）；
- 后端负责向 Apple 换取 token、校验 id_token（JWKS 验签）并返回本地 `AuthTokens`（access + refresh），客户端 `AccountViewModel` 会将 tokens 存入 Keychain 并加载用户信息。

安全注意：
- 仅在后端使用 HTTPS 与 Apple 通信；客户端与后端的通信在本项目可通过开发覆盖 URL（`BackendBaseURL`）配置（`AuthService.BackendConfig`），生产必须使用 HTTPS。


### 3.5 错误与重试策略

- 在 UI 层：`AppleAccountView` 根据 `appleViewModel.state` 展示 `processing/succeeded/failed`；提供“重置状态”与“重试”按钮，调用 `appleViewModel.reset()`。
- 在登录流程层：`AccountViewModel.loginWithAppleInternal` 会在捕获错误后把 `error.localizedDescription` 展示到 UI（`errorMessage`），不抛出敏感后端响应（避免泄露）。
- 对于 401/403 的后端返回（access token 失效），`AccountViewModel.loadInternal()` 的逻辑中包含刷新 token 的尝试与重试流程。


## 4 安全与隐私注意事项（前端）

- 不在日志或 UI 中记录或暴露完整的 `identity_token` 或 `authorization_code`（当前实现允许短期显示以便调试，但在生产中应移除或仅在开发模式下显示）。
- `rawNonce` 为敏感值，仅在内存中保留到提交给后端为止；不应持久化存储。
- 与后端通信必须通过 HTTPS（开发环境例外，但生产禁止）。
- 在展示用户邮箱/姓名时遵守隐私策略，不随意上传或共享；只有在用户触发同步场景下才发送给后端。


## 5 平台兼容与适配

- 使用系统 `SignInWithAppleButton` 与 `AuthenticationServices` 框架，兼容 iOS/macOS 平台。
- UI 在 macOS 中已按 `AppleAccountView.swift` 实现（按钮高度、样式、说明文本、状态展示）。


## 6 常见问题与排查（前端）

- Q: 点击授权但 `authorizationCode` 为空？
  - A: Apple 在某些情形下不返回 code（例如用户取消或系统异常）；查看 `appleViewModel.state` 中的错误信息；在 `ASAuthorizationController` 的回调中也应检查 error。

- Q: 后端返回 401/Invalid id_token？
  - A: 前端需确保将原始 `rawNonce` 传给后端；`rawNonce` 的 SHA256 必须和 `request.nonce` 中发送的一致（实现中 `request.nonce = sha256(rawNonce)`）。同时确保 `AuthService` 指向正确的后端 `BackendBaseURL`。

- Q: 首次授权后没有返回 `email`/`fullName`？
  - A: Apple 仅在首次授权返回这些字段，后续授权不会返回；前端应在首次返回时将这些信息发送到后端并与用户记录关联。


## 7 可选改进建议（前端）

- 在 `AppleSignInViewModel` 中使用更强的随机数来源（例如 Secure Enclave / CryptoKit APIs 已经在使用，但可考虑更复杂策略）并对 nonce 长度/字符集进行审查以满足后端特殊要求。 
- 删除或条件隐藏调试信息（如完整 `authorization_code`/`identity_token` 显示），仅在 debug 配置下显示。 
- 将 Sign in 按钮放置在更显眼位置，增加无障碍支持 (Accessibility labels) 与 Localizable 字符串（目前视图静态中文注释）。
- 在 `AccountViewModel` 中加入更详细的错误分类和用户提示（例如区分网络问题、权限问题、服务器错误等）。


## 8 参考（仓库内）

- `SyncNos/ViewModels/AppleSignInViewModel.swift`
- `SyncNos/Views/Settting/AppleAccountView.swift`
- `SyncNos/ViewModels/AccountViewModel.swift`
- `SyncNos/Services/Infrastructure/AuthService.swift`
- 后端说明：`Backend/docs/sign_in_with_apple.md`


---

文档生成时间：2025-10-15
