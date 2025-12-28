# Chats OCR JSON 加密待办

> **创建日期**：2025-12-28  
> **状态**：⏸️ 待处理  
> **优先级**：P3（低）  
> **关联文档**：`.cursor/plans/Chats-本地存储加密计划.md`

---

## 一、问题描述

当前 `CachedChatScreenshotV2` 模型中，OCR 原始响应和归一化 blocks 以**明文存储**：

```swift
// CachedChatScreenshotV2
var ocrRequestJSON: Data?        // ❌ 明文
var ocrResponseJSON: Data        // ❌ 明文（包含消息文本！）
var normalizedBlocksJSON: Data   // ❌ 明文（包含消息文本！）
```

这与消息内容加密（`contentEncrypted`）形成矛盾：用户可以直接从 `ocrResponseJSON` 读取明文消息内容。

## 二、影响范围

| 字段 | 加密状态 | 包含敏感内容 |
|------|----------|-------------|
| `contentEncrypted` | ✅ 加密 | 是 |
| `senderNameEncrypted` | ✅ 加密 | 是 |
| `nameEncrypted` | ✅ 加密 | 是 |
| `ocrResponseJSON` | ❌ 明文 | **是**（OCR 识别的文本）|
| `normalizedBlocksJSON` | ❌ 明文 | **是**（含消息文本）|

## 三、建议方案

### 方案 A：加密 OCR JSON 字段（推荐）

修改模型，添加加密版本：

```swift
// 加密存储
var ocrResponseJSONEncrypted: Data
var normalizedBlocksJSONEncrypted: Data

// 解密访问器
var ocrResponseJSON: Data {
    try? EncryptionService.shared.decrypt(ocrResponseJSONEncrypted)
}
```

**需要**：
- 数据模型迁移（SwiftData lightweight migration）
- 现有数据加密迁移脚本

### 方案 B：删除 OCR 原始 JSON

因为"离线重解析"功能已放弃（见 `Chats-OCR-Pending-Tasks.md`），可以考虑删除这些字段。

**需要**：
- 删除字段后的数据迁移
- 更新 `ChatsCacheService` 相关方法

### 方案 C：暂不处理

- 这些数据仅用于调试（#if DEBUG）
- 用户可通过删除缓存清除

## 四、决策

**当前决策**：暂不处理，后续迭代时再处理

**理由**：
1. 优先完成群聊昵称功能
2. OCR JSON 主要用于调试，普通用户不会接触
3. 需要数据迁移，涉及复杂度较高

## 五、后续 TODO

- [ ] 评估方案 A/B 的实现成本
- [ ] 设计数据迁移策略
- [ ] 实现加密或删除

---

## 变更日志

| 日期 | 描述 |
|------|------|
| 2025-12-28 | 创建待办文档 |

