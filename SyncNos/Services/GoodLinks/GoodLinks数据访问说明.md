### GoodLinks 数据访问说明（macOS）

- **应用/容器标识**
  - 主容器：`~/Library/Containers/com.ngocluu.goodlinks`（以及扩展 `com.ngocluu.goodlinks.*`）
  - 共享容器（数据实际存放处）：`~/Library/Group Containers/group.com.ngocluu.goodlinks`

- **核心数据路径**（可直接只读访问）
  - 数据库：`~/Library/Group Containers/group.com.ngocluu.goodlinks/Data/data.sqlite`
  - WAL/SHM：`data.sqlite-wal`、`data.sqlite-shm`
  - 辅助 JSON：
    - `~/Library/Group Containers/group.com.ngocluu.goodlinks/Data/widget-highlight-lists.json`
    - `~/Library/Group Containers/group.com.ngocluu.goodlinks/Data/widget-links.json`

- **SQLite 表结构（摘录）**
  - `link`
    - `id TEXT PRIMARY KEY`
    - `url TEXT NOT NULL`（文章 URL）
    - `originalURL TEXT`（原始 URL）
    - `title TEXT`（标题）
    - `summary TEXT`（摘要）
    - `author TEXT`（作者）
    - `tags TEXT`（逗号或空格分隔标签）
    - `starred BOOLEAN NOT NULL`
    - `readAt DOUBLE NOT NULL`（时间戳，秒，常见为 Unix 时间/浮点）
    - `addedAt DOUBLE NOT NULL`
    - `modifiedAt DOUBLE NOT NULL`
    - `fetchStatus INTEGER NOT NULL`、`status INTEGER NOT NULL` 等
    - `highlightTotal INTEGER`（该链接下高亮数量）
  - `highlight`
    - `id TEXT PRIMARY KEY`
    - `linkID TEXT NOT NULL`（关联 `link.id`）
    - `content TEXT NOT NULL`（高亮文本）
    - `parts TEXT NOT NULL`（内部片段描述，JSON/文本）
    - `color INTEGER`（高亮颜色枚举）
    - `note TEXT`（备注）
    - `time DOUBLE NOT NULL`（创建/发生时间）
    - `order INTEGER NOT NULL`（排序）
    - `rtl BOOLEAN NOT NULL DEFAULT 0`（是否右到左）
    - `status BOOLEAN NOT NULL`
    - `ts DOUBLE NOT NULL DEFAULT 0`
  - `tag`
    - `id TEXT PRIMARY KEY NOT NULL`
    - `depth INTEGER NOT NULL`
    - `total INTEGER NOT NULL`
    - `unreadTotal INTEGER NOT NULL`
  - 其余：`content`、`scroll`、`action`、`state`、`custom_action`、`main_list` 等

- **主外键关系**
  - `highlight.linkID -> link.id`（高亮隶属于某链接/文章）

- **时间字段说明**
  - `readAt`/`addedAt`/`modifiedAt`/`time`/`ts` 等为 `DOUBLE`，为秒级时间戳（含小数）
  - 通常可按 Unix Epoch 解析。若发现异常，可根据具体值范围切换到 macOS Reference Date（2001-01-01）进行判断

- **典型查询**
  - 列出最近更新的链接：
    - `SELECT id, url, title, summary, author, readAt, addedAt, modifiedAt, highlightTotal FROM link ORDER BY modifiedAt DESC LIMIT 50;`
  - 列出最近的高亮：
    - `SELECT id, linkID, content, color, note, time FROM highlight ORDER BY time DESC LIMIT 50;`
  - 按链接聚合高亮数量（若不使用 `highlightTotal`）：
    - `SELECT linkID, COUNT(*) FROM highlight GROUP BY linkID;`

- **数据导出（示例）**
  - 导出链接为 CSV：
    - `sqlite3 -readonly data.sqlite -csv "SELECT id,url,title,summary,author,readAt,addedAt,modifiedAt,highlightTotal FROM link;" > goodlinks_links.csv`
  - 导出高亮为 CSV：
    - `sqlite3 -readonly data.sqlite -csv "SELECT id,linkID,content,color,note,time FROM highlight;" > goodlinks_highlights.csv`

- **权限与注意事项**
  - 本地用户级路径，无需额外沙盒授权即可只读访问（在本机用户环境）
  - 如需跨 App 沙盒访问，建议通过用户选择文件夹并保存安全书签（Security-scoped Bookmark）
  - GoodLinks 的 iCloud 同步不影响本地 SQLite 的读取，但 WAL/SHM 存在时建议用 `-readonly` 打开

- **与 SyncNos 的映射建议**
  - 将 `link` 映射为 `Article` 模型：`id`、`url`、`title`、`author`、`summary`、`highlightTotal`
  - 将 `highlight` 映射为 `GLHighlight` 模型：`id`、`linkID`、`content`、`note`、`color`、`time`
  - 后续可提供“按链接 -> 高亮”的增量同步能力，使用 `modifiedAt`/`time` 作为游标

## 完整字段一览（基于实际数据库 PRAGMA）

