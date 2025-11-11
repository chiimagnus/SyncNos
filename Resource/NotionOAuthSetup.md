# Notion OAuth 配置指南

## 概述

SyncNos 支持通过 Notion OAuth 2.0 授权流程来访问用户的 Notion 工作区，无需手动复制 API 密钥和页面 ID。

## 配置步骤

### 1. 创建 Notion Public Integration

1. 访问 [Notion 开发者中心](https://www.notion.so/my-integrations)
2. 点击 **"+ New integration"** 按钮
3. 填写集成名称（例如：SyncNos）
4. 选择 **"Public"** 作为集成类型（这是启用 OAuth 的必要条件）
5. 在 **"Capabilities"** 选项卡中，选择所需的权限：
   - ✅ Read content
   - ✅ Update content
   - ✅ Insert content
6. 在 **"OAuth"** 部分，设置重定向 URI：
   ```
   https://chiimagnus.github.io/syncnos-oauth/callback
   ```
   **注意**：此 URL 会重定向到 SyncNos 应用的自定义 URL scheme (`syncnos://`)，无需本地服务器
7. 保存后，记录下 **Client ID** 和 **Client Secret**

### 2. 配置 SyncNos

使用配置文件配置 OAuth 凭证：

1. 复制模板文件：
   ```bash
   cp Resource/notion_auth.env.example Resource/notion_auth.env
   ```

2. 编辑 `Resource/notion_auth.env`，填写您的凭证：
   ```
   NOTION_OAUTH_CLIENT_ID=your_client_id
   NOTION_OAUTH_CLIENT_SECRET=your_client_secret
   ```

3. **重要**：在 Xcode 中，确保 `notion_auth.env` 文件被添加到 Target 的 "Copy Bundle Resources"：
   - 选择项目 → Target → Build Phases
   - 展开 "Copy Bundle Resources"
   - 点击 "+" 添加 `notion_auth.env` 文件
   - 确保文件在列表中（如果已存在，则跳过）

**配置文件位置**：将 `notion_auth.env` 放在 `Resource/` 文件夹中，并添加到 Xcode Target 的 "Copy Bundle Resources"，这样编译后文件会被复制到应用的 Bundle 中。

### 3. 使用 OAuth 授权

1. 在 SyncNos 设置中，打开 **"Notion API"** 页面
2. 点击 **"Authorize with Notion"** 按钮
3. Safari 浏览器将自动打开 Notion 授权页面（macOS 使用 Safari 以确保安全性）
4. 选择要授权的工作区和页面
5. 点击 **"Allow access"**
6. Notion 会重定向到 GitHub Pages 回调页面
7. GitHub Pages 页面会自动重定向到 SyncNos 应用（通过自定义 URL scheme）
8. 授权成功后，应用将自动保存访问令牌

**OAuth 流程说明**：
- Notion → GitHub Pages (`https://chiimagnus.github.io/syncnos-oauth/callback`)
- GitHub Pages → SyncNos 应用 (`syncnos://oauth/callback`)
- 应用接收回调并完成授权

## 注意事项

- **Client Secret 安全**：
  - ✅ 配置文件 `notion_auth.env` 已添加到 `.gitignore`，不会被提交到 Git
  - ✅ 模板文件 `notion_auth.env.example` 可以安全地提交到 Git
  - ❌ **永远不要**将包含真实凭证的 `notion_auth.env` 文件提交到版本控制
  - ❌ **永远不要**在代码中硬编码 Client Secret
- **重定向 URI**：必须与 Notion Integration 设置中的重定向 URI 完全匹配（`https://chiimagnus.github.io/syncnos-oauth/callback`）
- **URL Scheme**：应用已注册 `syncnos://` URL scheme，用于接收 OAuth 回调
- **浏览器**：macOS 会使用 Safari 浏览器打开授权页面（这是 Apple 的安全要求）
- **配置文件位置**：`Resource/notion_auth.env`（需要添加到 Xcode Target 的 "Copy Bundle Resources"）
- **页面 ID**：OAuth 授权后，您仍需要手动输入或选择要使用的 Notion 页面 ID
- **撤销授权**：可以在设置页面中点击 **"Revoke Authorization"** 来撤销 OAuth 授权

## 故障排除

### 授权失败

- 检查 Client ID 和 Client Secret 是否正确配置
  - 确认配置文件路径正确（`Resource/notion_auth.env`）
  - 确认配置文件格式正确（`KEY=VALUE`，每行一个）
  - 确认已添加到 Xcode Target 的 "Copy Bundle Resources"
- 确认重定向 URI 与 Notion Integration 设置中的完全匹配（`https://chiimagnus.github.io/syncnos-oauth/callback`）
- 确认应用已正确注册 URL scheme（`syncnos://`）
- 如果应用没有自动打开，检查 URL scheme 配置是否正确
- 检查网络连接是否正常

### 配置文件找不到

- 确认 `notion_auth.env` 在 `Resource/` 文件夹中
- 确认已添加到 Xcode Target 的 "Copy Bundle Resources"
- 检查文件权限是否可读

### 无法访问页面

- 确保在授权时选择了正确的页面
- 检查页面权限设置
- 尝试重新授权

## 参考文档

- [Notion API 文档](https://developers.notion.com/reference)
- [Notion OAuth 文档](https://developers.notion.com/reference/authorization)

