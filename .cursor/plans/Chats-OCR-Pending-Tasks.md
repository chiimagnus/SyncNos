# 微信聊天 OCR 待办事项（V2 后续迭代）

> 本文档记录 Chats OCR V2 重构完成后，尚未实现或明确推迟的功能。  
> 关联文档：
> - `.cursor/plans/Chats-OCR-Parsing-TechDoc.md`

---

## 一、明确放弃的功能

### 1. 群聊昵称绑定 ❌
- **状态**：🚫 已放弃（2025-12-25）
- **原因**：用户明确不再实现此功能
- **备注**：代码已预留 `senderName` 字段，如需恢复可参考原设计

### 2. 离线重解析功能 ❌
- **状态**：🚫 已放弃（2025-12-25）
- **原因**：用户明确不再实现此功能
- **备注**：`normalizedBlocksJSON` 已持久化，架构支持但不实现

### 3. 消息多选（跨气泡选择）❌
- **状态**：🚫 已放弃（2025-12-25）
- **原因**：实现 iMessage 风格的跨气泡连续文本选择复杂度过高
- **当前方案**：保持单气泡内文本选择

---

## 二、明确推迟的功能

### 1. 系统消息关键词识别
- **状态**：⏸️ 暂不实现
- **原因**：计划文档明确"解析器不包含业务字符串硬编码"
- **当前情况**：
  - 使用纯几何规则（两阶段 k-means）检测居中系统/时间戳
  - 不依赖"撤回""红包""加入群聊"等关键词
- **后续计划**：
  - 如需要，可作为可选能力（默认关闭）引入
  - 关键词表应外置为配置，不硬编码在解析器中

### 2. 截图拼接
- **状态**：⏸️ 暂不实现
- **原因**：计划文档明确"后续单独立项"
- **后续计划**：
  - 可能需要检测重叠消息并去重
  - 考虑基于消息内容或 bbox 匹配进行智能拼接

### 3. Notion 同步
- **状态**：⏸️ 暂不实现
- **原因**：计划文档明确"保持 Chats 独立模块"
- **后续计划**：
  - 如需同步，需创建 `ChatsNotionAdapter` 适配器
  - 遵循 `NotionSyncSourceProtocol` 协议

---

## 三、已完成功能

### 1. 消息分类调整功能 ✅
- **状态**：✅ 已实现（2025-12-24，键盘快捷键 2025-12-25）
- **功能描述**：
  - 用户可以右键点击消息气泡，手动修正消息的归属分类
  - 支持：对方消息、我的消息、系统消息
  - 分类结果持久化到 SwiftData
  - **键盘快捷键支持**（2025-12-25 新增）：
    - Option + ↑/↓：上下选择消息
    - Option + ←/→：循环切换消息分类（对方 ↔ 系统 ↔ 我的）
    - 点击消息可选中，选中消息显示蓝色边框高亮
- **相关文件**：
  - `Views/Chats/ChatsDetailView.swift`
  - `ViewModels/Chats/ChatsViewModel.swift`
  - `Services/DataSources-From/Chats/ChatsCacheService.swift`

### 2. 🔐 聊天记录本地存储加密 ✅
- **状态**：✅ 已实现（2025-12-25）
- **方案**：CryptoKit AES-GCM + Keychain 存储密钥（Apple 官方推荐）
- **加密范围**：消息内容、发送者昵称、对话名称
- **安全特性**：
  - AES-256-GCM 认证加密
  - 密钥存储在 macOS Keychain
  - 每次加密使用不同 nonce（防重放攻击）
  - 不同步到 iCloud Keychain
- **相关文件**：
  - `Services/Core/EncryptionService.swift`（新增）
  - `Models/Chats/ChatsCacheModels.swift`（修改）
  - `Services/DataSources-From/Chats/ChatsCacheService.swift`（修改）
- **详细计划**：`.cursor/plans/Chats-本地存储加密计划.md`

### 3. 分页加载 ✅
- **状态**：✅ 已实现（2025-12-26）
- **功能描述**：
  - 消息列表分页加载，每页 50 条
  - 支持"加载更多"按钮和滚动触发加载
  - 优化大量消息（2000+）的性能
