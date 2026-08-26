# Obsidian Local REST API 配置指南（WebClipper）

[English](./LocalRestAPI.en.md) | **中文**

本指南负责 SyncNos WebClipper 通过 Local REST API 插件同步到 Obsidian vault 的用户配置步骤；运行时行为仍以 `src/services/sync/obsidian/**` 为准。

## 准备条件

- 已安装 Obsidian Desktop，并已打开一个 vault。
- 已启用 Community plugins。

## 1. 安装 Local REST API

在 Obsidian 中打开 `Settings` → `Community plugins`，搜索 Adam Coddington 的 **Local REST API**，安装并启用。

![安装 Obsidian Local REST API 插件](./assets/obsidian-install-plugin.png)

## 2. 启用本机 HTTP

当前 SyncNos 客户端通过 HTTP 使用这一集成。在 Local REST API 插件设置中打开 **Insecure HTTP**。

SyncNos 默认连接地址为：

```text
http://127.0.0.1:27123
```

监听地址应保持为 `127.0.0.1` / `localhost`。除非明确希望把 API 暴露到局域网，否则不要绑定到 `0.0.0.0`。

![启用 Insecure HTTP](./assets/obsidian-enable-insecure-http.png)

## 3. 复制 API Key

从 Local REST API 插件设置复制 API Key。

![复制 API Key](./assets/obsidian-copy-api-key.png)

然后打开 WebClipper → `Settings` → `Obsidian`，填写：

- Base URL：通常保持 `http://127.0.0.1:27123`。
- API Key：从 Obsidian 复制的 key。
- Auth Header：通常保持 `Authorization`。

保存后运行连接测试。API Key 保存在扩展本机，并会从 SyncNos 备份中排除。

## 4. 同步行为

Obsidian 是本地派生目标。SyncNos 通过 localhost REST API 把 Markdown 和需要的本地图片附件写入 vault，这条路径不依赖 SyncNos 云端服务。

始终可以手动同步；如果显式开启 Obsidian auto-sync，本地内容变化也可以进入该 provider 的自动同步队列。

目标文件夹和笔记命名由当前 Obsidian service 与 settings 代码维护，不在本指南重复手抄实现细节。

## 5. 排障

遇到 `Failed to fetch` 或其他 network error 时，依次检查 Obsidian Desktop 是否运行、Local REST API 是否启用、Insecure HTTP 是否开启，以及 Base URL 是否确实指向本机服务。

遇到 `401` / `403` 或 `authenticated false` 时，重新复制 API Key，并检查 Auth Header；再次测试前移除意外的首尾空格。