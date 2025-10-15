# Sign in with Apple — 后端技术文档

> 版本说明：基于仓库中 `Backend/` 实现（FastAPI + python-jose + PyJWT + requests），此文档只覆盖后端实现、配置、安全和运维建议。

---

## 目录
- 概览
- 关键后端组件与职责
- 配置项与环境变量
- Authorization Code 交换流程（Token Exchange）
- id_token 验签（JWKS）与 nonce 验证
- 本地会话令牌（本地 JWT）设计（access / refresh）
- 数据库与刷新令牌管理
- 安全评估与立即修复建议
- 日志、监控与排错要点
- 测试要点

---

## 概览
后端负责接收客户端传来的 Apple `authorization_code`（以及可选 `rawNonce`），向 Apple Token Endpoint 交换 tokens（包含 `id_token`），使用 Apple 公钥（JWKS）对 `id_token` 做 RS256 验签与声明校验；校验通过后根据 `sub` 在本地用户库查找或创建用户，并签发本地的 access/refresh JWT 返回客户端。

后端主要文件（本仓库实现）：
- `Backend/app/services/apple_oauth.py` — 负责生成 Apple client_secret (ES256) 并向 Apple 交换 tokens
- `Backend/app/security/apple_jwks.py` — JWKS 获取、缓存与 id_token 验签（RS256，使用 `python-jose`）
- `Backend/app/security/jwt.py` — 本地签发/解析 HS256 JWT（access / refresh）
- `Backend/app/api/v1/auth.py` — 提供 `/login/apple`, `/refresh`, `/logout` 三个端点实现
- `Backend/app/core/config.py` — 后端配置（环境变量映射）
- `Backend/README.md`, `Backend/docs/sign_in_with_apple.md` — 项目说明与开发文档

---

## 关键后端组件与职责
- AppleOAuthService (`apple_oauth.py`)
  - 生成 client_secret，用于向 Apple Token Endpoint（`https://appleid.apple.com/auth/token`）以 `authorization_code` 交换 tokens。
  - 生成 client_secret 使用 ES256，headers 带 `kid`，私钥由配置 `APPLE_PRIVATE_KEY` 提供（支持 `\n` 转换为真实换行）。

- AppleJWKS 验签 (`apple_jwks.py`)
  - 拉取 Apple JWKS（缓存 TTL 可配置），并使用 `jose.jwt.decode` 以 JWKS 作为 key 进行 RS256 签名校验。
  - 校验 issuer、audience、exp/iat，并在提供 `rawNonce` 时对 `nonce` 做 SHA256(rawNonce) 后再比对 token 的 nonce claim。

- 本地 JWT 管理 (`jwt.py`)
  - 使用 HS256 与 `APP_JWT_SECRET` 签发本地 `access`（短期）与 `refresh`（长期）token。
  - 提供解析（parse_token）并在服务中用于刷新与作废验证逻辑。

- API 层 (`auth.py`)
  - `/login/apple`：接收 `authorization_code`(+可选 rawNonce)，通过 AppleOAuthService 获取 tokens，并用 AppleJWKS 验签 id_token；基于 `sub` 查找或创建用户，签发本地 tokens，写入刷新令牌到 DB。
  - `/refresh`：校验传入 refresh token（parse + DB 查找），作废旧刷新令牌并签发一对新 tokens（轮换 Refresh Token）。
  - `/logout`：作废对应 refresh token（DB 标记 revoked）。

---

## 配置项与环境变量
在 `Backend/app/core/config.py` 中通过 pydantic Settings 声明：
- APP 相关
  - `APP_JWT_SECRET` — 本地 HS256 签名密钥（必须安全、随机、不可泄露）
  - `APP_ACCESS_TOKEN_MINUTES` — access token 有效期（分钟）
  - `APP_REFRESH_TOKEN_DAYS` — refresh token 有效期（天）

- Apple OAuth
  - `APPLE_TEAM_ID` — Apple Developer Team ID
  - `APPLE_KEY_ID` — Key ID (p8 的 kid)
  - `APPLE_CLIENT_ID` — Services ID (client_id)
  - `APPLE_PRIVATE_KEY` — 私钥 `.p8` 内容或以 `\n` 表示换行的单行字符串
  - `APPLE_JWKS_TTL` — JWKS 缓存秒数（默认 3600）

- DB
  - `DATABASE_URL` — 数据库连接字符串（默认 sqlite，本仓库示例）

重要：生产环境请不要把 `.env` 或私钥提交到版本库。使用云秘钥管理服务（AWS Secrets Manager、Vault 等）或环境变量注入。详见 `Backend/README.md`。

---

