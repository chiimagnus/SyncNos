## CLI 计划：Apple Books 笔记全面读取（先不做 Notion 与 App）

### 范围与目标
- **目标**：在本机上通过 CLI 读取 Apple Books 的高亮与批注数据，尽可能“最全面”地获取字段，并支持导出为本地文件（JSON/JSONL/CSV/Markdown）。
- **不做**：Notion 同步、GUI/App、visionOS、定时与常驻守护。

### 路线图与任务清单

#### M0：工程初始化与最小可运行（能读到基础字段）
- [ ] **初始化 SwiftPM CLI 工程**（macOS 14+，Swift 6.1）。
  - 二进制名暂定：`syncbooknotes`。
  - 依赖：加入 `swift-argument-parser`；数据库优先原生 `SQLite3`（零依赖，M0），`GRDB` 可在后续里程碑切换；抽象存储层以便替换。
- [ ] **命令结构**（采用 `swift-argument-parser` 或自建轻量解析）：
  - `inspect`：打印 Apple Books 数据库位置、表清单、记录统计。
  - `export`：导出数据（默认 JSON），支持 `--format json|jsonl|csv|md`、`--out <path>`。
  - `sample`：示例输出前 N 条（`--limit`）。
  - `--db-root`：可选覆盖根路径，默认自动探测。
  - 全局：`--pretty`、`--overwrite`、`--progress`、`--quiet`、`--verbose`。
- [x] **数据库路径自动探测**：
  - `~/Library/Containers/com.apple.iBooksX/Data/Documents/AEAnnotation/*.sqlite`
  - `~/Library/Containers/com.apple.iBooksX/Data/Documents/BKLibrary/*.sqlite`
  - 若存在多个 `.sqlite`，选择最新修改时间；均不存在则输出可诊断错误与建议。
  - 若只读打开失败或 DB 被占用：复制到临时目录只读打开（可选 `immutable=1`）。
- [x] **最小查询跑通**（与参考插件一致）：
  - 从 `ZAEANNOTATION` 读取：`ZANNOTATIONASSETID`、`ZANNOTATIONUUID`、`ZANNOTATIONSELECTEDTEXT`（过滤删除/空文本）。
  - 从 `ZBKLIBRARYASSET` 读取：`ZASSETID`、`ZAUTHOR`、`ZTITLE`。
  - 合并为内存模型：`Book{assetId,title,author,ibooksURL}`、`Highlight{uuid,text}`。
- [x] **基础导出**：按书聚合导出 JSON；校验编码与换行处理。
  - 规范化文本：去除首尾空白，保留段内换行；过滤全空白行。
  - 文件名清洗：移除/替换非法字符，避免覆盖；支持 `--overwrite`。
  - JSON 输出：默认 UTF-8，支持 `--pretty`。

验收（M0）：可运行 `inspect` 与 `export`，导出包含（书名/作者/AssetID/UUID/文本）的 JSON 文件。

#### M1：表结构探测与字段最大化（“最全面”）
- [ ] **运行时表结构探测**：
  - 使用 `PRAGMA table_info('ZAEANNOTATION')`、`PRAGMA table_info('ZBKLIBRARYASSET')`、必要时遍历所有表 `SELECT name FROM sqlite_master WHERE type='table'`。
  - 根据探测到的列名构建动态查询，确保不同 macOS/Books 版本下尽量取全字段。
- [ ] **高亮/批注字段扩充（尽量覆盖）**：
  - 文本：`ZANNOTATIONSELECTEDTEXT`
  - 批注/笔记：常见列如 `ZANNOTATIONNOTE`/`ZANNOTATIONTEXT`（以探测为准）
  - 颜色/样式：如 `ZANNOTATIONSTYLE`（值→颜色名称映射）
  - 创建/修改时间：如 `ZANNOTATIONDATEADDED`/`ZANNOTATIONMODIFIED`（CoreFoundation 2001 epoch → ISO8601，含时区）
  - 位置信息：章节名/索引、页码、spine/anchor/cfi/range start-end（常见列如 `ZANNOTATIONLOCATION`/`ZRANGESTART`/`ZRANGEEND`，可能为数值、字符串或 BLOB）
  - 关联键：`ZANNOTATIONUUID`、`ZANNOTATIONASSETID`（用于关联书籍）
