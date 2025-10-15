# SyncNos 后端安全审查报告

> 目标：对 `Backend/` 目录进行全面安全审查，重点检查敏感信息暴露、认证/授权、令牌管理、输入校验、速率限制、日志与隐私泄露风险，并给出可执行修复建议。

---

## 概要结论（高优先级修复）

- 发现敏感配置被设计为可由 `.env` 加载，示例中存在明文示例；仓库文档提示 `APP_JWT_SECRET=change_this_in_prod`。必须立即确保所有真实密钥不在仓库中。
- Apple Sign in 的私钥从 `settings.apple_private_key` 读取并用于直接生成 client_secret（ES256），私钥在配置中以明文保存；如果 `.env` 被提交或泄露会导致钥匙泄露。
- 本地 JWT 使用 HS256（共享对称密钥）并通过 `APP_JWT_SECRET` 签发 access/refresh token，且刷新令牌的 jti 以明文形式存储在 SQLite 数据库（`refresh_tokens` 表）。对称 HS256 + 明文存储存在较高风险。
- 缺少显式速率限制或防暴力破解中间件；`/api/v1/auth/login/apple` 在短时间内可被重复调用以暴力尝试 authorization_code。
- 输入校验不足：`authorization_code` 与 `nonce` 只检查是否存在（非格式/长度校验）。
- 日志/文档中存在将敏感信息示例（`.env`）写入仓库的情况，存在被误提交的高风险。

---

## 详细发现（带代码位置）

- **敏感配置读取（高）**
  - 文件：`Backend/app/core/config.py`
  - 说明：使用 `pydantic_settings.BaseSettings` 加载 `APPLE_PRIVATE_KEY`、`APP_JWT_SECRET` 等。项目 README/示例提供了 `.env` 的多行私钥示例和默认 JWT 密钥值 `change_this_in_prod`，风险是开发者可能将真实 `.env` 提交。

- **Apple OAuth 私钥处理（高）**
  - 文件：`Backend/app/services/apple_oauth.py`
  - 说明：函数 `generate_client_secret()` 直接从 `settings.apple_private_key` 获取私钥（支持 `\n` 转换），并调用 `jwt.encode(..., private_key, algorithm="ES256")` 生成 client_secret。私钥以明文可被配置或误提交。
  - 风险：私钥泄露会导致攻击者伪造 Apple client_secret 并滥用授权交换接口。

- **Apple id_token 验签（良好）**
  - 文件：`Backend/app/security/apple_jwks.py`
  - 说明：从 `https://appleid.apple.com/auth/keys` 获取 JWKS 并用 `python-jose` 验证 `RS256`，并在提供 `nonce` 时核验 SHA256(rawNonce)。实现总体正确，包含 JWKS 缓存逻辑。
  - 建议：增强超时/错误捕获并在网络异常下返回统一错误码，避免泄漏内部异常信息。

- **本地 JWT 签发（高）**
  - 文件：`Backend/app/security/jwt.py`
  - 说明：`create_access_token` / `create_refresh_token` 使用 `PyJWT` 的 `HS256`，密钥来自 `settings.app_jwt_secret`。
  - 风险：HS256 依赖对称密钥，若后端密钥被泄露，任何人都能签发有效 token。刷新令牌在数据库表 `refresh_tokens` 中以 jti 明文存储并带有 `expires_at`，但数据库采用默认 `sqlite:///./app.db`（未加密）。

- **刷新令牌生命周期与存储（高）**
  - 文件：`Backend/app/api/v1/auth.py`, `Backend/app/db/models.py`, `Backend/app/repositories/users.py`
  - 说明：刷新令牌被签发后，解析出 `jti` 并在 DB 的 `refresh_tokens` 表中创建记录（`jti` 唯一）。刷新时旧令牌被标记撤销并写入新条目（令牌轮换存在）。
  - 风险：数据库为 SQLite，本地存储可能被物理访问时暴露；未对 jti 或关联字段进行加密/哈希存储。若 DB 泄露，可用于令牌重放/伪造检测绕过（若结合 JWT 秘钥被泄露，风险更高）。

