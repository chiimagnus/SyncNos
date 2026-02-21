# WebClipper Notion 图片同步（P1 外链 / P2 转存）实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收。

**Goal（目标）:**  
为 WebClipper（`Extensions/WebClipper/`）的聊天同步增加“图片支持”：
- **P1**：采集聊天中的图片 URL，在 popup 预览中可显示图片 + URL，并在 Notion 中以 **external image block** 显示。  
- **P2**：将图片 URL 通过 Notion 的 `file_uploads (external_url)` **转存为 Notion 托管图片**（失败降级为 external，不阻断整条同步）。

**Non-goals（非目标）:**  
- 不支持 `data:` / `blob:` 图片（Notion 无法从外部 URL 抓取）。  
- 不做“Notion 侧 block diff 的精确修复”；若用户在 Notion 手动删除了部分图片/内容，下一次同步依赖现有 `rebuilt` 分支兜底。  
- 不新增任何密钥持久化（仅使用现有 Notion OAuth token）。

**Approach（方案）:**  
- 采集侧：在 `collector-utils.js` 增加通用图片 URL 抽取（`img.currentSrc/src/srcset` → 选最大，http/https 白名单去重），并为每条 message 追加 Markdown 图片语法 `![](https://...)` 写入 `contentMarkdown`（没有 markdown 的站点也补齐）。  
- UI（popup）侧：允许 markdown-it 渲染图片；图片下方显示 URL（no-referrer + 仅 http/https）。  
- 同步侧（P1）：在 `notion-sync-service.js` 的 `markdownToNotionBlocks()` 增加图片语法解析，将 `![]()` 转为 Notion `image` block（`type=external`）。  
- 同步侧（P2）：新增 Notion File Upload API 封装（`/v1/file_uploads`，`Notion-Version=2025-09-03`），在写入 blocks 前将 external image URL 预先升级为 `file_upload` image block（短期缓存 url→uploadId，失败降级）。

**Acceptance（验收）:**  
- P1：任一支持站点（ChatGPT/Claude/Gemini/DeepSeek/Kimi/豆包/元宝/z.ai/NotionAI）的对话中出现图片时：
  - popup 预览可看到图片 + URL
  - Sync 到 Notion 页面可看到对应图片（external image）
- P2：开启转存后，部分可访问图片会变为 Notion `file_upload` 图片；不可转存的仍 external；整体同步不失败。  
- 验证通过：
  - `npm --prefix Extensions/WebClipper run test`
  - `npm --prefix Extensions/WebClipper run check`
  - `npm --prefix Extensions/WebClipper run build`

---

## P1：外链图片（采集 + popup 预览 + Notion external image）

### Task 1: collector-utils 增加图片 URL 抽取与 markdown 追加

**Files:**
- Modify: `Extensions/WebClipper/src/collectors/collector-utils.js`
- Test: `Extensions/WebClipper/tests/smoke/collector-utils-images.test.ts`（新增）

**Step 1: 实现功能**
- 新增 `extractImageUrlsFromElement(el)`：
  - 读取 `img.currentSrc/src/srcset`，选取尽可能“最大”的 URL
  - 仅保留 `http/https`，去重
- 新增 `appendImageMarkdown(markdown, imageUrls)`：
  - 对每个 URL 追加一行 `![](url)`（确保与正文间有空行）

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test`
- Expected: 新增用例 PASS

---

### Task 2: 所有 collector 采集图片并写入 contentMarkdown

**Files:**
- Modify:
  - `Extensions/WebClipper/src/collectors/chatgpt-collector.js`
  - `Extensions/WebClipper/src/collectors/claude-collector.js`
  - `Extensions/WebClipper/src/collectors/gemini-collector.js`
  - `Extensions/WebClipper/src/collectors/deepseek-collector.js`
  - `Extensions/WebClipper/src/collectors/kimi-collector.js`
  - `Extensions/WebClipper/src/collectors/doubao-collector.js`
  - `Extensions/WebClipper/src/collectors/yuanbao-collector.js`
  - `Extensions/WebClipper/src/collectors/zai/zai-collector.js`
  - `Extensions/WebClipper/src/collectors/notionai/notionai-collector.js`
- Test: `Extensions/WebClipper/tests/smoke/collectors-images-smoke.test.ts`（新增）

**Step 1: 实现功能**
- 对每条 message：
  - 用 `collector-utils.extractImageUrlsFromElement()` 从消息 wrapper 或内容节点抽取图片 URL
  - 用 `collector-utils.appendImageMarkdown()` 把图片追加到 `contentMarkdown`
  - 没有 markdown 的站点也要写 `contentMarkdown`（至少等于 `contentText`）

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test`
- Expected: 新增用例 PASS

