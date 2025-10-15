# SyncNos 后端安全审查报告

- 本地 JWT 使用 HS256（共享对称密钥）并通过 `APP_JWT_SECRET` 签发 access/refresh token，且刷新令牌的 jti 以明文形式存储在 SQLite 数据库（`refresh_tokens` 表）。对称 HS256 + 明文存储存在较高风险。
- 缺少显式速率限制或防暴力破解中间件；`/api/v1/auth/login/apple` 在短时间内可被重复调用以暴力尝试 authorization_code。
- 输入校验不足：`authorization_code` 与 `nonce` 只检查是否存在（非格式/长度校验）。