- **输入验证（中）**
  - 文件：`Backend/app/api/v1/auth.py`
  - 说明：对 `authorization_code` 仅检查是否存在，`nonce` 仅可选；未做长度、字符集或格式限制，也未限制重复请求频次。
  - 风险：恶意构造超长值或特制 payload 可能造成异常或 DoS 风险；缺少速率限制放大暴力攻击可能性。

- **速率限制与暴力防护（高）**
  - 全局：未发现 slowapi、ratelimit 中间件或自定义速率限制实现的代码。
  - 风险：`/login/apple`、`/refresh` 等接口易受暴力尝试攻击。

- **日志与隐私（中）**
  - 文档 `Backend/README.md` 与 `Resource/SyncNos 后端代码安全审查报告.md` 中包含敏感示例（私钥片段）。未在代码中发现把 token 写入日志的明确代码片段，但需审查运行时日志配置与调用栈，避免 `resp.text` 或外部异常直接返回/记录敏感信息（`apple_oauth.exchange_code_for_tokens` 在错误时会抛出包含 `resp.text` 的异常）。

- **依赖风险（中）**
  - `requirements.txt` 包含 `PyJWT[crypto]`、`python-jose[cryptography]`、`requests` 等。需要确保使用最新安全修复版本并在生产环境上对依赖进行定期审计。

---

## 可执行修复建议（按优先级）

优先级说明：危急（立即）、高（短期 1-7 天）、中（中期 1-4 周）。

- 危急：移除和保护敏感信息
  - 立即：从仓库移除任何真实的 `.env` 文件与 `.p8` 文件，并执行密钥轮换（Apple 私钥若已泄露需在 Apple Developer Portal 重新生成 Key）。
  - 在 `.gitignore` 中添加 `.env` 并核查历史提交中是否已泄露（若泄露，按密钥泄露流程处理：撤销/轮换）。
  - 不要在 README 或 docs 中包含真实私钥样例，改为占位符并明确要求使用安全秘密管理服务。

- 高：密钥管理与 JWT 安全
  - 将 `APP_JWT_SECRET` 等敏感配置移到环境变量或 secrets 管理（如 AWS Secrets Manager / HashiCorp Vault / CI secrets），不要在源码或 `.env` 中明文保留真实值。
  - 考虑将本地 access token 改为 RS256（非对称）并使用私钥保存在受管控的秘密管理系统；或保留 HS256 但确保存储强随机密钥与限期轮换。
  - 对刷新令牌 DB 存储：不要存储原始 refresh token 或以可逆形式存储；只需存储 `jti` 的安全哈希（例如 HMAC 或 PBKDF2），以便验证传入 token 的 jti 时先对传入 jti 做相同哈希再比对，降低数据库泄露可利用性。
  - 在生产环境使用加密的数据库（Postgres + TDE / filesystem encryption），避免明文 SQLite 存储敏感令牌。对于轻量级部署，使用文件系统加密（LUKS / FileVault）并限制权限。

- 高：速率限制与滥用防护
  - 在 FastAPI 中添加速率限制中间件（例如 slowapi 或 使用 Starlette middleware + Redis 计数器），对关键端点（`/api/v1/auth/login/apple`, `/api/v1/auth/refresh`, `/api/v1/auth/logout`）实施每 IP/每帐号限流与短期封锁策略。
  - 添加重试/退避机制与登录失败缓存（短期内多次失败触发额外验证或临时阻断）。

- 高：输入校验和错误暴露
  - 对 `authorization_code`、`nonce` 添加明确长度、字符集检查（拒绝超长值，例如 >2048 字符）和最大并发限制。
  - 错误处理中避免将外部服务的原始响应体 (`resp.text`) 直接回传给客户端；替换为通用错误码并在服务器端日志中以受控方式记录（masking）。

- 中：日志与审计
  - 审查运行时日志配置，确保不会记录敏感令牌、密钥或用户邮件的完整值。实现日志脱敏策略（掩码邮箱、token 前 N 位和后 N 位）。
  - 将重要安全事件（令牌签发/撤销、登录失败次数异常、密钥变更）写入审计日志，存储到受保护的日志系统并保留合规期限。