---

### Task 3: popup 预览渲染图片 + 显示 URL

**Files:**
- Modify: `Extensions/WebClipper/src/ui/popup/popup-chat-preview.js`
- Modify（如需）: `Extensions/WebClipper/src/ui/styles/popup.css`

**Step 1: 实现功能**
- 在 markdown-it token 渲染中允许 `image`：
  - 仅当 `src` 为 http/https 时创建 `<img>`（`loading="lazy"` + `referrerpolicy="no-referrer"`）
  - 图片下方附一个可点击 URL（`target="_blank"`）

**Step 2: 验证**
- 手动：打开 popup → 预览含图片对话 → 可见图片与 URL

---

### Task 4: Notion 同步端支持 Markdown 图片语法 → external image block

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-service.js`
- Test: `Extensions/WebClipper/tests/smoke/notion-sync-service-markdown.test.ts`

**Step 1: 实现功能**
- 在 `markdownToNotionBlocks()` 的逐行解析中新增图片识别（优先级高于 paragraph）：
  - 识别 `![](...)` / `![alt](...)`，抽取 URL
  - 仅当 URL 为 `http/https` 时生成 block：
    - `{ object:"block", type:"image", image:{ type:"external", external:{ url } } }`

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test`
- Expected: `notion-sync-service-markdown` 新增用例 PASS

---

### Task 5: 手动回归（P1）

**Step 1: 回归清单**
- 在任一支持站点找一个含图片的对话（至少 1 张图片）。  
- 打开 popup 勾选该对话 → Sync。  
- Expected：Notion 页面出现图片（external），不影响其它文本/代码块渲染。

**Step 2: 构建校验**
- Run: `npm --prefix Extensions/WebClipper run check`
- Run: `npm --prefix Extensions/WebClipper run build`
- Expected: PASS

---

## P2：Notion 转存（file_uploads external_url）

### Task 6: WebClipper 增加 Notion File Upload API 封装

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-api.js`
- Create: `Extensions/WebClipper/src/sync/notion/notion-files-api.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background.js`
- Test: `Extensions/WebClipper/tests/smoke/notion-files-api.test.ts`（新增）

**Step 1: 实现功能**
- 扩展 `notionFetch()` 支持可选 `notionVersion` 覆盖（默认仍为 `2022-06-28`）。  
- 新增 `notion-files-api.js`：
  - `createExternalURLUpload({ accessToken, url, filename, contentType })` → `POST /v1/file_uploads`（`notionVersion="2025-09-03"`）
  - `retrieveUpload({ accessToken, id })` → `GET /v1/file_uploads/:id`
  - `waitUntilUploaded({ accessToken, id })`：轮询 status（pending/uploaded/failed/expired），设置最大次数与间隔

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test`
- Expected: smoke test PASS

---

### Task 7: 写入前把 external image URL 升级为 file_upload image block（失败降级）

**Files:**
- Modify: `Extensions/WebClipper/src/sync/notion/notion-sync-service.js`
- Modify: `Extensions/WebClipper/src/bootstrap/background-router.js`
- Test: `Extensions/WebClipper/tests/smoke/background-router-notion-sync.test.ts`（补用例）

**Step 1: 实现功能**
- 在 `notion-sync-service.js` 新增：
  - `upgradeImageBlocksToFileUploads(accessToken, blocks)`：遍历 blocks，将 external image URL 尝试转存为 file_upload（Map 缓存 url→id）
- 在 `background-router.js` 同步逻辑中，在 `appendChildren` 前调用 upgrade（仅当 blocks 内存在 image external 时触发）

**Step 2: 验证**
- Run: `npm --prefix Extensions/WebClipper run test`
- Expected: 新增用例 PASS；现有 notion sync 流程不回归

---

### Task 8: 手动回归（P2）

**Step 1: 回归清单**
- 对同一含图片的对话 Sync：
  - Expected：部分图片变为 Notion 托管（file_upload）；不可转存的仍 external；整体同步不失败。

**Step 2: 构建校验**
- Run: `npm --prefix Extensions/WebClipper run check`
- Run: `npm --prefix Extensions/WebClipper run build`
- Expected: PASS

