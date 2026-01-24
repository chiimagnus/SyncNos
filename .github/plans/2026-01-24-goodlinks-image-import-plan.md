# GoodLinks 图片转存到 Notion（P4）实施计划

> 执行方式：建议使用 `executing-plans` 按批次实现与验收。

**Goal（目标）:** GoodLinks 文章中的图片全部转存为 Notion 内部文件（File Upload），同步顺序不变，失败时回退为 external image。

**Non-goals（非目标）:**
- 不实现 multi-part（>20MB）上传；仅覆盖 `external_url` 导入路径。
- 不新增 UI 开关（配置仅代码层）。
- 不做跨文章/跨同步的全局去重缓存。

**Approach（方案）:**
- 新增 Notion File Upload 操作层，使用 `mode=external_url` 创建 file upload，并轮询状态至 `uploaded`。
- 为 file upload 请求单独指定 Notion API Version（2025-09-03），避免影响现有 2022-06-28 版本接口。
- NotionHTMLToBlocksConverter 在处理图片时调用上传服务，成功使用 `file_upload` 类型的 image block，失败回退到 `external`。

**Acceptance（验收）:**
**Status**
- ✅ Build: `xcodebuild -scheme SyncNos build`
- ⏳ Manual: Notion 端图片显示验收待执行

- 同步包含多张图片的 GoodLinks 文章，Notion 页内图片为 Notion-hosted（`file_upload`）。
- 任一图片导入失败时仍可同步整篇文章，失败图片回退为 external image。
- `xcodebuild -scheme SyncNos build` 成功。

---

## Plan A（主方案）

### P1：新增 Notion File Upload 基础能力

#### Task 1: 为 NotionRequestHelper 增加版本覆盖与配置常量

**Status**
- ✅ 已完成（2026-01-24）：新增 file upload 版本/轮询常量并支持 versionOverride。

**Files**
- Modify: `SyncNos/Services/DataSources-To/Notion/Core/NotionRequestHelper.swift`
- Modify: `SyncNos/Services/DataSources-To/Notion/Configuration/NotionSyncConfig.swift`

**Step 1: 添加配置常量**
- 新增 `notionFileUploadVersion = "2025-09-03"`  
- 新增 `fileUploadPollIntervalMs` / `fileUploadMaxAttempts`（轮询用）

**Step 2: 扩展请求方法以支持版本覆盖**
```swift
let data = try await requestHelper.performRequest(
    path: "file_uploads",
    method: "POST",
    body: payload,
    versionOverride: NotionSyncConfig.notionFileUploadVersion
)
```

**Verify**
- Build: `xcodebuild -scheme SyncNos build`

---

#### Task 2: 新建 NotionFileUploadOperations（external_url + 轮询）

**Status**
- ✅ 已完成（2026-01-24）：支持 external_url 创建与轮询上传状态。

**Files**
- Create: `SyncNos/Services/DataSources-To/Notion/Operations/NotionFileUploadOperations.swift`

**Step 1: 定义模型与错误**
- `NotionFileUpload`（id/status/upload_url/filename/content_type）
- `NotionFileUploadError`（failed/expired/timeout）

**Step 2: 实现 create + retrieve + wait**
```swift
let upload = try await fileUploadOps.createExternalURLUpload(
    url: imageURL,
    filename: "image.jpg",
    contentType: "image/jpeg"
)
let ready = try await fileUploadOps.waitUntilUploaded(id: upload.id)
```
> external_url 需要 filename：缺省时从 URL path 或 content_type 推断并补齐。

**Verify**
- Build: `xcodebuild -scheme SyncNos build`

---

### P2：在 NotionService 暴露“导入图片”能力

#### Task 3: 扩展 NotionServiceProtocol / NotionService

**Status**
- ✅ 已完成（2026-01-24）：新增 importImageFromExternalURL 接口并接入 NotionFileUploadOperations。

