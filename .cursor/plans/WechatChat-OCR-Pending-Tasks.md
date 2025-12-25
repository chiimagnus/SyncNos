# 微信聊天 OCR 待办事项（V2 后续迭代）

> 本文档记录 WechatChat OCR V2 重构完成后，尚未实现或明确推迟的功能。  
> 关联文档：
> - `.cursor/plans/WechatChat-OCR-Parsing-TechDoc.md`

---

## 一、明确推迟的功能（计划文档中标为"不做"）

### 1. 群聊昵称绑定
- **状态**：⏸️ 暂不实现
- **原因**：计划文档明确"先把私聊做稳定，群聊后续单独迭代"
- **当前情况**：
  - 代码已预留 `senderName` 字段
  - `WechatMessage` 和 `CachedWechatMessageV2` 都支持 `senderName`
  - UI 中 `MessageBubble` 已处理 `senderName` 显示
- **后续计划**：
  - 基于 bbox 几何规则判断昵称位置（消息气泡上方小字）
  - 可能需要增加昵称检测的可配置阈值

### 2. 系统消息关键词识别
- **状态**：⏸️ 暂不实现
- **原因**：计划文档明确"解析器不包含业务字符串硬编码"
- **当前情况**：
  - 使用纯几何规则（两阶段 k-means）检测居中系统/时间戳
  - 不依赖"撤回""红包""加入群聊"等关键词
- **后续计划**：
  - 如需要，可作为可选能力（默认关闭）引入
  - 关键词表应外置为配置，不硬编码在解析器中

### 3. 截图拼接
- **状态**：⏸️ 暂不实现
- **原因**：计划文档明确"后续单独立项"
- **后续计划**：
  - 可能需要检测重叠消息并去重
  - 考虑基于消息内容或 bbox 匹配进行智能拼接

### 4. Notion 同步
- **状态**：⏸️ 暂不实现
- **原因**：计划文档明确"保持 WechatChat 独立模块"
- **后续计划**：
  - 如需同步，需创建 `WechatChatNotionAdapter` 适配器
  - 遵循 `NotionSyncSourceProtocol` 协议

---

## 二、可选增强功能（计划文档中标为"建议逐步加"）

### 1. Debug Overlay（bbox 可视化）【放弃❌】
- **状态**：🚫 已撤回（2024-12-24）
- **备注**：
  - 曾在 2024-12-24 实现并测试通过
  - 后续评估认为当前阶段不需要此功能
  - 如需重新引入，参考原实现思路：
    - 创建独立的 debug overlay 视图
    - 显示 bbox 矩形、方向颜色、消息序号
    - 支持缩放和滚动
- **相关代码已删除**：
  - `Views/WechatChat/WechatChatDebugOverlayView.swift`（已删除）
  - `Views/WechatChat/WechatChatDetailView.swift`（Debug 按钮已移除）

### 2. 消息分类调整功能
- **状态**：✅ 已实现（2024-12-24，键盘快捷键 2024-12-25）
- **功能描述**：
  - 用户可以右键点击消息气泡，手动修正消息的归属分类
  - 支持：对方消息、我的消息、系统消息
  - 分类结果持久化到 SwiftData
  - **键盘快捷键支持**（2024-12-25 新增）：
    - Option + ↑/↓：上下选择消息
    - Option + ←/→：循环切换消息分类（对方 ↔ 系统 ↔ 我的）
    - 点击消息可选中，选中消息显示蓝色边框高亮
- **实现细节**：
  - 使用 SwiftUI `.contextMenu` 覆盖系统右键菜单
  - 菜单包含"复制"按钮（补偿系统菜单被覆盖的问题）
  - 分类选项带有 checkmark 指示当前状态
  - 使用 `.onKeyPress()` 监听 Option + 方向键
  - 使用 `@FocusState` 管理焦点状态
- **相关文件**：
  - `Views/WechatChat/WechatChatDetailView.swift`（MessageBubble、SystemMessageRow 添加 contextMenu + 键盘快捷键）
  - `ViewModels/WechatChat/WechatChatViewModel.swift`（updateMessageClassification 方法）
  - `Services/DataSources-From/WechatChat/WechatChatCacheService.swift`（updateMessageClassification 方法）
