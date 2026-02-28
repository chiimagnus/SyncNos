# WebClipper Database Backup（Zip v2）实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收。

**Goal（目标）:** 将 WebClipper 的 Database Backup 从单文件 `*.json` 升级为 `*.zip`：按 `conversation.source` 分目录、每个对话一个 JSON 文件；同时提供 `index.csv` 便于人类/AI 快速阅读；Import 以“合并导入（按 key 去重）”为准则完成一键恢复。

**Non-goals（非目标）:**
- 不再兼容旧版单文件 `*.json` 备份（Export/Import 都不支持）。
- 不做“内容级去重”（例如按内容 hash 去重）；仅按现有 key 规则合并（`source+conversationKey`、`conversationId+messageKey`）。
- 不导出任何敏感凭据（Notion token / client secret 等）。

**Approach（方案）:**
- 定义 Zip v2 目录结构与 schema：`manifest.json` 作为 Import 的权威入口，`sources/{source}/...` 存放对话文件，`config/storage-local.json` 存放 allowlist 配置，`index/conversations.csv` 作为可读索引（Import 不依赖 CSV）。
- Export：从 IndexedDB 读取三大 store（`conversations/messages/sync_mappings`）+ allowlist 的 `chrome.storage.local`，按 `conversation.source` 分组生成每对话 JSON；同时生成 `manifest.json` 与 `index.csv`，最后打包 zip 下载。
- Import：仅接受 zip；读取 `manifest.json` 校验版本并按清单读取每对话文件；将对话文件中的 `conversation/messages/syncMapping` 还原为“可合并导入”的输入，再复用现有 upsert 规则导入到 IndexedDB，并应用 allowlist 配置。
- Zip 读写：当前已有 zip 写入（stored，无压缩），需要新增 zip 读取（至少支持本项目生成的 stored zip）。

**Acceptance（验收）:**
- UI：Database Backup 的 Import 文件选择只接受 `*.zip`；文案明确“不包含 Notion token”。
- Export：产物 zip 目录结构符合本文；`sources/` 下按 source 分文件夹，且每个对话一个 JSON。
- Import：导入后数据可用；重复导入同一 zip 不会产生“同 key 的重复记录”；并且 `storage-local` allowlist 配置被恢复。
- 安全：zip 不包含 `notion_oauth_token_v1`、`notion_oauth_client_secret` 等敏感字段。
- 回归：`npm --prefix Extensions/WebClipper run test` 通过；`npm --prefix Extensions/WebClipper run check` 通过。

---

## Zip v2 目录结构（确定版）

```text
webclipper-db-backup-<ISO>.zip
├─ manifest.json
├─ index/
│  └─ conversations.csv
├─ sources/
│  ├─ chatgpt/
│  │  ├─ <conversationKey>.json
│  │  └─ ...
│  ├─ claude/
│  ├─ gemini/
│  ├─ notionai/
│  └─ web/
└─ config/
   └─ storage-local.json
```

### `manifest.json`（Import 权威入口）

- `backupSchemaVersion: 2`
- `exportedAt: string (ISO)`
- `db: { name: string, version: number }`
- `counts: { conversations: number, messages: number, sync_mappings: number }`
- `config: { storageLocalPath: "config/storage-local.json" }`
- `index: { conversationsCsvPath: "index/conversations.csv" }`
- `sources: Array<{ source: string, conversationCount: number, files: string[] }>`

### `sources/{source}/{conversationKey}.json`（每对话一个 JSON）

- `schemaVersion: 1`（对话文件自身的版本号，便于未来扩展）
- `conversation: { source, conversationKey, ... }`
- `messages: Array<{ messageKey, role, contentText, contentMarkdown, sequence, updatedAt, ... }>`
- `syncMapping: { source, conversationKey, notionPageId, lastSyncedMessageKey, lastSyncedSequence, lastSyncedAt, updatedAt, ... } | null`

