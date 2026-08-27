# GitHub Markdown 同步配置指南（WebClipper）

[English](./GitHubSync.en.md) | **中文**

本指南负责 SyncNos WebClipper 将本地内容以 Markdown 形式同步到 GitHub 的用户配置步骤；运行时行为仍以 `src/services/sync/github/**` 为准。

## 开始前

- 待同步内容应已经先保存到 SyncNos WebClipper 本地。
- 登录需要授权给 SyncNos 的 GitHub 账号。
- 目标 repository 必须至少已经有一个 commit。
- 如果目标 repository 属于组织，你可能需要具备为该组织安装或配置 SyncNos GitHub App 的权限。

## 1. 使用 Device Flow 连接 GitHub

打开 WebClipper → `Settings` → `GitHub`，点击 `连接 GitHub`。

SyncNos 会直接向 GitHub 发起 Device Flow，并在设置页显示一个临时代码。打开 GitHub 官方设备授权页面：

`https://github.com/login/device`

只在这个页面输入临时代码。不要把代码粘贴到其他网站、聊天、Issue 或支持请求里，也不要分享给其他人。代码过期后，回到 SyncNos 再次点击 `连接 GitHub`，重新开始一轮 Device Flow。

SyncNos 不会要求你创建或粘贴 Personal Access Token（PAT）。GitHub 授权与 token refresh 都由浏览器扩展直接和 GitHub 完成；这条 GitHub 路径不经过 SyncNos OAuth server，也不经过 Cloudflare Worker。

## 2. 安装或配置 SyncNos GitHub App

授权完成后，SyncNos 会通过 GitHub 为当前用户可见的 SyncNos GitHub App installation 来发现 repositories。

GitHub App 的 repository scope 就是 SyncNos 能看到哪些 repositories 的权限边界。installation 需要：

- **Contents: Read and write**
- **Metadata: Read**

如果设置页提示 GitHub App 尚未安装，点击 `安装 / 配置 GitHub App`。如果 App 已安装但看不到目标 repository，请进入 installation 配置，为它开放该 repository。

当已保存的 repository 被移出 installation scope 后，SyncNos 不会自动改成列表里的第一个 repository。原目标会保留并明确显示为不可用，直到你恢复权限或主动选择另一个有写权限的 repository。

## 3. 选择 repository、branch 与目录

在 WebClipper → `Settings` → `GitHub` 中：

1. 选择一个已经授权且具备 contents 写权限的 repository。
2. 填写目标 branch；该 branch 必须已经存在。
3. 按需配置 AI 对话、网页文章、视频字幕三个相对 repository 根目录的输出目录。
4. 离开输入框或按 Enter 保存修改。

目录支持嵌套，例如 `sync/chats`。目录必须保持为 repository 相对路径；absolute path、`..` traversal、反斜杠、空 path segment 和 `.github/workflows/**` 都会被明确拒绝，而不是被前端“清洗”为另一个路径。

在同一 repository/branch 下修改目录后，下一次同步会写入新路径并清理旧的 SyncNos managed path。切换 repository 或 branch 会改变 target identity，因此 SyncNos 不会跨 repository 或 branch 去清理旧目标。

## 4. 测试连接

选择目标后点击 `测试连接`。

Test Connection 只验证当前 GitHub 账号、GitHub App installation access、repository 和 branch preflight，**不会**创建测试文件，也不会制造试写 commit。

preflight 成功并不代表未来所有写入都必然被 branch protection 或 repository ruleset 允许。真实同步在最终更新 ref 时仍可能收到 GitHub `403` 或 `422`。此时应选择允许 GitHub App 写入的 branch，或调整 repository ruleset；不要把 force push 或绕过保护当成 SyncNos 的修复方案。

## 5. 同步行为

GitHub 是派生输出目标，SyncNos 本地数据始终是真源。

- provider 启用且配置完成后，始终可以手动同步。
- 可以在 Settings 中显式开启 GitHub auto-sync。
- 本地 projection 未变化时不会产生新的 content commit。
- 手动 reconcile 可以覆盖直接在 GitHub 上修改的 SyncNos managed Markdown，使远端重新与本地 projection 一致。
- 在同一 repository/branch 下修改标题或目录时，可以在同一个 content commit 中删除旧 managed path 并写入新路径；如果旧远端路径已经不存在，会视为已经清理完成。
- 本地删除会转化为 managed remote cleanup。GitHub 暂时离线时，cleanup 会保留为可恢复状态，之后可以继续重试。
- 本地缓存图片读取失败或上传失败只会产生 warning；Markdown 文本仍可成功同步。

不属于 SyncNos managed paths 的 repository 内容，例如无关的 `README.md`，不在 SyncNos managed projection 范围内，不应被修改。

## 6. Disconnect、撤销授权与卸载 App 的区别

三种动作含义不同：

- **SyncNos `断开连接`**：只清除此设备上该扩展保存的 GitHub 凭据；repository、branch 和目录偏好会保留。
- **GitHub → Settings → Applications → Authorized GitHub Apps → Revoke**：在 GitHub 侧撤销用户授权，并使对应 user tokens 失效。
- **GitHub → Settings → Applications → Installed GitHub Apps → Configure / Uninstall**：调整或移除 GitHub App installation 及其 repository 访问范围。

只想让当前这份 SyncNos 本地退出登录时使用 `断开连接`；需要从 GitHub 侧真正撤销访问时，使用 GitHub 的 authorization 或 installation 管理入口。

## 故障排查

### 临时代码过期

回到 SyncNos Settings 重新点击 `连接 GitHub`，只在 `https://github.com/login/device` 输入新生成的代码。

### GitHub App 未安装或没有可选 repository

打开 `安装 / 配置 GitHub App`，确认 App 安装在正确的个人账号或组织下，并为 installation 开放目标 repository。回到 SyncNos 后刷新 repositories。

### 已保存的 repository 显示不可用

这是有意保留原配置，而不是静默切换目标。恢复 GitHub App 对该 repository 的访问，或主动选择另一个可写 repository。

### Branch preflight 失败

确认目标 branch 已经存在，并且 repository 至少已经有一个 commit；然后确认 GitHub App installation 可以访问该 repository。

### Test Connection 成功，但同步时出现 403 / 422

检查 branch protection 与 repository ruleset。改用 GitHub App 被允许更新的 branch，或调整 ruleset 允许预期的 App 写入。不要为了让 SyncNos 通过而 force push 或关闭保护。

### Markdown 已同步，但图片缺失

图片缓存与上传是 best effort。查看 SyncNos 的同步 warning，在本地图片缓存或 GitHub 连接恢复后重试即可；单个图片失败不会阻断文本 Markdown projection。
