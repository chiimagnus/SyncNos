<!-- 397da00f-155a-46cd-a6fa-ea8142498ec8 d207d27c-e8d4-4f8a-9b80-fc8e2da30a6c -->
# Sign in with Apple 开发环境改进方案

## 目标

- 在“仅开发环境、仍为 http”的前提下，补齐后端 Apple `id_token` 的 JWKS 验签与关键字段校验，并移除当前“跳过验签”的逻辑。
- 前端新增 nonce 支持并传给后端；补强 401 自动刷新与错误兜底流程；不变更现有 UI 结构。
- 不启用 https（待后续迁移到云端再切换），但保证逻辑与安全校验与未来 https 一致。

## 后端改进（FastAPI）

- 新依赖
  - 在 `Backend/requirements.txt` 增加：`python-jose[cryptography]`（用于 Apple id_token RS256 验签）。
- 新增 Apple JWKS 验证模块
  - 新建 `Backend/app/security/apple_jwks.py`：
    - 拉取并缓存 Apple JWKS（`https://appleid.apple.com/auth/keys`），设置内存缓存 TTL（如 1 小时）。
    - 提供 `verify_apple_id_token(id_token: str, audience: str, nonce: Optional[str]) -> dict`：
      - 使用 `from jose import jwt as jose_jwt`：
      - 验证 `iss == "https://appleid.apple.com"`、`aud == settings.apple_client_id`、`exp/iat`；如传入 `nonce`，校验 `nonce` 一致。
      - 选择 `alg: RS256`，基于 `kid` 提取对应公钥解码。
    - 代码骨架（示意）：
      ```python
      from jose import jwt as jose_jwt
      import requests, time
      APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
      _cache = {"jwks": None, "ts": 0, "ttl": 3600}
      def _get_jwks():
          now = time.time()
          if not _cache["jwks"] or now - _cache["ts"] > _cache["ttl"]:
              _cache["jwks"] = requests.get(APPLE_JWKS_URL, timeout=10).json()
              _cache["ts"] = now
          return _cache["jwks"]
      def verify_apple_id_token(id_token: str, audience: str, nonce: str | None):
          jwks = _get_jwks()
          return jose_jwt.decode(
              id_token,
              jwks,
              algorithms=["RS256"],
              audience=audience,
              issuer="https://appleid.apple.com",
              options={"verify_at_hash": False},
              nonce=nonce
          )
      ```

- 登录端点接入验签与 nonce
  - 修改 `Backend/app/api/v1/auth.py` 的 `/login/apple`：
    - 获取 `authorization_code` 后，调用 Apple token endpoint 得到 `id_token`；
    - 使用上面的 `verify_apple_id_token` 校验（替换现有 `verify_signature=False` 解析）。
    - 从校验后的 payload 读取 `sub/email`，后续逻辑保持一致。
    - 请求体新增可选字段 `nonce`（若前端传入则强校验，否则不校验 nonce）。
- 统一鉴权依赖（替换“第一个用户”简化实现）
  - 新建 `get_current_user` 依赖：
    - 从 `Authorization: Bearer <access>` 中解析本地 HS256 access（沿用现有 `security/jwt.py`），校验 `type == "access"`。
    - 解析 `sub` 即 user_id 并查询用户。
  - 修改 `Backend/app/api/v1/users.py` 接口使用该依赖，移除 `_current_user` 简化实现。
- 刷新、登出逻辑复核
  - 保持现有 refresh 轮换与作废逻辑不变；
  - 对刷新端点返回统一错误码与文案，方便前端兜底；
- 配置与常量
  - `settings.apple_client_id` 作为 `audience`；
  - 可选增加 `APPLE_JWKS_TTL` 环境变量，默认 3600 秒。

## 前端改进（SwiftUI / macOS）

- Nonce 支持
  - 在 `AppleSignInViewModel` 中生成随机字符串，并传递其 SHA256（Apple 要求传 `request.nonce = sha256(nonce)`）；
  - 在授权成功后，将“原始 nonce”随同 `authorization_code` 一起 POST 给后端（修改 `AuthService.loginWithApple` payload：`{"authorization_code": code, "nonce": <nonce>}`）。
- 401/错误兜底与重试
  - `AccountViewModel` 的 `load()`/`fetchProfile` 路径：
    - 若 401 且有 refresh，自动刷新一次并重试当前请求；
    - 二次失败则清 Token 并提示“需要重新登录”。
- 小幅健壮性
  - 给 `AuthService` 的 JSON 解码器设置合理的 `keyDecodingStrategy`/超时；
  - 为 dev 提供 `UserDefaults("BackendBaseURL")` 覆盖能力（已具备，保留）。

## 验收与测试

- 单元测试（后端）
  - `verify_apple_id_token`：
    - 伪造/替换 `jwks` 返回，使用 jose 生成 RS256 测试令牌（本地测试用）；
    - 覆盖 `aud/iss/exp/nonce` 错误与正确场景。
- 集成测试（端到端）
  - 本地起后端（http），前端运行，通过真实 Sign In with Apple（或模拟 code）走完整流；
  - 校验后端确实不再接受未验签的 `id_token`。

### To-dos

- [ ] 在 Backend/app/services/apple_oauth.py 添加 JWKS 获取与 TTL 缓存函数（依赖：config）
- [ ] 在 Backend/app/services/apple_oauth.py 实现 verify_id_token_with_jwks（依赖：plan-add-jwks-fetch）
- [ ] 在 Backend/app/api/v1/auth.py 使用 verify_id_token_with_jwks 替换现有不验签代码（依赖：plan-add-verify-token）
- [ ] 为 exchange_code_for_tokens 添加网络错误处理与 1 次重试并记录日志（依赖：plan-integrate-auth）
- [ ] 新增 tests/backend/test_auth_jwks.py，模拟 JWKS 并覆盖验证成功/失败路径（依赖：plan-add-verify-token）
- [ ] 更新 Backend/README.md 与前端 docs，加入 mkcert 可选步骤与开发调试说明（示例 uvicorn 命令）
- [ ] 本地运行后端并用前端或 curl 做端到端测试（依赖：前面所有项完成）