- 中：令牌轮换和最小权限
  - 缩短 access token 生命周期（目前 30 分钟，可评估更短）并实现 refresh token 轮换与一次性使用策略（当前代码似乎在 refresh 时撤销旧 jti 并生成新 jti，已包含轮换机制，需确保实现无竞争窗口）。

- 中：依赖与供应链安全
  - 固定并定期更新 `requirements.txt` 中的库版本，使用 Dependabot 或 Snyk 之类工具扫描漏洞。

---

## 实施步骤（建议行动清单）

- 立即操作（步骤）：
  1. 删除任何真实 `.env` 并在 `.gitignore` 中加入 `.env`。
  2. 若私钥曾提交，按泄露流程：立即在 Apple Developer Portal 撤销相关 Key，生成新 Key，并在所有受影响环境中更换。
  3. 在部署环境中把 `APP_JWT_SECRET`、`APPLE_PRIVATE_KEY` 等放进 secrets 管理系统（不要直接写入代码库）。

- 短期（1-7 天）：
  1. 改进 `jwt` 实现：考虑改为 RS256 或在短期内至少保证 `APP_JWT_SECRET` 强随机并存储在受控位置。
  2. 在关键端点加入速率限制中间件并配置阈值（例如 10 次/分钟 每 IP）。
  3. 对 `authorization_code`、`nonce` 加入长度与格式校验。
  4. 修改日志策略，避免输出外部响应体和敏感数据。

- 中期（1-4 周）：
  1. 将 refresh token jti 存储改为仅保存哈希值并在验证时比较哈希。
  2. 将数据库从 SQLite 迁移到 Postgres 或 MySQL（生产）并加密备份。
  3. 实施安全审计日志系统与令牌失效监控。

- 长期（可选）：
  1. 将所有秘密托管到专门的 Secret Manager，启用自动轮换与版本控制。
  2. 添加 MFA / 可选的二次身份校验在异常登录时触发。

---

## 参考：代码片段说明（证据）

- Apple client_secret 生成（易泄露点）:
  - `Backend/app/services/apple_oauth.py`:
    - 使用 `settings.apple_private_key` 生成 ES256 client_secret: `jwt.encode(claims, private_key, algorithm="ES256", headers=headers)`。

- 本地 JWT 签发（弱点）:
  - `Backend/app/security/jwt.py`:
    - `create_access_token` / `create_refresh_token` 使用 `HS256` 和 `settings.app_jwt_secret`。

- 刷新令牌存储（可改进）:
  - `Backend/app/api/v1/auth.py` + `Backend/app/db/models.py`
    - `RefreshToken` 表包含 `jti`、`revoked`、`expires_at`，`jti` 以明文存储。

- JWKS 验签为 RS256（正确点）:
  - `Backend/app/security/apple_jwks.py` 使用 JWKS 拉取并 `jose_jwt.decode(..., algorithms=["RS256"])`。

---

## 附录：快速修复命令示例

- 从 repo 移除 .env 并加入 .gitignore（示例）：

```bash
# 在 Backend/ 目录
rm Backend/.env  # 若存在（谨慎）
# 确保 .gitignore 包含
echo "Backend/.env" >> .gitignore
```

- 生成强随机 JWT 密钥（示例）：

```python
import secrets
print(secrets.token_urlsafe(32))
```

---

如果你希望，我会：
- 1) 将上述报告写入 `Resource/SyncNos_Backend_Security_Audit_Report.md`（我已在执行中）；
- 2) 提交一个具体的代码更改建议列表（patch）供你审阅并合并；
- 3) 帮你实现其中一个短期修复（例如：加入 slowapi 限流中间件或把 refresh jti 改为哈希存储）。

请告诉我你希望我下一步做哪项（我建议先写入并提交报告，然后逐项修复）。

---

（已根据你的请求逐文件检查 `Backend/` 中与 OAuth、JWT、令牌、DB、配置相关代码并生成本报告；我会把最终报告文件写入 `Resource/` 并把 TODO 标记为完成。）