- **详细计划文档**：
  - `.cursor/plans/WechatChat-消息分类调整功能计划.md`
  - `.cursor/plans/WechatChat-键盘快捷键分类切换功能计划.md`

### 2. 解析日志详细输出
- **状态**：⏸️ 待实现
- **技术文档描述**：
  - 每张截图输出：输入 blocks 数、过滤后 blocks 数、候选消息数、左/右消息数
- **当前情况**：
  - `WechatOCRParser` 内部没有详细日志
  - ViewModel 有基础日志（消息数量）
- **实现建议**：
  - 在 `WechatOCRParser.parse()` 中增加 debug 日志
  - 可选：返回解析统计信息供 UI 展示

### 3. OCR 请求参数 Profile 化
- **状态**：⏸️ 待评估
- **技术文档描述**：
  - 后续如需提升群聊/暗色小字识别，再引入 profile
- **当前情况**：
  - 已预留 `OCRRequestConfig.wechatChat`（开启方向矫正）
  - 当前统一使用 `OCRRequestConfig.default`
- **实现建议**：
  - 可在设置中增加"OCR 优化模式"开关
  - 或自动检测图片特征选择 profile

---

## 三、技术债务/优化项

### 1. 离线重解析功能【放弃❌】
- **状态**：⏸️ 架构已支持，功能未实现
- **技术文档描述**：
  - 从 store 读出 `normalizedBlocksJSON`
  - 反序列化为 blocks
  - 用当前版本 `WechatOCRParser` 重新 parse
  - 覆盖/重写该截图对应的消息集合
- **当前情况**：
  - `ocrResponseJSON` 和 `normalizedBlocksJSON` 已持久化
  - 缺少重解析入口方法
- **实现建议**：
  - 在 `WechatChatCacheService` 增加 `reparse(screenshotId:)` 方法
  - 或在 ViewModel 增加批量重解析功能

### 2. 噪声区域过滤（可开关）
- **状态**：⏸️ 待评估
- **技术文档描述**：
  - 当私聊稳定后再把过滤作为可开关能力引入
  - 使用 Debug 面板验证不误删
- **当前情况**：
  - 完全禁用 top/bottom 过滤（保证不漏）
- **实现建议**：
  - 在 `WechatChatParseConfig` 增加 `enableNoiseFilter` 开关
  - 需配合 Debug Overlay 验证

### 3. 图片/语音/卡片类型识别
- **状态**：⏸️ 待实现
- **技术文档描述**：
  - 当前统一按 `text` 展示
  - 后续再增强 image/voice/card 识别
- **当前情况**：
  - `WechatMessageKind` 已定义 `.image/.voice/.card`
  - 解析器当前只输出 `.text` 或 `.system`
- **实现建议**：
  - 基于 OCR block 的 `label` 字段识别图片区域
  - 或结合 bbox 特征（宽高比、面积）判断

---

## 四、优先级建议

| 优先级 | 功能 | 状态 | 理由 |
|--------|------|------|------|
| P1 | 群聊昵称绑定 | ⏸️ | 群聊场景需求明确 |
| P2 | Debug Overlay | 🚫 已撤回 | 当前阶段不需要 |
| P2 | 离线重解析 | ⏸️ | 算法迭代必备 |
| P3 | 解析日志 | ⏸️ | 排障辅助 |
| P3 | 截图拼接 | ⏸️ | 提升用户体验 |
| P4 | OCR Profile 化 | ⏸️ | 边缘场景优化 |
| P4 | Notion 同步 | ⏸️ | 取决于产品规划 |

---

## 五、代码预留点

以下代码位置已预留扩展能力：

1. **`WechatOCRParser.swift`**
   - `config: WechatChatParseConfig` 支持自定义参数
   - 可扩展增加群聊昵称绑定逻辑

2. **`WechatChatCacheModels.swift`**
   - `CachedWechatMessageV2.senderName` 已预留
   - `WechatOCRBlockSnapshot` 支持离线重解析

3. **`OCRModels.swift`**
   - `OCRRequestConfig.wechatChat` 已预留
   - 可扩展其他 profile

4. **`WechatChatCacheService.swift`**
   - `fetchOcrPayload()` 支持 Debug 面板
   - 可扩展重解析方法