- [ ] **BLOB/归档字段解析（可选但重要）**：
  - 若位置/样式等以 `NSKeyedArchiver` 或二进制 Plist 形式存储，尝试用 `PropertyListSerialization`/开源解码实现还原主要键值。
  - 解析失败时保留原始十六进制/BASE64 字段，避免信息丢失。
- [ ] **模型与导出结构升级**：
  - `Highlight{ uuid,text,note?,color?,createdAt?,modifiedAt?,chapter?,page?,location?{start?,end?,cfi?,spine?},raw?{...} }`
  - `Book{ assetId,title,author,ibooksURL, highlights:[Highlight] }`
- [ ] **字段存在性与降级策略**：
  - 缺列不报错，标记为 `null` 或缺省；将“已探测列/缺失列”写入 `inspect` 输出。

验收（M1）：导出包含批注、颜色、时间、位置信息等尽量完整的结构；对未知/解析失败的字段，以 `raw` 携带保序输出。

#### M2：导出能力与开发者体验
- [ ] **导出格式**：
  - JSON（分书聚合）
  - JSONL（逐高亮一行，便于后续管道处理）
  - CSV（关键字段扁平化，使用安全分隔与转义）
  - Markdown（每本书一个文件或合并单文件；可选 `--one-file-per-book`）
- [ ] **过滤与选择**：`--book "title|assetId"`、`--author xxx`、`--since <date>`、`--color in [yellow,green,...]`、`--has-note`。
- [ ] **日志与诊断**：`--verbose` 输出 SQL、命中路径、列映射、样例记录；`sample --limit N` 快速验证。

验收（M2）：多格式导出稳定；过滤与选择器可组合使用；`--verbose` 提供定位信息。

#### M3：稳定性、健壮性与测试
- [ ] **错误处理**：单条解析失败不影响整体，记录到 `stderr` 与可选日志文件。
- [ ] **单元测试**：
  - 列探测与查询构建
  - BLOB/Plist 解码
  - 导出格式转换与转义
- [ ] **集成测试**：
  - 使用脱敏/合成的 AEAnnotation 与 BKLibrary 小样本库
  - 跨版本列差异回归
- [ ] **性能**：
  - 大量高亮时分批读取与流式写出（尤其 JSONL/CSV），避免内存峰值。

验收（M3）：在真实大库上运行稳定、内存可控、错误可追踪。

### 目录结构（建议）
- `Sources/
  - syncbooknotes/`（CLI 入口与命令）
  - `Core/`（模型、协议、错误）
  - `BooksStore/`（SQLite 访问与解析，包含列探测与解码）
  - `Exporters/`（JSON/JSONL/CSV/Markdown 导出实现）
- `Tests/` 对应子模块测试

### 字段优先级（汇总，按重要性）
1. **书籍**：`assetId`、`title`、`author`、`ibooks://assetid/<id>`
2. **高亮主键**：`uuid`
3. **内容**：`text`、`note`
4. **时间**：`createdAt`、`modifiedAt`
5. **样式**：`color/style`（数值→名称映射）
6. **位置**：`chapter`、`page`、`location{start,end,cfi,spine}`
7. **原始**：`raw`（未识别或解析失败字段，便于后续演进）

### 风险与应对
- **列名/表结构跨版本差异**：采用 PRAGMA 探测 + 动态查询 + 缺列降级。
- **BLOB/归档格式不公开**：尽力解析，失败时保留原始数据并记录样例。
- **权限/路径差异**：提供 `--db-root` 覆盖；`inspect` 给出诊断建议。

### 验收清单（最终）
- [ ] `inspect` 能列出数据库路径、表/列、记录数量、缺失列提示。
- [ ] `export` 能导出 JSON/JSONL/CSV/Markdown，字段覆盖面达到上述优先级 1-6，多版本兼容。
- [ ] 在包含上千条高亮的库上运行稳定，错误可定位，导出可被下游工具直接消费。
