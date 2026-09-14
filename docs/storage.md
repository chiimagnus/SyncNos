# 本地数据、备份与恢复边界

本页只维护会影响数据安全、恢复和跨界面一致性的长期契约。object store、索引、schema 版本、storage key、provider 默认目录等实现细节以源码和测试为准。

## 本地真源

- AI 对话、文章和 Video 先保存到浏览器本地；Provider 与导出文件都是派生结果。
- conversation 的业务时间是 `lastActivityAt`。真实采集或评论活动可以推进它；纯阅读、Provider sync、identity rewrite、schema/backup migration 不得用执行时刻伪造 Activity。
- sync mapping、cursor 和远端状态不得反向覆盖本地内容事实。
- 虚拟列表只有在完整性确认后才能做完整快照；不完整 DOM 不能删除历史消息。
- 文章评论属于本地文章身份下的独立注释层。新写入和可安全迁移的数据中，每个 thread 的首节点只承载一种内容（仅引用或仅评论）；第二条及后续节点都是有正文的同级 comment child，并直接挂首节点。引用节点必须有可验证定位或稳定导入身份，引用与评论独立持久化；删除首节点时删除整个 thread，删除非首节点时只删除该节点。历史 composite quote+comment 若缺少可验证 locator / stable import identity，则保留原记录以避免数据丢失，不伪造可定位 quote。
- 图片缓存是增强数据；缓存失败不得阻断正文保存。

## 图片引用与缓存

- 对话正文和图片下载是两个持久化阶段。正文成功写入后，图片 resolver、下载、队列或缓存失败不得把这次正文保存改判为失败，也不得回滚正文。
- ChatGPT 尚未本地化的内容图片必须保留可恢复的稳定身份；session token、临时 signed download URL 和原始 backend response 不进入持久消息或 Backup。
- 用户上传图片与 AI 生成图片属于对话内容；普通 tool/MCP 截图和视觉执行产物不是 conversation asset，不进入图片缓存。
- 自动图片缓存只决定是否在保存后后台本地化；手动 backfill 仍可处理已有条目。成功本地化只改写真正的 Markdown image target，local asset identity 继续受 owning conversation 约束。
- 导出和 Provider 同步需要图片时，可以临时物化尚未本地缓存的 ChatGPT 图片，不以“先写入永久本地缓存”为前提。临时取图失败按目标能力降级图片，不能泄漏内部引用，也不能破坏已经保存的本地正文。

## 一致性与刷新

- IndexedDB 业务层共用 canonical connection lifecycle，不维护第二套连接所有权。
- 受 durable revision 跟踪的业务变更与 revision 必须同 transaction 提交；no-op 不制造 revision。
- post-commit wake 只负责提示重读。consumer 以 durable revision + canonical reread 为事实真源；漏 wake 不能永久留下旧状态。
- canonical read reject 时保留 last-good 并允许后续 replay；只有成功读取到的空值才是 authoritative empty。

## Backup ZIP

Backup ZIP 是恢复包，不是 IndexedDB 的物理副本。当前导入/导出只支持当前 Backup schema；旧 ZIP schema 和 legacy raw JSON backup 不再是受支持入口。

Backup 可以包含本地采集内容、可恢复 sync mapping、图片缓存、文章评论和非敏感设置。Provider token/client secret/API key、pending OAuth/Device Flow credential、Reader TTS AI API key，以及设备/浏览器 Profile 特定的 CLI identity/opt-in 等状态必须排除。

设备特定、可重新派生的远端 cleanup/pending 状态不跨设备迁移。sync mapping 只有在表达可恢复 continuity 且不携带秘密时才进入 Backup。

## 恢复与失败

- 导入是 merge restore，不无条件覆盖当前数据库；同一 Backup 重复导入应保持幂等。
- 评论/划线按稳定来源身份或自身文章上下文身份合并，不因内容/时间相似误吞，也不因表示变化制造重复。
- ZIP 导入按已提交 stage 推进。后续 stage 失败不能回滚已经 commit 的 stage，progress 也只能报告已提交结果。
- restore / migration 不得用导入时刻伪造 `lastActivityAt`。
- manifest、schema 和 ZIP 路径必须在写入前验证；缺失或危险 entry 直接拒绝，不猜测替代路径。
- 图片 asset identity 只在 owning conversation 内有效。导入 remap 不能跨 conversation 复用 local ID/blob/fallback URL；只改写真正的 Markdown image target，不修改普通文本或 code。
- Provider 只有在远端结果明确成功后才能推进本地 continuity。远端失败或 mapping 更新失败不得伪造成功，更不能回滚已保存的本地内容。

权限、OAuth 和外部网络边界见 [Privacy](../PRIVACY.md)。
