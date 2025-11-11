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
   syncnos://oauth/callback
   ```
7. 保存后，记录下 **Client ID** 和 **Client Secret**

### 2. 配置 SyncNos

1. 打开 `NotionOAuthService.swift` 文件
2. 找到以下常量并替换为您的实际值：
   ```swift
   static let clientId = "YOUR_CLIENT_ID" // 替换为实际的 Client ID
   static let clientSecret = "YOUR_CLIENT_SECRET" // 替换为实际的 Client Secret
   ```
3. 重新编译应用

### 3. 使用 OAuth 授权

1. 在 SyncNos 设置中，打开 **"Notion API"** 页面
2. 点击 **"Authorize with Notion"** 按钮
3. 浏览器将打开 Notion 授权页面
4. 选择要授权的工作区和页面
5. 点击 **"Allow access"**
6. 授权成功后，应用将自动保存访问令牌

## 注意事项

- **Client Secret 安全**：虽然 Client Secret 存储在应用代码中，但对于 macOS 桌面应用这是可接受的折衷方案
- **重定向 URI**：必须与 Notion Integration 设置中的重定向 URI 完全匹配
- **页面 ID**：OAuth 授权后，您仍需要手动输入或选择要使用的 Notion 页面 ID
- **撤销授权**：可以在设置页面中点击 **"Revoke Authorization"** 来撤销 OAuth 授权

## 故障排除

### 授权失败

- 检查 Client ID 和 Client Secret 是否正确配置
- 确认重定向 URI 与 Notion Integration 设置中的完全匹配
- 检查网络连接是否正常

### 无法访问页面

- 确保在授权时选择了正确的页面
- 检查页面权限设置
- 尝试重新授权

## 参考文档

- [Notion API 文档](https://developers.notion.com/reference)
- [Notion OAuth 文档](https://developers.notion.com/reference/authorization)

