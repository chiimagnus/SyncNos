# Obsidian Local REST API 配置

[English](./LocalRestAPI.en.md) | **中文**

SyncNos 通过 Obsidian 的 **Local REST API** 社区插件，把 Markdown 和本地图片附件写入 vault。

## 1. 安装 Local REST API

在 Obsidian Desktop 中打开 **设置 → 第三方插件**，安装 Adam Coddington 的 **Local REST API** 并启用。

![安装 Obsidian Local REST API 插件](./assets/obsidian-install-plugin.png)

## 2. 启用本机 HTTP 服务

SyncNos 当前使用插件的本机 HTTP endpoint，不使用 HTTPS endpoint。请开启插件的 Non-encrypted / Insecure HTTP server。

默认地址：

```text
http://127.0.0.1:27123
```

监听地址应保持为 `127.0.0.1` / `localhost`。除非明确希望局域网可以访问，否则不要绑定到 `0.0.0.0`。

![启用本机 HTTP 服务](./assets/obsidian-enable-insecure-http.png)

## 3. 配置 SyncNos

从 Local REST API 插件复制 API Key，然后打开 **SyncNos → 设置 → Obsidian**，填写：

- **Base URL：**通常为 `http://127.0.0.1:27123`
- **API Key：**从 Obsidian 复制的 key
- **Auth Header：**通常为 `Authorization`

点击 **测试** 验证连接。

![在 SyncNos 中配置 API Key](./assets/obsidian-copy-api-key.png)

API Key 保存在 extension-local storage，不会进入 SyncNos Backup ZIP。配置完成后可以手动同步，也可以单独开启自动同步。

## 排障

遇到 `Failed to fetch` 或其它 network error 时，检查 Obsidian 是否运行、Local REST API 是否启用、本机 HTTP server 是否开启，以及 Base URL 是否正确。

遇到 `401` / `403` 或 `authenticated false` 时，重新复制 API Key，并检查 Auth Header。
