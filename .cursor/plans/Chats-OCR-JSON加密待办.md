# Chats OCR JSON 加密待办

> **创建日期**：2025-12-28  
> **状态**：✅ 已完成（方案 B）  
> **优先级**：P3（低）  
> **关联文档**：`.cursor/plans/Chats-本地存储加密计划.md`

---

## 一、问题描述

~~当前 `CachedChatScreenshotV2` 模型中，OCR 原始响应和归一化 blocks 以**明文存储**~~

**已解决**：2025-12-30 采用方案 B，完全删除 OCR JSON 字段。

## 二、解决方案

### 采用方案 B：删除 OCR 原始 JSON ✅

**删除的字段**：
- `ocrRequestJSON: Data?`
- `ocrResponseJSON: Data`
- `normalizedBlocksJSON: Data`

**删除的功能**：
- `ChatOCRPayloadSheet` 调试视图
- `fetchRecentOcrPayloads()` / `fetchOcrPayload()` 方法
- `ChatOcrPayloadSummary` / `ChatOcrPayloadDetail` DTO

**破坏性变更**：
- 新 store 文件：`chats_v3_minimal.store`（原 `chats_v2_encrypted.store`）
- 用户现有 Chat 数据需要重新导入

## 三、当前加密状态

### CachedChatConversationV2（对话）

| 字段 | 加密状态 |
|------|----------|
| `conversationId` | ❌ 明文（UUID，非敏感）|
| `nameEncrypted` | ✅ AES-256-GCM |
| `createdAt/updatedAt` | ❌ 明文（非敏感）|

### CachedChatMessageV2（消息）

| 字段 | 加密状态 |
|------|----------|
| `messageId/conversationId/screenshotId` | ❌ 明文（UUID，非敏感）|
| `contentEncrypted` | ✅ AES-256-GCM |
| `senderNameEncrypted` | ✅ AES-256-GCM |
| `isFromMe/kindRaw/order/bboxJSON` | ❌ 明文（非敏感）|

### CachedChatScreenshotV2（截图元数据）

| 字段 | 加密状态 |
|------|----------|
| `screenshotId/conversationId` | ❌ 明文（UUID，非敏感）|
| `importedAt/parsedAt` | ❌ 明文（非敏感）|
| `imageWidth/imageHeight` | ❌ 明文（非敏感）|
| `ocrEngine` | ❌ 明文（非敏感）|

**所有敏感内容（消息文本、发送者昵称、对话名称）现在都已加密存储。**

---

## 变更日志

| 日期 | 描述 |
|------|------|
| 2025-12-28 | 创建待办文档 |
| 2025-12-30 | 采用方案 B 完成，删除 OCR JSON 字段 |

