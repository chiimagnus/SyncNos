# Browser-required 边界

只在 CLI 无法独立完成、任务确实需要 live browser context 时读取。使用现有浏览器 Skill；完成交互后回到 CLI 做状态 read-back。

## Local CLI Integration 权限

registration 健康但 `doctor` 仍为 `extension_unreachable` 时，用浏览器 Skill 检查目标浏览器/Profile，不要让用户重复确认已经明确提供的事实。若 Local CLI Integration 未开启，或 `nativeMessaging` 权限确实需要重新授予，就通过 SyncNos 可见的 **设置 → CLI → 本地 CLI 集成** 控件完成所需 user gesture，再运行 `syncnos status` / `syncnos doctor`。不要修改 Profile、Preferences、Secure Preferences 或私有 storage 绕过权限手势。

## 网页上下文

- 选区评论：在真实 HTTP(S) 文章页选择精确文本，通过 SyncNos 现有 in-page comments flow 创建根评论；不要手工构造 locator JSON。完成后可用 `comments list` read-back。
- `capture`：目标页不是 active tab 时，只切换到正确 tab，再运行 `syncnos capture`；不要复制 collector DOM 逻辑。
- `$` mention：先用 `mention search` / `mention build` 生成候选与插入文本；只有用户要求写入网页 composer 时才用浏览器能力插入，不复制站点 editor 逻辑。

## OAuth / Device Flow

认证从 CLI 开始，浏览器只处理必须的用户批准：Notion/飞书完成授权后回到 `auth status`；GitHub 可向用户展示 CLI 返回的 `verificationUri` 和 `userCode`，批准后按 `poll` / status 继续。不要读取或暴露 access/refresh token、client secret、API key、内部 `deviceCode` 等凭据。