### `config/storage-local.json`（插件配置，allowlist）

- `schemaVersion: 1`
- `storageLocal: object`（仅 allowlist 键）

### `index/conversations.csv`（可读索引，不作为 Import 依赖）

建议列（可按需裁剪）：
- `source`
- `conversationKey`
- `title`
- `url`
- `lastCapturedAt`
- `messageCount`
- `notionPageId`
- `hasNotionPageId`
- `filePath`

---

## P1（最高优先级）：实现 Zip v2 Export/Import 主流程

### Task 1: 定义/升级 backup 工具协议与 allowlist

**Files:**
- Modify: `Extensions/WebClipper/src/storage/backup-utils.js`
- Test: `Extensions/WebClipper/tests/smoke/backup-utils.test.ts`

**Step 1: 实现功能**
- 保留并继续使用：`mergeConversationRecord/mergeMessageRecord/mergeSyncMappingRecord/filterStorageForBackup/uniqueConversationKey`。
- 移除或废弃旧 `validateBackupDocument`（单文件 JSON v1），新增：
  - `BACKUP_ZIP_SCHEMA_VERSION = 2`
  - `validateBackupManifest(doc)`（校验 `backupSchemaVersion`、必需字段、路径合法性）
  - `validateConversationBundle(doc)`（校验 per-conversation 文件的关键字段）
- 扩展 `STORAGE_ALLOWLIST_BASE`：加入
  - `popup_source_filter_key`
  - `notion_ai_preferred_model_index`
- 明确：allowlist **不得**包含 `notion_oauth_token_v1`、`notion_oauth_client_secret`。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test -- backup-utils`
- Expected: 相关测试通过（必要时更新断言以匹配新 schema）。

### Task 2: 增强 zip-utils：增加 unzip 读取能力（至少支持 stored zip）

**Files:**
- Modify: `Extensions/WebClipper/src/export/local/zip-utils.js`
- Test: `Extensions/WebClipper/tests/smoke/zip-utils.test.ts`（新建）

**Step 1: 实现功能**
- 在 `zip-utils.js` 增加 `extractZipEntries(blobOrArrayBuffer)`：
  - 支持读取 End of Central Directory（EOCD）
  - 支持 Central Directory 遍历，解析文件名/offset/size/CRC
  - 仅支持 compression method=0（stored），其它 method 明确报错
  - 返回 `{ name -> Uint8Array }` 或 `{ name, bytes }[]`
- 保留现有 `createZipBlob(files)` 不变（向后兼容 markdown export）。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test -- zip-utils`
- Expected: round-trip：`createZipBlob` 打包的 zip 能被 `extractZipEntries` 解析并取回同内容。

### Task 3: Export：生成 Zip v2（manifest + index.csv + sources + config）

**Files:**
- Modify: `Extensions/WebClipper/src/ui/popup/popup-database.js`
- Modify: `Extensions/WebClipper/src/ui/popup/popup-core.js`（如需复用 `sanitizeFilenamePart` 或新增 CSV helper）

**Step 1: 实现功能**
- 替换 `exportDatabaseBackup()`：
  - 读取三大 store + `chrome.storage.local` allowlist（使用 `backupUtils.STORAGE_ALLOWLIST`）
  - 将 `conversations` 按 `source` 分组；对每个会话取其 messages + mapping，生成一个对话 JSON：
    - 文件路径：`sources/<source>/<safeConversationKey>.json`
  - 生成 `config/storage-local.json`
  - 生成 `index/conversations.csv`（注意 CSV 转义：逗号/引号/换行）
  - 生成 `manifest.json`（包含 `sources[].files` 清单）
  - 调用 `createZipBlob(files)` 下载：`webclipper-db-backup-<stamp>.zip`