**Files**
- Modify: `SyncNos/Services/Core/Protocols.swift`
- Modify: `SyncNos/Services/DataSources-To/Notion/Core/NotionService.swift`

**Step 1: 新增协议方法**
- `importImageFromExternalURL(url: URL, filename: String?, contentType: String?) async throws -> String`

**Step 2: NotionService 内部委托 NotionFileUploadOperations**
```swift
let fileUploadId = try await notionService.importImageFromExternalURL(
    url: imageURL,
    filename: "cover.jpg",
    contentType: "image/jpeg"
)
```

**Verify**
- Build: `xcodebuild -scheme SyncNos build`

---

### P3：NotionHTMLToBlocksConverter 将图片转为 file_upload

#### Task 4: 转换器集成上传 + 失败回退

**Status**
- ✅ 已完成（2026-01-24）：图片转为 file_upload，失败回退 external；已加入 URL 级缓存与依赖注入。

**Files**
- Modify: `SyncNos/Services/DataSources-To/Notion/Core/NotionHTMLToBlocksConverter.swift`
- Modify: `SyncNos/Services/Core/DIContainer.swift`（注入依赖）

**Step 1: 增加上传依赖与去重缓存**
- 依赖：`NotionServiceProtocol`（或新增轻量协议）
- 缓存：`[String: String]`（url → fileUploadId）

**Step 2: 图片处理逻辑**
```swift
if let fileUploadId = try? await notionService.importImageFromExternalURL(url: imageURL, filename: nil, contentType: nil) {
    return makeFileUploadImageBlock(id: fileUploadId)
}
return makeExternalImageBlock(urlString: imageURL.absoluteString)
```

**Step 3: 保序输出**
- 使用 `for item in items { ... await ... }` 逐条处理，保证顺序一致。

**Verify**
- Build: `xcodebuild -scheme SyncNos build`

---

### P4：集成与验收

#### Task 5: 同步管线确认（如签名变更）

**Status**
- ✅ 已确认（2026-01-24）：同步管线无需额外修改。

**Files**
- Modify (if needed): `SyncNos/Services/DataSources-To/Notion/SyncEngine/Adapters/GoodLinksNotionAdapter.swift`

**Verify**
- Build: `xcodebuild -scheme SyncNos build`

---

## Manual Verification（手动验收）

**Status**: ⏳ 待人工执行


1. 同步含多图的 GoodLinks 文章 → Notion 页面图片显示为 Notion-hosted（非 external）。
2. 用无效图片 URL（或屏蔽网络）同步 → 该图片回退 external，不影响其他内容。
3. Build: `xcodebuild -scheme SyncNos build`

---

## 不确定项（已确认）

- **API 路径**：已确认使用 `POST /v1/file_uploads` 与 `GET /v1/file_uploads/{id}`。
- **轮询上限**：当前为 `fileUploadMaxAttempts = 20`、`fileUploadPollIntervalMs = 800`，可按需要调整。
 - **图片类型**：external_url 会补齐 filename（URL path / query / content_type 推断），必要时推断 content_type；默认 image.jpg。
- **URL 方案**：HTTP 图片在上传时自动升级为 HTTPS（Notion 仅接受 HTTPS）。
---

## Bugfix（同步无高亮正文）

**Issue**
- ✅ 已修复（2026-01-24）：无高亮的 GoodLinks 文章不会追加正文。

**Fix**
- 新增 NotionService `pageHasHeading`，无高亮且页面已存在时补齐 Article 头部块。
- 新页面仍保持先追加 Article，再追加高亮。

**Files**
- Modify: `SyncNos/Services/Core/Protocols.swift`
- Modify: `SyncNos/Services/DataSources-To/Notion/Core/NotionService.swift`
- Modify: `SyncNos/Services/DataSources-To/Notion/SyncEngine/NotionSyncEngine.swift`

**Verify**
- Build: `xcodebuild -scheme SyncNos build`
