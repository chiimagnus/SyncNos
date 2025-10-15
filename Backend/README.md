# SyncNos Backend Documentation

这是一份关于Sign in with Apple的技术文档

## 快速开始（FastAPI Apple 登录 MVP）

1. 创建并激活虚拟环境（推荐）

```bash
cd Backend/

# 在 macOS / Linux
python3 -m venv .venv
source .venv/bin/activate

# 在 Windows (PowerShell)
# python3 -m venv .venv
# .\.venv\Scripts\Activate.ps1
```

2. 安装依赖

```bash
pip install -r requirements.txt
```

2. 配置环境变量（在`Backend/`根目录创建 `.env`）

```bash
# Apple Sign in
APPLE_TEAM_ID=YOUR_APPLE_TEAM_ID
APPLE_KEY_ID=YOUR_APPLE_KEY_ID
APPLE_CLIENT_ID=com.example.app.services  # Services ID
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n<YOUR_P8_MULTILINE>\n-----END PRIVATE KEY-----\n"

# App JWT secret (HS256)
APP_JWT_SECRET=change_this_in_prod

# Token TTL (optional overrides)
APP_ACCESS_TOKEN_MINUTES=30
APP_REFRESH_TOKEN_DAYS=7
```

3. 启动服务

```bash
uvicorn app.main:app --reload --port 8000
```

4. 本地测试登录（iOS 获取到 authorization_code 后）

```bash
curl -X POST http://127.0.0.1:8000/api/v1/auth/login/apple \
  -H 'Content-Type: application/json' \
  -d '{"authorization_code":"<iOS获取的code字符串>"}'
```

5. 交互式文档

- 访问 `http://127.0.0.1:8000/docs` 查看 Swagger UI

---

更多开发细节与 Sign in with Apple 改造说明，请参阅：

- `Backend/docs/sign_in_with_apple.md`：包含 JWKS 验签、nonce 流程、前端/后端代码片段、测试与故障排查指南。


## 填写.env文件中的值

- APPLE_TEAM_ID（Team ID）  
  在 Apple Developer 账户页面右上角的 Account -> Membership（或 Account overview）能看到 Team ID；也可以在 Certificates, Identifiers & Profiles 的页面 URL/账户信息里找到。

- APPLE_KEY_ID（Key ID，Sign in with Apple 的 Key）  
  1. 登录 Apple Developer → Certificates, Identifiers & Profiles → Keys。  
  2. 点 “+” 新建 Key，勾选 “Sign in with Apple”，创建后会出现 Key ID 并可以下载一个 `.p8` 文件。**注意：这个 `.p8` 只允许下载一次，务必保存好**。Key ID 就是页面显示的 ID（格式类似：ABC123XYZ）。

- APPLE_CLIENT_ID（Client ID / Services ID / Bundle ID）  
  - 如果你在客户端（iOS App）发起 Sign in with Apple 时使用的是 App 的 Bundle ID，则后端 `client_id` 用同一个 Bundle ID（比如 `com.your.app`）。  
  - 如果客户端使用的是 Web/服务 ID（Services ID），则后端要用该 Services ID（在 Identifiers → Services IDs 创建并配置回调时可见）。  
  总结：后端 `APPLE_CLIENT_ID` 必须和客户端请求时用的 client_id 保持一致（通常 iOS 原生就是 Bundle ID）。

- APPLE_PRIVATE_KEY（.p8 私钥内容）  
  - 在创建 Key 后下载到本地的 `.p8` 文件，打开拷贝全部文本（包括 -----BEGIN PRIVATE KEY----- 和 -----END PRIVATE KEY-----）。  
  - 建议把 `.p8` 原文放到后端安全存储（最好不用直接把多行写入代码库）。如果写入 `.env`，需要把换行转义或用引号包住（README 示例使用了一行带 \n 的表示）。  
  - 重要：Key 只能下载一次，若丢失需要重新在 Developer Portal 重新创建新的 Key。

- APP_JWT_SECRET（后端用于签发本地 JWT 的密钥）  
  - 可以用一个强随机字符串。生成方式示例：  
    - Python：`python3 -c "import secrets; print(secrets.token_urlsafe(32))"`  
    - OpenSSL：`openssl rand -hex 32`  
  - 把这个值放到 `.env` 的 `APP_JWT_SECRET`，不要提交到 git。

> 注意：
> - `.p8` 与 `APP_JWT_SECRET` 都是敏感信息，不要提交到版本库（把 `.env` 加入 `.gitignore`）。  
> - Key 只可下载一次；如果不小心丢失，需要在 Apple Developer Portal 重新建 Key 并更新 Key ID/.p8。  
> - 后端交换 `authorization_code` 时，`client_id` 必须和客户端请求时使用的 `client_id` 一致（iOS 原生通常用 Bundle ID）。  
> - 生产环境务必把私钥与密钥放到受保护的秘密管理系统（如 AWS Secrets Manager / GitHub Secrets / environment variables in CI），不要明文存储在仓库里。