## Authorization Code 交换流程（Token Exchange）
实现位于 `apple_oauth.py`：
1. `generate_client_secret()`
   - 构建 claims：iss(team_id)、iat、exp(通常短期，如 5 分钟)、aud、sub(client_id)
   - headers 包含 `kid` 与 alg
   - 使用 ES256 对上述 claims 签名，私钥取自 `settings.apple_private_key`（支持替换 `\n` 为换行）
   - 返回一个 JWT（client_secret）

2. `exchange_code_for_tokens(authorization_code)`
   - 用 `requests.post(APPLE_TOKEN_URL, data=...)` 向 Apple 交换 tokens
   - 数据字段包含：grant_type=authorization_code、code、client_id、client_secret
   - 处理网络异常与非200错误，抛出异常由 API 层返回 401

安全与健壮性注意点：
- client_secret 生成期间请确保私钥不会入侵日志或异常堆栈。
- 使用短期 exp 来限制 client_secret 的滥用风险（代码中使用 5 分钟）。
- 请求 Apple 时设置合理超时（示例中 15s）。

---

## id_token 验签（JWKS）与 nonce 验证
实现位于 `apple_jwks.py`：
1. JWKS 拉取与缓存
   - 从 `https://appleid.apple.com/auth/keys` 获取 JWKS，并缓存于模块内 `_jwks_cache`，缓存时长由 `APPLE_JWKS_TTL` 决定。
   - 建议：在生产中增加错误重试与后备方案（例如本地静态备用 JWKS 以防苹果短暂不可达），并对异常做告警。

2. 验签要点（`verify_apple_id_token`）
   - 使用 `jose.jwt.decode`，传入 JWKS、algorithms=["RS256"], audience=client_id, issuer="https://appleid.apple.com"
   - 校验 exp/iat 等默认声明
   - nonce 验证：如果后端从客户端收到 `rawNonce`（即客户端保留的原始随机值），后端需计算 `sha256(rawNonce)` 的十六进制或 base64（实现中使用 hex via hashlib.sha256(...).hexdigest()），并与 id_token 的 `nonce` 声明比对

注意：apple_jwks.py 使用 `options={"verify_at_hash": False}`。如果需要更严格地检查 at_hash（access token 与 id_token 的绑定），请开启并校验 `at_hash`。

---

## 本地会话令牌设计（access / refresh）
实现位于 `jwt.py`：
- access token
  - 算法：HS256（本仓库实现）
  - payload 包含：sub(user_id)、type=access、exp、iat
  - 默认有效期：由 `APP_ACCESS_TOKEN_MINUTES` 配置（示例 30 分钟）

- refresh token
  - 算法：HS256
  - payload 包含：sub(user_id)、type=refresh、jti（唯一 ID）、exp、iat
  - 默认有效期：由 `APP_REFRESH_TOKEN_DAYS` 配置
  - Refresh token 存储在 DB（RefreshToken 表），字段包含 jti、user_id、revoked、expires_at

- 刷新流程（`/refresh`）
  - 后端解析 refresh token（验证签名与类型）
  - 在数据库中查找对应 jti，确保未被撤销且未过期
  - 标记旧的 refresh token revoked（轮换），签发新的 refresh + 新 access
  - 将新 refresh 的 jti 写入 DB

设计原则：
- 使用 refresh token 轮换降低泄露影响
- 把 refresh token 存储在 DB（而非单向哈希）可实现服务器端作废与审计；生产中建议对 refresh token 的持久化数据加密

安全注意：示例使用 HS256 和单一 `APP_JWT_SECRET`。生产中建议：
- 使用强随机长度 >= 32 字节的秘密
- 考虑使用 RS256 签发本地令牌以便于密钥轮换（不过需要更多基础设施）

---

## 数据库与刷新令牌管理
实现要点（见 `auth.py`）：
- 创建 `RefreshToken` 记录：在登录时签发 refresh token 并将 jti、expires_at、revoked=false 写入数据库
- 刷新时作废旧 jti 并写入新 jti（实现 Token Rotation）
- 登出时将 refresh token 的 `revoked=true`

建议：
- 在 DB 中对 refresh token 表的 jti 做索引以便快速查找
- 在生产中，对 refresh token 的存储加密；最小化对明文 token 的日志记录
- 监控异常的 refresh 尝试（例如大量 401/refresh 错误）以识别滥用

---

## 安全评估（仓库现状）与立即修复建议
基于当前代码审查（已发现的风险与位置）：

