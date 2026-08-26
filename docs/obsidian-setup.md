# Obsidian Local REST API 配置

本页是 Obsidian 连接与验收的唯一长期指南。运行时行为以 `src/services/sync/obsidian/**` 为准。

## 1. 准备 Obsidian

需要 Obsidian Desktop、一个已打开的 vault，以及社区插件 [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api)。安装并启用该插件后，在插件设置中启用 Insecure HTTP。

当前 SyncNos 客户端只接受 HTTP；默认地址是：

```text
http://127.0.0.1:27123
```

只绑定 `127.0.0.1` / `localhost`。不要把 Local REST API 监听到 `0.0.0.0`，否则可能把带 API Key 的本地服务暴露到局域网。

## 2. 配置 WebClipper

在 `Settings → Obsidian` 中填写：

- Base URL：通常保持 `http://127.0.0.1:27123`；
- API Key：从 Local REST API 插件设置复制；
- Auth Header：保持默认 `Authorization`，除非你的本地服务明确使用其他 header。

保存后运行连接测试。API Key 保存在扩展本机，但不会进入 SyncNos 备份。

## 3. 同步行为

Obsidian 是本地派生目标：SyncNos 通过 localhost REST API 把 Markdown 和需要的本地图片附件写入 vault，不需要 SyncNos 或 Obsidian 云端服务。

聊天、文章和视频的目标文件夹可在设置中调整；具体默认路径与文件命名以当前 Obsidian service 为准，不在文档复制实现细节。可以手动同步；显式启用 Obsidian auto-sync 后，本地内容变化也会进入自动同步队列。

## 4. 排障

连接测试失败时依次检查：

1. Obsidian Desktop 是否正在运行；
2. Local REST API 是否已安装并启用；
3. Insecure HTTP 是否开启，Base URL 是否为可访问的本机 HTTP 地址；
4. API Key 是否完整、没有额外空格；
5. Auth Header 是否与插件配置一致。

`401/403` 属于认证问题；`Failed to fetch` / network error 优先检查 Obsidian、插件、监听地址和端口。