- 导出文件名/路径安全：
  - `source`/`conversationKey` 必须 sanitize（复用 `sanitizeFilenamePart` 逻辑或在本文件内实现等价 sanitize）
  - 防止 `../` 等路径逃逸（zip-utils 已做 normalize，但导出侧仍应生成干净路径）

**Step 2: 验证（手动）**
- 在 Chrome/Edge 加载本地扩展，进入 popup -> Settings -> Database Backup -> Export
- Expected:
  - 下载 `*.zip`
  - 解压后目录结构符合本文
  - `config/storage-local.json` 不包含 token/secret

### Task 4: Import：从 Zip v2 合并导入到 IndexedDB

**Files:**
- Modify: `Extensions/WebClipper/src/ui/popup/popup-database.js`
- Modify: `Extensions/WebClipper/src/export/local/zip-utils.js`（如 Task 2 的 API 需要补充文本解码 helper）

**Step 1: 实现功能**
- 更新 file input accept：只允许 `*.zip`
- 替换 `importFromFile(file)`：
  - 使用 `extractZipEntries(file)` 得到 entries
  - 读取并解析 `manifest.json`，调用 `backupUtils.validateBackupManifest`
  - 读取并应用 `config/storage-local.json`（仍为 merge-only：`storageSet(filteredSettings)`）
  - 遍历 `manifest.sources[].files`：
    - 解析每个对话 JSON（`validateConversationBundle`）
    - 对每个对话执行“合并 upsert”流程：
      - Upsert conversation by `(source, conversationKey)`（复用既有代码路径）
      - Upsert messages by `(localConversationId, messageKey)`
      - Upsert sync mapping by `(source, conversationKey)`，并按现有规则填充 `convo.notionPageId`（仅当本地缺失）
- 错误处理：manifest 缺失/版本不支持/zip 不可读/非 stored zip 等，UI 状态提示明确。

**Step 2: 验证（手动）**
- 在一个“干净 profile”或删除扩展存储后导入 zip
- Expected: conversations 列表出现；重复导入同一 zip 不会产生“同 key 重复记录”；Notion 映射字段仍在（如 `notionPageId`）。

### Task 5: UI 文案与输入约束更新（不做国际化）

**Files:**
- Modify: `Extensions/WebClipper/src/ui/popup/popup.html`
- Modify: `Extensions/WebClipper/src/ui/popup/popup-database.js`（如需）

**Step 1: 实现功能**
- 将 `databaseImportFile` 的 `accept` 改为 `.zip,application/zip`
- 更新 Note 文案：
  - 强调 “Import merges by (source + conversationKey)”
  - 强调 “Notion token is not included”
  - 说明 “Backup file is a .zip”

**Step 2: 验证**
- 目视检查 popup：文件选择器只显示 zip；Note 更新正确。

---

## P2：测试覆盖与回归验证

### Task 6: 补充 Import/Export schema 的单测（关键边界）

**Files:**
- Modify: `Extensions/WebClipper/tests/smoke/backup-utils.test.ts`
- Create: `Extensions/WebClipper/tests/smoke/backup-zip-schema.test.ts`

**Step 1: 实现功能**
- 覆盖至少三类场景：
  - 数据转换：manifest + bundle 校验通过
  - 状态变化：allowlist 过滤不会带出 token/secret
  - 边界条件：缺失字段/未知版本/非法路径（如 `../`）被拒绝

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test`
- Expected: PASS

### Task 7: 回归检查（最小冒烟）

**Step 1: 验证**
- Run: `npm --prefix Extensions/WebClipper run check`
- 手动：导出 zip -> 删除扩展数据 -> 导入 zip -> 随机打开 2–3 个会话预览/导出 Markdown
- Expected: 主流程正常；无明显性能卡死；错误提示清晰。

---

## 不确定项（执行前如需再确认）

- `conversationKey` 作为文件名暂不做长度限制（先观察真实数据形态）；如后续发现极端长文件名，再加截断策略并通过 `manifest.json` 保持可逆映射。