1) 敏感信息暴露（严重）
   - 说明：仓库 README 与审计记录指向 `.env` 中可能包含 `APPLE_PRIVATE_KEY` 与 `APP_JWT_SECRET` 的示例或真实值
   - 影响：私钥或 JWT 秘密泄露会导致授权绕过或伪造请求
   - 立即修复：从仓库中移除任何包含私钥或 secret 的文件；把 `.env` 添加到 `.gitignore`；在生产使用秘密管理服务

2) Apple 私钥处理（高）
   - 说明：`apple_oauth.generate_client_secret` 从 `settings.apple_private_key` 直接读取并用于签名
   - 建议：确保加载方式安全——在容器/服务器上通过环境变量注入，或在运行时从秘密管理服务检索；限制私钥在进程内存的保留时间，并避免将其写入日志

3) 本地 JWT 使用 HS256（中）
   - 说明：`jwt.py` 使用 HS256 与共享 secret
   - 建议：确保 `APP_JWT_SECRET` 强且受管理；考虑 RS256（非对称）以便密钥轮换与更强的安全边界；至少确保 secret 的最小长度（32+ bytes）并定期轮换

4) 缺少速率限制（高）
   - 说明：token 交换与登录端点未见速率限制实现（可能受暴力破解/滥用）
   - 建议：在 API 层或反向代理处加入速率限制（例如 slowapi / starlette 或 API网关），对 `/login/apple`、`/refresh`、`/logout` 设限

5) 日志中可能记录敏感信息（中）
   - 建议：审查所有日志语句，禁止将 id_token、authorization_code、client_secret、refresh_token 等写入日志

6) JWKS 拉取健壮性（中）
   - 建议：增加异常重试、超时与后备 JWKS；考虑在 JWKS 请求失败时拒绝验证并上报告警

---

## 日志、监控与排错要点
- 记录关键操作：登录请求、Token Exchange 请求（不记录敏感 token 内容）、refresh 请求与失败原因
- 监控指标：Apple Token Endpoint 调用成功率与延迟、JWKS 拉取失败率、refresh 失败率、异常登录/刷新尝试次数
- 警报建议：当短时间内出现大量 refresh token 拒绝或 token 轮换异常时

---

## 测试要点
- 单元测试：
  - apple_oauth.generate_client_secret 能根据配置正确生成 ES256 client_secret（可使用测试私钥+已知 claims 验证）
  - apple_jwks.verify_apple_id_token：使用模拟 JWKS（自签）生成 id_token，验证成功与 nonce 校验行为
  - jwt.create_access_token/create_refresh_token 与 parse_token 的互操作性

- 集成测试：
  - 模拟 client 获取 authorization_code 并调用 `/login/apple`，后端成功返回本地 tokens
  - refresh 测试：用返回的 refresh token 调用 `/refresh`，验证轮换、旧 token 被标记为 revoked

- 安全测试：
  - 尝试使用伪造或过期 id_token，应返回 401
  - 检查日志确保 token/secret 未被记录

---

## 运维与部署建议
- 不要在版本库中保存 `.env` 或私钥；使用专用 secrets 管理服务
- 对生产环境启用 HTTPS（在文档顶部已强调）
- 加强速率限制、WAF 与监控
- 定期轮换 `APP_JWT_SECRET` 并提供平滑迁移策略（支持旧 secret 验证一段时间或发布版本同时验证多 key）

---

## 常见问题与排查（摘录）
- "No id_token in Apple response"：确保 Apple Token Endpoint 返回的 JSON 中包含 `id_token`；检查 `exchange_code_for_tokens` 返回的 HTTP 状态码与 body
- nonce 失败：确认客户端发送的原始 `rawNonce` 在后端没有被哈希；后端计算 `sha256(rawNonce).hexdigest()` 与 token 的 nonce 比较（当前实现使用 hex）
- token 交换失败：检查 `APPLE_PRIVATE_KEY` 格式（是否包含换行），`APPLE_CLIENT_ID` 与 `APPLE_KEY_ID` 是否正确

---

文档基于仓库中 `Backend/` 下实现。已核对的关键源码文件：
- `Backend/app/services/apple_oauth.py`
- `Backend/app/security/apple_jwks.py`
- `Backend/app/security/jwt.py`
- `Backend/app/api/v1/auth.py`
- `Backend/app/core/config.py`
- `Backend/docs/sign_in_with_apple.md`（仓库内已有开发指引）

如果你希望我把文档扩展为包含示例 curl、单元测试样例或生产安全配置范例，我可以接着补充并将最终版本写入 `Resource/SignInWithApple-Backend.md`（当前已写入）。

---

小结：我已经把 Draft 写入 `Resource/SignInWithApple-Backend.md`。接下来我会把 TODO 标记为已完成（写入文档）。
