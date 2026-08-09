# 本地数据与安全边界

## 事实源

| 位置 | 内容 | 规则 |
| --- | --- | --- |
| IndexedDB | `conversations`、`messages`、`sync_mappings`、`image_cache`、`article_comments` | 会话事实源；schema、索引和迁移以 `src/platform/idb/schema.ts` 为准。 |
| `chrome.storage.local` | 跨界面设置、OAuth 状态、同步配置和 job snapshot | 不是会话正文；敏感键必须排除出备份。 |
| `localStorage` / `sessionStorage` | 筛选、导航和布局等 UI 临时状态 | 不进入备份，也不得承载共享事实。 |
| Notion / Obsidian / Feishu / 导出文件 | 同步或导出的结果 | 派生自本地，不能反向覆盖本地 conversation。 |

`article_comments` 是 article 的独立注释层；根评论可有 locator，回复必须属于同一 article identity 的根线程。删除 conversation 时必须同时清理其消息与 mapping。

## 写入与备份

- 完整采集可用快照同步；不完整的虚拟列表采集只能追加已验证的 diff，不能删掉旧消息。
- 图片缓存不改变会话主事实，失败不阻断文本写入。
- Zip 备份包含本地会话、mapping、图片缓存、评论线程与非敏感设置；导入是 merge，不是覆盖。
- 备份和导入必须拒绝危险 Zip 路径、校验 manifest/schema，并保留无法恢复的资产为明确降级，而不是写入坏数据。

## 凭据与权限

- OAuth token、client secret 和任何以 token 前缀命名的键必须从备份和日志中排除。
- 官方 OAuth 的 secret 只放在 Worker secret；用户自建 Feishu 应用的 secret 可在本机保存，但仍不得备份或记录。
- `wxt.config.ts` 是 permissions、host permissions 和 web-accessible resources 的真源。修改权限时评估新增的信任边界，并运行完整构建验证。
