# Obsidian Setup Guide (WebClipper)

本指南用于帮助你在 **Obsidian** 里安装并配置 `Obsidian Local REST API` 插件，并把 **API Key** 正确填写到 **SyncNos WebClipper** 中。

如果你只想快速完成配置：按顺序完成下面 3 个步骤，然后回到 WebClipper 点一次 `Test` 即可。

## 你需要准备什么

- 已安装 Obsidian（桌面端）
- Obsidian 已打开一个 Vault
- Obsidian 已启用 Community plugins（社区插件）

## Step 1: 安装并启用 Obsidian Local REST API

在 Obsidian 中：

1. 打开 `Settings`
2. 进入 `Community plugins`
3. `Browse` 搜索并安装：`Local REST API`（插件名通常显示为 `Local REST API`，作者为 Adam Coddington）
4. 安装后点击 `Enable`

![Install Obsidian Local REST API plugin](./assets/obsidian-install-plugin.png)

## Step 2: 启用 Insecure HTTP（WebClipper 当前版本必须）

SyncNos WebClipper 当前版本使用 **HTTP** 连接 Obsidian（端口 `27123`），因此你需要在 Obsidian 的 `Local REST API` 插件设置中打开 `Insecure HTTP`。

在 Obsidian 中：

1. `Settings` -> `Local REST API`
2. 打开 `Insecure HTTP`
3. 确认端口是 `27123`
4. 确认监听地址是 `127.0.0.1` 或 `localhost`
   - 不要使用 `0.0.0.0`（会暴露到局域网，安全风险更高）

![Enable insecure HTTP mode](./assets/obsidian-enable-insecure-http.png)

## Step 3: 复制 API Key，并粘贴到 WebClipper

在 Obsidian 的 `Local REST API` 插件设置中找到并复制 `API Key`：

![Copy API key](./assets/obsidian-copy-api-key.png)

然后在 SyncNos WebClipper 的 Popup 中：

1. 进入 `Settings`
2. 找到 `Obsidian Local REST API`
3. 填写：
   - `Base URL`: `http://127.0.0.1:27123`
   - `API Key`: 粘贴你刚复制的 key（完整粘贴，不要多空格/换行）
   - `Auth Header`: `Authorization`（默认即可）
4. 点击 `Test`

提示：

- `API Key` 输入框在 `blur`（失焦）或按 `Enter` 时会自动保存。

## 常见问题

### Test 显示 Failed / network_error / Failed to fetch

优先检查：

- Obsidian 是否正在运行（必须是桌面端在前台或后台运行）
- Obsidian 的 `Local REST API` 插件是否已启用
- 是否已启用 `Insecure HTTP`，且端口为 `27123`
- `Base URL` 是否是 `http://127.0.0.1:27123`（不要写成 `https`，也不要写 `27124`）

### Test 显示 unauthorized / authenticated false

通常是 API Key 没带上或不正确：

- 重新从 Obsidian 的插件设置里复制一遍 API Key
- 确认没有粘贴到多余的空格或换行
- `Auth Header` 保持为 `Authorization`

