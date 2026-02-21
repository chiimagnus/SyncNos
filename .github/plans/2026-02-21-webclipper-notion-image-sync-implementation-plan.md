# WebClipper Notion 图片同步（P1 外链图片 / P2 Notion 转存）实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收。

**Goal（目标）:**  
为 WebClipper（`Extensions/WebClipper/`）的 Notion 同步增加“图片支持”：
- **P1**：采集聊天中的图片 URL，并在 Notion 中以 **external image block** 显示（先覆盖 NotionAI + z.ai）。  
- **P2**：将图片 URL 通过 Notion 的 `file_uploads (external_url)` **转存为 Notion 托管图片**（失败降级为 external）。

**Non-goals（非目标）:**  
- 不支持 `data:` / `blob:` 图片（没有可供 Notion 抓取的外部 URL）。  
- 不保证所有图片都能显示：若图片 URL 需要登录/签名过期/403，Notion 侧可能无法访问；P2 会尽力转存，失败再降级。  
- P1 仅覆盖 NotionAI + z.ai；其它站点后续按需扩展。

**Approach（方案）:**  
- 采集侧：在 `notionai-markdown.js` 与 `zai-markdown.js` 的 HTML→Markdown 转换中增加 `<img src>` 识别，输出 Markdown 图片语法 `![](https://...)`（仅 http/https）。  
- 同步侧（P1）：在 `notion-sync-service.js` 的 `markdownToNotionBlocks()` 增加图片语法解析，将 `![]()` 转为 Notion `image` block（`type=external`）。  
- 同步侧（P2）：新增 Notion File Upload API 封装（`/v1/file_uploads`，version=2025-09-03），在 blocks 生成阶段把 external image URL 转换为 `file_upload` image block；并加入 URL→uploadId 的短期缓存。

**Acceptance（验收）:**  
- P1：NotionAI / z.ai 的对话中出现图片时，Sync 到 Notion 页面可看到对应图片（external image）。  
- P1：`npm --prefix Extensions/WebClipper run test` 通过，新增测试覆盖：
  - `<img src>` → `![]()`（NotionAI + z.ai markdown）
  - `![]()` → Notion image external block（sync service）
- P2：开启转存后，能将部分可访问的图片转为 Notion `file_upload` 图片；不可转存时仍显示 external（不阻断整体同步）。  
- P2：`npm --prefix Extensions/WebClipper run test` / `run check` / `run build` 通过。

---

## P1：外链图片（NotionAI + z.ai）

### Task 1: NotionAI markdown 提取支持 `<img>` → `![]()`

**Files:**
- Modify: `Extensions/WebClipper/src/collectors/notionai/notionai-markdown.js`
- Test: `Extensions/WebClipper/tests/collectors/notionai-collector.test.ts`（或新增 `notionai-markdown.test.ts`）

**Step 1: 实现功能**
- 在 `nodeToMarkdown()` 增加 `img` tag 处理：
  - 读取 `src` 与 `alt`
  - 仅当 `src` 为 `http/https` 时输出 `![alt](src)`（alt 为空可用空字符串）
  - 非 http/https 返回空字符串或 alt 文本（避免引入无效 URL）

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test`
- Expected: 新增用例 PASS

---

### Task 2: z.ai markdown 提取支持 `<img>` → `![]()`

**Files:**
- Modify: `Extensions/WebClipper/src/collectors/zai/zai-markdown.js`
- Test: `Extensions/WebClipper/tests/collectors/zai-collector.test.ts`

**Step 1: 实现功能**
- 在 `htmlToMarkdown()` 的 `renderNode()` 增加 `img` tag 处理：
  - 读取 `src`/`alt`
  - 仅 `http/https` 输出 `![alt](src)`，并确保在段落内不会粘连（必要时前后加换行）

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test`
- Expected: 新增用例 PASS

---

### Task 3: Notion 同步端支持 Markdown 图片语法 → external image block

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-service.js`
- Test: `Extensions/WebClipper/tests/smoke/notion-sync-service-markdown.test.ts`

**Step 1: 实现功能**
- 在 `markdownToNotionBlocks()` 的逐行解析中新增图片识别（优先级高于 paragraph）：
  - 识别 `![](...)` / `![alt](...)`，抽取 URL
  - 仅当 URL 为 `http/https` 时生成 block：
    - `{ object:"block", type:"image", image:{ type:"external", external:{ url } } }`
  - caption/alt 暂不写入（P1 MVP），或写入为 `caption`（可选）

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test`
- Expected: `notion-sync-service-markdown` 新增用例 PASS

---

### Task 4: 手动回归（P1）

**Step 1: 回归清单**
- 在 NotionAI / z.ai 中找一个含图片的对话（至少 1 张图片）。  
- 打开 popup 勾选该对话 → Sync。  
- Expected：Notion 页面出现图片（external），不影响其它文本/代码块渲染。

**Step 2: 构建校验**
- Run: `npm --prefix Extensions/WebClipper run check`
- Run: `npm --prefix Extensions/WebClipper run build`
- Expected: PASS

---

## P2：Notion 转存（file_uploads external_url）

### Task 5: WebClipper 增加 Notion File Upload API 封装

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-api.js`
- Create: `Extensions/WebClipper/src/sync/notion/notion-files-api.js`
- Test: `Extensions/WebClipper/tests/smoke/notion-files-api.test.ts`（新增）

**Step 1: 实现功能**
- 扩展 `notionFetch()` 支持可选 `notionVersion` 覆盖（默认仍为 `2022-06-28`）。  
- 新增 `notion-files-api.js`：
  - `createExternalURLUpload({ accessToken, url, filename, contentType })` → `POST /v1/file_uploads`（`notionVersion="2025-09-03"`）
  - `retrieveUpload({ accessToken, id })` → `GET /v1/file_uploads/:id`
  - `waitUntilUploaded({ accessToken, id })`：轮询 status（pending/uploaded/failed/expired），设置最大次数与间隔

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test`
- Expected: mock notionFetch 的 smoke test PASS

---

### Task 6: blocks 生成阶段把 external image URL 转存为 file_upload image block（失败降级）

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-service.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background-router.js`
- Test: `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`（新增/补用例）

**Step 1: 实现功能**
- 在 `notion-sync-service.js` 新增 async 路径（示例命名）：
  - `messagesToBlocksAsync(accessToken, messages, options)` 或 `markdownToNotionBlocksAsync(accessToken, markdown)`
  - 对图片 URL：优先 `notionFilesApi` 转存并生成 `file_upload` image block；失败则 external image block
  - 增加 `imageUploadCache`（Map url→uploadId，短期缓存，避免同一批次重复转存）
- 在 `background-router.js` 的同步逻辑中切换到 async blocks 生成（仅对包含图片的消息触发，或提供 feature flag）。

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test`
- Expected: 新增用例 PASS；现有 notion sync 流程测试不回归

---

### Task 7: 手动回归（P2）

**Step 1: 回归清单**
- 对同一含图片的对话 Sync：
  - Expected：部分图片变为 Notion 托管（file_upload）；不可转存的仍 external；整体同步不失败。

**Step 2: 构建校验**
- Run: `npm --prefix Extensions/WebClipper run check`
- Run: `npm --prefix Extensions/WebClipper run build`
- Expected: PASS

---

## 不确定项（执行时需确认）
- NotionAI / z.ai 图片 DOM 结构可能包含 lazy-loaded URL、srcset、或非 img 标签（需按实际页面补规则）。  
- Notion `file_uploads` API 对 URL 可访问性要求高：签名短链/需 cookie 的图片大概率转存失败；应确保失败降级且不阻断整体同步。

