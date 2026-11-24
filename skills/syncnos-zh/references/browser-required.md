# Browser-required 边界

只在 CLI 无法独立完成、任务确实需要 live browser context 时读取。使用现有浏览器 Skill；完成交互后回到 CLI 做状态 read-back。

## Local CLI Integration 权限

registration 健康但 `doctor` 仍为 `extension_unreachable` 时，用浏览器 Skill 检查目标浏览器/Profile，不要让用户重复确认已经明确提供的事实。若 Local CLI Integration 未开启，或 `nativeMessaging` 权限确实需要重新授予，就通过 SyncNos 可见的 **设置 → CLI & AI SKILL → 本地访问 → 启用 SyncNos CLI** 控件完成所需 user gesture，再运行 `syncnos status` / `syncnos doctor`。不要修改 Profile、Preferences、Secure Preferences 或私有 storage 绕过权限手势。

## 网页上下文

- 选区评论：在真实 HTTP(S) 文章页选择精确文本，通过 SyncNos 现有 in-page comments flow 创建根评论；不要手工构造 locator JSON。完成后可用 `comments list` read-back。
- `capture`：先切换目标标签页，再核对浏览器实际活动标签页的 URL，确认一致才运行 `syncnos capture`。CDP `activate` 成功不等于后台选页正确；无法确认时不要抓取，也不要复制 collector DOM 逻辑。
- `$` mention：先用 `mention search` / `mention build` 生成候选与插入文本；只有用户要求写入网页 composer 时才用浏览器能力插入，不复制站点 editor 逻辑。

## Provider 认证

OAuth / Device Flow 从 CLI 开始，浏览器处理用户批准；完成后回到 `auth status`，
GitHub 按需使用 `poll`。需要用户批准时，可展示 CLI 返回的 GitHub `verificationUri` 和 `userCode`；
不要读取或暴露凭据及内部 `deviceCode`。

Notion 手动连接是仅在浏览器中操作的例外，不是 CLI auth 命令。
用户选择此方式时，按 [Notion 连接说明](https://chiimagnus.github.io/SyncNos/docs/sync/notion/)
操作，让用户直接在 SyncNos 设置中输入集成令牌，不通过聊天或命令参数传递。
未经授权不要断开现有账号。完成后通过 `notion auth status` 验证连接，
其余目标配置与同步仍走 CLI。已连接不代表已取得页面权限或完成远端写入。