- **相关文件**：
  - `ViewModels/Chats/ChatsViewModel.swift`（添加分页状态管理）
  - `Views/Chats/ChatsDetailView.swift`（添加加载更多 UI）
  - `Services/DataSources-From/Chats/ChatsCacheService.swift`（添加分页查询方法）
- **详细计划**：`.cursor/plans/Chats-分页加载实现计划.md`

### 4. 导入导出功能 ✅
- **状态**：✅ 已实现（2025-12-26）
- **功能描述**：
  - **导出**：支持 JSON 和 Markdown 格式
  - **导入**：支持从 JSON 和 Markdown 文件导入对话
  - **拖拽**：支持拖拽图片（触发 OCR）和 JSON/MD 文件（触发导入）
  - **UI**：统一的 Import/Export 菜单
- **Markdown 格式规范**：
  - 发送者使用 `# Name`
  - 系统消息使用 `# System`
  - "我" 统一使用 `Me`
- **相关文件**：
  - `Services/DataSources-From/Chats/ChatsExporter.swift`（新增）
  - `Services/DataSources-From/Chats/ChatsImporter.swift`（新增）
  - `ViewModels/Chats/ChatsViewModel.swift`（添加导入导出方法）
  - `Views/Chats/ChatsDetailView.swift`（添加菜单和拖拽支持）
- **详细计划**：`.cursor/plans/Chats-导入导出功能实现计划.md`

### 5. Debug Overlay ❌
- **状态**：🚫 已撤回（2025-12-24）
- **备注**：当前阶段不需要此功能

---

## 四、待实现功能

### 1. 解析日志详细输出
- **状态**：⏸️ 待实现
- **技术文档描述**：
  - 每张截图输出：输入 blocks 数、过滤后 blocks 数、候选消息数、左/右消息数
- **实现建议**：
  - 在 `WechatOCRParser.parse()` 中增加 debug 日志
  - 可选：返回解析统计信息供 UI 展示

### 3. OCR 请求参数 Profile 化
- **状态**：⏸️ 待评估
- **技术文档描述**：
  - 后续如需提升群聊/暗色小字识别，再引入 profile
- **实现建议**：
  - 可在设置中增加"OCR 优化模式"开关
  - 或自动检测图片特征选择 profile

### 4. 图片/语音/卡片类型识别
- **状态**：⏸️ 待实现
- **技术文档描述**：
  - 当前统一按 `text` 展示
  - 后续再增强 image/voice/card 识别
- **实现建议**：
  - 基于 OCR block 的 `label` 字段识别图片区域
  - 或结合 bbox 特征（宽高比、面积）判断

---

## 五、优先级建议

| 优先级 | 功能 | 状态 | 理由 |
|--------|------|------|------|
| P1 | 本地存储加密 | ✅ 已完成 | 隐私保护需求明确 |
| P1 | 分页加载 | ✅ 已完成 | 性能优化必需 |
| P1 | 导入导出 | ✅ 已完成 | 数据备份和迁移 |
| P2 | 截图拼接 | ⏸️ | 提升用户体验 |
| P3 | 解析日志 | ⏸️ | 排障辅助 |
| P3 | Notion 同步 | ⏸️ | 取决于产品规划 |
| P4 | OCR Profile 化 | ⏸️ | 边缘场景优化 |

---

## 六、代码预留点

以下代码位置已预留扩展能力：

1. **`WechatOCRParser.swift`**
   - `config: ChatsParseConfig` 支持自定义参数

2. **`ChatsCacheModels.swift`**
   - `CachedWechatMessageV2.senderName` 已预留
   - `WechatOCRBlockSnapshot` 支持离线重解析

3. **`OCRModels.swift`**
   - `OCRRequestConfig.chats` 已预留
   - 可扩展其他 profile

4. **`ChatsCacheService.swift`**
   - `fetchOcrPayload()` 支持 Debug 面板
   - 可扩展加密/解密方法
