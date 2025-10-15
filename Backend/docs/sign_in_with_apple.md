# Sign in with Apple - 开发指引

本指南面向开发者，描述在本仓库中 Sign in with Apple 的实现要点、开发环境下的改进（JWKS 验签、nonce 支持、401 自动刷新）、如何配置以及测试/排查步骤。

> 说明：本环境仅用于开发与测试，暂不启用 HTTPS；生产环境请务必使用 HTTPS 与安全的密钥管理。

## 目录

- 概览
- 后端配置
- JWKS 验签实现细节
- 前端 nonce 支持
- 本地调试与测试
- 常见问题与排查

## 概览

- 客户端通过系统 `Sign in with Apple` 获取 `authorization_code`（授权码）及 `identity_token`（id_token）。
- 客户端将 `authorization_code`（以及可选的 `nonce`）发送到后端 `/api/v1/auth/login/apple`。
- 后端用 `authorization_code` 向 Apple Token Endpoint 交换 `id_token`/access/refresh；使用 Apple JWKS 对 `id_token` 做 RS256 验签并校验 `iss`/`aud`/`exp`/`nonce`。
- 后端根据 `sub` 在本地 DB 查找或创建用户，并签发本地 HS256 access/refresh token 返回给客户端。

## 后端配置

1. 安装依赖：

```bash
cd Backend
pip install -r requirements.txt
```

2. 在 `Backend/.env` 中配置以下变量（示例已在 `README.md`）：

- `APPLE_TEAM_ID`
- `APPLE_KEY_ID`
- `APPLE_CLIENT_ID`
- `APPLE_PRIVATE_KEY` (.p8 内容，注意换行处理)
- `APP_JWT_SECRET`
- 可选：`APPLE_JWKS_TTL`（JWKS 缓存秒数，默认 3600）

## JWKS 验签实现细节

- 文件：`Backend/app/security/apple_jwks.py`
- 功能：从 `https://appleid.apple.com/auth/keys` 拉取 JWKS 并缓存；使用 `python-jose[cryptography]` 的 `jose.jwt.decode` 对 `id_token` 验签。
- 关键点：
  - 校验 `issuer == "https://appleid.apple.com"`
  - 校验 `audience == settings.apple_client_id`
  - 验证 `exp/iat`
  - 如果请求提供 `nonce`，必须校验 `nonce` 字段一致

示例调用：

```python
from app.security.apple_jwks import verify_apple_id_token
payload = verify_apple_id_token(id_token, audience=settings.apple_client_id, nonce=maybe_nonce)
```

错误处理：`jose` 会抛出具体异常（如 `ExpiredSignatureError`、`JWTClaimsError`），你的端点应捕获并返回 401。

## 前端 nonce 支持与流程

- 在 `SyncNos/ViewModels/AppleSignInViewModel.swift` 中生成随机 `rawNonce`，并设置 `request.nonce = sha256(rawNonce)`。
- 在回调中，将 `authorization_code` 与原始 `rawNonce` 一并传给后端：

```swift
// AuthService.loginWithApple(authorizationCode: String, nonce: String?)
```

注意：Apple 要求传给 request 的 `nonce` 为 `SHA256(nonce)` 的十六进制字符串。

## 本地调试与测试

1. 运行后端：`uvicorn app.main:app --reload --port 8000`
2. 在 macOS 客户端运行 App，进入 Settings → General → Apple Account，点击 Sign in。
3. 若你希望用命令行测试，先从 iOS/macOS 客户端获取 `authorization_code`，然后：

```bash
curl -X POST http://127.0.0.1:8000/api/v1/auth/login/apple \
  -H 'Content-Type: application/json' \
  -d '{"authorization_code":"<code>", "nonce":"<rawNonce>"}'
```

4. 若后端返回 401 且错误为“Invalid Apple id_token”或类似，请检查：
  - `APPLE_CLIENT_ID` 是否与客户端发起请求时使用的 client_id 一致；
  - `APPLE_PRIVATE_KEY` 是否正确并能生成有效 `client_secret`；
  - `nonce`（若传）是否与客户端生成的原始 `rawNonce` 一致。

## 常见问题与排查

- 问：为什么收到 "No id_token in Apple response"？
  - 答：Apple 可能在某些场景不返回 id_token，或 token endpoint 返回异常。请检查 `exchange_code_for_tokens` 的 response 内容与 HTTP 状态码。

- 问：如何本地测试 JWKS 验签？
  - 答：可以在测试中通过替换 `apple_jwks._jwks_cache` 为一个包含你自签名公钥的 JWKS，并用 `python-jose` 生成对应签名的 id_token 进行单元测试。

---

如果你希望，我可以继续：

- 把这份指南改成 repository 的 docs 页面并在 CI 中加入后端 JWKS 的单元测试；或
- 提供一个小脚本，帮助你生成测试用的 RS256 id_token（用于单元测试）。


