# 本地数据、备份与恢复边界

本页只维护影响数据安全、恢复和跨界面一致性的长期契约。schema、索引、storage key 和默认路径以源码与测试为准。

## 本地真源

- AI 对话、文章和 Video 先保存到浏览器本地；Provider 与导出文件都是派生结果。
- 同一个真实 AI 会话始终复用同一条本地 conversation。采集 key 格式或瞬时 URL / host 变化只做原地身份迁移，保留消息、图片缓存和同步映射；持久 URL 只保留稳定会话地址。
- `lastActivityAt` 只由真实内容或评论活动推进；阅读、同步、迁移和恢复不得伪造活跃时间。
- 虚拟列表只有在确认完整后才能覆盖历史；不完整页面不能删除已有消息。
- 不完整窗口的 sequence 不是绝对历史位置，不能按正文相同猜测并删除旧 message key；完整快照才可清理被替代的消息。
- 评论中的引用和评论独立持久化；迁移不得丢内容或伪造 locator。定位仍要求可靠 exact Range，不增加模糊回退。
- 图片缓存是增强数据，失败不得阻断正文保存。

## 图片

- 正文写入与图片下载分离。图片解析、下载或缓存失败不得回滚已经保存的正文。
- 未缓存的远端图片只保存可恢复身份，不持久化 session token、临时 signed URL 或原始 backend response。
- 用户上传和 AI 生成图片属于内容；普通 tool/MCP 截图不是 conversation asset。
- 导出或 Provider 同步可临时取得未缓存图片，不要求先写入永久缓存。

## 一致性

- IndexedDB 业务层使用统一 connection lifecycle。
- 受 revision 跟踪的业务变更与 revision 必须同 transaction 提交；wake 只提示重读，durable revision + canonical reread 才是事实。
- 读取失败时保留 last-good；只有成功读取到的空值才是 authoritative empty。

## Backup

- Backup ZIP 是逻辑恢复包，不是 IndexedDB 物理副本；只支持当前 Backup schema。
- 普通 Backup 可包含本地内容、可恢复 mapping、图片缓存、评论和非敏感设置，不包含认证凭据。
- 用户显式选择 **包含私密数据（用于迁移）** 时，Full Backup 才包含可迁移凭据。该选项默认关闭，ZIP 不额外加密。
- 临时 OAuth / Device Flow 状态、设备运行状态和浏览器 Profile 特定身份不迁移。
- 导出如果会静默丢数据必须失败，不能生成“成功但不完整”的 Backup。

## 恢复与失败

- 导入是 merge restore；重复导入应保持幂等。敏感凭据只允许从明确声明的 Full Backup 恢复。
- manifest、schema 和 ZIP 路径必须在写入前验证；危险或缺失数据直接拒绝。
- 已提交的恢复 stage 不因后续 stage 失败而回滚，也不得用恢复时刻改写业务活跃时间。
- 图片 asset identity 只在 owning conversation 内有效，导入 remap 不得跨 conversation 复用。
- Provider 只有在远端结果明确成功后才能推进本地 continuity；远端失败不得伪造成功，也不得回滚本地内容。

权限、OAuth 和外部网络边界见 [Privacy](../PRIVACY.md)。