- action
  - `id TEXT PRIMARY KEY`
  - `data BLOB NOT NULL`

- content
  - `id TEXT PRIMARY KEY NOT NULL`（外键参照 `link.id`，删除级联）
  - `content TEXT`
  - `wordCount INTEGER NOT NULL`
  - `videoDuration INTEGER`（可空）

- custom_action
  - `id TEXT PRIMARY KEY NOT NULL`
  - `name TEXT NOT NULL`
  - `content TEXT NOT NULL`
  - `type INTEGER NOT NULL`
  - `icon TEXT NOT NULL`
  - `color INTEGER NOT NULL`
  - `order INTEGER NOT NULL`
  - `status BOOLEAN NOT NULL`

- deleting
  - `id INTEGER PRIMARY KEY`（自增）
  - `eid TEXT NOT NULL`
  - `type INTEGER NOT NULL`
  - `deletedAt DOUBLE NOT NULL`

- extra
  - `id TEXT PRIMARY KEY`
  - `info TEXT`

- grdb_migrations
  - `identifier TEXT PRIMARY KEY NOT NULL`

- highlight
  - `id TEXT PRIMARY KEY NOT NULL`
  - `linkID TEXT NOT NULL`（外键参照 `link.id`，删除级联）
  - `content TEXT NOT NULL`
  - `parts TEXT NOT NULL`
  - `color INTEGER`（可空）
  - `note TEXT`（可空）
  - `time DOUBLE NOT NULL`
  - `order INTEGER NOT NULL`
  - `rtl BOOLEAN NOT NULL DEFAULT 0`
  - `status BOOLEAN NOT NULL`
  - `ts DOUBLE NOT NULL DEFAULT 0`

- link
  - `id TEXT PRIMARY KEY`
  - `url TEXT NOT NULL`
  - `originalURL TEXT`
  - `title TEXT`
  - `summary TEXT`
  - `author TEXT`
  - `preview TEXT`
  - `tags TEXT`
  - `starred BOOLEAN NOT NULL`
  - `readAt DOUBLE NOT NULL`
  - `addedAt DOUBLE NOT NULL`
  - `modifiedAt DOUBLE NOT NULL`
  - `fetchStatus INTEGER NOT NULL`
  - `status INTEGER NOT NULL`
  - `highlightTotal INTEGER`（可空）
  - `imageDownloaded BOOLEAN NOT NULL DEFAULT 0`
  - `fileSynced BOOLEAN NOT NULL DEFAULT 0`
  - `publishedAt DOUBLE NOT NULL DEFAULT 0`
  - `deletedAt DOUBLE NOT NULL DEFAULT 0`
  - `authorImage TEXT`
  - `folderID TEXT`
  - `imageSynced BOOLEAN NOT NULL DEFAULT 0`

- main_list
  - `id TEXT PRIMARY KEY NOT NULL`
  - `total INTEGER NOT NULL`
  - `unreadTotal INTEGER NOT NULL`
  - `order INTEGER NOT NULL`
  - `isHidden BOOLEAN NOT NULL`
  - `lastOpenedAt DOUBLE NOT NULL DEFAULT 0`

- scroll
  - `id TEXT PRIMARY KEY NOT NULL`（外键参照 `link.id`，删除级联）
  - `value TEXT NOT NULL`
  - `status BOOLEAN NOT NULL`
  - `ts DOUBLE NOT NULL DEFAULT 0`

- state
  - `id TEXT PRIMARY KEY`
  - `data BLOB NOT NULL`

- tag
  - `id TEXT PRIMARY KEY NOT NULL`
  - `depth INTEGER NOT NULL`
  - `total INTEGER NOT NULL`
  - `unreadTotal INTEGER NOT NULL`
  - `lastOpenedAt DOUBLE NOT NULL DEFAULT 0`
  - `lastUsedAt DOUBLE NOT NULL DEFAULT 0`

## 外键约束
- `highlight.linkID -> link.id ON DELETE CASCADE`
- `content.id -> link.id ON DELETE CASCADE`
- `scroll.id -> link.id ON DELETE CASCADE`

## 索引（节选）
- `content_temp_on_content`
- `deleting_on_eid`
- `extra_on_info`
- `hl_temp_on_linkID`
- 以及自动索引：`sqlite_autoindex_*`（由 PRIMARY KEY/UNIQUE 生成）

## 类型/时间/布尔值说明
- BOOLEAN 以 0/1 存储；建议在应用层使用 `Bool` 映射
- 时间戳字段（如 `readAt`、`addedAt`、`modifiedAt`、`time`、`ts` 等）为 `DOUBLE` 秒；通常为 Unix Epoch 秒（含小数）
- 文本字段默认 `NOCASE` 比较规则（见建表语句），若做去重/比较需注意大小写

## 典型联表示例
- 最近高亮及其所属链接：
  - `SELECT h.id, h.linkID, h.content, h.color, h.note, h.time, l.title, l.url FROM highlight h JOIN link l ON h.linkID = l.id ORDER BY h.time DESC LIMIT 50;`
