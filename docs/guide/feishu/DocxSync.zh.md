# 飞书 DocX 同步配置指南（WebClipper）

[English](./DocxSync.en.md) | 中文

本指南说明如何把 **SyncNos WebClipper** 的内容同步到 **飞书云文档（DocX）**。

你需要先在飞书开放平台创建一个应用，然后在 WebClipper 的 Settings → Feishu 里完成连接。

## 你需要准备什么

- 一个飞书账号（能进入 `open.feishu.cn/app`）
- 你要同步的会话已在 WebClipper 本地保存（先能在列表/详情里看到）

## 先选一种连接方式（二选一）

### 方式 A：使用 Cloudflare Worker（更安全，但通常需要你自己部署）

适合你不想把 **App Secret**（Client Secret）保存在浏览器本机的情况。

工作原理：

- 扩展不保存 App Secret
- 扩展把 `code` / `refresh_token` 发给你部署的 Worker
- Worker 使用 App Secret 向飞书兑换/刷新 token

你需要做三件事：

1. 创建飞书应用并拿到 `App ID / App Secret`
2. 部署本仓库提供的 Feishu OAuth Worker（把 App Secret 作为 Worker Secret 注入）
3. 把你的 Worker `exchange` URL 填回 WebClipper

### 方式 B：不使用 Worker（更省事，但会把密钥保存在本机）

适合你想最快跑通同步，且可以接受密钥存储在本机浏览器的情况。

工作原理：

- 扩展直接向飞书 token endpoint 发起兑换/刷新
- 需要你在扩展里填写 App Secret

> 注意：仓库里默认的 Worker URL 可能是维护者个人的地址，不保证对所有用户可用。如果你选择方式 A，通常需要部署你自己的 Worker；如果你不想部署，就选方式 B。

## 第 1 步：创建飞书应用（企业自建应用）

1. 打开飞书开放平台：`https://open.feishu.cn/app`
2. 创建应用（通常选择「企业自建应用」即可）
3. 在应用详情页的「凭证与基础信息」里获取：
   - **App ID**（Client ID，形如 `cli_***`）
   - **App Secret**（Client Secret）

### 1.1 配置重定向 URL（非常重要）

在应用的「安全设置」中添加重定向 URL：

```
https://chiimagnus.github.io/syncnos-oauth/callback
```

说明：

- 必须是 `https://`
- 必须和上面完全一致（多一个 `/` 都会失败）
- **当前 WebClipper 代码里固定使用这个 redirect URI**，所以你创建应用时也必须把它加入白名单

### 1.2 配置权限（Scopes）

在应用的「权限管理 / API 权限」里至少开通：

- `docx:document`
- `drive:drive`

（建议直接按 WebClipper 同步所需开齐，否则后续可能同步失败/创建目录失败。）

## 第 2 步（可选）：部署你自己的 Cloudflare Worker（方式 A）

如果你选的是方式 B（直接填 App Secret），可以跳过本节。

### 2.1 Worker 代码在哪里

本仓库已提供 Worker：

- `cloudflare-workers/syncnos-feishu-oauth/`

它提供两个接口：

- `POST /feishu/oauth/exchange`：用 `code + redirectUri` 换 token
- `POST /feishu/oauth/refresh`：用 `refreshToken` 刷新 token

### 2.2 部署步骤（示例）

在仓库根目录执行（需要你本机已登录 Cloudflare / 配好 wrangler）：

```bash
cd cloudflare-workers/syncnos-feishu-oauth
npx wrangler deploy
```

然后把 App Secret 写入 Worker secret（不要提交到 git）：

```bash
cd cloudflare-workers/syncnos-feishu-oauth
npx wrangler secret put FEISHU_CLIENT_SECRET
```

### 2.3 Worker URL 填什么

部署后你会得到一个 `*.workers.dev`（或自定义域名）：

- Exchange URL（填到 WebClipper）：`https://<your-worker-host>/feishu/oauth/exchange`
- Refresh URL（扩展会自动从 exchange 推导出来）：`https://<your-worker-host>/feishu/oauth/refresh`

## 第 3 步：在 WebClipper 里连接飞书

1. 打开 WebClipper → `Settings`
2. 进入 `Feishu`
3. 展开 `Advanced`
4. 先填 `App ID (Client ID)`
5. 然后按你选择的方式填写：
   - 方式 A（Worker）：填 `代理 URL（Worker）`，`App Secret` 留空
   - 方式 B（直连）：填 `App Secret (Client Secret)`，`代理 URL` 留空
6. 点击 `Save`
7. 点击 `Connect`，在新打开的飞书授权页面完成授权

连接成功后：

- 扩展会保存 OAuth token（`feishu_oauth_token_v1`，会被备份排除）
- 你可以对任意会话执行 “Sync to Feishu”
- 默认会在云盘根目录创建/使用三个文件夹（可在 Settings → Feishu Paths 自定义）：
  - `SyncNos-AIChats`
  - `SyncNos-WebArticles`
  - `SyncNos-Videos`

## 常见问题（Troubleshooting）

### Connect 后一直 Waiting / token exchange failed

先判断你选的是哪种方式：

- 方式 A（Worker）
  - 确认你填的是 `.../feishu/oauth/exchange`（不是根域名）
  - 确认 Worker 已设置 `FEISHU_CLIENT_SECRET`
- 方式 B（直连）
  - 确认已填写 `App Secret (Client Secret)`

### 授权页能打开，但授权后扩展没反应

90% 是 redirect URI 没配对：

- 你的飞书应用里必须包含：`https://chiimagnus.github.io/syncnos-oauth/callback`
- 并且必须完全一致
